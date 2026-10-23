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
    assert.notInclude(task.result, "opaque reasoning");
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
    assert.notInclude(task.result, "opaque stream reasoning");
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

  // These are provider wire contracts, not parser-helper tests. HTTP 200
  // alone cannot authorize replacing a previously successful translation.
  const claudePartial = [
    {
      type: "message_start",
      message: {
        type: "message",
        role: "assistant",
        content: [],
        stop_reason: null,
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "partial translation" },
    },
    { type: "content_block_stop", index: 0 },
  ];
  const claudeEnd = {
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null },
  };
  const claudeStop = { type: "message_stop" };
  const claudeError = {
    type: "error",
    error: {
      type: "overloaded_error",
      message: "PRIVATE provider error detail",
    },
  };
  const claudeMessage = {
    type: "message",
    role: "assistant",
    content: [{ type: "text", text: "partial translation" }],
    stop_reason: "end_turn",
  };
  const claudeSSE = (events: { type: string; [key: string]: unknown }[]) =>
    events
      .map(
        (event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
      )
      .join("");
  const geminiCandidate = {
    index: 0,
    content: { parts: [{ text: "partial translation" }] },
  };
  const geminiComplete = {
    candidates: [{ ...geminiCandidate, finishReason: "STOP" }],
  };
  const geminiSSE = (payloads: unknown[]) =>
    payloads.map((payload) => `data: ${JSON.stringify(payload)}\n\n`).join("");

  it("accepts completed Gemini proxy JSON bodies in streaming mode", async function () {
    setPref("gemini.endPoint", MOCK);
    setPref("gemini.model", "completion-test-model");
    setPref("gemini.prompt", "${sourceText}");
    setPref("gemini.stream", true);
    const original = Zotero.HTTP.request;
    try {
      for (const response of [
        {
          candidates: [
            {
              finishReason: "STOP",
              content: { parts: [{ text: "완전한 번역" }] },
            },
          ],
        },
        [
          { candidates: [{ content: { parts: [{ text: "완전한 번역" }] } }] },
          {
            candidates: [{ content: { role: "model" }, finishReason: "STOP" }],
          },
          { usageMetadata: { totalTokenCount: 5 } },
        ],
      ]) {
        Zotero.HTTP.request = (async () => ({
          status: 200,
          responseText: JSON.stringify(response),
        })) as unknown as typeof original;
        const task = buildTask(
          "Translate the entire source paragraph.",
          "gemini",
        );
        await Gemini.translate(task);
        assert.equal(task.result, "완전한 번역");
      }
    } finally {
      Zotero.HTTP.request = original;
    }
  });

  const failures: {
    service: "claude" | "gemini";
    stream: boolean;
    description: string;
    body: string;
    error: RegExp;
  }[] = [];

  for (const reason of ["max_tokens", "refusal"]) {
    for (const stream of [true, false]) {
      failures.push({
        service: "claude",
        stream,
        description: reason,
        body: stream
          ? claudeSSE([
              ...claudePartial,
              {
                ...claudeEnd,
                delta: { stop_reason: reason, stop_sequence: null },
              },
              claudeStop,
            ])
          : JSON.stringify({ ...claudeMessage, stop_reason: reason }),
        error: new RegExp(`stop_reason: ${reason}`),
      });
    }
  }
  for (const reason of ["MAX_TOKENS", "SAFETY"]) {
    for (const stream of [true, false]) {
      const payload = {
        candidates: [{ ...geminiCandidate, finishReason: reason }],
      };
      failures.push({
        service: "gemini",
        stream,
        description: reason,
        body: stream ? geminiSSE([payload]) : JSON.stringify(payload),
        error: new RegExp(`finishReason: ${reason}`),
      });
    }
  }
  for (const block of [
    { type: "tool_use", id: "tool_test", name: "unrequested", input: {} },
    {
      type: "server_tool_use",
      id: "srvtool_test",
      name: "web_search",
      input: {},
    },
    { type: "refusal", refusal: "Not translating." },
  ]) {
    for (const stream of [true, false]) {
      failures.push({
        service: "claude",
        stream,
        description: `${block.type} despite end_turn`,
        body: stream
          ? claudeSSE([
              ...claudePartial,
              { type: "content_block_start", index: 1, content_block: block },
              { type: "content_block_stop", index: 1 },
              claudeEnd,
              claudeStop,
            ])
          : JSON.stringify({
              ...claudeMessage,
              content: [...claudeMessage.content, block],
            }),
        error: /unsupported or malformed content block/,
      });
    }
  }
  failures.push(
    {
      service: "claude",
      stream: true,
      description: "an error after text",
      body: claudeSSE([...claudePartial, claudeError]),
      error: /Claude API returned an error/,
    },
    {
      service: "claude",
      stream: true,
      description: "an error after message_stop",
      body: claudeSSE([...claudePartial, claudeEnd, claudeStop, claudeError]),
      error: /Claude API returned an error/,
    },
    {
      service: "claude",
      stream: false,
      description: "an error envelope containing text",
      body: JSON.stringify({ ...claudeMessage, ...claudeError }),
      error: /Claude API returned an error/,
    },
    {
      service: "claude",
      stream: true,
      description: "a missing message_stop",
      body: claudeSSE([...claudePartial, claudeEnd]),
      error: /before message_stop/,
    },
    {
      service: "claude",
      stream: true,
      description: "a message_stop without a final stop_reason",
      body: claudeSSE([...claudePartial, claudeStop]),
      error: /stop_reason: missing/,
    },
    {
      service: "claude",
      stream: false,
      description: "a missing stop_reason",
      body: JSON.stringify({ ...claudeMessage, stop_reason: undefined }),
      error: /stop_reason: missing/,
    },
    {
      service: "claude",
      stream: true,
      description: "a malformed frame before completion",
      body:
        claudeSSE(claudePartial) +
        'event: content_block_delta\ndata: {"type":\n\n' +
        claudeSSE([claudeEnd, claudeStop]),
      error: /Malformed Claude stream data/,
    },
    {
      service: "claude",
      stream: true,
      description: "an unclosed content block",
      body: claudeSSE([...claudePartial.slice(0, -1), claudeEnd, claudeStop]),
      error: /Malformed Claude message_delta/,
    },
    {
      service: "claude",
      stream: false,
      description: "a malformed later text block",
      body: JSON.stringify({
        ...claudeMessage,
        content: [...claudeMessage.content, { type: "text", text: 42 }],
      }),
      error: /unsupported or malformed content block/,
    },
    {
      service: "claude",
      stream: false,
      description: "a thought-only answer",
      body: JSON.stringify({
        ...claudeMessage,
        content: [{ type: "thinking", thinking: "internal reasoning" }],
      }),
      error: /empty translation/,
    },
    {
      service: "gemini",
      stream: true,
      description: "an error after STOP",
      body: geminiSSE([
        geminiComplete,
        {
          error: {
            code: 503,
            status: "UNAVAILABLE",
            message: "PRIVATE provider error detail",
          },
        },
      ]),
      error: /Gemini API returned an error/,
    },
    {
      service: "gemini",
      stream: false,
      description: "an error envelope containing text",
      body: JSON.stringify({
        ...geminiComplete,
        error: {
          code: 503,
          status: "UNAVAILABLE",
          message: "PRIVATE provider error detail",
        },
      }),
      error: /Gemini API returned an error/,
    },
    {
      service: "gemini",
      stream: false,
      description: "blocked prompt feedback despite text",
      body: JSON.stringify({
        ...geminiComplete,
        promptFeedback: { blockReason: "SAFETY" },
      }),
      error: /prompt was blocked/,
    },
    {
      service: "gemini",
      stream: true,
      description: "a missing finishReason",
      body: geminiSSE([{ candidates: [geminiCandidate] }]),
      error: /without finishReason STOP/,
    },
    {
      service: "gemini",
      stream: false,
      description: "a missing finishReason",
      body: JSON.stringify({ candidates: [geminiCandidate] }),
      error: /without finishReason STOP/,
    },
    {
      service: "gemini",
      stream: true,
      description: "a malformed frame after STOP",
      body: geminiSSE([geminiComplete]) + 'data: {"candidates":\n\n',
      error: /Malformed Gemini response data/,
    },
    {
      service: "gemini",
      stream: false,
      description: "a malformed later text part",
      body: JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: "partial translation" }, { text: 42 }] },
          },
        ],
      }),
      error: /Malformed Gemini response text part/,
    },
    {
      service: "gemini",
      stream: true,
      description: "text after STOP",
      body: geminiSSE([geminiComplete, { candidates: [geminiCandidate] }]),
      error: /candidate data after STOP/,
    },
    {
      service: "gemini",
      stream: true,
      description: "MAX_TOKENS in a proxy JSON array",
      body: JSON.stringify([
        { candidates: [geminiCandidate] },
        { candidates: [{ finishReason: "MAX_TOKENS" }] },
      ]),
      error: /finishReason: MAX_TOKENS/,
    },
    {
      service: "gemini",
      stream: false,
      description: "a thought-only answer",
      body: JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: { parts: [{ text: "internal thought", thought: true }] },
          },
        ],
      }),
      error: /empty translation/,
    },
  );

  for (const fixture of failures) {
    it(`${fixture.service} rejects ${fixture.description} (${fixture.stream ? "stream" : "JSON"})`, async function () {
      const { service, stream, body } = fixture;
      setPref(`${service}.endPoint`, MOCK);
      setPref(`${service}.model`, "completion-test-model");
      setPref(`${service}.prompt`, "${sourceText}");
      setPref(`${service}.temperature`, "0.3");
      setPref(`${service}.maxTokens`, "4000");
      setPref(`${service}.stream`, stream);
      const task = buildTask("Translate the entire source paragraph.", service);
      task.result = "previous successful translation";
      const original = Zotero.HTTP.request;
      let failure: unknown;
      try {
        Zotero.HTTP.request = async (...args: Parameters<typeof original>) => {
          const xhr = {
            status: 200,
            response: body,
            responseText: body,
            timeout: 0,
            overrideMimeType() {},
            onprogress: null as (() => void) | null,
          };
          args[2]?.requestObserver?.(xhr);
          // Give the real public service a preview before it receives the
          // final response, so rejection must also discard transient text.
          xhr.onprogress?.();
          return xhr as unknown as XMLHttpRequest;
        };
        await (service === "claude" ? Claude : Gemini).translate(task);
      } catch (error) {
        failure = error;
      } finally {
        Zotero.HTTP.request = original;
      }
      assert.exists(failure, "HTTP 200 with partial text must not succeed");
      assert.match(String(failure), fixture.error);
      assert.notInclude(String(failure), "PRIVATE provider error detail");
      assert.notInclude(String(failure), "partial translation");
      assert.equal(task.result, "previous successful translation");
      assert.equal(task.status, "fail");
    });
  }
});
