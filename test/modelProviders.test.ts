/*
 * Provider-boundary tests for the Claude and Gemini services: the base URL
 * and model settings must produce the provider resource path, the API key
 * must travel in a header (never the URL), and native stream parsing must
 * not lose fragments split across progress events or leak thoughts.
 * Uses the mock server in `test/mock-llm-server.mjs`, started by `npm test`
 * through the `test:init` hook in `zotero-plugin.config.ts`.
 */
import { Claude } from "../src/modules/services/claude";
import { Gemini } from "../src/modules/services/gemini";
import type { TranslateTask } from "../src/utils/task";
import { getPref, setPref, clearPref } from "../src/utils/prefs";
import { config } from "../package.json";

import type Addon from "../src/addon";

if (!(globalThis as { addon?: unknown }).addon) {
  const running = (Zotero as unknown as Record<string, Addon | undefined>)[
    config.addonInstance
  ];
  (globalThis as unknown as { addon: unknown }).addon = running ?? {
    api: { getTemporaryRefreshHandler: () => () => {} },
  };
}
const MOCK = "http://127.0.0.1:23190";

function buildTask(raw: string, service: string): Required<TranslateTask> {
  return {
    id: "test-task",
    type: "title",
    raw,
    result: "",
    audio: [],
    service,
    candidateServices: [],
    itemId: undefined,
    langfrom: "en-US",
    langto: "zh-CN",
    langfromInferred: false,
    status: "processing",
    extraTasks: [],
    secret: "test-secret",
    silent: false,
    callerID: "test",
    processed: false,
    signal: new AbortController().signal,
  };
}

const cleanupKeys = [
  "endPoint",
  "model",
  "prompt",
  "stream",
  "temperature",
  "maxTokens",
  "thinkingLevel",
];

