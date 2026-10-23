/*
 * Regression tests for the ChatGPT API format switch.
 * Uses the mock server in `test/mock-llm-server.mjs`, which `npm test`
 * starts through the `test:init` hook in `zotero-plugin.config.ts`.
 * The mock echoes each request (path, headers, body) back as the
 * "translation", so assertions verify both the request and the parsing.
 */
import { ChatGPT } from "../src/modules/services/gpt";
import type { TranslateTask } from "../src/utils/task";
import { getPref, setPref, clearPref } from "../src/utils/prefs";
import { config } from "../package.json";

import type Addon from "../src/addon";

/*
 * The service reads the plugin instance from the bare `addon` global in the
 * plugin's own scope. Bridge the configured running instance into
 * this context; fall back to a stub since a "title" task never uses refresh.
 */
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

function configure(prefix: string, endPoint: string, apiFormat: string) {
  setPref(`${prefix}.endPoint`, endPoint);
  setPref(`${prefix}.model`, "mock-model");
  setPref(`${prefix}.prompt`, "${sourceText}");
  setPref(`${prefix}.apiFormat`, apiFormat);
  setPref(`${prefix}.temperature`, "0.3");
  setPref(`${prefix}.customParams`, "{}");
}

const cleanupKeys = [
  "endPoint",
  "model",
  "prompt",
  "apiFormat",
  "temperature",
  "customParams",
  "stream",
];

describe("ChatGPT API format", function () {
  this.timeout(20000);
  const previous = new Map<string, string | number | boolean>();

  beforeEach(function () {
    assert.isTrue(
      Zotero.DataDirectory.dir
        .replace(/\\/g, "/")
        .endsWith("/.scaffold/test/data"),
    );
    previous.clear();
    for (const key of cleanupKeys) {
      previous.set(`chatGPT.${key}`, getPref(`chatGPT.${key}`));
    }
    configure("chatGPT", `${MOCK}/v1/chat/completions`, "openai");
  });

  afterEach(function () {
    for (const [key, value] of previous) {
      if (value === undefined) clearPref(key);
      else setPref(key, value);
    }
  });

  it("accepts any header-safe provider key", function () {
    const validate = ChatGPT.secretValidator!;
    assert.isTrue(validate("proxy-key_123").status);
    assert.isFalse(validate("").status);
    assert.isFalse(validate("bad key").status);
    assert.isFalse(validate("bad\nkey").status);
    assert.isFalse(validate("trailing-newline\n").status);
  });

  it("sends Anthropic format with stream and parses the text deltas", async function () {
    setPref("chatGPT.stream", true);
    setPref("chatGPT.endPoint", `${MOCK}/v1/messages`);
    setPref("chatGPT.apiFormat", "anthropic");
    const task = buildTask("HELLO ANTHROPIC", "chatgpt");
    await ChatGPT.translate(task);
    assert.include(task.result, "path=/v1/messages");
    assert.include(task.result, "auth=false");
    assert.include(task.result, "xapikey=true");
    assert.include(task.result, "version=2023-06-01");
    assert.include(task.result, "model=mock-model");
    assert.include(task.result, "maxTokens=4000");
    assert.include(task.result, "userText=HELLO ANTHROPIC");
  });

  it("sends Anthropic format without stream and parses content blocks", async function () {
    setPref("chatGPT.stream", false);
    setPref("chatGPT.endPoint", `${MOCK}/v1/messages`);
    setPref("chatGPT.apiFormat", "anthropic");
    const task = buildTask("HELLO ANTHROPIC", "chatgpt");
    await ChatGPT.translate(task);
    assert.include(task.result, "path=/v1/messages");
    assert.include(task.result, "xapikey=true");
    assert.include(task.result, "maxTokens=4000");
    assert.include(task.result, "userText=HELLO ANTHROPIC");
  });

  it("keeps the default OpenAI format with stream", async function () {
    setPref("chatGPT.stream", true);
    const task = buildTask("HELLO OPENAI", "chatgpt");
    await ChatGPT.translate(task);
    assert.include(task.result, "path=/v1/chat/completions");
    assert.include(task.result, "auth=true");
    assert.include(task.result, "xapikey=false");
    assert.include(task.result, "maxTokens=unset");
    assert.include(task.result, "userText=HELLO OPENAI");
  });

  it("keeps the default OpenAI format without stream", async function () {
    setPref("chatGPT.stream", false);
    const task = buildTask("HELLO OPENAI", "chatgpt");
    await ChatGPT.translate(task);
    assert.include(task.result, "path=/v1/chat/completions");
    assert.include(task.result, "auth=true");
    assert.include(task.result, "userText=HELLO OPENAI");
  });

  it("expands a bare base URL for the OpenAI format", async function () {
    setPref("chatGPT.endPoint", MOCK);
    setPref("chatGPT.apiFormat", "openai");
    setPref("chatGPT.stream", false);
    const task = buildTask("HELLO BASE URL", "chatgpt");
    await ChatGPT.translate(task);
    assert.include(task.result, "path=/v1/chat/completions");
    assert.include(task.result, "userText=HELLO BASE URL");
  });

  it("expands a versioned base URL for the Anthropic format", async function () {
    setPref("chatGPT.endPoint", `${MOCK}/v1`);
    setPref("chatGPT.apiFormat", "anthropic");
    setPref("chatGPT.stream", false);
    const task = buildTask("HELLO BASE URL", "chatgpt");
    await ChatGPT.translate(task);
    assert.include(task.result, "path=/v1/messages");
    assert.include(task.result, "xapikey=true");
    assert.include(task.result, "userText=HELLO BASE URL");
  });

  it("keeps a non-standard endpoint path untouched", async function () {
    setPref("chatGPT.endPoint", `${MOCK}/api/chat`);
    setPref("chatGPT.apiFormat", "openai");
    setPref("chatGPT.stream", false);
    const task = buildTask("HELLO OLLAMA", "chatgpt");
    await ChatGPT.translate(task);
    assert.include(task.result, "path=/api/chat");
    assert.include(task.result, "userText=HELLO OLLAMA");
  });

  it("expands the Gemini OpenAI-compatible base URL", async function () {
    setPref("chatGPT.endPoint", `${MOCK}/v1beta/openai/`);
    setPref("chatGPT.apiFormat", "openai");
    setPref("chatGPT.stream", false);
    const task = buildTask("HELLO GEMINI", "chatgpt");
    await ChatGPT.translate(task);
    assert.include(task.result, "path=/v1beta/openai/chat/completions");
    assert.include(task.result, "userText=HELLO GEMINI");
  });

  it("expands an Anthropic mount base URL", async function () {
    setPref("chatGPT.endPoint", `${MOCK}/anthropic`);
    setPref("chatGPT.apiFormat", "anthropic");
    setPref("chatGPT.stream", false);
    const task = buildTask("HELLO DEEPSEEK ANTHROPIC", "chatgpt");
    await ChatGPT.translate(task);
    assert.include(task.result, "path=/anthropic/v1/messages");
    assert.include(task.result, "xapikey=true");
    assert.include(task.result, "userText=HELLO DEEPSEEK ANTHROPIC");
  });
});
