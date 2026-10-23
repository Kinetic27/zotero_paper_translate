import {
  buildPromptParts,
  buildThinkingParams,
  getPref,
  getString,
  getThinkingLevelOptions,
  isResponsesApiEndpoint,
  normalizeLLMEndpoint,
  stripThinkingTags,
} from "../../utils";
import { TranslateService } from "./base";
import { hasSourceTextPlaceholder } from "./gptPrompt";

function getCustomParams(
  prefix: string,
  extraFilterKeys: string[] = [],
): Record<string, any> {
  const storedCustomParams =
    (getPref(`${prefix}.customParams`) as string) || "{}";
  try {
    const customParams = JSON.parse(storedCustomParams);
    // Filter out parameters that are already defined (for both Chat Completions and Responses API)
    const standardParams = [
      "model",
      "messages",
      "input",
      "temperature",
      "stream",
      ...extraFilterKeys,
    ];
    return Object.fromEntries(
      Object.entries(customParams).filter(
        ([key]) => !standardParams.includes(key),
      ),
    );
  } catch (e) {
    return {};
  }
}

type ApiFormat = "openai" | "responses" | "anthropic";

function checkResponse(obj: any) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("Malformed ChatGPT response.");
  }
  if (obj.error != null || obj.refusal != null || obj.type === "error") {
    // Provider messages can contain request text or secrets. Do not echo them.
    throw new Error("ChatGPT returned an error or refusal.");
  }
  if (
    obj.function_call != null ||
    (obj.tool_calls != null &&
      (!Array.isArray(obj.tool_calls) || obj.tool_calls.length > 0))
  ) {
    throw new Error("ChatGPT returned a tool call instead of a translation.");
  }
}

function readMessageText(message: any): string {
  checkResponse(message);
  if (
    (message.role !== undefined && message.role !== "assistant") ||
    typeof message.content !== "string"
  ) {
    throw new Error("Malformed ChatGPT message.");
  }
  return message.content;
}

function checkStopReason(reason: unknown, anthropic = false) {
  if (anthropic ? reason !== "end_turn" : reason !== "stop") {
    throw new Error("ChatGPT response is incomplete or not a translation.");
  }
}

function readResponseItem(item: any, completed: boolean): string {
  checkResponse(item);
  if (item.type !== "message" && item.type !== "reasoning") {
    throw new Error("ChatGPT returned non-text output.");
  }
  if (completed && item.status != null && item.status !== "completed") {
    throw new Error("ChatGPT response is incomplete.");
  }
  if (item.type === "reasoning") return "";
  if (item.role !== "assistant" || !Array.isArray(item.content)) {
    throw new Error("Malformed ChatGPT response message.");
  }
  return item.content
    .map((part: any) => {
      checkResponse(part);
      if (part.type !== "output_text" || typeof part.text !== "string") {
        throw new Error("ChatGPT returned non-text output or a refusal.");
      }
      return part.text;
    })
    .join("");
}

function readCompletedResponse(obj: any): string {
  checkResponse(obj);
  if (obj.status !== "completed" || obj.incomplete_details != null) {
    throw new Error("ChatGPT response is incomplete.");
  }
  if (!Array.isArray(obj.output)) {
    throw new Error("Malformed ChatGPT response output.");
  }
  return obj.output.map((item: any) => readResponseItem(item, true)).join("");
}

function readAnthropicBlock(block: any): string {
  checkResponse(block);
  if (block.type === "text" && typeof block.text === "string") {
    return block.text;
  }
  if (block.type === "thinking" || block.type === "redacted_thinking") {
    return "";
  }
  throw new Error("ChatGPT returned non-text output or a malformed block.");
}

function parseNonStreamResponse(obj: any, format: ApiFormat): string {
  checkResponse(obj);
  if (format === "responses") return readCompletedResponse(obj);
  if (format === "anthropic") {
    checkStopReason(obj.stop_reason, true);
    if (
      obj.type !== "message" ||
      (obj.role !== undefined && obj.role !== "assistant") ||
      !Array.isArray(obj.content)
    ) {
      throw new Error("Malformed ChatGPT Anthropic message.");
    }
    return obj.content.map(readAnthropicBlock).join("");
  }
  if (Array.isArray(obj.choices) && obj.choices.length > 0) {
    const choice = obj.choices[0];
    checkResponse(choice);
    checkStopReason(choice.finish_reason);
    return readMessageText(choice.message);
  }
  // Preserve the existing Ollama native /api/chat compatibility.
  if (obj.done !== true) {
    throw new Error("ChatGPT response is incomplete.");
  }
  if (obj.done_reason != null) checkStopReason(obj.done_reason);
  return readMessageText(obj.message);
}

