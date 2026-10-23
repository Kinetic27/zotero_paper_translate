/*
 * Regression tests for the ChatGPT API format switch.
 * Uses the mock server in `test/mock-llm-server.mjs`, which `npm test`
 * starts through the `test:init` hook in `zotero-plugin.config.ts`.
 * The mock echoes each request (path, headers, body) back as the
 * "translation", so assertions verify both the request and the parsing.
 * Completion regressions also substitute native HTTP at the public service
 * boundary to control progress fragments and final-only response bytes.
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

type FixtureFormat = "openai" | "responses" | "anthropic" | "ollama";

const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const responseOutput = {
  status: "completed",
  output: [
    {
      type: "reasoning",
      summary: [{ type: "summary_text", text: "private thought" }],
    },
    {
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        { type: "output_text", text: "번역된 " },
        { type: "output_text", text: "문장." },
      ],
    },
  ],
};
const chatDelta = (content: string, finish_reason: string | null = null) => ({
  choices: [{ index: 0, delta: { content }, finish_reason }],
});
const anthropicPrefix = [
  { type: "message_start", message: { type: "message", role: "assistant" } },
  {
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "" },
  },
  {
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "private thought" },
  },
  { type: "content_block_stop", index: 0 },
  {
    type: "content_block_start",
    index: 1,
    content_block: { type: "text", text: "" },
  },
  {
    type: "content_block_delta",
    index: 1,
    delta: { type: "text_delta", text: "번역된 " },
  },
];
const anthropicSuffix = [
  {
    type: "content_block_delta",
    index: 1,
    delta: { type: "text_delta", text: "문장." },
  },
  { type: "content_block_stop", index: 1 },
  { type: "message_delta", delta: { stop_reason: "end_turn" } },
  { type: "message_stop" },
];
const fixtures = [
  {
    format: "openai" as FixtureFormat,
    prefix: frame(chatDelta("<think>private thought</think>번역된 ")),
    suffix: frame(chatDelta("문장.", "stop")) + "data: [DONE]\r\n\r\n",
    nonStream: {
      choices: [
        {
          message: {
            role: "assistant",
            content: "<think>private thought</think>번역된 문장.",
          },
          finish_reason: "stop",
        },
      ],
    },
  },
  {
    format: "responses" as FixtureFormat,
    // The completed snapshot, not an incomplete preview, owns the final text.
    prefix: frame({ type: "response.output_text.delta", delta: "번역된 " }),
    suffix: frame({ type: "response.completed", response: responseOutput }),
    nonStream: responseOutput,
  },
  {
    format: "anthropic" as FixtureFormat,
    prefix: anthropicPrefix.map(frame).join(""),
    suffix: anthropicSuffix.map(frame).join(""),
    nonStream: {
      type: "message",
      role: "assistant",
      stop_reason: "end_turn",
      content: [
        { type: "thinking", thinking: "private thought" },
        { type: "text", text: "번역된 " },
        { type: "redacted_thinking", data: "private thought" },
        { type: "text", text: "문장." },
      ],
    },
  },
  {
    format: "ollama" as FixtureFormat,
    prefix:
      JSON.stringify({
        message: {
          role: "assistant",
          content: "<think>private thought</think>번역된 ",
        },
        done: false,
      }) + "\n",
    suffix:
      JSON.stringify({
        message: { role: "assistant", content: "문장." },
        done: true,
        done_reason: "stop",
      }) + "\n",
    nonStream: {
      message: {
        role: "assistant",
        content: "<think>private thought</think>번역된 문장.",
      },
      done: true,
      done_reason: "stop",
    },
  },
];

async function translateFixture(
  format: FixtureFormat,
  stream: boolean,
  responseText: string,
  progress = false,
) {
  const path =
    format === "responses"
      ? "/v1/responses"
      : format === "anthropic"
        ? "/v1/messages"
        : format === "ollama"
          ? "/api/chat"
          : "/v1/chat/completions";
  const endpoint = `https://gpt-completion-fixture.invalid${path}`;
  configure(
    "chatGPT",
    endpoint,
    format === "anthropic" ? "anthropic" : "openai",
  );
  setPref("chatGPT.stream", stream);
  const task = buildTask("Completion contract", "chatgpt");
  task.result = "previous translation";
  const previews: string[] = [];
  const original = Zotero.HTTP.request;
  Zotero.HTTP.request = (async (
    method: string,
    url: string,
    options: Record<string, any> = {},
  ) => {
    // Leave the native runner's loopback event reporting untouched.
    if (url !== endpoint)
      return original.call(Zotero.HTTP, method, url, options);
    const xhr = {
      status: 200,
      response: "",
      responseText: "",
      timeout: 100,
      onprogress: null as XMLHttpRequest["onprogress"],
      onload: null as XMLHttpRequest["onload"],
    };
    const nativeXHR = xhr as unknown as XMLHttpRequest;
    options.requestObserver?.(nativeXHR);
    if (progress) {
      // Cuts include CRLF, field names, JSON strings and thinking-tag edges.
      for (let end = 1; end < responseText.length; end += 7) {
        xhr.response = xhr.responseText = responseText.slice(0, end);
        xhr.onprogress?.call(nativeXHR, {
          target: nativeXHR,
        } as unknown as ProgressEvent);
        previews.push(task.result);
      }
    }
    // The last bytes arrive without onprogress (a normal small/final response).
    xhr.response = xhr.responseText = responseText;
    xhr.onload?.call(nativeXHR, {
      target: nativeXHR,
    } as unknown as ProgressEvent);
    return nativeXHR;
  }) as typeof Zotero.HTTP.request;
  let error: unknown;
  try {
    await ChatGPT.translate(task);
  } catch (caught) {
    error = caught;
  } finally {
    Zotero.HTTP.request = original;
  }
  return { task, error, previews };
}

function assertFailedTranslation(
  outcome: Awaited<ReturnType<typeof translateFixture>>,
) {
  assert.exists(
    outcome.error,
    "Invalid output must reject the public translate call",
  );
  assert.equal(
    outcome.task.result,
    "previous translation",
    "Do not retain a partial result or the translating placeholder",
  );
  assert.notInclude(String(outcome.error), "private-error-secret");
}

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

  for (const fixture of fixtures) {
    it(`completes ${fixture.format} across progress fragments and final-only delivery`, async function () {
      for (const progress of [false, true]) {
        const outcome = await translateFixture(
          fixture.format,
          true,
          fixture.prefix + fixture.suffix,
          progress,
        );
        assert.notExists(outcome.error);
        assert.equal(outcome.task.result, "번역된 문장.");
        for (const preview of outcome.previews)
          assert.notInclude(preview, "private thought");
      }
    });

    it(`rejects ${fixture.format} incomplete EOF independently of errors`, async function () {
      assertFailedTranslation(
        await translateFixture(fixture.format, true, fixture.prefix, true),
      );
    });

    it(`rejects ${fixture.format} errors after text and after its terminal`, async function () {
      const error =
        fixture.format === "ollama"
          ? JSON.stringify({ error: "private-error-secret" }) + "\n"
          : frame({
              type: "error",
              error: { message: "private-error-secret" },
            });
      for (const prefix of [fixture.prefix, fixture.prefix + fixture.suffix]) {
        assertFailedTranslation(
          await translateFixture(fixture.format, true, prefix + error, true),
        );
      }
    });

    it(`validates ${fixture.format} nonstream text and rejects malformed JSON without a placeholder success`, async function () {
      const outcome = await translateFixture(
        fixture.format,
        false,
        JSON.stringify(fixture.nonStream),
      );
      assert.notExists(outcome.error);
      assert.equal(outcome.task.result, "번역된 문장.");
      assertFailedTranslation(
        await translateFixture(fixture.format, false, '{"broken":'),
      );
      assertFailedTranslation(
        await translateFixture(
          fixture.format,
          false,
          JSON.stringify({ error: { message: "private-error-secret" } }),
        ),
      );
    });
  }

  it("rejects Chat Completions truncation, filtering, refusals and tools", async function () {
    for (const reason of [
      "length",
      "content_filter",
      "tool_calls",
      "function_call",
    ]) {
      assertFailedTranslation(
        await translateFixture(
          "openai",
          true,
          frame(chatDelta("partial", reason)),
        ),
      );
      assertFailedTranslation(
        await translateFixture(
          "openai",
          false,
          JSON.stringify({
            choices: [
              { finish_reason: reason, message: { content: "partial" } },
            ],
          }),
        ),
      );
    }
    for (const message of [
      { content: "partial", refusal: "private-error-secret" },
      {
        content: "partial",
        tool_calls: [{ type: "function", function: { name: "unexpected" } }],
      },
      { content: "partial", function_call: { name: "unexpected" } },
      { content: 17 },
    ]) {
      assertFailedTranslation(
        await translateFixture(
          "openai",
          true,
          frame({ choices: [{ delta: message, finish_reason: "stop" }] }),
        ),
      );
      assertFailedTranslation(
        await translateFixture(
          "openai",
          false,
          JSON.stringify({ choices: [{ message, finish_reason: "stop" }] }),
        ),
      );
    }
    assertFailedTranslation(
      await translateFixture("openai", true, "data: [DONE]\n\n"),
    );
  });

  it("rejects Responses failed/incomplete terminals, refusals and non-text output", async function () {
    for (const status of ["failed", "incomplete"]) {
      const response = { ...responseOutput, status };
      assertFailedTranslation(
        await translateFixture(
          "responses",
          true,
          fixtures[1].prefix + frame({ type: `response.${status}`, response }),
        ),
      );
      assertFailedTranslation(
        await translateFixture("responses", false, JSON.stringify(response)),
      );
    }
    for (const item of [
      { type: "function_call", name: "unexpected", arguments: "{}" },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "refusal", refusal: "private-error-secret" }],
      },
      {
        type: "message",
        role: "assistant",
        status: "incomplete",
        content: [{ type: "output_text", text: "partial" }],
      },
    ]) {
      const response = { status: "completed", output: [item] };
      assertFailedTranslation(
        await translateFixture(
          "responses",
          true,
          frame({ type: "response.completed", response }),
        ),
      );
      assertFailedTranslation(
        await translateFixture("responses", false, JSON.stringify(response)),
      );
    }
    assertFailedTranslation(
      await translateFixture(
        "responses",
        true,
        fixtures[1].prefix + frame({ type: "response.completed" }),
      ),
    );
  });

  it("rejects Anthropic truncation, refusal and tool blocks", async function () {
    for (const reason of [
      "max_tokens",
      "refusal",
      "tool_use",
      "pause_turn",
      "stop_sequence",
    ]) {
      const suffix = [
        { type: "content_block_stop", index: 1 },
        { type: "message_delta", delta: { stop_reason: reason } },
        { type: "message_stop" },
      ]
        .map(frame)
        .join("");
      assertFailedTranslation(
        await translateFixture("anthropic", true, fixtures[2].prefix + suffix),
      );
      assertFailedTranslation(
        await translateFixture(
          "anthropic",
          false,
          JSON.stringify({
            type: "message",
            stop_reason: reason,
            content: [{ type: "text", text: "partial" }],
          }),
        ),
      );
    }
    const tool = { type: "tool_use", name: "unexpected", input: {} };
    assertFailedTranslation(
      await translateFixture(
        "anthropic",
        false,
        JSON.stringify({
          type: "message",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "partial" }, tool],
        }),
      ),
    );
    assertFailedTranslation(
      await translateFixture(
        "anthropic",
        true,
        frame(anthropicPrefix[0]) +
          frame({
            type: "content_block_start",
            index: 0,
            content_block: tool,
          }) +
          frame({ type: "message_stop" }),
      ),
    );
  });

  it("rejects malformed frames even following a valid terminal", async function () {
    for (const fixture of fixtures) {
      const malformed =
        fixture.format === "ollama" ? '{"broken":\n' : 'data: {"broken":\n\n';
      assertFailedTranslation(
        await translateFixture(
          fixture.format,
          true,
          fixture.prefix + fixture.suffix + malformed,
        ),
      );
    }
  });

  it("requires nonstream completion metadata even when usable text exists", async function () {
    for (const [format, payload] of [
      ["openai", { choices: [{ message: { content: "partial" } }] }],
      ["responses", { output: responseOutput.output }],
      [
        "anthropic",
        { type: "message", content: [{ type: "text", text: "partial" }] },
      ],
      ["ollama", { message: { content: "partial" } }],
    ] as const) {
      assertFailedTranslation(
        await translateFixture(format, false, JSON.stringify(payload)),
      );
    }
  });
});
