import {
  buildPromptParts,
  getPref,
  getString,
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

/** Parse a complete Anthropic SSE body, taking text deltas only. */
function parseClaudeSSE(text: string): string {
  let result = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try {
      const obj = JSON.parse(payload);
      // Thinking deltas carry `thinking` rather than `text`, so they never
      // leak into the translation.
      if (obj.type === "content_block_delta") {
        result += obj.delta?.text || "";
      }
    } catch {
      // Malformed frames are skipped.
    }
  }
  return result;
}

/**
 * Join every text block of a non-streaming Anthropic response in order.
 * Thinking blocks are excluded; later text blocks are not dropped.
 */
function parseClaudeContent(payload: any): string {
  const content = payload?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (block: any) => block?.type === "text" && typeof block.text === "string",
    )
    .map((block: any) => block.text)
    .join("");
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
            if (obj.type === "content_block_delta") {
              result += obj.delta?.text || "";
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

  const xhr = await Zotero.HTTP.request("POST", apiURL, requestOptions);
  if (xhr?.status !== 200) {
    data.result = `Request error: ${xhr?.status}`;
    data.status = "fail";
    throw `Request error: ${xhr?.status}`;
  }

  if (stream) {
    // The complete body is authoritative regardless of progress-event
    // boundaries, so a final fragment is never lost.
    data.result = stripThinkingTags(
      parseClaudeSSE(xhr.responseText || "").replace(/^\n\n/, ""),
    );
  } else {
    try {
      const responseObj = JSON.parse(xhr.responseText);
      // Extended thinking emits a thinking block first; keep every text block
      // in order so a multi-block answer is not truncated to its first part.
      data.result = stripThinkingTags(
        parseClaudeContent(responseObj).replace(/^\n\n/, ""),
      );
      // Trigger UI updates after receiving the full response.
      refreshHandler();
    } catch (error) {
      data.result = getString("status-translating");
      data.status = "fail";
      throw `Failed to parse response: ${error}`;
    }
  }

  data.status = "success";
  return;
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