/** Parse complete SSE frames, never individual HTTP progress fragments. */
function streamFrames(text: string, final: boolean, native: boolean) {
  const normalized = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (native) {
    const lines = normalized.split("\n");
    if (!final) lines.pop();
    return lines
      .filter((line) => line.trim())
      .map((data) => ({ event: "", data }));
  }
  const end = final ? normalized.length : normalized.lastIndexOf("\n\n");
  if (end < 0) return [];
  return normalized
    .slice(0, end)
    .split(/\n\n+/)
    .map((frame) => {
      let event = "";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        } else if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (!/^(id|retry):/.test(line)) {
          throw new Error("Malformed ChatGPT stream frame.");
        }
      }
      return { event, data: data.join("\n") };
    });
}

/** Progress is a preview; the complete HTTP body is authoritative at EOF. */
function parseStreamResponse(
  text: string,
  format: ApiFormat,
  final: boolean,
): string {
  const native = format === "openai" && text.trimStart().startsWith("{");
  let result = "";
  let completed = false;
  let started = false;
  let stopReason: unknown;
  let block: { index: number; type: string } | undefined;
  let nextBlock = 0;
  for (const frame of streamFrames(text, final, native)) {
    if (frame.event === "error") {
      throw new Error("ChatGPT returned a stream error.");
    }
    if (!frame.data.trim()) continue;
    if (frame.data.trim() === "[DONE]") {
      if (!completed) throw new Error("ChatGPT response is incomplete.");
      continue;
    }
    const obj = JSON.parse(frame.data);
    checkResponse(obj);
    if (format !== "openai" && frame.event && frame.event !== obj.type) {
      throw new Error("Malformed ChatGPT stream event.");
    }

    if (format === "responses") {
      const type = obj.type;
      if (
        typeof type !== "string" ||
        type === "response.failed" ||
        type === "response.incomplete" ||
        type.startsWith("response.refusal")
      ) {
        throw new Error(
          "ChatGPT response failed, was refused or is incomplete.",
        );
      }
      if (obj.response != null) {
        checkResponse(obj.response);
        if (
          obj.response.incomplete_details != null ||
          (obj.response.status != null &&
            !["queued", "in_progress", "completed"].includes(
              obj.response.status,
            ))
        ) {
          throw new Error("ChatGPT response is incomplete.");
        }
      }
      if (completed) throw new Error("ChatGPT sent data after completion.");
      if (type === "response.completed" || type === "response.done") {
        result = readCompletedResponse(obj.response);
        completed = true;
      } else if (type === "response.output_text.delta") {
        if (typeof obj.delta !== "string") {
          throw new Error("Malformed ChatGPT text delta.");
        }
        result += obj.delta;
      } else if (type === "response.output_text.done") {
        if (typeof obj.text !== "string") {
          throw new Error("Malformed ChatGPT completed text.");
        }
      } else if (
        type === "response.output_item.added" ||
        type === "response.output_item.done"
      ) {
        readResponseItem(obj.item, type === "response.output_item.done");
      } else if (
        type === "response.content_part.added" ||
        type === "response.content_part.done"
      ) {
        checkResponse(obj.part);
        if (
          obj.part.type !== "output_text" ||
          typeof obj.part.text !== "string"
        ) {
          throw new Error("ChatGPT returned non-text output or a refusal.");
        }
      } else if (
        ![
          "response.created",
          "response.queued",
          "response.in_progress",
        ].includes(type) &&
        !/^response\.reasoning_(summary_(part|text)|text)\.(added|delta|done)$/.test(
          type,
        )
      ) {
        throw new Error("Unexpected ChatGPT response event.");
      }
    } else if (format === "anthropic") {
      if (obj.type === "ping") continue;
      if (completed || (!started && obj.type !== "message_start")) {
        throw new Error("Malformed ChatGPT Anthropic stream lifecycle.");
      }
      if (obj.type === "message_start") {
        checkResponse(obj.message);
        if (
          started ||
          obj.message.type !== "message" ||
          (obj.message.role !== undefined && obj.message.role !== "assistant")
        ) {
          throw new Error("Malformed ChatGPT Anthropic message start.");
        }
        started = true;
      } else if (obj.type === "content_block_start") {
        if (block || stopReason !== undefined || obj.index !== nextBlock) {
          throw new Error("Malformed ChatGPT Anthropic content block.");
        }
        result += readAnthropicBlock(obj.content_block);
        block = { index: obj.index, type: obj.content_block.type };
      } else if (obj.type === "content_block_delta") {
        checkResponse(obj.delta);
        if (!block || obj.index !== block.index || stopReason !== undefined) {
          throw new Error("Malformed ChatGPT Anthropic content delta.");
        }
        if (obj.delta.type === "text_delta" && block.type === "text") {
          if (typeof obj.delta.text !== "string") {
            throw new Error("Malformed ChatGPT Anthropic text delta.");
          }
          result += obj.delta.text;
        } else if (
          block.type !== "thinking" ||
          !["thinking_delta", "signature_delta"].includes(obj.delta.type) ||
          typeof obj.delta[
            obj.delta.type === "thinking_delta" ? "thinking" : "signature"
          ] !== "string"
        ) {
          throw new Error("Unexpected ChatGPT Anthropic content delta.");
        }
      } else if (obj.type === "content_block_stop") {
        if (!block || obj.index !== block.index) {
          throw new Error("Malformed ChatGPT Anthropic block stop.");
        }
        block = undefined;
        nextBlock++;
      } else if (obj.type === "message_delta") {
        checkResponse(obj.delta);
        if (block)
          throw new Error("ChatGPT ended a message before its content block.");
        if (obj.delta.stop_reason != null) {
          checkStopReason(obj.delta.stop_reason, true);
          stopReason = obj.delta.stop_reason;
        }
      } else if (obj.type === "message_stop") {
        if (block)
          throw new Error("ChatGPT ended a message before its content block.");
        checkStopReason(stopReason, true);
        completed = true;
      } else {
        throw new Error("Unexpected ChatGPT Anthropic event.");
      }
    } else if (native) {
      if (completed) throw new Error("ChatGPT sent data after completion.");
      result += readMessageText(obj.message);
      if (obj.done != null && typeof obj.done !== "boolean") {
        throw new Error("Malformed Ollama completion status.");
      }
      if (obj.done_reason != null) checkStopReason(obj.done_reason);
      completed = obj.done === true;
    } else {
      if (!Array.isArray(obj.choices)) {
        throw new Error("Malformed ChatGPT choices.");
      }
      if (obj.choices.length === 0 && obj.usage == null) {
        throw new Error("Malformed ChatGPT choices.");
      }
      for (const choice of obj.choices) {
        checkResponse(choice);
        checkResponse(choice.delta);
        if (choice.finish_reason != null) checkStopReason(choice.finish_reason);
        // Custom Request may ask for alternatives; only choice zero is used.
        if (choice.index != null && choice.index !== 0) continue;
        if (completed) throw new Error("ChatGPT sent data after completion.");
        if (
          (choice.delta.role != null && choice.delta.role !== "assistant") ||
          (choice.delta.content != null &&
            typeof choice.delta.content !== "string")
        ) {
          throw new Error("Malformed ChatGPT text delta.");
        }
        result += choice.delta.content ?? "";
        completed = choice.finish_reason === "stop";
      }
    }
  }
  if (final && !completed) {
    throw new Error("ChatGPT response ended before completion.");
  }
  return result;
}

