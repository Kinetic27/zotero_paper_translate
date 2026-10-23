import {
  buildPromptParts,
  getPref,
  getThinkingLevelOptions,
  stripThinkingTags,
} from "../../utils";
import { TranslateService } from "./base";

const INVALID_KEY_INFO =
  "The API key contains characters that cannot be sent in an HTTP header.";

function isHeaderSafeSecret(secret: string): boolean {
  // Any provider key is accepted as long as it can be sent verbatim in an
  // HTTP header: printable ASCII with no whitespace or control characters.
  return secret.length > 0 && !/[^\x21-\x7e]/.test(secret);
}

/**
 * Gemini accepts a base URL (`https://generativelanguage.googleapis.com/v1beta`)
 * or a proxy prefix. The model is a separate setting, so append the generation
 * resource to the base and keep any query parameters already present.
 */
function buildGeminiEndpoint(
  endPoint: unknown,
  model: unknown,
  stream: boolean,
): string {
  const raw = String(endPoint ?? "").trim();
  if (!raw) {
    throw "Gemini EndPoint is not set.";
  }
  const trimmedModel = String(model ?? "").trim();
  if (!trimmedModel) {
    throw "Gemini Model is not set.";
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw `Gemini EndPoint is not a valid URL: ${raw}`;
  }
  const resource = stream ? "streamGenerateContent" : "generateContent";
  // A plain model id gets the `models/` collection; a fully qualified
  // resource (`models/x`, `tunedModels/x`) is used as typed. Assigning
  // pathname percent-encodes spaces while keeping `/`.
  const collection = trimmedModel.includes("/") ? "" : "models/";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${collection}${trimmedModel}:${resource}`;
  if (stream) {
    url.searchParams.set("alt", "sse");
  }
  return url.href;
}

/** Text parts of a Gemini response, excluding thought parts. */
function extractText(payload: any): string {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part: any) => !part.thought && typeof part.text === "string")
    .map((part: any) => part.text)
    .join("");
}

/**
 * Validate every chunk, not just the chunks containing text. A final STOP is
 * required; MAX_TOKENS and safety/error signals must never save partial text.
 * Proxies may return the stream as a JSON object or array instead of SSE.
 */
function parseGeminiBody(text: string, stream: boolean): string {
  let payloads: any[];
  try {
    if (!stream || /^[[{]/.test(text.trimStart())) {
      const parsed = JSON.parse(text);
      payloads = stream && Array.isArray(parsed) ? parsed : [parsed];
    } else {
      payloads = [];
      for (const frame of text.split(/\r?\n\r?\n/)) {
        const payload = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!payload || payload === "[DONE]") continue;
        payloads.push(JSON.parse(payload));
      }
    }
  } catch {
    throw new Error("Malformed Gemini response data.");
  }

  let result = "";
  let finished = false;
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Malformed Gemini response.");
    }
    if (payload.error) {
      throw new Error("Gemini API returned an error.");
    }
    const blockReason = payload.promptFeedback?.blockReason;
    if (blockReason && blockReason !== "BLOCK_REASON_UNSPECIFIED") {
      throw new Error("Gemini prompt was blocked.");
    }
    const candidates = payload.candidates;
    // Usage/prompt metadata may be delivered separately from the candidate.
    if (
      candidates === undefined ||
      (Array.isArray(candidates) && candidates.length === 0)
    ) {
      if (!payload.usageMetadata && !payload.promptFeedback) {
        throw new Error("Malformed Gemini response: missing candidates.");
      }
      continue;
    }
    if (!Array.isArray(candidates) || candidates.length !== 1) {
      throw new Error("Malformed Gemini response candidates.");
    }
    const candidate = candidates[0];
    if (
      !candidate ||
      typeof candidate !== "object" ||
      (candidate.index !== undefined && candidate.index !== 0)
    ) {
      throw new Error("Malformed Gemini response candidate.");
    }
    const reason = candidate.finishReason;
    if (reason !== undefined && reason !== "") {
      if (reason !== "STOP") {
        const label =
          reason === "MAX_TOKENS" || reason === "SAFETY" ? reason : "not STOP";
        throw new Error(
          `Gemini response is incomplete (finishReason: ${label}).`,
        );
      }
    }
    if (
      candidate.safetyRatings?.some((rating: any) => rating?.blocked === true)
    ) {
      throw new Error("Gemini response was blocked by a safety filter.");
    }
    if (candidate.content !== undefined) {
      if (
        !candidate.content ||
        typeof candidate.content !== "object" ||
        Array.isArray(candidate.content)
      ) {
        throw new Error("Malformed Gemini response content.");
      }
      const parts = candidate.content?.parts;
      if (parts !== undefined && !Array.isArray(parts)) {
        throw new Error("Malformed Gemini response content.");
      }
      for (const part of parts ?? []) {
        if (
          !part ||
          typeof part !== "object" ||
          typeof part.text !== "string" ||
          (part.thought !== undefined && typeof part.thought !== "boolean")
        ) {
          throw new Error("Malformed Gemini response text part.");
        }
        if (finished && part.text) {
          throw new Error(
            "Malformed Gemini response: candidate data after STOP.",
          );
        }
        if (!part.thought) result += part.text;
      }
    }
    if (reason === "STOP") finished = true;
  }
  if (!finished) {
    throw new Error("Gemini response ended without finishReason STOP.");
  }
  return result;
}

const translate = <TranslateService["translate"]>async function (data) {
  const endPoint = getPref("gemini.endPoint");
  const model = getPref("gemini.model");
  const thinkingLevel = getPref("gemini.thinkingLevel") as string;
  const stream = getPref("gemini.stream") as boolean;

  function getGenerationConfig() {
    // Gemini 3 replaces thinkingBudget with the thinkingLevel field; it
    // cannot be fully disabled there, so "off" maps to "minimal"
    // https://ai.google.dev/gemini-api/docs/thinking
    const modelId = String(model ?? "")
      .trim()
      .split("/")
      .pop();
    const isGemini3 = /^gemini-3/.test(modelId ?? "");
    if (thinkingLevel === "off") {
      return {
        thinkingConfig: isGemini3
          ? { thinkingLevel: "minimal" }
          : { thinkingBudget: 0 },
      };
    }
    if (
      thinkingLevel === "low" ||
      thinkingLevel === "medium" ||
      thinkingLevel === "high"
    ) {
      const budgets = { low: 1024, medium: 8192, high: 24576 };
      return {
        thinkingConfig: isGemini3
          ? { thinkingLevel: thinkingLevel }
          : { thinkingBudget: budgets[thinkingLevel] },
      };
    }
    return undefined;
  }

  function transformContent(
    langFrom: string,
    langTo: string,
    sourceText: string,
  ) {
    return buildPromptParts(
      "gemini.prompt",
      langFrom,
      langTo,
      sourceText,
      data,
    );
  }

  const apiURL = buildGeminiEndpoint(endPoint, model, stream);

  if (!data.secret) {
    throw "The Gemini API key is not set.";
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
  );

  const generationConfig = getGenerationConfig();
  const requestOptions = {
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": data.secret,
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: user,
            },
          ],
        },
      ],
      system_instruction: {
        parts: [
          {
            text: system,
          },
        ],
      },
      ...(generationConfig ? { generationConfig } : {}),
    }),
    responseType: "text",
    // The request body is the user's document and the key is a secret: log
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
      // SSE frames can be split across progress events; only parse complete
      // lines and keep the trailing fragment until the next event.
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
            result += extractText(JSON.parse(payload));
          } catch {
            // A malformed frame is skipped; fragmented frames never reach
            // JSON.parse because the line buffer holds them.
          }
        }

        if (xmlhttp.timeout) {
          xmlhttp.timeout = 0;
        }

        data.result = stripThinkingTags(result);
        refreshHandler();
      };

      xmlhttp.onprogress = () => {
        try {
          consume(false);
        } catch (error) {
          console.error("Error processing Gemini stream:", error);
        }
      };
      xmlhttp.onload = () => {
        try {
          consume(true);
        } catch (error) {
          console.error("Error processing Gemini stream:", error);
        }
      };
    },
  };

  try {
    const xhr = await Zotero.HTTP.request("POST", apiURL, requestOptions);
    if (xhr?.status !== 200) {
      throw new Error(`Request error: ${xhr?.status}`);
    }
    const result = stripThinkingTags(
      parseGeminiBody(xhr.responseText || "", stream),
    );
    if (!result.trim()) {
      throw new Error("Gemini returned an empty translation.");
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

export const Gemini: TranslateService = {
  id: "gemini",
  type: "sentence",
  helpUrl: "https://ai.google.dev/gemini-api/docs",

  defaultSecret: "",
  secretValidator(secret: string) {
    return {
      secret,
      status: isHeaderSafeSecret(secret),
      info: !secret
        ? "The secret is not set."
        : isHeaderSafeSecret(secret)
          ? ""
          : INVALID_KEY_INFO,
    };
  },

  translate,

  config(settings) {
    settings
      .addTextSetting({
        prefKey: "gemini.endPoint",
        nameKey: "service-gemini-dialog-endPoint",
      })
      .addTextSetting({
        prefKey: "gemini.model",
        nameKey: "service-gemini-dialog-model",
      })
      .addTextAreaSetting({
        prefKey: "gemini.prompt",
        nameKey: "service-gemini-dialog-prompt",
      })
      .addCheckboxSetting({
        prefKey: "gemini.stream",
        nameKey: "service-gemini-dialog-stream",
      })
      .addSelectSetting({
        prefKey: "gemini.thinkingLevel",
        nameKey: "service-gemini-dialog-thinkingLevel",
        options: getThinkingLevelOptions(),
      });
  },
};
