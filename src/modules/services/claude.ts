import {
  buildPromptParts,
  getPref,
  getThinkingLevelOptions,
  normalizeLLMEndpoint,
  stripThinkingTags,
} from "../../utils";
import { TranslateService } from "./base";
import type { TranslateTask } from "../../utils/task";

const INVALID_KEY_INFO =
  "The API key contains characters that cannot be sent in an HTTP header.";

function isHeaderSafeSecret(secret: string): boolean {
  // Any provider key is accepted as long as it can be sent verbatim in an
  // HTTP header: printable ASCII with no whitespace or control characters.
  return secret.length > 0 && !/[^\x21-\x7e]/.test(secret);
}

function transformContent(
  langFrom: string,
  langTo: string,
  sourceText: string,
  data: Required<TranslateTask>,
) {
  return buildPromptParts("claude.prompt", langFrom, langTo, sourceText, data);
}

function checkClaudeError(payload: any) {
  if (payload?.type === "error" || payload?.error) {
    throw new Error("Claude API returned an error.");
  }
}

function checkClaudeStopReason(reason: unknown) {
  // No stop sequences or tools are requested: only a natural end of the
  // assistant turn is a complete translation.
  if (reason !== "end_turn") {
    const label =
      reason === "max_tokens" || reason === "refusal"
        ? reason
        : reason == null
          ? "missing"
          : "invalid";
    throw new Error(`Claude response is incomplete (stop_reason: ${label}).`);
  }
}

function parseClaudeBlock(block: any): string {
  if (block?.type === "text" && typeof block.text === "string") {
    return block.text;
  }
  if (block?.type === "thinking" || block?.type === "redacted_thinking") {
    return "";
  }
  // No client or server tools are requested, and refusal/unknown blocks are
  // not translations even if the message claims to have ended naturally.
  throw new Error("Claude returned an unsupported or malformed content block.");
}

/** A completed Anthropic stream must end its turn and then stop the message. */
function parseClaudeSSE(text: string): string {
  let result = "";
  let started = false;
  let stopped = false;
  let stopReason: unknown;
  let block: { index: number; type: string } | undefined;
  let nextIndex = 0;
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const lines = frame.split(/\r?\n/);
    const payload = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!payload || payload === "[DONE]") continue;
    let obj: any;
    try {
      obj = JSON.parse(payload);
    } catch {
      throw new Error("Malformed Claude stream data.");
    }
    checkClaudeError(obj);
    const event = lines.find((line) => line.startsWith("event:"));
    if (
      !obj ||
      typeof obj.type !== "string" ||
      (event && event.slice(6).trim() !== obj.type)
    ) {
      throw new Error("Malformed Claude stream event.");
    }
    if (
      ![
        "message_start",
        "content_block_start",
        "content_block_delta",
        "content_block_stop",
        "message_delta",
        "message_stop",
      ].includes(obj.type)
    ) {
      // Anthropic may add event types; only known lifecycle events affect
      // completion. Errors were already checked above, even after a stop.
      continue;
    }
    if (stopped) {
      throw new Error("Malformed Claude stream: data after message_stop.");
    }
    if (!started && obj.type !== "message_start") {
      throw new Error("Malformed Claude stream: missing message_start.");
    }
    if (obj.type === "message_start") {
      if (
        started ||
        obj.message?.type !== "message" ||
        obj.message.role !== "assistant" ||
        obj.message.stop_reason !== null ||
        !Array.isArray(obj.message.content) ||
        obj.message.content.length !== 0
      ) {
        throw new Error("Malformed Claude message_start.");
      }
      started = true;
    } else if (obj.type === "content_block_start") {
      if (
        stopReason !== undefined ||
        block ||
        obj.index !== nextIndex ||
        typeof obj.content_block?.type !== "string"
      ) {
        throw new Error("Malformed Claude content block.");
      }
      block = { index: obj.index, type: obj.content_block.type };
      result += parseClaudeBlock(obj.content_block);
    } else if (obj.type === "content_block_delta") {
      if (
        stopReason !== undefined ||
        !block ||
        obj.index !== block.index ||
        typeof obj.delta?.type !== "string"
      ) {
        throw new Error("Malformed Claude content delta.");
      }
      if (obj.delta.type === "text_delta") {
        if (block.type !== "text" || typeof obj.delta.text !== "string") {
          throw new Error("Malformed Claude text delta.");
        }
        result += obj.delta.text;
      }
    } else if (obj.type === "content_block_stop") {
      if (!block || obj.index !== block.index) {
        throw new Error("Malformed Claude content_block_stop.");
      }
      block = undefined;
      ++nextIndex;
    } else if (obj.type === "message_delta") {
      if (
        block ||
        !obj.delta ||
        typeof obj.delta !== "object" ||
        Array.isArray(obj.delta)
      ) {
        throw new Error("Malformed Claude message_delta.");
      }
      if (obj.delta.stop_reason !== undefined) {
        checkClaudeStopReason(obj.delta.stop_reason);
        stopReason = obj.delta.stop_reason;
      }
    } else if (obj.type === "message_stop") {
      if (block) {
        throw new Error("Claude stream ended before content_block_stop.");
      }
      checkClaudeStopReason(stopReason);
      stopped = true;
    }
  }
  if (!started || !stopped) {
    throw new Error("Claude stream ended before message_stop.");
  }
  return result;
}

