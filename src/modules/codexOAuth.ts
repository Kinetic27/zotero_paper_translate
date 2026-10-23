/**
 * ChatGPT OAuth browser login for Codex without the Codex CLI.
 *
 * Builds the PKCE authorization URL and runs a loopback-only HTTP listener on
 * the fixed redirect URI registered for the Codex client. The result carries
 * only the authorization code and PKCE verifier; token exchange and credential
 * storage are owned by the caller.
 *
 * Protocol reference: gajae-code packages/ai/src/utils/oauth/openai-codex.ts
 * (https://github.com/Yeachan-Heo/gajae-code). Its MIT notice is bundled at
 * addon/chrome/content/notices/gajae-code.txt.
 */

export const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_REDIRECT_URI = "http://localhost:1455/auth/callback";

export type CodexBrowserLogin = {
  authUrl: string;
  result: Promise<{ code: string; verifier: string }>;
  close: () => void;
};

const AUTHORIZE_URL = "https://auth.openai.com/oauth/authorize";
const PORT = 1455;
const PATH = "/auth/callback";
const HOST = `localhost:${PORT}`;
const SCOPE = "openid profile email offline_access";
const MAX_HEADER = 16 * 1024;
const MAX_SOCKETS = 8;
const SOCKET_DEADLINE = 5_000;
const LOGIN_TIMEOUT = 10 * 60_000;
const MAX_CODE = 4096;

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; ++index) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return true;
  }
  return false;
}

type LoginSocket = {
  transport: nsISocketTransport;
  input?: nsIInputStream;
  pump?: nsIInputStreamPump;
  reader?: nsIScriptableInputStream;
  deadline?: ReturnType<typeof setTimeout>;
  buffer: string;
  done: boolean;
};

const PORT_BUSY =
  `Codex sign-in could not listen on ${CODEX_REDIRECT_URI}. ` +
  `Port ${PORT} is already in use or blocked; close the application using it and retry.`;
const CANCELLED = "Codex sign-in cancelled.";
const CLOSED = "Codex sign-in was closed.";

/** XPCOM teardown steps fail when already closed; that is not actionable. */
function quiet<T>(action: () => T): T | undefined {
  try {
    return action();
  } catch {
    return undefined;
  }
}

/** Unpadded base64url; inputs here are 32 bytes, well under the spread cap. */
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

/**
 * Static ASCII response. Request query values are never reflected, so the
 * authorization code and state cannot leak into the page or its headers.
 */
function page(
  status: number,
  reason: string,
  title: string,
  message: string,
): string {
  const body = `<!doctype html><html><head><meta charset="ascii"><title>${title}</title></head><body><p>${message}</p></body></html>`;
  return (
    `HTTP/1.1 ${status} ${reason}\r\n` +
    "Content-Type: text/html; charset=ascii\r\n" +
    `Content-Length: ${body.length}\r\n` +
    "Cache-Control: no-store\r\n" +
    "Pragma: no-cache\r\n" +
    "Referrer-Policy: no-referrer\r\n" +
    "X-Content-Type-Options: nosniff\r\n" +
    "Connection: close\r\n\r\n" +
    body
  );
}

const OK = page(
  200,
  "OK",
  "Authorization received",
  "Authorization received. Return to Zotero to check sign-in.",
);
const DENIED = page(
  400,
  "Bad Request",
  "Sign-in failed",
  "Sign-in failed. Return to Zotero.",
);
const BAD = page(400, "Bad Request", "Bad request", "Bad request.");
const NOT_FOUND = page(404, "Not Found", "Not found", "Not found.");
const TOO_LARGE = page(
  431,
  "Request Header Fields Too Large",
  "Request too large",
  "Request too large.",
);

function authorizationUrl(challenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CODEX_CLIENT_ID,
    redirect_uri: CODEX_REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: "codex_cli_rs",
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

/**
 * URLSearchParams never rejects malformed escapes, so validate every pair with
 * decodeURIComponent first. Undefined means invalid percent or UTF-8 encoding.
 */
function queryParams(query: string): URLSearchParams | undefined {
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    try {
      decodeURIComponent(separator < 0 ? pair : pair.slice(0, separator));
      decodeURIComponent(separator < 0 ? "" : pair.slice(separator + 1));
    } catch {
      return undefined;
    }
  }
  return new URLSearchParams(query);
}

function headerEnd(buffer: string): number {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf < 0) return lf;
  if (lf < 0) return crlf;
  return Math.min(crlf, lf);
}

