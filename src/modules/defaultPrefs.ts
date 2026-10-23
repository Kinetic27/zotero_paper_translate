import { getPref, getPrefJSON, setPref } from "../utils/prefs";
import { services } from "./services";

export function setDefaultPrefSettings() {
  const isZhCN = Zotero.locale === "zh-CN";
  const sentenceIds = services
    .getAllServicesWithType("sentence")
    .map((service) => service.id);
  const wordIds = services
    .getAllServicesWithType("word")
    .map((service) => service.id);
  if (!sentenceIds.includes((getPref("translateSource") as string) || "")) {
    // Keep the regional default within the supported translation choices.
    setPref("translateSource", isZhCN ? "bing" : "googleapi");
  }
  if (!wordIds.includes((getPref("dictSource") as string) || "")) {
    setPref("dictSource", isZhCN ? "bingdict" : "freedictionaryapi");
  }

  if (!getPref("targetLanguage")) setPref("targetLanguage", Zotero.locale);

  const secrets = getPrefJSON("secretObj");
  for (const service of services.getAllServices()) {
    if (typeof secrets[service.id] === "undefined") {
      secrets[service.id] = service.defaultSecret || "";
    }
  }
  setPref("secretObj", JSON.stringify(secrets));

  if (isZhCN && !getPref("disabledLanguages")) {
    setPref("disabledLanguages", "zh,zh-CN,中文;");
  }

  const extraServices = (getPref("extraEngines") as string) || "";
  const availableExtras = extraServices
    .split(",")
    .filter((id) => sentenceIds.includes(id))
    .join(",");
  if (availableExtras !== extraServices)
    setPref("extraEngines", availableExtras);

  if (!getPref("annotationTagContent")) {
    setPref("annotationTagContent", isZhCN ? "翻译" : "Translation");
  }
}
