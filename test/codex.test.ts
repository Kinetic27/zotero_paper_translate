import { config } from "../package.json";
import { getPref, setPref } from "../src/utils/prefs";
import type Addon from "../src/addon";
import {
  loginCodex,
  cancelCodexLogin,
  logoutCodex,
  getCodexStatus,
  shutdownCodex,
  translateWithCodex,
} from "../src/modules/codex";
import {
  loadCodexCredentials,
  saveCodexCredentials,
  clearCodexCredentials,
} from "../src/modules/codexCredentials";
import type { TranslateTask } from "../src/utils/task";
import { createServiceSettingsDialog } from "../src/utils/settingsDialog";

// Real Zotero loopback sockets, browser-settings controls and encrypted login
// manager; only outbound OpenAI HTTPS is replaced. Fixture text is not evidence
// of authenticated account access or model translation quality.
describe("Direct ChatGPT OAuth in native Zotero", function () {
  this.timeout(20000);
  const tokenURL = "https://auth.openai.com/oauth/token";
  const modelsURL =
    "https://chatgpt.com/backend-api/codex/models?client_version=0.163.0";
  const responseURL = "https://chatgpt.com/backend-api/codex/responses";
  const origin = "chrome://zoteroPaperTranslate";
  const realm = "ChatGPT OAuth";
  const registeredService = () =>
    (Zotero as unknown as Record<string, Addon>)[
      config.addonInstance
    ].data.translate.services.getServiceById("codex")!;
  let isolated = false;
  let originalRequest: typeof Zotero.HTTP.request;
  let originalLaunch: typeof Zotero.launchURL;
  let originalAdd: typeof Services.logins.addLoginAsync;
  let nativeLogins: { addLoginAsync: typeof Services.logins.addLoginAsync };
  const originalPrefs = new Map<string, unknown>();
  let opened = "",
    mode = "valid",
    cancelled = 0;
  let release: (() => void) | undefined;
  const calls: { method: string; url: string; options: Record<string, any> }[] =
    [];
  const base64 = (value: string) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(value)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const access = (id: string) =>
    `${base64('{"alg":"none"}')}.${base64(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "test-account" }, "https://api.openai.com/profile": { email: "독자@example.invalid" }, jti: id }))}.test-signature`;
  const initialCredentials = () => ({
    access: access("initial"),
    refresh: "test-refresh-token",
    expires: Date.now() + 3600000,
    accountId: "test-account",
    email: "독자@example.invalid",
  });
  const message = {
    id: "message-1",
    type: "message",
    role: "assistant",
    status: "completed",
    content: [{ type: "output_text", text: "번역된 문장 [MATH_0]." }],
  };
  const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
  const completed = () =>
    frame({
      type: "response.completed",
      response: { id: "response-1", status: "completed", output: [message] },
    });
  const successfulStream = () =>
    ": keep-alive\r\n\r\n" +
    frame({
      type: "response.created",
      response: { id: "response-1", status: "in_progress" },
    }) +
    frame({
      type: "response.output_text.delta",
      item_id: "message-1",
      delta: "번역",
    }) +
    `data: {"type":"response.output_item.done",\r\ndata: "item":${JSON.stringify(message)}}\r\n\r\n` +
    completed() +
    "data: [DONE]\r\n\r\n";
  const wait = async (condition: () => boolean | Promise<boolean>) => {
    const deadline = Date.now() + 7000;
    while (!(await condition())) {
      if (Date.now() > deadline)
        assert.fail("ChatGPT test operation did not settle.");
      await Zotero.Promise.delay(10);
    }
  };
  const rejected = async (promise: Promise<unknown>, expected?: string) => {
    let error: unknown;
    try {
      await promise;
    } catch (caught) {
      error = caught;
    }
    assert.exists(
      error,
      "Failure must not publish partial or fabricated success",
    );
    if (expected)
      assert.include(String(error).toLowerCase(), expected.toLowerCase());
    assert.notInclude(String(error), "private-error-secret");
    assert.notInclude(String(error), "test-refresh-token");
  };
  const localRequest = (url: string) => {
    const options = {
      successCodes: false as const,
      followRedirects: false,
      timeout: 5000,
      logBodyLength: 0,
      debug: false,
      anon: true,
    };
    return originalRequest.call(Zotero.HTTP, "GET", url, options);
  };
  const callback = (query?: string) => {
    const state = new URL(opened).searchParams.get("state")!;
    return localRequest(
      `http://localhost:1455/auth/callback?${query ?? `code=test-code&state=${encodeURIComponent(state)}`}`,
    );
  };
  const signIn = async () => {
    await loginCodex();
    assert.equal((await callback()).status, 200);
    await wait(async () =>
      (await getCodexStatus()).includes("Signed in with ChatGPT"),
    );
  };
  const endpointCalls = (url: string) =>
    calls.filter((call) => call.url === url);
  const openSettings = async () => {
    await createServiceSettingsDialog(registeredService());
    let dialog: Window | undefined;
    await wait(() => {
      const window = Services.wm.getMostRecentWindow(
        "",
      ) as unknown as Window | null;
      if (
        window?.document.querySelector("#codex-login") &&
        window.document.querySelector('[data-setting-key="codex.model"]')
      )
        dialog = window;
      return !!dialog;
    });
    return dialog!;
  };
  const visible = (dialog: Window, id: string) =>
    dialog.document.getElementById(id)!.getClientRects().length > 0;
  const openChoices = async (dialog: Window, key: string, keyboard = false) => {
    const picker =
      dialog.document.querySelector<HTMLButtonElement>(
        `[data-setting-picker="${key}"]`,
      ) ||
      dialog.document.querySelector<HTMLSelectElement>(
        `select[data-setting-key="${key}"]`,
      )!;
    assert.isAbove(picker.getClientRects().length, 0);
    await wait(() => !picker.disabled);
    // The toolkit schedules its final sizeToContent 300 ms after dialog load.
    await Zotero.Promise.delay(350);
    dialog.focus();
    picker.focus();
    await wait(() => dialog.document.hasFocus());
    const utils = (dialog as unknown as { windowUtils: nsIDOMWindowUtils })
      .windowUtils;
    if (keyboard)
      picker.dispatchEvent(
        new (dialog as Window & typeof globalThis).KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
        }),
      );
    else {
      const bounds = picker.getBoundingClientRect();
      const x = bounds.left + bounds.width / 2;
      const y = bounds.top + bounds.height / 2;
      utils.sendMouseEvent("mousedown", x, y, 0, 1, 0);
      utils.sendMouseEvent("mouseup", x, y, 0, 1, 0);
    }
    let popup: XULMenuPopupElement | undefined;
    await wait(() => {
      popup = (
        Array.from(
          dialog.document.querySelectorAll("menupopup"),
        ) as XULMenuPopupElement[]
      ).find((candidate) => candidate.state === "open");
      return !!popup;
    });
    const bounds = popup!.getOuterScreenRect();
    assert.isAbove(
      bounds.width,
      0,
      "The displayed choice popup must actually open",
    );
    assert.isAbove(bounds.height, 0);
    return popup!;
  };
  const choose = async (
    dialog: Window,
    key: string,
    value: string,
    expected: string[],
    keyboard = false,
  ) => {
    const popup = await openChoices(dialog, key, keyboard);
    const items = Array.from(popup.querySelectorAll("menuitem")) as Element[];
    assert.deepEqual(
      items.map((item) => item.getAttribute("value")),
      expected,
      "Verify the menu users open, not only the hidden settings values",
    );
    assert.isTrue(
      items.every((item) =>
        (Array.from(item.querySelectorAll("label")) as Element[]).some(
          (label) =>
            label.getBoundingClientRect().width > 0 &&
            label.getBoundingClientRect().height > 0,
        ),
      ),
      "Each displayed option must have a visible caption",
    );
    const item = items.find((item) => item.getAttribute("value") === value)!;
    popup.activateItem(item);
    await wait(() => popup.state === "closed");
    assert.equal(
      (
        dialog.document.querySelector(
          `[data-setting-key="${key}"]`,
        ) as HTMLSelectElement
      ).value,
      value,
    );
  };
  const nativeRecords = () =>
    (Services.logins.findLogins as any)(origin, null, realm) as nsILoginInfo[];

  before(async function () {
    try {
      // Never clear credentials in a real user profile, even if this suite is
      // accidentally launched outside the scaffold's dedicated native runtime.
      assert.isTrue(
        Zotero.DataDirectory.dir
          .replace(/\\/g, "/")
          .endsWith("/.scaffold/test/data"),
      );
      isolated = true;
      originalRequest = Zotero.HTTP.request;
      originalLaunch = Zotero.launchURL;
      nativeLogins = Services.logins.QueryInterface!(
        Ci.nsIInterfaceRequestor,
      ).getInterface(Ci.nsIVariant) as typeof nativeLogins;
      originalAdd = nativeLogins.addLoginAsync;
      for (const key of [
        "codex.model",
        "codex.reasoningEffort",
        "codex.accountRevision",
      ] as const)
        originalPrefs.set(key, getPref(key));
      Zotero.launchURL = ((url: string) => {
        opened = url;
      }) as typeof Zotero.launchURL;
      Zotero.HTTP.request = (async (
        method: string,
        url: string,
        options: Record<string, any> = {},
      ) => {
        // The native test runner itself reports events through loopback HTTP.
        if (/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\//.test(url))
          return originalRequest.call(Zotero.HTTP, method, url, options);
        calls.push({ method, url, options });
        if (mode === "native-wire" && url === responseURL)
          return originalRequest.call(
            Zotero.HTTP,
            method,
            "http://127.0.0.1:23190/codex-wire",
            options,
          );
        let status = 200,
          responseText: string;
        if (url === tokenURL) {
          const fields = new URLSearchParams(String(options.body));
          responseText = JSON.stringify({
            access_token: access(
              fields.get("grant_type") === "refresh_token"
                ? "rotated"
                : "initial",
            ),
            refresh_token:
              fields.get("grant_type") === "refresh_token"
                ? "rotated-refresh-token"
                : "test-refresh-token",
            expires_in: 3600,
          });
          if (mode === "bad-token")
            responseText = JSON.stringify({
              access_token: "private-error-secret",
              refresh_token: "test-refresh-token",
              expires_in: 3600,
            });
        } else if (url === modelsURL) {
          responseText = JSON.stringify({
            models: [
              { slug: "disabled", supported_in_api: false, priority: -2 },
              { slug: "image-only", input_modalities: ["image"], priority: -1 },
              {
                slug: "z-last",
                display_name: "Other <b>model</b>",
                priority: 9,
                supported_reasoning_levels: [
                  { effort: "medium" },
                  { effort: "xhigh" },
                ],
                default_reasoning_level: "medium",
              },
              { slug: "plain-model", priority: 99 },
              {
                slug: "text-first",
                display_name: "Text first",
                priority: 0,
                input_modalities: ["text"],
                supported_reasoning_levels: [
                  { effort: "low" },
                  { effort: "high" },
                  { effort: "low" },
                  { effort: "high\n" },
                ],
                default_reasoning_level: "low",
              },
            ],
          });
        } else if (url === responseURL) {
          responseText = successfulStream();
          if (mode === "partial")
            responseText =
              frame({ type: "response.output_text.delta", delta: "partial" }) +
              "data: [DONE]\n\n";
          if (mode === "malformed") responseText = "data: {not JSON}\n\n";
          if (mode === "incomplete")
            responseText = frame({
              type: "response.incomplete",
              response: {
                id: "response-1",
                status: "incomplete",
                output: [message],
              },
            });
          if (mode === "refusal")
            responseText =
              frame({
                type: "response.output_item.done",
                item: {
                  ...message,
                  content: [
                    { type: "refusal", refusal: "private-error-secret" },
                  ],
                },
              }) + completed();
          if (mode === "tool-after-completion")
            responseText =
              completed() +
              frame({
                type: "response.output_item.done",
                item: {
                  type: "function_call",
                  name: "read_file",
                  arguments: "private-error-secret",
                },
              });
          if (mode === "failure-after-completion")
            responseText =
              completed() +
              frame({
                type: "response.failed",
                response: {
                  id: "response-1",
                  status: "failed",
                  error: { message: "private-error-secret" },
                },
              });
          if (mode === "http-failure") {
            status = 503;
            responseText = "private-error-secret";
          }
          if (
            mode === "unauthorized" ||
            (mode === "unauthorized-once" &&
              endpointCalls(responseURL).length === 1)
          ) {
            status = 401;
            responseText = "private-error-secret";
          }
        } else
          throw new Error(
            "Unexpected external network request in a fixture test.",
          );
        const xhr = {
          status,
          responseText,
          overrideMimeType() {},
          addEventListener() {},
          removeEventListener() {},
          getResponseHeader() {
            return null;
          },
        } as unknown as XMLHttpRequest;
        options.requestObserver?.(xhr);
        return new Promise<XMLHttpRequest>((resolve, reject) => {
          options.cancellerReceiver?.(() => {
            ++cancelled;
            reject(new Error("private-error-secret"));
          });
          const heldResponse =
            url === responseURL &&
            JSON.parse(
              JSON.parse(String(options.body)).input[0].content[0].text,
            ).text === "hold";
          const heldRefresh = url === tokenURL && mode === "hold-refresh";
          if (heldResponse || heldRefresh) release = () => resolve(xhr);
          else resolve(xhr);
        });
      }) as typeof Zotero.HTTP.request;
    } catch (error) {
      assert.fail(`Native OAuth test setup failed: ${String(error)}`);
    }
  });
  beforeEach(async function () {
    if (!isolated) return;
    await shutdownCodex();
    await clearCodexCredentials();
    setPref("codex.model", "");
    setPref("codex.reasoningEffort", "");
    opened = "";
    mode = "valid";
    cancelled = 0;
    release = undefined;
    calls.length = 0;
  });
  afterEach(async function () {
    if (!isolated || !originalAdd) return;
    release?.();
    nativeLogins.addLoginAsync = originalAdd;
    await logoutCodex();
  });
  after(async function () {
    if (!isolated || !originalAdd) return;
    await shutdownCodex();
    Zotero.HTTP.request = originalRequest;
    Zotero.launchURL = originalLaunch;
    nativeLogins.addLoginAsync = originalAdd;
    for (const key of [
      "codex.model",
      "codex.reasoningEffort",
      "codex.accountRevision",
    ] as const)
      setPref(key, (originalPrefs.get(key) ?? "") as string);
  });

  it("opens compact settings and switches auth actions through cancellation, browser completion and logout", async function () {
    (globalThis as unknown as { addon: unknown }).addon = (
      Zotero as unknown as Record<string, unknown>
    )[config.addonInstance];
    const alert = Zotero.alert;
    const messages: string[] = [];
    let dialog: Window | undefined;
    let started = false;
    const cancelThroughUI = async () => {
      const count = messages.length;
      (
        dialog!.document.querySelector(
          "#codex-cancel-login",
        ) as HTMLButtonElement
      ).click();
      await wait(() => messages.length > count);
      return messages[count];
    };
    try {
      Zotero.alert = ((_window, _title, text) => {
        messages.push(text);
      }) as typeof Zotero.alert;
      dialog = await openSettings();
      assert.isAtMost(
        dialog.outerWidth,
        760,
        "Config must be compact on its first opening",
      );
      await wait(() => visible(dialog!, "codex-login"));
      assert.isFalse(visible(dialog, "codex-logout"));
      assert.isFalse(visible(dialog, "codex-cancel-login"));
      assert.isFalse(visible(dialog, "codex-status"));
      assert.notExists(
        dialog!.document.querySelector(
          '[data-pref="codex.executable"], [id*="codex.executable"], [name="codex.executable"]',
        ),
      );
      (
        dialog!.document.querySelector("#codex-login") as HTMLButtonElement
      ).click();
      started = true;
      await wait(() => messages.length > 0);
      assert.notEqual(opened, "", messages[0]);
      assert.include(messages[0], "browser");
      assert.notInclude(messages[0], "No Codex installation");
      await wait(() => visible(dialog!, "codex-cancel-login"));
      assert.isFalse(visible(dialog, "codex-login"));
      assert.isFalse(visible(dialog, "codex-logout"));
      const message = await cancelThroughUI();
      started = false;
      assert.include(message, "cancelled");
      const closed = await callback().then(
        (response) => response.status === 0,
        () => true,
      );
      assert.isTrue(closed, "Cancel must release the native callback listener");
      assert.lengthOf(endpointCalls(tokenURL), 0);
      await wait(() => visible(dialog!, "codex-login"));
      assert.isFalse(visible(dialog, "codex-cancel-login"));
      const before = messages.length;
      (
        dialog.document.querySelector("#codex-login") as HTMLButtonElement
      ).click();
      started = true;
      await wait(() => messages.length > before);
      assert.equal((await callback()).status, 200);
      await wait(() => visible(dialog!, "codex-logout"));
      started = false;
      assert.isFalse(visible(dialog, "codex-login"));
      assert.isFalse(visible(dialog, "codex-cancel-login"));
      assert.isTrue(visible(dialog, "codex-status"));
      assert.isAtMost(dialog.outerWidth, 760);
      (
        dialog.document.querySelector("#codex-logout") as HTMLButtonElement
      ).click();
      await wait(() => visible(dialog!, "codex-login"));
      assert.isFalse(visible(dialog, "codex-logout"));
      assert.isFalse(visible(dialog, "codex-status"));
      assert.lengthOf(nativeRecords(), 0);
    } finally {
      try {
        if (started) await cancelThroughUI();
      } finally {
        dialog?.close();
        Zotero.alert = alert;
      }
    }
  });

  it("validates state, callback origin and PKCE before saving only encrypted account credentials", async function () {
    const secret = getPref("secretObj"),
      revision = getPref("codex.accountRevision");
    await loginCodex();
    const url = new URL(opened),
      state = url.searchParams.get("state")!;
    assert.equal(
      url.origin + url.pathname,
      "https://auth.openai.com/oauth/authorize",
    );
    assert.equal(
      url.searchParams.get("client_id"),
      "app_EMoamEEZ73f0CkXaXp7hrann",
    );
    assert.equal(
      url.searchParams.get("redirect_uri"),
      "http://localhost:1455/auth/callback",
    );
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.include(url.searchParams.get("scope")!, "offline_access");
    for (const query of [
      "code=test-code&state=wrong",
      `code=test-code&state=${state}&state=${state}`,
      `code=test-code&error=denied&state=${state}`,
    ])
      assert.isAtLeast((await callback(query)).status, 400);
    assert.isAtLeast(
      (
        await localRequest(
          `http://127.0.0.1:1455/auth/callback?code=test-code&state=${state}`,
        )
      ).status,
      400,
    );
    assert.lengthOf(endpointCalls(tokenURL), 0);
    const response = await callback();
    assert.equal(response.status, 200);
    assert.notInclude(response.responseText, "test-code");
    assert.notInclude(response.responseText, state);
    assert.equal(response.getResponseHeader("Cache-Control"), "no-store");
    await wait(async () => !!(await loadCodexCredentials()));
    await wait(async () =>
      (await getCodexStatus()).includes("Signed in with ChatGPT"),
    );
    const token = endpointCalls(tokenURL)[0];
    const fields = new URLSearchParams(String(token.options.body));
    assert.equal(token.method, "POST");
    assert.equal(fields.get("grant_type"), "authorization_code");
    assert.equal(fields.get("code"), "test-code");
    assert.equal(
      fields.get("redirect_uri"),
      "http://localhost:1455/auth/callback",
    );
    const verifier = fields.get("code_verifier")!;
    assert.isAtLeast(verifier.length, 43);
    assert.isAtMost(verifier.length, 128);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    assert.equal(
      btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, ""),
      url.searchParams.get("code_challenge"),
    );
    assert.lengthOf(nativeRecords(), 1);
    assert.equal((await loadCodexCredentials())!.accountId, "test-account");
    assert.include(await getCodexStatus(), "독자@example.invalid");
    assert.equal(getPref("secretObj"), secret);
    assert.notEqual(getPref("codex.accountRevision"), revision);
    await logoutCodex();
    assert.lengthOf(nativeRecords(), 0);
  });

  it("uses the registered provider and account catalog without tool definitions or duplicated SSE text", async function () {
    await saveCodexCredentials({
      ...initialCredentials(),
      expires: Date.now() - 1,
    });
    const task = {
      raw: "Translate α with [MATH_0].",
      langfrom: "en-US",
      langto: "ko-KR",
      result: "",
      signal: new AbortController().signal,
    } as Required<TranslateTask>;
    await registeredService().translate(task);
    assert.equal(task.result, "번역된 문장 [MATH_0].");
    assert.equal((await loadCodexCredentials())!.email, "독자@example.invalid");
    const request = endpointCalls(responseURL)[0],
      body = JSON.parse(request.options.body);
    assert.equal(body.model, "text-first");
    assert.isTrue(body.stream);
    assert.isFalse(body.store);
    assert.notProperty(body, "tools");
    assert.notProperty(body, "tool_choice");
    assert.notProperty(body, "thread_id");
    assert.notProperty(
      body,
      "reasoning",
      "Default effort must not override the model setting",
    );
    assert.deepEqual(JSON.parse(body.input[0].content[0].text), {
      sourceLanguage: "en-US",
      targetLanguage: "ko-KR",
      text: "Translate α with [MATH_0].",
    });
    assert.equal(
      request.options.headers.Authorization,
      `Bearer ${access("rotated")}`,
    );
    assert.equal(request.options.headers["chatgpt-account-id"], "test-account");
    for (const call of calls) {
      assert.equal(call.options.logBodyLength, 0);
      assert.isFalse(call.options.debug);
      assert.isTrue(call.options.anon);
      assert.isFalse(call.options.followRedirects);
    }
  });

  it("saves account model and effort dropdowns without reusing an old inference or saving rejected edits", async function () {
    await signIn();
    const running = (Zotero as unknown as Record<string, Addon>)[
      config.addonInstance
    ];
    const manager = running.data.translate.services;
    const queue = running.data.translate.queue;
    const tasks: Required<TranslateTask>[] = [];
    const run = async () => {
      const task: Required<TranslateTask> = {
        id: `oauth-selector-${tasks.length}`,
        type: "title",
        raw: "Same source across model and effort changes [MATH_0].",
        result: "",
        audio: [],
        service: "codex",
        candidateServices: [],
        itemId: undefined,
        langfrom: "en-US",
        langto: "ko-KR",
        langfromInferred: false,
        status: "processing",
        extraTasks: [],
        secret: "",
        silent: true,
        callerID: "oauth-selector-test",
        processed: false,
        signal: new AbortController().signal,
      };
      tasks.push(task);
      queue.push(task);
      assert.isTrue(
        await manager.runTranslationTask(task, {
          noDisplay: true,
          noCheckZoteroItemLanguage: true,
        }),
      );
    };
    let dialog: Window | undefined;
    const alert = Zotero.alert;
    const messages: string[] = [];
    try {
      Zotero.alert = ((_window, _title, text) =>
        messages.push(text)) as typeof Zotero.alert;
      await run();
      assert.lengthOf(endpointCalls(responseURL), 1);
      dialog = await openSettings();
      assert.isAtMost(dialog.outerWidth, 760);
      const model = dialog.document.querySelector<HTMLSelectElement>(
        '[data-setting-key="codex.model"]',
      )!;
      const effort = dialog.document.querySelector<HTMLSelectElement>(
        '[data-setting-key="codex.reasoningEffort"]',
      )!;
      await wait(() => !model.disabled && model.options.length === 4);
      assert.deepEqual(
        Array.from(model.options, (option) => option.getAttribute("value")),
        ["", "text-first", "z-last", "plain-model"],
      );
      assert.include(model.options[2].textContent!, "Other <b>model</b>");
      assert.isNull(
        model.querySelector("b"),
        "Catalog names are plain text, not privileged markup",
      );
      assert.deepEqual(
        Array.from(effort.options, (option) => option.getAttribute("value")),
        ["", "low", "high"],
      );
      await choose(dialog, "codex.reasoningEffort", "high", [
        "",
        "low",
        "high",
      ]);
      await choose(dialog, "codex.model", "plain-model", [
        "",
        "text-first",
        "z-last",
        "plain-model",
      ]);
      assert.equal(effort.value, "");
      assert.isTrue(
        effort.disabled,
        "Missing capability metadata must not invent supported effort values",
      );
      await choose(
        dialog,
        "codex.model",
        "z-last",
        ["", "text-first", "z-last", "plain-model"],
        true,
      );
      assert.deepEqual(
        Array.from(effort.options, (option) => option.getAttribute("value")),
        ["", "medium", "xhigh"],
      );
      await choose(dialog, "codex.reasoningEffort", "xhigh", [
        "",
        "medium",
        "xhigh",
      ]);
      (dialog.document.querySelector("#save") as HTMLButtonElement).click();
      await wait(() => !!dialog?.closed);
      assert.equal(getPref("codex.model"), "z-last");
      assert.equal(getPref("codex.reasoningEffort"), "xhigh");
      await run();
      assert.lengthOf(
        endpointCalls(responseURL),
        2,
        "A matching source/history entry must not bypass new account/model/effort validation",
      );
      const body = JSON.parse(endpointCalls(responseURL)[1].options.body);
      assert.equal(body.model, "z-last");
      assert.deepEqual(body.reasoning, { effort: "xhigh" });

      setPref("codex.reasoningEffort", "medium");
      await run();
      assert.lengthOf(endpointCalls(responseURL), 3);
      const effortOnly = JSON.parse(endpointCalls(responseURL)[2].options.body);
      assert.equal(effortOnly.model, "z-last");
      assert.deepEqual(effortOnly.reasoning, { effort: "medium" });

      setPref("codex.model", "retired-model");
      setPref("codex.reasoningEffort", "high");
      dialog = await openSettings();
      dialog.alert = (message?: unknown) => {
        messages.push(String(message));
      };
      const invalidModel = dialog.document.querySelector<HTMLSelectElement>(
        '[data-setting-key="codex.model"]',
      )!;

      await wait(
        () => !invalidModel.disabled && invalidModel.options.length === 5,
      );
      assert.equal(invalidModel.value, "retired-model");
      await choose(dialog, "codex.reasoningEffort", "", ["", "high"]);
      (dialog.document.querySelector("#save") as HTMLButtonElement).click();
      await wait(() => messages.length > 0);
      assert.isFalse(dialog.closed);
      dialog.close();
      await wait(() => !!dialog?.closed);
      assert.equal(getPref("codex.model"), "retired-model");
      assert.equal(
        getPref("codex.reasoningEffort"),
        "high",
        "Closing after rejected Save must not persist the unsaved edit",
      );
    } finally {
      if (dialog && !dialog.closed) dialog.close();
      Zotero.alert = alert;
      for (const task of tasks) {
        const index = queue.indexOf(task);
        if (index >= 0) queue.splice(index, 1);
      }
    }
  });

  it("fails before inference without credentials or with an unavailable model or effort", async function () {
    await rejected(translateWithCodex("text", "en", "ko"), "sign in");
    await signIn();
    setPref("codex.model", "disabled");
    await rejected(translateWithCodex("text", "en", "ko"), "unavailable");
    setPref("codex.model", "text-first");
    setPref("codex.reasoningEffort", "xhigh");
    await rejected(translateWithCodex("text", "en", "ko"), "effort");
    setPref("codex.model", "plain-model");
    setPref("codex.reasoningEffort", "high");
    await rejected(translateWithCodex("text", "en", "ko"), "effort");
    assert.lengthOf(endpointCalls(responseURL), 0);
  });

  it("decodes fragmented native HTTP, rejects unfinished and oversized streams, and closes cancelled connections", async function () {
    await saveCodexCredentials(initialCredentials());
    mode = "native-wire";
    assert.equal(
      await translateWithCodex("wire-fragmented", "en", "ko"),
      "네이티브 번역 [MATH_0].",
    );
    await rejected(translateWithCodex("wire-partial", "en", "ko"));
    await rejected(
      translateWithCodex("wire-oversize", "en", "ko"),
      "too large",
    );
    const oversized = JSON.parse(
      (await localRequest("http://127.0.0.1:23190/codex-wire/state"))
        .responseText,
    );
    assert.isBelow(
      oversized.oversizedBytes,
      8 * 1024 * 1024,
      "The HTTP download must stop at its limit rather than buffer the complete oversized stream",
    );
    const controller = new AbortController();
    const work = translateWithCodex("wire-hold", "en", "ko", controller.signal);
    void work.catch(() => undefined);
    const held = async () =>
      JSON.parse(
        (await localRequest("http://127.0.0.1:23190/codex-wire/state"))
          .responseText,
      ).held;
    await wait(async () => (await held()) === 1);
    controller.abort();
    await rejected(work, "cancel");
    await wait(async () => (await held()) === 0);
  });

  it("rejects incomplete, malformed, refused and tool-bearing responses even after a completion frame", async function () {
    await signIn();
    for (const value of [
      "partial",
      "malformed",
      "incomplete",
      "refusal",
      "tool-after-completion",
      "failure-after-completion",
      "http-failure",
    ]) {
      mode = value;
      await rejected(translateWithCodex("text", "en", "ko"));
    }
    mode = "valid";
    assert.equal(
      await translateWithCodex("text", "en", "ko"),
      "번역된 문장 [MATH_0].",
    );
  });

  it("invokes the HTTP canceller and never sends cancelled queued text", async function () {
    await signIn();
    const active = new AbortController(),
      queued = new AbortController();
    const work = translateWithCodex("hold", "en", "ko", active.signal);
    void work.catch(() => undefined);
    await wait(() => !!release);
    const waiting = translateWithCodex(
      "do-not-send",
      "en",
      "ko",
      queued.signal,
    );
    void waiting.catch(() => undefined);
    queued.abort();
    active.abort();
    await rejected(work, "cancel");
    await rejected(waiting, "cancel");
    assert.equal(cancelled, 1);
    assert.lengthOf(endpointCalls(responseURL), 1);
    assert.equal(
      await translateWithCodex("text", "en", "ko"),
      "번역된 문장 [MATH_0].",
    );
  });

  it("rotates a rejected access token once and does not loop on persistent authorization failures", async function () {
    await signIn();
    mode = "unauthorized-once";
    assert.equal(
      await translateWithCodex("text", "en", "ko"),
      "번역된 문장 [MATH_0].",
    );
    assert.equal(
      (await loadCodexCredentials())!.refresh,
      "rotated-refresh-token",
    );
    assert.equal(
      endpointCalls(responseURL)[1].options.headers.Authorization,
      `Bearer ${access("rotated")}`,
    );
    assert.equal(
      endpointCalls(tokenURL).filter(
        (call) =>
          new URLSearchParams(call.options.body).get("grant_type") ===
          "refresh_token",
      ).length,
      1,
    );
    calls.length = 0;
    mode = "unauthorized";
    await rejected(translateWithCodex("text", "en", "ko"));
    assert.lengthOf(endpointCalls(responseURL), 2);
    assert.lengthOf(endpointCalls(tokenURL), 1);
  });

  it("shares refresh rotation while promptly cancelling one waiting translation", async function () {
    await saveCodexCredentials({
      ...initialCredentials(),
      expires: Date.now() - 1,
    });
    mode = "hold-refresh";
    const controller = new AbortController();
    const work = translateWithCodex("text", "en", "ko", controller.signal);
    const cancelledWork = work.then(
      () => false,
      (error) => String(error).toLowerCase().includes("cancel"),
    );
    await wait(() => !!release);
    const status = getCodexStatus();
    void status.catch(() => undefined);
    try {
      controller.abort();
      assert.isTrue(
        await Promise.race([
          cancelledWork,
          Zotero.Promise.delay(500).then(() => false),
        ]),
        "Cancelling one consumer must not wait for or abort another consumer's token refresh",
      );
    } finally {
      release?.();
    }
    assert.include(await status, "Signed in with ChatGPT");
    assert.lengthOf(endpointCalls(tokenURL), 1);
    assert.equal(
      (await loadCodexCredentials())!.refresh,
      "rotated-refresh-token",
    );
  });

  it("does not reopen the browser after immediate cancellation or when the callback port is occupied", async function () {
    const pending = loginCodex();
    void pending.catch(() => undefined);
    await cancelCodexLogin();
    await rejected(pending, "cancel");
    assert.equal(opened, "");
    const listener = Cc["@mozilla.org/network/server-socket;1"].createInstance(
      Ci.nsIServerSocket,
    );
    listener.init(1455, true, -1);
    try {
      await rejected(loginCodex(), "1455");
      assert.equal(opened, "");
    } finally {
      listener.close();
    }
  });

  it("persists an already-completed refresh rotation when shutdown wins the continuation race", async function () {
    await saveCodexCredentials({
      ...initialCredentials(),
      expires: Date.now() - 1,
    });
    mode = "hold-refresh";
    const status = getCodexStatus();
    void status.catch(() => undefined);
    await wait(() => !!release);
    release!();
    await shutdownCodex();
    await rejected(status, "cancel");
    assert.equal(
      (await loadCodexCredentials())!.refresh,
      "rotated-refresh-token",
    );
  });

  it("waits for an uninterruptible encrypted write and leaves no credentials after logout", async function () {
    let finishSave: (() => void) | undefined;
    nativeLogins.addLoginAsync = (async (
      ...args: Parameters<typeof originalAdd>
    ) => {
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      return originalAdd.apply(nativeLogins, args);
    }) as typeof originalAdd;
    await loginCodex();
    await callback();
    await wait(() => !!finishSave);
    const signedOut = logoutCodex();
    finishSave!();
    await signedOut;
    assert.isNull(await loadCodexCredentials());
    assert.lengthOf(nativeRecords(), 0);
  });

  it("rolls back an encrypted write that finishes after login cancellation", async function () {
    let finishSave: (() => void) | undefined;
    nativeLogins.addLoginAsync = (async (
      ...args: Parameters<typeof originalAdd>
    ) => {
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
      return originalAdd.apply(nativeLogins, args);
    }) as typeof originalAdd;
    await loginCodex();
    await callback();
    await wait(() => !!finishSave);
    const cancelledLogin = cancelCodexLogin();
    finishSave!();
    await cancelledLogin;
    assert.isNull(await loadCodexCredentials());
  });

  it("keeps malformed tokens out of storage and scopes logout to its own login-manager realm", async function () {
    mode = "bad-token";
    await loginCodex();
    await callback();
    await wait(async () => (await getCodexStatus()).includes("Use Sign in"));
    assert.isNull(await loadCodexCredentials());
    const unrelated = Cc[
      "@mozilla.org/login-manager/loginInfo;1"
    ].createInstance(Ci.nsILoginInfo);
    (unrelated.init as any)(
      origin,
      null,
      "unrelated-test-realm",
      "fixture",
      "unrelated-test-secret",
    );
    await Services.logins.addLoginAsync(unrelated);
    try {
      await saveCodexCredentials(initialCredentials());
      const own = nativeRecords()[0];
      const malformed = Cc[
        "@mozilla.org/login-manager/loginInfo;1"
      ].createInstance(Ci.nsILoginInfo);
      (malformed.init as any)(
        origin,
        null,
        realm,
        "chatgpt",
        "private-error-secret",
      );
      Services.logins.modifyLogin(own, malformed);
      await rejected(loadCodexCredentials(), "invalid");
      await logoutCodex();
      assert.lengthOf(
        (Services.logins.findLogins as any)(
          origin,
          null,
          "unrelated-test-realm",
        ),
        1,
      );
    } finally {
      Services.logins.removeLogin(unrelated);
    }
  });
});