const gptTranslate = async function (
  apiURL: string,
  model: string,
  temperature: number,
  prefix: string,
  data: Parameters<TranslateService["translate"]>[0],
  stream?: boolean,
  apiFormat?: string,
  thinkingLevel?: string,
) {
  function transformContent(
    langFrom: string,
    langTo: string,
    sourceText: string,
  ) {
    return buildPromptParts(
      `${prefix}.prompt`,
      langFrom,
      langTo,
      sourceText,
      data,
    );
  }

  const streamMode = stream ?? true;
  const useAnthropicApi = apiFormat === "anthropic";
  const useResponsesApi = !useAnthropicApi && isResponsesApiEndpoint(apiURL);
  const format: ApiFormat = useAnthropicApi
    ? "anthropic"
    : useResponsesApi
      ? "responses"
      : "openai";

  const refreshHandler = addon.api.getTemporaryRefreshHandler({ task: data });
  const previousResult = data.result;

  // The placeholder and streaming text are previews, never a saved success.
  if (streamMode === false) {
    data.result = getString("status-translating");
    refreshHandler();
  }

  const streamCallback = (xmlhttp: XMLHttpRequest) => {
    xmlhttp.onprogress = () => {
      if (xmlhttp.timeout) xmlhttp.timeout = 0;
      try {
        data.result = stripThinkingTags(
          parseStreamResponse(xmlhttp.responseText, format, false).replace(
            /^\n\n/,
            "",
          ),
        );
        refreshHandler();
      } catch {
        // Callback errors cannot reject Zotero.HTTP.request. Re-parse the
        // entire body after it settles, including frames after a terminal.
      }
    };
  };

  // Thinking parameters are dialect-specific; custom params are filtered
  // against them so Custom Request stays usable as an escape hatch on
  // endpoints whose provider is not detected
  const thinkingParams = buildThinkingParams(
    apiURL,
    model,
    thinkingLevel ?? "default",
  );

  // Build request body based on API format
  const { system, user } = transformContent(
    data.langfrom,
    data.langto,
    data.raw,
  );
  const messages = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  const requestBody = useAnthropicApi
    ? {
        model: model,
        max_tokens: 4000,
        system: system,
        messages: [{ role: "user", content: user }],
        temperature: temperature,
        stream: streamMode,
        ...getCustomParams(prefix, ["max_tokens"]),
      }
    : useResponsesApi
      ? {
          model: model,
          input: messages,
          temperature: temperature,
          stream: streamMode,
          ...thinkingParams,
          ...getCustomParams(prefix, Object.keys(thinkingParams)),
        }
      : {
          model: model,
          messages: messages,
          temperature: temperature,
          stream: streamMode,
          ...thinkingParams,
          ...getCustomParams(prefix, Object.keys(thinkingParams)),
        };

  const requestHeaders = useAnthropicApi
    ? {
        "Content-Type": "application/json",
        "anthropic-version": "2023-06-01",
        "x-api-key": data.secret,
      }
    : {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.secret}`,
      };

  // Key-based auth needs no cookies, and a redirect must not smuggle the key
  // to another host, so the request stays anonymous and non-redirecting.
  // A variable is used because `anon` is a runtime-only request option that
  // the bundled typings do not declare.
  const requestOptions = {
    headers: requestHeaders,
    body: JSON.stringify(requestBody),
    responseType: "text",
    anon: true,
    followRedirects: false,
    // Never let the native HTTP layer log the request body or headers: they
    // carry the API key.
    debug: false,
    logBodyLength: 0,
    requestObserver: (xmlhttp: XMLHttpRequest) => {
      if (streamMode) {
        streamCallback(xmlhttp);
      }
    },
  };

  try {
    const xhr = await Zotero.HTTP.request("POST", apiURL, requestOptions);
    if (xhr?.status !== 200) {
      throw new Error(`Request error: ${xhr?.status}`);
    }
    let content: string;
    try {
      content = streamMode
        ? parseStreamResponse(xhr.responseText, format, true)
        : parseNonStreamResponse(JSON.parse(xhr.responseText), format);
    } catch {
      throw new Error(
        "ChatGPT returned an incomplete, invalid or refused translation.",
      );
    }
    const result = stripThinkingTags(content.replace(/^\n\n/, ""));
    if (!result.trim())
      throw new Error("ChatGPT returned an empty translation.");
    data.result = result;
    refreshHandler();
  } catch (error) {
    data.result = previousResult;
    refreshHandler();
    throw error;
  }
};

const prefPrefix = "chatGPT";

export const ChatGPT: TranslateService = {
  id: "chatgpt",
  type: "sentence",
  helpUrl: "https://github.com/Kinetic27/zotero_paper_translate#service",

  defaultSecret: "",
  secretValidator(secret: string) {
    // Any provider key is accepted as long as it can be sent verbatim in an
    // HTTP header (printable ASCII, no whitespace or control characters).
    const status = secret.length > 0 && !/[^\x21-\x7e]/.test(secret);
    return {
      secret,
      status,
      info:
        secret.length === 0
          ? "The secret is not set."
          : status
            ? "Click the button to check connectivity."
            : "The secret key contains characters that cannot be sent in an HTTP header.",
    };
  },

  async translate(data) {
    const model = getPref(`${prefPrefix}.model`) as string;
    const temperature = parseFloat(
      getPref(`${prefPrefix}.temperature`) as string,
    );
    const stream = getPref(`${prefPrefix}.stream`) as boolean;
    const apiFormat = getPref(`${prefPrefix}.apiFormat`) as string;
    // Users paste the base URL from the provider docs, expand it to the
    // resource path the selected API format needs.
    const apiURL = normalizeLLMEndpoint(
      getPref(`${prefPrefix}.endPoint`) as string,
      apiFormat,
    );
    const thinkingLevel = getPref(`${prefPrefix}.thinkingLevel`) as string;

    return await gptTranslate(
      apiURL,
      model,
      temperature,
      prefPrefix,
      data,
      stream,
      apiFormat,
      thinkingLevel,
    );
  },

  config(settings) {
    settings
      .addTextSetting({
        prefKey: `${prefPrefix}.endPoint`,
        nameKey: "service-chatgpt-dialog-endPoint",
      })
      .addTextSetting({
        prefKey: `${prefPrefix}.model`,
        nameKey: "service-chatgpt-dialog-model",
      })
      .addNumberSetting({
        prefKey: `${prefPrefix}.temperature`,
        nameKey: "service-chatgpt-dialog-temperature",
        min: 0,
        max: 2,
        step: 0.1,
      })
      .addSelectSetting({
        prefKey: `${prefPrefix}.apiFormat`,
        nameKey: "service-chatgpt-dialog-apiFormat",
        options: [
          {
            value: "openai",
            label: getString("service-dialog-api-format-openai"),
          },
          {
            value: "anthropic",
            label: getString("service-dialog-api-format-anthropic"),
          },
        ],
      })
      .addStaticRow("", {
        tag: "div",
        namespace: "html",
        styles: {
          color: "var(--fill-secondary)",
          fontSize: "0.9em",
          maxWidth: "400px",
        },
        properties: {
          textContent: getString("service-gpt-dialog-apiFormat-hint"),
        },
      })
      .addTextAreaSetting({
        prefKey: `${prefPrefix}.prompt`,
        nameKey: "service-chatgpt-dialog-prompt",
        placeholder: getString("service-chatgpt-dialog-prompt"),
      })
      .addStaticRow("", {
        tag: "div",
        namespace: "html",
        styles: {
          color: "var(--fill-secondary)",
          fontSize: "0.9em",
          maxWidth: "400px",
        },
        properties: {
          textContent: getString("service-gpt-dialog-prompt-hint", {
            args: {
              variables: "${langFrom}, ${langTo}, ${sourceText}",
              required: "${sourceText}",
            },
          }),
        },
      })
      .addCheckboxSetting({
        prefKey: `${prefPrefix}.stream`,
        nameKey: "service-chatgpt-dialog-stream",
      })
      .addSelectSetting({
        prefKey: `${prefPrefix}.thinkingLevel`,
        nameKey: "service-chatgpt-dialog-thinkingLevel",
        options: getThinkingLevelOptions(),
      })
      .addStaticRow("", {
        tag: "div",
        namespace: "html",
        styles: {
          color: "var(--fill-secondary)",
          fontSize: "0.9em",
          maxWidth: "400px",
        },
        properties: {
          textContent: getString("service-gpt-dialog-thinkingLevel-hint"),
        },
      })
      .addCustomParamsSetting({
        prefKey: `${prefPrefix}.customParams`,
        nameKey: "service-chatgpt-dialog-custom-request",
        desc: getString("service-dialog-custom-request-description"),
      })
      .onSave((data) => {
        const prompt = String(data[`${prefPrefix}.prompt`] || "");
        return hasSourceTextPlaceholder(prompt)
          ? true
          : getString("service-gpt-dialog-prompt-required", {
              args: { placeholder: "${sourceText}" },
            });
      });
  },
};