/**
 * Join every text block of a non-streaming Anthropic response in order.
 * Thinking blocks are excluded; later text blocks are not dropped.
 */
function parseClaudeContent(text: string): string {
  let payload: any;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("Malformed Claude response data.");
  }
  checkClaudeError(payload);
  checkClaudeStopReason(payload?.stop_reason);
  const content = payload?.content;
  if (payload?.type !== "message" || !Array.isArray(content)) {
    throw new Error("Malformed Claude message content.");
  }
  return content.map(parseClaudeBlock).join("");
}

const translate = <TranslateService["translate"]>async function (data) {
  // Users may paste either the full messages URL or the provider base URL.
  const apiURL = normalizeLLMEndpoint(
    getPref("claude.endPoint") as string,
    "anthropic",
  );
  const model = getPref("claude.model") as string;
  if (!apiURL) {
    throw "The Claude API base URL is not set.";
  }
  if (!String(model ?? "").trim()) {
    throw "The Claude model is not set.";
  }
  const temperature = parseFloat(getPref("claude.temperature") as string);
  const stream = getPref("claude.stream") as boolean;
  const maxTokens = parseInt(getPref("claude.maxTokens") as string) || 4000;
  const thinkingLevel = getPref("claude.thinkingLevel") as string;

  if (!data.secret) {
    throw "The Claude API key is not set.";
  }
  if (!isHeaderSafeSecret(data.secret)) {
    throw INVALID_KEY_INFO;
  }

  const refreshHandler = addon.api.getTemporaryRefreshHandler({ task: data });
  const previousResult = data.result;

  const { system, user } = transformContent(
    data.langfrom,
    data.langto,
    data.raw,
    data,
  );

  // https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
  // The API requires max_tokens to be greater than thinking.budget_tokens
  const thinkingBudgets = { low: 2048, medium: 8192, high: 16384 };
  let thinking: Record<string, any> | undefined;
  let effectiveMaxTokens = maxTokens;
  if (thinkingLevel === "off") {
    thinking = { type: "disabled" };
  } else if (
    thinkingLevel === "low" ||
    thinkingLevel === "medium" ||
    thinkingLevel === "high"
  ) {
    const budget = thinkingBudgets[thinkingLevel];
    thinking = { type: "enabled", budget_tokens: budget };
    effectiveMaxTokens = Math.max(maxTokens, budget + 1024);
  }

  // Pass maxTokens to the request body
  const requestBody = {
    model: model,
    system: system,
    messages: [
      {
        role: "user",
        content: user,
      },
    ],
    temperature: temperature,
    stream: stream,
    max_tokens: effectiveMaxTokens,
    ...(thinking ? { thinking } : {}),
  };

  const headers = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
    "x-api-key": data.secret,
  };

  const requestOptions = {
    headers: headers,
    body: JSON.stringify(requestBody),
    responseType: "text",
    // The body carries the user's document and the key is a secret: log
    // neither. Do not inherit cookies and do not forward the key on redirects.
    anon: true,
    followRedirects: false,
    noCache: true,
    logBodyLength: 0,
    debug: false,
    requestObserver: (xmlhttp: XMLHttpRequest) => {
      xmlhttp.overrideMimeType("text/plain; charset=utf-8");
      if (!stream) return;

      let preLength = 0;
      let result = "";
      // SSE frames can be split across progress events; keep the trailing
      // fragment until the next event and flush it on load.
      let buffer = "";

      const consume = (final: boolean) => {
        const response = String(xmlhttp.response || "");
        if (response.length > preLength) {
          buffer += response.slice(preLength);
          preLength = response.length;
        }
        const lines = buffer.split("\n");
        buffer = final ? "" : lines.pop() || "";
        for (const rawLine of lines) {
          const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const obj = JSON.parse(payload);
            // Thinking deltas carry no `text`, so they never leak here.
            if (
              obj.type === "content_block_delta" &&
              obj.delta?.type === "text_delta" &&
              typeof obj.delta.text === "string"
            ) {
              result += obj.delta.text;
            }
          } catch {
            // A malformed frame is skipped; fragmented frames stay buffered.
          }
        }

        if (xmlhttp.timeout) {
          xmlhttp.timeout = 0;
        }

        data.result = stripThinkingTags(result.replace(/^\n\n/, ""));
        refreshHandler();
      };

      xmlhttp.onprogress = () => {
        try {
          consume(false);
        } catch (error) {
          console.error("Error processing Claude stream:", error);
        }
      };
      xmlhttp.onload = () => {
        try {
          consume(true);
        } catch (error) {
          console.error("Error processing Claude stream:", error);
        }
      };
    },
  };

  try {
    const xhr = await Zotero.HTTP.request("POST", apiURL, requestOptions);
    if (xhr?.status !== 200) {
      throw new Error(`Request error: ${xhr?.status}`);
    }

    // Progress is only a preview. Validate the entire body, including errors
    // after text, before allowing the task runner to save a successful result.
    const result = stripThinkingTags(
      (stream
        ? parseClaudeSSE(xhr.responseText || "")
        : parseClaudeContent(xhr.responseText || "")
      ).replace(/^\n\n/, ""),
    );
    if (!result.trim()) {
      throw new Error("Claude returned an empty translation.");
    }
    data.result = result;
    data.status = "success";
    refreshHandler();
  } catch (error) {
    data.result = previousResult;
    data.status = "fail";
    refreshHandler();
    throw error;
  }
};

