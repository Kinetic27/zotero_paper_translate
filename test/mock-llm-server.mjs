/*
 * Mock LLM server for `test/gptApiFormat.test.ts` and
 * `test/modelProviders.test.ts`. `npm test` starts it through the
 * `test:init` hook in `zotero-plugin.config.ts`; it can also be run on its
 * own for debugging: `node test/mock-llm-server.mjs`.
 * Emulates the Anthropic Messages, OpenAI Chat Completions, and Gemini
 * generateContent APIs. Instead of translating, every response echoes the
 * request it received (path, headers, body fields) so tests can assert
 * exactly what was sent. Keys echoed here are the fake test keys.
 */
import http from "node:http";
import { pathToFileURL } from "node:url";

const PORT = 23190;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let codexHeld = 0;
let codexOversizeSent = 0;

async function codexWire(req, res, body) {
  if (req.url === "/codex-wire/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({ held: codexHeld, oversizedBytes: codexOversizeSent }),
    );
    return true;
  }
  if (req.url !== "/codex-wire") return false;
  const text = JSON.parse(body.input[0].content[0].text).text;
  // SSE is UTF-8 regardless of an intermediary's incorrect charset label.
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=iso-8859-1",
  });
  const frame = (value) => `data: ${JSON.stringify(value)}\n\n`;
  if (text === "wire-hold") {
    ++codexHeld;
    res.once("close", () => {
      --codexHeld;
    });
    res.write(frame({ type: "response.output_text.delta", delta: "waiting" }));
    return true;
  }
  if (text === "wire-oversize") {
    codexOversizeSent = 0;
    res.write('data: {"type":"response.output_text.delta","delta":"');
    for (let index = 0; index < 128 && !res.destroyed; ++index) {
      res.write("x".repeat(65536));
      codexOversizeSent += 65536;
      await delay(5);
    }
    if (!res.destroyed) res.end('"}\n\n');
    return true;
  }
  if (text === "wire-partial") {
    res.end(frame({ type: "response.output_text.delta", delta: "unfinished" }));
    return true;
  }
  const bytes = Buffer.from(
    frame({
      type: "response.completed",
      response: {
        id: "wire-response",
        status: "completed",
        output: [
          {
            id: "wire-message",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "네이티브 번역 [MATH_0]." }],
          },
        ],
      },
    }),
  );
  const split = bytes.indexOf(Buffer.from("번")) + 1;
  res.write(bytes.subarray(0, split));
  await delay(30);
  res.end(bytes.subarray(split));
  return true;
}

function summarize(req, body) {
  const auth = Boolean(req.headers["authorization"]);
  const apiKey = Boolean(req.headers["x-api-key"]);
  const apiKeyValue = String(req.headers["x-api-key"] ?? "");
  const version = String(req.headers["anthropic-version"] ?? "");
  const thinking = body.thinking ? body.thinking.type : "unset";
  return [
    `path=${req.url}`,
    `auth=${auth}`,
    `xapikey=${apiKey}`,
    `xapikeyValue=${apiKeyValue}`,
    `version=${version}`,
    `model=${body.model}`,
    `maxTokens=${body.max_tokens ?? "unset"}`,
    `temp=${body.temperature}`,
    `thinking=${thinking}`,
    `userText=${body.messages?.find((message) => message.role === "user")?.content ?? body.input ?? ""}`,
  ].join(" ");
}

/**
 * Gemini generateContent fixtures. The path carries the model, the key is a
 * header, and thought parts are interleaved so tests can prove they never
 * leak. The streaming body is written in byte fragments that split both a
 * JSON line and a multi-byte character across progress events.
 */
