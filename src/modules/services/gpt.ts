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

interface ParsedResponse {
  content: string;
  finished: boolean;
}

/**
 * Parse streaming response for OpenAI Responses API
 * Event format: { "type": "response.output_text.delta", "delta": "text", ... }
 */
function parseResponsesApiStreamResponse(obj: any): ParsedResponse {
  const eventType = obj.type || "";

  // Text delta event - this is the main event for streaming text
  // Format: { "type": "response.output_text.delta", "delta": "In", ... }
  if (eventType === "response.output_text.delta") {
    return {
      content: obj.delta || "",
      finished: false,
    };
  }

  // Completion events
  if (
    eventType === "response.completed" ||
    eventType === "response.done" ||
    eventType === "response.failed" ||
    eventType === "response.incomplete"
  ) {
    return {
      content: "",
      finished: true,
    };
  }

  // Other events we don't need to extract content from:
  // response.created, response.in_progress, response.output_item.added,
  // response.content_part.added, response.output_text.done, etc.
  return { content: "", finished: false };
}

/**
 * Parse non-streaming response for OpenAI Responses API
 * Response format: { output: [{ type: "message", content: [{ type: "output_text", text: "..." }] }] }
 */
function parseResponsesApiNonStreamResponse(obj: any): string {
  if (obj.output && Array.isArray(obj.output)) {
    for (const item of obj.output) {
      if (item.type === "message" && item.content) {
        for (const content of item.content) {
          if (content.type === "output_text") {
            return content.text || "";
          }
        }
      }
    }
  }
  return "";
}

function parseStreamResponse(obj: any): ParsedResponse {
  // Handle Anthropic format (stream events carry a type field)
  if (typeof obj.type === "string") {
    if (obj.type === "content_block_delta") {
      return {
        content: obj.delta?.text || "",
        finished: false,
      };
    }
    if (obj.type === "message_stop") {
      return { content: "", finished: true };
    }
    // message_start, content_block_start/stop, ping, etc.
    return { content: "", finished: false };
  }
  // Handle OpenAI format (choices array with delta)
  if (obj.choices && obj.choices[0]) {
    const choice = obj.choices[0];
    return {
      content: choice.delta?.content || "",
      finished:
        choice.finish_reason !== undefined && choice.finish_reason !== null,
    };
  }
  // Handle Ollama native format (direct message)
  else if (obj.message) {
    return {
      content: obj.message.content || "",
      finished: obj.done === true,
    };
  }
  return { content: "", finished: false };
}

function parseNonStreamResponse(obj: any): string {
  // Handle Anthropic format (content blocks; thinking blocks are skipped)
  if (Array.isArray(obj.content)) {
    const textBlock = obj.content.find(
      (block: { type?: string; text?: string }) => block.type === "text",
    );
    return textBlock?.text || "";
  }
  // Handle OpenAI format (choices array)
  if (obj.choices && obj.choices[0]) {
    return obj.choices[0].message.content || "";
  }
  // Handle Ollama native format (direct message)
  else if (obj.message && obj.message.content) {
    return obj.message.content;
  }
  return "";
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
  // Both the Responses API and the Anthropic API interleave "event:" lines
  // with "data:" lines, so both need line-based SSE parsing
  const lineBasedSse = useResponsesApi || useAnthropicApi;

  const refreshHandler = addon.api.getTemporaryRefreshHandler({ task: data });

  //It takes some time to translate, so set the text to "Translating" before the request
  if (streamMode === false) {
    data.result = getString("status-translating");
    refreshHandler();
  }

  /**
   * The requestObserver callback, under streaming mode
   * @param xmlhttp
   */
  const streamCallback = (xmlhttp: XMLHttpRequest) => {
    let preLength = 0;
    let result = "";
    let buffer = ""; // Buffer to store incomplete JSON fragments
    xmlhttp.onprogress = (e: any) => {
      // Only concatenate the new strings
      const newResponse = e.target.response.slice(preLength);

      // Handle both OpenAI SSE format and Ollama native streaming
      let dataArray;
      const hasSseData = /(^|\n)data:/.test(newResponse);
      if (hasSseData) {
        // OpenAI SSE format
        // Prepend buffer from previous incomplete chunk
        const fullResponse = buffer + newResponse;
        if (lineBasedSse) {
          // Responses/Anthropic APIs have "event:" lines, need line-by-line
          // parsing
          dataArray = fullResponse
            .split("\n")
            .filter((line: string) => line.startsWith("data:"))
            .map((line: string) => line.slice(5).trimStart());
        } else {
          // Chat Completions format: simple split works
          dataArray = fullResponse.split("data:");
        }
        buffer = ""; // Reset buffer
      } else {
        // Ollama native format - each line is a JSON object
        const fullResponse = buffer + newResponse;
        dataArray = fullResponse
          .split("\n")
          .filter((line: string) => line.trim());
        buffer = ""; // Reset buffer
      }

      for (let i = 0; i < dataArray.length; i++) {
        const data = dataArray[i];
        if (!data.trim()) continue;

        try {
          const obj = JSON.parse(data);
          const { content, finished } = useResponsesApi
            ? parseResponsesApiStreamResponse(obj)
            : parseStreamResponse(obj);

          result += content;
          if (finished) {
            break;
          }
        } catch {
          // If parsing fails and this is the last item, it might be incomplete
          // Save it to buffer for next iteration
          // https://github.com/windingwind/zotero-pdf-translate/issues/1304
          if (i === dataArray.length - 1) {
            buffer = hasSseData ? "data:" + data : data;
          }
          continue;
        }
      }

      // Clear timeouts caused by stream transfers
      if (e.target.timeout) {
        e.target.timeout = 0;
      }

      // Remove \n\n from the beginning of the data
      data.result = stripThinkingTags(result.replace(/^\n\n/, ""));
      preLength = e.target.response.length;

      refreshHandler();
    };
  };

  /**
   * The requestObserver callback, under non-streaming mode
   * @param xmlhttp
   */
  const nonStreamCallback = (xmlhttp: XMLHttpRequest) => {
    // Non-streaming logic: Handle the complete response at once
    xmlhttp.onload = () => {
      try {
        const responseObj = JSON.parse(xmlhttp.responseText);
        const resultContent = useResponsesApi
          ? parseResponsesApiNonStreamResponse(responseObj)
          : parseNonStreamResponse(responseObj);
        data.result = stripThinkingTags(resultContent.replace(/^\n\n/, ""));
      } catch (error) {
        // throw `Failed to parse response: ${error}`;
        return;
      }

      // Trigger UI updates after receiving the full response
      refreshHandler();
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
      } else {
        nonStreamCallback(xmlhttp);
      }
    },
  };

  const xhr = await Zotero.HTTP.request("POST", apiURL, requestOptions);
  if (xhr?.status !== 200) {
    throw `Request error: ${xhr?.status}`;
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