export const Claude: TranslateService = {
  id: "claude",
  type: "sentence",
  helpUrl:
    "https://docs.anthropic.com/claude/docs/getting-started-with-the-claude-api",

  defaultSecret: "",
  secretValidator(secret: string) {
    const status = isHeaderSafeSecret(secret);
    return {
      secret,
      status,
      info: !secret ? "The secret is not set." : status ? "" : INVALID_KEY_INFO,
    };
  },

  translate,

  config(settings) {
    settings
      .addTextSetting({
        prefKey: "claude.endPoint",
        nameKey: "service-claude-dialog-endPoint",
      })
      .addTextSetting({
        prefKey: "claude.model",
        nameKey: "service-claude-dialog-model",
      })
      .addNumberSetting({
        prefKey: "claude.temperature",
        nameKey: "service-claude-dialog-temperature",
        min: 0,
        max: 1,
        step: 0.1,
      })
      .addNumberSetting({
        prefKey: "claude.maxTokens",
        nameKey: "service-claude-dialog-maxTokens",
        inputType: "number",
        min: 100,
        max: 10000,
        step: 100,
      })
      .addTextAreaSetting({
        prefKey: "claude.prompt",
        nameKey: "service-claude-dialog-prompt",
      })
      .addCheckboxSetting({
        prefKey: "claude.stream",
        nameKey: "service-claude-dialog-stream",
      })
      .addSelectSetting({
        prefKey: "claude.thinkingLevel",
        nameKey: "service-claude-dialog-thinkingLevel",
        options: getThinkingLevelOptions(),
      });
  },
};