async function geminiWire(req, res, body) {
  const url = req.url || "";
  const stream = url.includes(":streamGenerateContent");
  if (!stream && !url.includes(":generateContent")) return false;
  const model = /\/models\/([^/?:]+)/.exec(url)?.[1] ?? "";
  const summary = [
    `path=${url}`,
    `model=${model}`,
    `xgoogkey=${Boolean(req.headers["x-goog-api-key"])}`,
    `xgoogkeyValue=${String(req.headers["x-goog-api-key"] ?? "")}`,
    `userText=${body.contents?.[0]?.parts?.[0]?.text ?? ""}`,
    `systemText=${body.system_instruction?.parts?.[0]?.text ?? ""}`,
    `generationConfig=${JSON.stringify(body.generationConfig ?? null)}`,
  ].join(" ");

  if (!stream) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { text: "internal thought", thought: true },
                { text: summary },
              ],
            },
          },
        ],
      }),
    );
    return true;
  }

  res.writeHead(200, { "Content-Type": "text/event-stream" });
  const frames = [
    {
      candidates: [
        { content: { parts: [{ text: "생각 중", thought: true }] } },
      ],
    },
    { candidates: [{ content: { parts: [{ text: summary.slice(0, 30) }] } }] },
    { candidates: [{ content: { parts: [{ text: summary.slice(30) }] } }] },
    { candidates: [{ content: { parts: [{ text: " 번역" }] } }] },
    { candidates: [{ finishReason: "STOP" }] },
    { usageMetadata: { totalTokenCount: 50 } },
  ];
  const bytes = Buffer.from(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(""),
  );
  // Split inside the first text frame, then inside a Korean character.
  const cuts = [
    bytes.indexOf(Buffer.from('"text":"path=')) + 10,
    bytes.indexOf(Buffer.from("번")) + 1,
  ].filter((cut) => cut > 0 && cut < bytes.length);
  let start = 0;
  for (const cut of cuts) {
    res.write(bytes.subarray(start, cut));
    start = cut;
    // Exceed XHR's progress-event cadence so native callbacks see fragments.
    await delay(100);
  }
  res.end(bytes.subarray(start));
  return true;
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
  if (await codexWire(req, res, body)) return;
  if (await geminiWire(req, res, body)) return;
  const summary = summarize(req, body);
  const isAnthropic = req.url.includes("/v1/messages");
  console.log(`[mock] ${req.method} ${req.url} stream=${body.stream}`);

  if (!body.stream) {
    // An opted-in fixture splits the Anthropic text into two text blocks
    // around a later thinking block, so a parser that keeps only the first
    // text block visibly loses the tail. The shared Anthropic route used by
    // the other suites stays a single text block.
    const userText = body.messages?.[0]?.content ?? "";
    const splitBlocks = isAnthropic && userText.startsWith("HELLO BLOCKS");
    const splitAt = summary.indexOf("version=");
    const payload = isAnthropic
      ? {
          type: "message",
          role: "assistant",
          stop_reason: "end_turn",
          content: splitBlocks
            ? [
                { type: "thinking", thinking: "internal reasoning" },
                { type: "text", text: summary.slice(0, splitAt) },
                { type: "thinking", thinking: "later reasoning" },
                { type: "redacted_thinking", data: "opaque reasoning" },
                { type: "text", text: summary.slice(splitAt) },
              ]
            : [
                { type: "thinking", thinking: "internal reasoning" },
                { type: "text", text: summary },
              ],
        }
      : {
          choices: [
            {
              message: { role: "assistant", content: summary },
              finish_reason: "stop",
            },
          ],
        };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }

  res.writeHead(200, { "Content-Type": "text/event-stream" });
  if (isAnthropic) {
    const events = [
      {
        event: "message_start",
        data: {
          type: "message_start",
          message: {
            type: "message",
            role: "assistant",
            content: [],
            stop_reason: null,
          },
        },
      },
      {
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "" },
        },
      },
      {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "thinking_delta", thinking: "ignore me" },
        },
      },
      {
        event: "content_block_stop",
        data: { type: "content_block_stop", index: 0 },
      },
      {
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index: 1,
          content_block: {
            type: "redacted_thinking",
            data: "opaque stream reasoning",
          },
        },
      },
      {
        event: "content_block_stop",
        data: { type: "content_block_stop", index: 1 },
      },
      { event: "ping", data: { type: "ping" } },
      {
        event: "content_block_start",
        data: {
          type: "content_block_start",
          index: 2,
          content_block: { type: "text", text: "" },
        },
      },
      {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: 2,
          delta: { type: "text_delta", text: summary.slice(0, 40) },
        },
      },
      {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: 2,
          delta: { type: "text_delta", text: summary.slice(40) },
        },
      },
      {
        event: "content_block_stop",
        data: { type: "content_block_stop", index: 2 },
      },
      {
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
        },
      },
      { event: "message_stop", data: { type: "message_stop" } },
    ];
    for (const { event, data } of events) {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      await delay(30);
    }
  } else {
    const events = [
      {
        choices: [
          { delta: { content: summary.slice(0, 40) }, finish_reason: null },
        ],
      },
      {
        choices: [
          { delta: { content: summary.slice(40) }, finish_reason: "stop" },
        ],
      },
    ];
    for (const data of events) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      await delay(30);
    }
    res.write("data: [DONE]\n\n");
  }
  res.end();
});

export function startMockLLMServer() {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`[mock] listening on http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

// Standalone mode: `node test/mock-llm-server.mjs`
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startMockLLMServer();
}
