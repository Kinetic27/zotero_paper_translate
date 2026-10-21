import { config } from "../package.json";
import { clearPref, getPref, setPref } from "../src/utils/prefs";

// Run before pageReader.test.ts, whose terminal scenario shuts down the live addon.
describe("Reader-focused preferences", function () {
  this.timeout(20000);

  it("opens essential translation and reading settings while preserving stored legacy choices", async function () {
    assert.isTrue(
      Zotero.DataDirectory.dir
        .replace(/\\/g, "/")
        .endsWith("/.scaffold/test/data"),
    );
    const keys = [
      "translateSource",
      "sourceLanguage",
      "targetLanguage",
      "secretObj",
      "enableComment",
      "enablePopup",
      "dictSource",
      "annotationTagContent",
      "fontSize",
      "lineHeight",
    ];
    const previous = new Map(keys.map((key) => [key, getPref(key)]));
    let window: Window | null = null;
    const wait = async (condition: () => boolean) => {
      const deadline = Date.now() + 7000;
      while (!condition()) {
        if (Date.now() > deadline) {
          assert.fail(
            "The retained preference controls did not finish loading.",
          );
        }
        await Zotero.Promise.delay(10);
      }
    };
    try {
      setPref("translateSource", "googleapi");
      setPref("sourceLanguage", "en-US");
      setPref("targetLanguage", "ko-KR");
      setPref(
        "secretObj",
        JSON.stringify({
          chatgpt: "synthetic-settings-key",
          claude: "synthetic-other-key",
        }),
      );
      setPref("enableComment", true);
      setPref("enablePopup", true);
      setPref("dictSource", "bingdict");
      setPref("annotationTagContent", "retained-annotation-tag");
      const pane = Zotero.PreferencePanes.pluginPanes.find(
        (pane) => pane.pluginID === config.addonID,
      )!;
      assert.exists(pane);
      window = Zotero.Utilities.Internal.openPreferences(pane.id!);
      assert.exists(window);
      const id = (name: string) => `${config.addonRef}-${name}`;
      await wait(
        () =>
          !!window!.document.getElementById(id("langto")) &&
          !!window!.document.getElementById(id("sentenceServices")),
      );
      const doc = window!.document;
      const root = doc.getElementById(`zotero-prefpane-${config.addonRef}`)!;
      assert.lengthOf(
        root.querySelectorAll("groupbox"),
        3,
        "Translation, basic reading appearance and About remain",
      );
      assert.lengthOf(
        root.querySelectorAll("checkbox, radiogroup, radio"),
        0,
        "Legacy feature options must be removed, not hidden",
      );
      for (const name of [
        "wordServices",
        "manageKeys",
        "renameServices",
        "reset-titleTranslation",
        "reset-abstractTranslation",
      ]) {
        assert.isNull(doc.getElementById(id(name)), name);
      }
      assert.exists(
        root.querySelector(
          'label[href="https://github.com/windingwind/zotero-pdf-translate"]',
        ),
      );
      const select = (name: string, value: string) => {
        const control = doc.getElementById(id(name))!;
        assert.exists(control.querySelector(`menuitem[value="${value}"]`));
        control.setAttribute("value", value);
        const event = doc.createEvent("Event");
        event.initEvent("command", true, false);
        control.dispatchEvent(event);
      };
      select("sentenceServices", "chatgpt");
      const secret = doc.getElementById(
        id("sentenceServicesSecret"),
      ) as HTMLInputElement;
      assert.equal(secret.value, "synthetic-settings-key");
      const status = doc.querySelector<XUL.Button>(
        `#${id("sentenceServicesStatus")}`,
      )!;
      assert.isFalse(status.hidden, "API configuration must remain accessible");
      secret.value = "updated-settings-key";
      const blur = doc.createEvent("Event");
      blur.initEvent("blur", false, false);
      secret.dispatchEvent(blur);
      assert.deepEqual(JSON.parse(getPref("secretObj") as string), {
        chatgpt: "updated-settings-key",
        claude: "synthetic-other-key",
      });
      select("sentenceServices", "codex");
      assert.isFalse(
        status.hidden,
        "OAuth configuration must remain accessible",
      );
      select("sentenceServices", "bing");
      assert.isTrue(status.hidden);
      select("langfrom", "en");
      select("langto", "ko");
      assert.equal(getPref("translateSource"), "bing");
      assert.equal(getPref("sourceLanguage"), "en");
      assert.equal(getPref("targetLanguage"), "ko");
      assert.isTrue(getPref("enableComment"));
      assert.isTrue(getPref("enablePopup"));
      assert.equal(getPref("dictSource"), "bingdict");
      assert.equal(getPref("annotationTagContent"), "retained-annotation-tag");
      const font = doc.getElementById(id("fontSize")) as HTMLInputElement;
      const spacing = doc.getElementById(id("lineHeight")) as HTMLInputElement;
      const change = (input: HTMLInputElement, value: string) => {
        input.value = value;
        const event = doc.createEvent("Event");
        event.initEvent("change", true, false);
        input.dispatchEvent(event);
      };
      change(font, "99");
      assert.equal(
        getPref("fontSize"),
        "40",
        "Font size is bounded at the real settings input",
      );
      change(font, "21");
      change(spacing, "1.8");
      assert.equal(getPref("fontSize"), "21");
      assert.equal(getPref("lineHeight"), "1.8");
      setPref("fontSize", "23");
      await wait(() => font.value === "23");
    } finally {
      if (window && !window.closed) window.close();
      for (const [key, value] of previous) {
        if (value === undefined) clearPref(key);
        else setPref(key, value);
      }
    }
  });
});
