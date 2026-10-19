const ORIGIN = "chrome://zoteroPaperTranslate";
const REALM = "ChatGPT OAuth";
const USERNAME = "chatgpt";

const MAX_TOKEN_LENGTH = 16384;
const MAX_ACCOUNT_ID_LENGTH = 512;
const MAX_EMAIL_LENGTH = 320;

export interface CodexCredentials {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
  email?: string;
}

type LoginInit = (
  origin: string,
  formActionOrigin: string | null,
  httpRealm: string | null,
  username: string,
  password: string,
) => void;

type FindLogins = (
  origin: string,
  formActionOrigin: string | null,
  httpRealm: string | null,
) => nsILoginInfo[];

let queue: Promise<void> = Promise.resolve();

/**
 * Serializes credential-store operations so a queued clear always observes the
 * effects of an earlier save. Rejections are consumed at the queue tail and
 * never poison later operations.
 */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function malformedCredentials(): Error {
  return new Error(
    "Saved ChatGPT credentials are invalid. Sign out of ChatGPT and sign in again to replace them.",
  );
}

function unavailableStore(): Error {
  return new Error(
    "Zotero's encrypted credential store could not be accessed. Restart Zotero, then sign out of ChatGPT and sign in again.",
  );
}

function multipleRecords(): Error {
  return new Error(
    "Multiple saved ChatGPT credential entries were found. Sign out of ChatGPT and sign in again to repair them.",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasLineBreak(value: string): boolean {
  return value.includes("\r") || value.includes("\n");
}

function validateToken(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_TOKEN_LENGTH ||
    hasLineBreak(value)
  ) {
    throw malformedCredentials();
  }
  return value;
}

function validateAccountId(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ACCOUNT_ID_LENGTH ||
    hasLineBreak(value)
  ) {
    throw malformedCredentials();
  }
  return value;
}

function validateExpiry(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw malformedCredentials();
  }
  return value;
}

function validateEmail(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length > MAX_EMAIL_LENGTH ||
    hasLineBreak(value)
  ) {
    throw malformedCredentials();
  }
  return value;
}

/** Copies only validated fields; unknown properties are dropped. */
function normalizeCredentials(value: unknown): CodexCredentials {
  if (!isRecord(value)) {
    throw malformedCredentials();
  }
  const normalized: CodexCredentials = {
    access: validateToken(value.access),
    refresh: validateToken(value.refresh),
    expires: validateExpiry(value.expires),
    accountId: validateAccountId(value.accountId),
  };
  if (value.email !== undefined) {
    normalized.email = validateEmail(value.email);
  }
  return normalized;
}

function serializeCredentials(value: CodexCredentials): string {
  return JSON.stringify(value);
}

function parseCredentials(raw: string): CodexCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw malformedCredentials();
  }
  return normalizeCredentials(parsed);
}

async function ready(): Promise<void> {
  try {
    await Zotero.initializationPromise;
    await Services.logins.initializationPromise;
  } catch {
    throw unavailableStore();
  }
}

/**
 * Only queries this add-on's own origin/realm; never enumerates all logins and
 * never touches records belonging to other realms or providers. Multiple
 * matching records mean our own namespace was corrupted and callers fail
 * closed. Every record in this private origin+realm namespace belongs to us,
 * regardless of its username.
 */
function ownLogins(): nsILoginInfo[] {
  let logins: nsILoginInfo[];
  try {
    const findLogins = Services.logins.findLogins as unknown as FindLogins;
    logins = findLogins.call(Services.logins, ORIGIN, null, REALM);
  } catch {
    throw unavailableStore();
  }
  return logins;
}

/** Fails closed unless exactly one record with the fixed username exists. */
function singleOwnLogin(): nsILoginInfo | null {
  const logins = ownLogins();
  if (logins.length === 0) {
    return null;
  }
  if (logins.length > 1) {
    throw multipleRecords();
  }
  if (logins[0].username !== USERNAME) {
    throw malformedCredentials();
  }
  return logins[0];
}

function createLogin(value: CodexCredentials): nsILoginInfo {
  try {
    const login = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(
      Ci.nsILoginInfo,
    );
    (login.init as unknown as LoginInit)(
      ORIGIN,
      null,
      REALM,
      USERNAME,
      serializeCredentials(value),
    );
    return login;
  } catch {
    throw unavailableStore();
  }
}

export async function loadCodexCredentials(): Promise<CodexCredentials | null> {
  return enqueue(async () => {
    await ready();
    const login = singleOwnLogin();
    if (!login) {
      return null;
    }
    let password: string;
    try {
      password = login.password;
    } catch {
      throw unavailableStore();
    }
    return parseCredentials(password);
  });
}

export async function saveCodexCredentials(
  value: CodexCredentials,
): Promise<void> {
  return enqueue(async () => {
    const credentials = normalizeCredentials(value);
    await ready();
    const existing = singleOwnLogin();
    const login = createLogin(credentials);
    try {
      if (existing) {
        Services.logins.modifyLogin(existing, login);
      } else {
        await Services.logins.addLoginAsync(login);
      }
    } catch {
      throw unavailableStore();
    }
  });
}

export async function clearCodexCredentials(): Promise<void> {
  return enqueue(async () => {
    await ready();
    const logins = ownLogins();
    try {
      for (const login of logins) {
        Services.logins.removeLogin(login);
      }
    } catch {
      throw unavailableStore();
    }
  });
}