/**
 * Build the browser login. The caller opens `authUrl`; `result` settles once
 * the loopback listener accepts the authorization code. Setup failures (PKCE,
 * abort, bind) reject THIS promise, so the caller never opens the browser.
 */
export async function createCodexBrowserLogin(
  signal?: AbortSignal,
): Promise<CodexBrowserLogin> {
  const verifier = randomToken();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const state = randomToken();
  const authUrl = authorizationUrl(base64url(new Uint8Array(digest)), state);

  let settled = false;
  let server: nsIServerSocket | undefined;
  let overallTimer: ReturnType<typeof setTimeout> | undefined;
  const sockets = new Set<LoginSocket>();
  let resolveResult!: (value: { code: string; verifier: string }) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<{ code: string; verifier: string }>(
    (resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    },
  );
  // The caller may create the login before awaiting `result` (and may abandon
  // it on an early cancel), so never surface an unhandled rejection.
  result.catch(() => undefined);

  function settle(error?: Error, code?: string): void {
    if (settled) return;
    settled = true;
    if (overallTimer !== undefined) clearTimeout(overallTimer);
    overallTimer = undefined;
    signal?.removeEventListener("abort", onAbort);
    for (const socket of [...sockets]) closeSocket(socket);
    sockets.clear();
    const listening = server;
    server = undefined;
    if (listening) quiet(() => listening.close());
    if (error) rejectResult(error);
    else resolveResult({ code: code!, verifier });
  }

  function onAbort(): void {
    settle(new Error(CANCELLED));
  }

  function closeSocket(socket: LoginSocket, text?: string): void {
    if (socket.done) return;
    socket.done = true;
    if (socket.deadline !== undefined) clearTimeout(socket.deadline);
    socket.deadline = undefined;
    sockets.delete(socket);
    if (text) {
      // Write directly to the socket before closing input. A buffered output
      // stream can still have queued bytes when transport.close() discards it.
      // This small static ASCII page fits the loopback socket's send buffer.
      const output = quiet(() =>
        socket.transport.openOutputStream(
          Ci.nsITransport.OPEN_UNBUFFERED!,
          0,
          0,
        ),
      );
      quiet(() => {
        if (!output) return;
        let sent = 0;
        while (sent < text.length) {
          const written = output.write(text.slice(sent), text.length - sent);
          if (!written) break;
          sent += written;
        }
        output.flush();
      });
      if (output) quiet(() => output.close());
    }
    quiet(() => socket.pump?.cancel(Cr.NS_BINDING_ABORTED));
    quiet(() => socket.reader?.close());
    quiet(() => socket.input?.close());
    quiet(() => socket.transport.close(Cr.NS_OK));
  }

  function finish(
    socket: LoginSocket,
    text: string,
    error?: Error,
    code?: string,
  ): void {
    closeSocket(socket, text);
    if (error || code !== undefined) settle(error, code);
  }

  function handleRequest(socket: LoginSocket, head: string): void {
    const lines = head.split(/\r?\n/);
    const target = /^GET (\S+) HTTP\/1\.[01]$/.exec(lines.shift() ?? "")?.[1];
    if (!target) return finish(socket, BAD);
    const hosts: string[] = [];
    for (const line of lines) {
      if (!line) continue;
      const separator = line.indexOf(":");
      if (separator <= 0) return finish(socket, BAD);
      if (line.slice(0, separator).trim().toLowerCase() === "host") {
        hosts.push(line.slice(separator + 1).trim());
      }
    }
    // Exactly one Host naming the registered redirect; anything else is
    // answered without touching the pending login.
    if (hosts.length !== 1 || hosts[0]!.toLowerCase() !== HOST)
      return finish(socket, BAD);
    const queryStart = target.indexOf("?");
    if ((queryStart < 0 ? target : target.slice(0, queryStart)) !== PATH) {
      // Also answers browser favicon probes with 404.
      return finish(socket, NOT_FOUND);
    }
    const params =
      queryStart < 0
        ? new URLSearchParams()
        : queryParams(target.slice(queryStart + 1));
    // Never settle the pending login from an unvalidated caller.
    const states = params?.getAll("state") ?? [];
    if (!params || states.length !== 1 || states[0] !== state)
      return finish(socket, BAD);
    const errors = params.getAll("error");
    const codes = params.getAll("code");
    // An OAuth error may complete the login only alone, with a single non-empty
    // value; ambiguous error/code combinations stay pending like bad state.
    if (
      errors.length > 1 ||
      (errors.length === 1 && (!errors[0] || codes.length > 0))
    ) {
      return finish(socket, BAD);
    }
    if (errors.length === 1) {
      return finish(
        socket,
        DENIED,
        new Error("Codex sign-in was denied in the browser."),
      );
    }
    const code = codes.length === 1 ? codes[0]! : "";
    if (!code || code.length > MAX_CODE || hasControlCharacter(code))
      return finish(socket, BAD);
    finish(socket, OK, undefined, code);
  }

  function accept(transport: nsISocketTransport): void {
    if (sockets.size >= MAX_SOCKETS) {
      quiet(() => transport.close(Cr.NS_ERROR_UNEXPECTED));
      return;
    }
    const socket: LoginSocket = { transport, buffer: "", done: false };
    sockets.add(socket);
    // Absolute deadline from accept: trickled data cannot extend it.
    socket.deadline = setTimeout(() => closeSocket(socket), SOCKET_DEADLINE);

    const listener = {
      QueryInterface: ChromeUtils.generateQI([Ci.nsIStreamListener]),
      // A GET carries no body, so nothing is consumed on start.
      onStartRequest(): void {},
      onDataAvailable(
        _request: nsIRequest,
        stream: nsIInputStream,
        _offset: number,
        _count: number,
      ): void {
        if (socket.done) return;
        try {
          if (!socket.reader) {
            socket.reader = Cc[
              "@mozilla.org/scriptableinputstream;1"
            ].createInstance(Ci.nsIScriptableInputStream);
            socket.reader.init(stream);
          }
          // Only buffered bytes are read, so this never blocks.
          const available = socket.reader.available();
          if (available > 0) {
            socket.buffer += socket.reader.read(
              Math.min(available, MAX_HEADER + 1),
            );
          }
        } catch {
          closeSocket(socket);
          return;
        }
        if (socket.buffer.length > MAX_HEADER) return finish(socket, TOO_LARGE);
        const end = headerEnd(socket.buffer);
        // A split request is buffered until its header terminator arrives.
        if (end >= 0) handleRequest(socket, socket.buffer.slice(0, end));
      },
      onStopRequest(): void {
        if (!socket.done) closeSocket(socket);
      },
    };

    try {
      // nsITransport.OPEN_UNBUFFERED; zero sizes select transport defaults.
      socket.input = transport.openInputStream(
        Ci.nsITransport.OPEN_UNBUFFERED!,
        0,
        0,
      );
      socket.pump = Cc[
        "@mozilla.org/network/input-stream-pump;1"
      ].createInstance(Ci.nsIInputStreamPump);
      socket.pump.init(socket.input, 0, 0, true);
      socket.pump.asyncRead(listener);
    } catch {
      closeSocket(socket);
    }
  }

  const serverListener = {
    QueryInterface: ChromeUtils.generateQI([Ci.nsIServerSocketListener]),
    onSocketAccepted(
      _serv: nsIServerSocket,
      transport: nsISocketTransport,
    ): void {
      accept(transport);
    },
    onStopListening(): void {
      // Only reached while the bound server we own is still registered.
      if (!settled && server) {
        settle(
          new Error(
            "Codex sign-in listener stopped unexpectedly. Retry the login.",
          ),
        );
      }
    },
  };

  const close = (): void => {
    settle(new Error(CLOSED));
  };

  if (signal?.aborted) {
    settle(new Error(CANCELLED));
    throw new Error(CANCELLED);
  }

  let created: nsIServerSocket | undefined;
  try {
    created = Cc["@mozilla.org/network/server-socket;1"].createInstance(
      Ci.nsIServerSocket,
    );
    // Loopback only; the port is fixed by the registered redirect URI.
    created.init(PORT, true, -1);
    created.asyncListen(serverListener);
    if (created.port !== PORT) throw new Error("unexpected callback port");
    server = created;
  } catch {
    if (created) quiet(() => created!.close());
    settle(new Error(PORT_BUSY));
    throw new Error(PORT_BUSY);
  }

  if (signal?.aborted) {
    settle(new Error(CANCELLED));
    throw new Error(CANCELLED);
  }

  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) {
    // Abort may have fired between the check above and listener registration.
    settle(new Error(CANCELLED));
    throw new Error(CANCELLED);
  }
  overallTimer = setTimeout(() => {
    settle(new Error("Codex sign-in timed out. Retry the login."));
  }, LOGIN_TIMEOUT);

  return { authUrl, result, close };
}
