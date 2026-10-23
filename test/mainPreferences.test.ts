import { config } from "../package.json";
import type Addon from "../src/addon";
import { elementPrefix } from "../src/utils/elementIdentity";
import { clearPref, getPref, setPref } from "../src/utils/prefs";
import {
  closeServiceSettingsDialogs,
  createServiceSettingsDialog,
} from "../src/utils/settingsDialog";

// Run before pageReader.test.ts, whose terminal scenario shuts down the live addon.
describe("Reader-focused preferences", function () {
  this.timeout(20000);

  const previousToolkit = Object.getOwnPropertyDescriptor(
    globalThis,
    "ztoolkit",
  );
  const runningAddon = () =>
    (Zotero as unknown as Record<string, Addon>)[config.addonInstance];
  const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 7000;
    while (!condition()) {
      if (Date.now() > deadline)
        assert.fail("Native settings dialog did not settle.");
      await Zotero.Promise.delay(10);
    }
  };
  const findDialog = async (selector: string) => {
    let dialog: Window | undefined;
    await waitFor(() => {
      const candidate = Services.wm.getMostRecentWindow(
        "",
      ) as unknown as Window | null;
      if (
        candidate &&
        !candidate.closed &&
        candidate.document.querySelector(selector)
      )
        dialog = candidate;
      return !!dialog;
    });
    return dialog!;
  };
  const openSettings = async (id: string, settingKey: string) => {
    const service = runningAddon().data.translate.services.getServiceById(id)!;
    await createServiceSettingsDialog(service);
    return findDialog(`[data-setting-key="${settingKey}"]`);
  };
  const openCustomParams = async (parent: Window) => {
    (
      parent.document.getElementById(
        "chatGPT.customParams",
      ) as HTMLButtonElement
    ).click();
    return findDialog("#custom-params-table");
  };

  before(function () {
    assert.isTrue(
      Zotero.DataDirectory.dir
        .replace(/\\/g, "/")
        .endsWith("/.scaffold/test/data"),
    );
    (globalThis as unknown as { addon: unknown }).addon = runningAddon();
    (globalThis as unknown as { ztoolkit: ZToolkit }).ztoolkit =
      runningAddon().data.ztoolkit;
  });

  after(function () {
    if (previousToolkit)
      Object.defineProperty(globalThis, "ztoolkit", previousToolkit);
    else delete (globalThis as { ztoolkit?: unknown }).ztoolkit;
  });

  it("opens essential translation and reading settings while preserving stored legacy choices", async function () {
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

  it("keeps invalid service numbers editable, saves corrections, and never saves a rejected edit on close", async function () {
    const keys = [
      "claude.endPoint",
      "claude.model",
      "claude.temperature",
      "claude.maxTokens",
      "claude.prompt",
      "claude.stream",
      "claude.thinkingLevel",
    ];
    const previous = new Map(keys.map((key) => [key, getPref(key)]));
    let dialog: Window | undefined;
    const input = (key: string) =>
      dialog!.document.querySelector<HTMLInputElement>(
        `[data-setting-key="${key}"]`,
      )!;
    const rejectNumber = async (control: HTMLInputElement, value: string) => {
      control.value = value;
      const edited = control.value;
      let invalid = false;
      control.addEventListener("invalid", () => (invalid = true), {
        once: true,
      });
      dialog!.document.querySelector<HTMLButtonElement>("#save")!.click();
      await waitFor(() => dialog!.closed || invalid);
      assert.isFalse(
        dialog!.closed,
        "Invalid numbers must not close the editor",
      );
      assert.strictEqual(dialog!.document.activeElement, control);
      assert.equal(
        control.value,
        edited,
        "Keep the rejected edit for correction",
      );
    };
    try {
      setPref("claude.model", "stored-model");
      setPref("claude.temperature", "0.4");
      setPref("claude.maxTokens", "4000");
      dialog = await openSettings("claude", "claude.temperature");
      input("claude.model").value = "corrected-model";
      const temperature = input("claude.temperature");
      for (const value of ["2", "-0.1", "0.25", "", "1e309"]) {
        await rejectNumber(temperature, value);
        assert.equal(getPref("claude.temperature"), "0.4");
        assert.equal(getPref("claude.model"), "stored-model");
      }
      temperature.value = "0.7";
      const tokens = input("claude.maxTokens");
      for (const value of ["50", "450", "11000"]) {
        await rejectNumber(tokens, value);
        assert.equal(getPref("claude.maxTokens"), "4000");
        assert.equal(getPref("claude.temperature"), "0.4");
      }
      tokens.value = "5000";
      dialog.document.querySelector<HTMLButtonElement>("#save")!.click();
      await waitFor(() => dialog!.closed);
      assert.equal(getPref("claude.temperature"), "0.7");
      assert.equal(getPref("claude.maxTokens"), "5000");
      assert.equal(getPref("claude.model"), "corrected-model");

      dialog = await openSettings("claude", "claude.temperature");
      input("claude.model").value = "discarded-model";
      await rejectNumber(input("claude.temperature"), "2");
      dialog.document.querySelector<HTMLButtonElement>("#close")!.click();
      await waitFor(() => dialog!.closed);
      assert.equal(getPref("claude.temperature"), "0.7");
      assert.equal(getPref("claude.model"), "corrected-model");
    } finally {
      if (dialog && !dialog.closed) dialog.close();
      for (const [key, value] of previous) {
        if (value === undefined) clearPref(key);
        else setPref(key, value);
      }
    }
  });

  it("validates custom parameters before closing and persists only a corrected Save", async function () {
    const key = "chatGPT.customParams";
    const previous = getPref(key);
    const stored = '{"existing":true}';
    const alert = Zotero.alert;
    const messages: string[] = [];
    let parent: Window | undefined;
    let editor: Window | undefined;
    const field = (id: string) =>
      editor!.document.getElementById(id) as HTMLInputElement;
    const reject = async () => {
      const count = messages.length;
      editor!.document.querySelector<HTMLButtonElement>("#save")!.click();
      await waitFor(() => editor!.closed || messages.length > count);
      assert.isFalse(editor!.closed, "Validation must run before closing");
      assert.equal(getPref(key), stored);
      assert.equal(field("key-0").value, "existing");
      assert.equal(field("value-0").value, "true");
    };
    try {
      Zotero.alert = ((_window, _title, text) => {
        messages.push(text);
      }) as typeof Zotero.alert;
      setPref(key, stored);
      parent = await openSettings("chatgpt", "chatGPT.temperature");
      editor = await openCustomParams(parent);
      field("key-1").value = "limit";
      field("value-1").value = "{broken";
      await reject();
      assert.equal(field("key-1").value, "limit");
      assert.equal(field("value-1").value, "{broken");
      field("key-1").value = "existing";
      field("value-1").value = "3";
      await reject();
      assert.include(messages[messages.length - 1], "existing");
      assert.equal(field("key-1").value, "existing");
      assert.equal(field("value-1").value, "3");
      editor.document.querySelector<HTMLButtonElement>("#close")!.click();
      await waitFor(() => editor!.closed);
      assert.equal(
        getPref(key),
        stored,
        "Rejected Save followed by Close is not Save",
      );

      editor = await openCustomParams(parent);
      field("value-0").value = "false";
      field("key-1").value = "limit";
      field("value-1").value = '{"nested":[1,null]}';
      editor.document.querySelector<HTMLButtonElement>("#save")!.click();
      await waitFor(() => editor!.closed);
      assert.deepEqual(JSON.parse(getPref(key) as string), {
        existing: false,
        limit: { nested: [1, null] },
      });
    } finally {
      if (editor && !editor.closed) editor.close();
      if (parent && !parent.closed) parent.close();
      Zotero.alert = alert;
      if (previous === undefined) clearPref(key);
      else setPref(key, previous);
    }
  });

  it("closes owned service and custom editors without saving through the settings shutdown lifecycle", async function () {
    const keys = ["claude.model", "chatGPT.model", "chatGPT.customParams"];
    const previous = new Map(keys.map((key) => [key, getPref(key)]));
    const windows: Window[] = [];
    const unloaded = new Set<Window>();
    try {
      setPref("claude.model", "saved-claude");
      setPref("chatGPT.model", "saved-chatgpt");
      setPref("chatGPT.customParams", '{"keep":1}');
      const claude = await openSettings("claude", "claude.model");
      windows.push(claude);
      claude.document.querySelector<HTMLInputElement>(
        '[data-setting-key="claude.model"]',
      )!.value = "unsaved-claude";
      const chatgpt = await openSettings("chatgpt", "chatGPT.model");
      windows.push(chatgpt);
      chatgpt.document.querySelector<HTMLInputElement>(
        '[data-setting-key="chatGPT.model"]',
      )!.value = "unsaved-chatgpt";
      const custom = await openCustomParams(chatgpt);
      windows.push(custom);
      (custom.document.getElementById("value-0") as HTMLInputElement).value =
        "2";
      const codex = await openSettings("codex", "codex.model");
      windows.push(codex);
      for (const window of windows)
        window.addEventListener("unload", () => unloaded.add(window), {
          once: true,
        });

      // Exercise the real settings teardown, not the terminal addon hook used
      // by pageReader.test.ts after every other shared-runtime scenario.
      closeServiceSettingsDialogs();
      await waitFor(() => windows.every((window) => window.closed));
      await waitFor(() => unloaded.size === windows.length);
      assert.equal(getPref("claude.model"), "saved-claude");
      assert.equal(getPref("chatGPT.model"), "saved-chatgpt");
      assert.equal(getPref("chatGPT.customParams"), '{"keep":1}');
    } finally {
      for (const window of windows) {
        if (!window.closed) window.close();
      }
      for (const [key, value] of previous) {
        if (value === undefined) clearPref(key);
        else setPref(key, value);
      }
    }
  });

  it("renders persisted service names containing XML syntax as literal panel labels", async function () {
    const key = "renameServices.chatgpt";
    const previous = getPref(key);
    const label = `A & B <model> "quoted" 'single'`;
    const doc = Zotero.getMainWindow().document;
    const panel = doc.createElementNS(
      "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul",
      `${elementPrefix}-panel`,
    ) as HTMLElement;
    panel.hidden = true;
    try {
      setPref(key, label);
      doc.documentElement.appendChild(panel);
      await waitFor(
        () => !!panel.querySelector(`#${config.addonRef}-services`),
      );
      const menu = panel.querySelector(`#${config.addonRef}-services`)!;
      const item = menu.querySelector('menuitem[value="chatgpt"]')!;
      assert.exists(
        item,
        "A renamed service must not break panel initialization",
      );
      assert.equal(item.getAttribute("label"), `${label}🗝️`);
      assert.lengthOf(menu.querySelectorAll('menuitem[value="chatgpt"]'), 1);
      assert.isNull(panel.querySelector("model"));
    } finally {
      panel.remove();
      if (previous === undefined) clearPref(key);
      else setPref(key, previous);
    }
  });
});