describe("Claude and Gemini provider endpoints", function () {
  this.timeout(20000);
  const previous = new Map<string, string | number | boolean>();

  beforeEach(function () {
    assert.isTrue(
      Zotero.DataDirectory.dir
        .replace(/\\/g, "/")
        .endsWith("/.scaffold/test/data"),
    );
    previous.clear();
    for (const service of ["claude", "gemini"]) {
      for (const key of cleanupKeys) {
        previous.set(`${service}.${key}`, getPref(`${service}.${key}`));
      }
      setPref(`${service}.thinkingLevel`, "default");
    }
  });

  afterEach(function () {
    for (const [key, value] of previous) {
      if (value === undefined) clearPref(key);
      else setPref(key, value);
    }
  });

  it("expands a bare Claude base URL and sends a custom key in the header", async function () {
    setPref("claude.endPoint", MOCK);
    setPref("claude.model", "claude-custom-model");
    setPref("claude.prompt", "${sourceText}");
    setPref("claude.temperature", "0.3");
    setPref("claude.maxTokens", "4000");
    setPref("claude.stream", false);
    const task = buildTask("HELLO BLOCKS", "claude");
    await Claude.translate(task);
    assert.include(task.result, "path=/v1/messages");
    assert.include(task.result, "model=claude-custom-model");
    assert.include(task.result, "xapikey=true");
    assert.include(task.result, "xapikeyValue=test-secret");
    // The fixture splits the echoed request into two text blocks around a
    // later thinking block: block 1 ends before `version=`, block 2 carries
    // the rest. So `auth=false` (block 1) plus `userText=HELLO BLOCKS`
    // (block 2 only) prove both blocks were joined in order, while neither
    // thinking block leaked into the result.
    assert.include(task.result, "auth=false");
    assert.include(task.result, "version=2023-06-01");
    assert.include(task.result, "userText=HELLO BLOCKS");
    assert.isBelow(
      task.result.indexOf("auth=false"),
      task.result.indexOf("userText=HELLO BLOCKS"),
    );
    assert.notInclude(
      task.result,
      "?key=",
      "the key must not travel in the URL",
    );
    assert.notInclude(task.result, "internal reasoning");
    assert.notInclude(task.result, "later reasoning");
  });

  it("keeps a full Claude messages URL untouched", async function () {
    setPref("claude.endPoint", `${MOCK}/v1/messages`);
    setPref("claude.model", "claude-custom-model");
    setPref("claude.prompt", "${sourceText}");
    setPref("claude.temperature", "0.3");
    setPref("claude.maxTokens", "4000");
    setPref("claude.stream", true);
    const task = buildTask("HELLO CLAUDE STREAM", "claude");
    await Claude.translate(task);
    assert.include(task.result, "path=/v1/messages");
    assert.include(task.result, "model=claude-custom-model");
    assert.include(task.result, "userText=HELLO CLAUDE STREAM");
    assert.notInclude(task.result, "ignore me");
  });

  it("builds the Gemini model resource from a custom base and sends the key as a header", async function () {
    setPref("gemini.endPoint", `${MOCK}/proxy`);
    setPref("gemini.model", "gemini-custom-model");
    setPref("gemini.prompt", "${sourceText}");
    setPref("gemini.stream", false);
    const task = buildTask("HELLO GEMINI", "gemini");
    await Gemini.translate(task);
    assert.include(
      task.result,
      "path=/proxy/models/gemini-custom-model:generateContent",
    );
    assert.include(task.result, "model=gemini-custom-model");
    assert.include(task.result, "xgoogkey=true");
    assert.include(task.result, "xgoogkeyValue=test-secret");
    assert.include(task.result, "userText=HELLO GEMINI");
    assert.notInclude(task.result, "?key=");
    assert.notInclude(task.result, "&key=");
    assert.notInclude(task.result, "internal thought");
  });

  it("preserves the Gemini query and fragmented UTF-8 text without leaking thoughts", async function () {
    setPref("gemini.endPoint", `${MOCK}/proxy?tenant=abc`);
    setPref("gemini.model", "gemini-custom-model");
    setPref("gemini.prompt", "${sourceText}");
    setPref("gemini.stream", true);
    const task = buildTask("HELLO GEMINI STREAM", "gemini");
    await Gemini.translate(task);
    assert.include(
      task.result,
      "path=/proxy/models/gemini-custom-model:streamGenerateContent?tenant=abc&alt=sse",
    );
    assert.include(task.result, "xgoogkeyValue=test-secret");
    assert.include(task.result, "userText=HELLO GEMINI STREAM");
    assert.include(task.result, "번역");
    assert.match(task.result, /model=gemini-custom-model/);
    assert.notInclude(task.result, "생각");
    assert.notInclude(task.result, "internal thought");
  });

  it("rejects a key that cannot be sent in a header", async function () {
    // A trailing newline is the classic case a `$`-anchored allowlist misses.
    const unsafe = ["bad\nkey", "trailing-newline\n", "spaced key", ""];
    for (const secret of unsafe) {
      assert.isFalse(Claude.secretValidator!(secret).status, secret);
      assert.isFalse(Gemini.secretValidator!(secret).status, secret);
    }
    for (const secret of [
      "header-safe-key",
      "sk-ant-abc123",
      "AIzaSyAbc-123_9",
    ]) {
      assert.isTrue(Claude.secretValidator!(secret).status, secret);
      assert.isTrue(Gemini.secretValidator!(secret).status, secret);
    }

    // The request path must fail before any network call rather than letting
    // the native header layer reject an opaque key.
    for (const [service, api] of [
      ["claude", Claude.translate],
      ["gemini", Gemini.translate],
    ] as const) {
      if (service === "gemini") {
        setPref("gemini.endPoint", `${MOCK}/proxy`);
        setPref("gemini.model", "gemini-custom-model");
        setPref("gemini.prompt", "${sourceText}");
      } else {
        setPref("claude.endPoint", `${MOCK}/v1/messages`);
        setPref("claude.model", "claude-custom-model");
        setPref("claude.prompt", "${sourceText}");
      }
      for (const secret of ["bad\nkey", "trailing-newline\n"]) {
        let failure: unknown;
        const task = buildTask("HELLO", service);
        task.secret = secret;
        try {
          await api(task);
        } catch (error) {
          failure = error;
        }
        assert.equal(
          String(failure),
          "The API key contains characters that cannot be sent in an HTTP header.",
          secret,
        );
      }
    }
  });
});
