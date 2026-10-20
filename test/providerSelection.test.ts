import { setDefaultPrefSettings } from "../src/modules/defaultPrefs";
import { clearPref, getPref, setPref } from "../src/utils/prefs";

describe("Compact provider preference validation", function () {
  it("replaces unavailable selections without migrating or deleting saved API keys", function () {
    assert.isTrue(
      Zotero.DataDirectory.dir
        .replace(/\\/g, "/")
        .endsWith("/.scaffold/test/data"),
    );
    const keys = [
      "translateSource",
      "dictSource",
      "extraEngines",
      "secretObj",
      "targetLanguage",
      "disabledLanguages",
      "annotationTagContent",
    ];
    const previous = new Map(keys.map((key) => [key, getPref(key)]));
    try {
      setPref("translateSource", "customgpt1");
      setPref("dictSource", "chatgpt");
      setPref("extraEngines", ",bing,customgpt3,googleapi,niutranspro");
      setPref(
        "secretObj",
        JSON.stringify({ customgpt1: "synthetic-retired-key" }),
      );
      setDefaultPrefSettings();
      assert.equal(
        getPref("translateSource"),
        Zotero.locale === "zh-CN" ? "bing" : "googleapi",
      );
      assert.equal(
        getPref("dictSource"),
        Zotero.locale === "zh-CN" ? "bingdict" : "freedictionaryapi",
      );
      assert.equal(getPref("extraEngines"), "bing,googleapi");
      const keysAfter = JSON.parse(getPref("secretObj") as string);
      assert.equal(keysAfter.customgpt1, "synthetic-retired-key");
      assert.equal(
        keysAfter.chatgpt,
        "",
        "A retired slot's key must not be copied to a different provider",
      );

      setPref("translateSource", "gemini");
      setPref("dictSource", "bingdict");
      setDefaultPrefSettings();
      assert.equal(getPref("translateSource"), "gemini");
      assert.equal(getPref("dictSource"), "bingdict");
    } finally {
      for (const [key, value] of previous) {
        if (value === undefined) clearPref(key);
        else setPref(key, value);
      }
    }
  });
});
