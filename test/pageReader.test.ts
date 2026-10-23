import { config, version } from "../package.json";
import { elementPrefix } from "../src/utils/elementIdentity";
import { getPref, setPref } from "../src/utils/prefs";
import { addTranslateTask } from "../src/utils/task";
import { makeReadingFixturePDF, readingFixture } from "./pdfReadingFixture";
import type { ReadingBlock } from "../src/modules/pdfReadingTypes";
import type { TranslateService } from "../src/modules/services/base";

const longPageText = Array(40)
  .fill("Long page text ".repeat(5).trim())
  .join("\n");

/**
 * Synthetic PDF bytes go through real Zotero/PDF.js and rendered panels.
 * Stubbed provider HTTP proves request routing, response publication and lifecycle,
 * not live translation quality, installed-version compatibility or the user's UI.
 */
function makePDF() {
  const texts = [
    "First page text",
    "Second page text",
    "",
    ...Array.from({ length: 12 }, (_, i) => `Cache page ${i}`),
    longPageText,
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${texts.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${texts.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  for (const [i, text] of texts.entries()) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    const stream = text
      ? `BT /F1 12 Tf 72 720 Td ${text
          .split("\n")
          .map((line) => `(${line}) Tj 0 -14 Td`)
          .join(" ")} ET`
      : "";
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Reader state did not settle");
    await Zotero.Promise.delay(25);
  }
}

describe("PDF page reader with stubbed provider HTTP", function () {
  this.timeout(60000);
  let item: Zotero.Item;
  let reader: _ZoteroTypes.ReaderInstance<"pdf">;
  let application: _ZoteroTypes.Reader.PDFViewerApplication;
  let body: HTMLElement;
  let checkbox: HTMLButtonElement;
  let result: HTMLElement & { value: string };
  let status: HTMLElement;
  let requests: string[];
  let requestLanguages: string[];
  let requestHosts: string[];
  let resolveSlow: (() => void) | undefined;
  let slow = false;
  let fail = false;
  let echoProse = false;
  let inlineFailure: "drop" | "duplicate" | undefined;
  const originalRequest = Zotero.HTTP.request;
  const saved = new Map<string, string | number | boolean>();
  let path: string;
  let closed = false;

  before(async function () {
    for (const key of [
      "translateSource",
      "sourceLanguage",
      "targetLanguage",
      "secretObj",
      "showOriginalPage",
      "customRawRatio",
      "rawResultOrder",
      "fontSize",
      "lineHeight",
    ])
      saved.set(key, getPref(key));
    setPref("translateSource", "googleapi");
    setPref("sourceLanguage", "en");
    setPref("targetLanguage", "ko");
    setPref("secretObj", "{}");
    setPref("showOriginalPage", false);
    setPref("customRawRatio", "0.95");
    setPref("rawResultOrder", true);
    requests = [];
    requestLanguages = [];
    requestHosts = [];
    Zotero.HTTP.request = (async (
      method: string,
      url: string,
      options: any,
    ) => {
      if (
        !/^https:\/\/(translate\.googleapis\.com|translate\.google\.com)\/translate_a\/single/.test(
          url,
        )
      )
        return originalRequest.call(Zotero.HTTP, method as "GET", url, options);
      const query = new URL(url).searchParams.get("q")!;
      requests.push(query);
      const params = new URL(url).searchParams;
      requestLanguages.push(`${params.get("sl")}→${params.get("tl")}`);
      requestHosts.push(new URL(url).hostname);
      if (slow)
        await new Promise<void>((resolve) => {
          resolveSlow = resolve;
        });
      if (fail) throw new Error("Test provider unavailable");
      let response = "번역 결과";
      if (query.startsWith("The energy ") && query.includes("[MATH_0]"))
        response =
          inlineFailure === "drop"
            ? "수식이 빠졌습니다."
            : inlineFailure === "duplicate"
              ? "[MATH_0]와 [MATH_0]입니다."
              : "보존량은 [MATH_0]이며 이 문장은 번역됩니다.";
      else if (query.startsWith("A tensor ") && query.includes("[MATH_0]"))
        response = "관측값은 [MATH_0]에 저장됩니다.";
      else if (
        query.startsWith("The two variables ") &&
        query.includes("[MATH_0]")
      )
        response = "먼저 [MATH_1], 다음 [MATH_0]를 비교합니다.";
      else if (
        query.startsWith("The conserved quantity ") &&
        query.includes("[MATH_0]")
      )
        response = "보존량 [MATH_0]는 [MATH_1]와 함께 안정적입니다.";
      else if (
        query.startsWith("The latent dimension ") &&
        query.includes("[MATH_0]")
      )
        response = "잠재 차원 [MATH_0]을 유지합니다.";
      return {
        status: 200,
        response: [[[echoProse ? query : response, query]]],
      };
    }) as typeof Zotero.HTTP.request;
    path = PathUtils.join(PathUtils.tempDir, `page-reader-${Date.now()}.pdf`);
    await IOUtils.writeUTF8(path, makePDF());
    item = await Zotero.Attachments.importFromFile({ file: path });
    reader = (await Zotero.Reader.open(
      item.id,
    )) as _ZoteroTypes.ReaderInstance<"pdf">;
    await reader._initPromise;
    await reader._internalReader._primaryView.initializedPromise;
    application =
      reader._internalReader._primaryView._iframeWindow!.PDFViewerApplication;
    const doc = Zotero.getMainWindow().document as Document;
    const detailElements = () =>
      Array.from(doc.querySelectorAll("item-details")) as HTMLElement[];
    await until(() =>
      detailElements().some(
        (element) =>
          (element as any).tabID === reader.tabID &&
          !!element.querySelector(".page-source"),
      ),
    );
    const details = detailElements().find(
      (element) => (element as any).tabID === reader.tabID,
    )!;
    body = details.querySelector(`${elementPrefix}-panel`) as HTMLElement;
    checkbox = body.querySelector('[role="switch"]')!;
    result = body.querySelector(".page-result")!;
    status = body.querySelector("[role=status]")!;
  });

  after(async function () {
    resolveSlow?.();
    if (checkbox) {
      if (checkbox.getAttribute("aria-checked") === "true") checkbox.click();
    }
    Zotero.HTTP.request = originalRequest;
    for (const [key, value] of saved) setPref(key, value);
    if (reader && !closed)
      (reader as unknown as _ZoteroTypes.ReaderTab).close();
    if (item) await item.eraseTx();
    if (path) await IOUtils.remove(path, { ignoreAbsent: true });
  });

  function enable(value: boolean) {
    if ((checkbox.getAttribute("aria-checked") === "true") !== value)
      checkbox.click();
  }
  async function page(number: number) {
    application.pdfViewer!.currentPageNumber = number;
    await until(
      () =>
        status.textContent!.includes(`Page ${number}`) &&
        (status.textContent!.includes("saved") ||
          status.textContent!.includes("no extractable text")),
    );
  }
  function reread() {
    body
      .querySelector<HTMLButtonElement>(`#${config.addonRef}-retranslate-page`)!
      .click();
  }
  function translate() {
    body
      .querySelector(`#${config.addonRef}-translate`)!
      .dispatchEvent(new (Zotero.getMainWindow() as any).Event("command"));
  }

  it("fills the native reader viewport with sibling plugin sections after resize and reopen without translation requests", async function () {
    const win = Zotero.getMainWindow();
    const size = [win.outerWidth, win.outerHeight];
    const viewport = body.closest("#zotero-view-item") as HTMLElement;
    const section = body.closest("item-pane-custom-section") as HTMLElement;
    const collapsible = section.querySelector(
      "collapsible-section",
    ) as HTMLElement & {
      open: boolean;
    };
    const wasOpen = collapsible.open;
    const details = section.closest("item-details") as HTMLElement & {
      scrollToPane(id: string): Promise<void>;
    };
    const keys: string[] = [];
    const before = requests.length;
    const contextPane = win.ZoteroContextPane;
    const wasCollapsed =
      contextPane.splitter.getAttribute("state") === "collapsed";
    const footer = body.querySelector(`#${config.addonRef}-copy-container`)!;
    const assertLayout = () => {
      const host = viewport.getBoundingClientRect();
      const panel = body.getBoundingClientRect();
      const head = section.querySelector(".head")!.getBoundingClientRect();
      const hostStyle = win.getComputedStyle(viewport)!;
      const hostPadding =
        (parseFloat(hostStyle.paddingTop) || 0) +
        (parseFloat(hostStyle.paddingBottom) || 0);
      const translated = result.getBoundingClientRect();
      const copy = footer.getBoundingClientRect();
      assert.isAbove(
        host.height,
        350,
        "Exercise a usable native scroll viewport",
      );
      assert.closeTo(
        collapsible.getBoundingClientRect().height,
        viewport.clientHeight - hostPadding,
        3,
        "Reader section including its own header fills the native scroll viewport",
      );
      assert.isAtLeast(head.top, host.top - 2);
      assert.isAtMost(
        copy.bottom,
        host.bottom + 2,
        "Copy footer remains in the viewport",
      );
      assert.closeTo(
        copy.bottom,
        panel.bottom,
        2,
        "No empty reading area below the footer",
      );
      assert.isAbove(
        translated.height,
        host.height * 0.3,
        "Translation receives the remaining reading space",
      );
      assert.isAtMost(
        translated.bottom,
        copy.top,
        "Translation does not cover copy controls",
      );
      assert.isAbove(copy.height, 0);
      assert.isAbove(translated.width, 0);
      return {
        host: viewport.clientHeight,
        result: translated.height,
        panel: panel.height,
      };
    };
    try {
      (contextPane as typeof contextPane & { collapsed: boolean }).collapsed =
        false;
      contextPane.update();
      await until(
        () => viewport.clientHeight > 350 && viewport.clientWidth >= 250,
      );
      for (let index = 0; index < 2; index++) {
        const key = Zotero.ItemPaneManager.registerSection({
          paneID: `reader-layout-${Zotero.Utilities.randomString(8)}`,
          pluginID: config.addonID,
          header: {
            l10nID: "item-details-pane",
            icon: "chrome://zotero/skin/16/universal/open-link.svg",
          },
          sidenav: {
            l10nID: "item-details-pane",
            icon: "chrome://zotero/skin/16/universal/open-link.svg",
          },
          bodyXHTML:
            '<html:div style="height: 260px">Synthetic sibling plugin content</html:div>',
          onRender: ({ body: siblingBody }) => {
            siblingBody.setAttribute(
              "aria-label",
              "Synthetic sibling plugin section",
            );
          },
          onItemChange: ({ tabType, setEnabled }) => {
            setEnabled(tabType === "reader");
          },
        });
        assert.isString(key);
        keys.push(key as string);
      }
      const siblingFor = (key: string) =>
        (
          Array.from(
            viewport.querySelectorAll("item-pane-custom-section"),
          ) as HTMLElement[]
        ).find((node) => node.dataset.pane === key);
      await until(() => keys.every((key) => !!siblingFor(key)));
      const siblings = keys.map((key) => siblingFor(key)!);
      for (const sibling of siblings) {
        (
          sibling.querySelector("collapsible-section") as HTMLElement & {
            open: boolean;
          }
        ).open = true;
      }
      win.focus();
      win.resizeTo(1200, 650);
      await until(
        () => viewport.clientHeight > 350 && viewport.clientWidth >= 250,
      );
      collapsible.open = true;
      (section.querySelector(".fullHeight") as HTMLElement).click();
      await details.scrollToPane(section.dataset.pane!);
      await Zotero.Promise.delay(300);
      for (const sibling of siblings) {
        assert.isAbove(
          sibling.getBoundingClientRect().height,
          250,
          "Real registered sibling sections coexist with the reader",
        );
      }
      const small = {
        host: viewport.clientHeight,
        result: result.getBoundingClientRect().height,
      };
      win.resizeTo(1200, 850);
      await until(() => viewport.clientHeight > small.host + 100);
      await Zotero.Promise.delay(300);
      assert.closeTo(
        result.getBoundingClientRect().height - small.result,
        viewport.clientHeight - small.host,
        3,
        "Resizing must give the translation the newly available viewport height without refresh",
      );
      await details.scrollToPane(section.dataset.pane!);
      await Zotero.Promise.delay(300);
      const large = assertLayout();
      for (const sibling of siblings) {
        (
          sibling.querySelector("collapsible-section") as HTMLElement & {
            open: boolean;
          }
        ).open = false;
      }
      await Zotero.Promise.delay(300);
      assert.closeTo(
        assertLayout().panel,
        large.panel,
        3,
        "Sibling collapse cannot change the reader's viewport allocation",
      );
      collapsible.open = false;
      await Zotero.Promise.delay(300);
      assert.equal(
        collapsible
          .querySelector(':scope > [data-type="body"]')!
          .getBoundingClientRect().height,
        0,
        "Collapsed host section clips its reading body",
      );
      collapsible.open = true;
      await details.scrollToPane(section.dataset.pane!);
      await Zotero.Promise.delay(300);
      assertLayout();
      assert.equal(
        requests.length,
        before,
        "Layout, resize and reopen send no provider requests",
      );
    } finally {
      for (const key of keys) Zotero.ItemPaneManager.unregisterSection(key);
      win.resizeTo(size[0], size[1]);
      collapsible.open = wasOpen;
      if (
        (contextPane.splitter.getAttribute("state") === "collapsed") !==
        wasCollapsed
      )
        contextPane.togglePane();
      await until(() =>
        keys.every(
          (key) =>
            !(
              Array.from(
                viewport.querySelectorAll("[data-pane]"),
              ) as HTMLElement[]
            ).some((node) => node.getAttribute("data-pane") === key),
        ),
      );
    }
  });

  it("clicking the rendered item-pane control extracts PDF text, publishes the stub response, caches it and isolates selection history", async function () {
    (
      Zotero.getMainWindow()
        .ZoteroContextPane as _ZoteroTypes.ZoteroContextPane & {
        collapsed: boolean;
      }
    ).collapsed = false;
    await until(() => result.getBoundingClientRect().width > 100);
    const original = body.querySelector(".page-source") as HTMLElement;
    assert.include(
      body.querySelector(".reading-build")!.textContent!,
      version,
      "Identify the UI constructor actually rendering, not merely manifest metadata",
    );
    const providerItems = Array.from(
      body.querySelectorAll(`#${config.addonRef}-services menuitem`),
    ) as Element[];
    assert.deepEqual(
      providerItems.map((item) => item.getAttribute("value")),
      [
        "google",
        "googleapi",
        "bing",
        "deeplx",
        "chatgpt",
        "claude",
        "gemini",
        "codex",
      ],
      "The actual reading menu exposes only the requested translation and model choices, in order",
    );
    assert.include(providerItems[7].getAttribute("label")!, "OpenAI Auth");
    const show = body.querySelector(
      `#${config.addonRef}-show-original`,
    ) as HTMLButtonElement;
    assert.isTrue(original.hidden, "Translation-only is the default");
    assert.equal(original.getBoundingClientRect().height, 0);
    const expandedSection = body.closest("item-pane-custom-section")!;
    (
      expandedSection.querySelector("collapsible-section") as HTMLElement & {
        open: boolean;
      }
    ).open = true;
    (expandedSection.querySelector(".fullHeight") as HTMLElement).click();
    await Zotero.Promise.delay(100);
    assert.equal(
      original.getBoundingClientRect().height,
      0,
      "Expanded mode and old layout preferences cannot reveal original",
    );
    assert.isAbove(
      result.getBoundingClientRect().height,
      100,
      "Translation owns freed reading space",
    );
    show.click();
    assert.isFalse(original.hidden);
    assert.equal(show.getAttribute("aria-checked"), "true");
    show.click();
    assert.isTrue(original.hidden);
    assert.exists(
      body.querySelector('[role="switch"]'),
      "Page automation must expose an ON/OFF switch in the rendered toolbar",
    );
    const activePanel = body as HTMLElement & { render(): void };
    activePanel.render();
    assert.exists(
      activePanel.querySelector('[role="switch"]'),
      "Rendered TranslatorPanel must own the visible page checkbox, not an item-pane sibling",
    );
    const section = body.closest("item-pane-custom-section") as HTMLElement & {
      open: boolean;
    };
    const collapsible = section.querySelector(
      "collapsible-section",
    ) as HTMLElement & { open: boolean };
    collapsible.open = true;
    await Zotero.Promise.delay(100);
    assert.isAbove(
      checkbox.getBoundingClientRect().width,
      0,
      "Checkbox has a visible rendered box after panel render",
    );
    assert.isFalse(checkbox.hidden);
    assert.isFalse(
      (body.querySelector(".page-reading-mode") as HTMLElement).hidden,
    );
    assert.equal(checkbox.textContent, "Auto");
    assert.equal(checkbox.title, "Automatic page translation: OFF");
    assert.equal(checkbox.getAttribute("aria-checked"), "false");
    assert.equal(
      checkbox.localName,
      "button",
      "Native button supplies keyboard activation for the switch",
    );
    assert.lengthOf(requests, 0);
    assert.isNull(body.querySelector(`#${config.addonRef}-auto-container`));
    assert.isNull(body.querySelector(`#${config.addonRef}-concat-container`));
    assert.lengthOf(body.querySelectorAll(`${elementPrefix}-reading-pane`), 2);
    translate();
    await until(() => result.value === "번역 결과");
    await until(() => status.textContent!.includes("· saved"));
    const firstTranslationCount = requests.length;
    translate();
    await until(() => status.textContent!.includes("saved"));
    assert.equal(
      requests.length,
      firstTranslationCount,
      "Translate reuses saved pages instead of spending another request",
    );
    assert.include(status.textContent!, "saved, cached");
    const previousFont = getPref("fontSize") as string;
    setPref("fontSize", "18");
    await until(() => result.style.fontSize === "18px");
    const font = body.querySelector<HTMLInputElement>(
      `#${config.addonRef}-font-size`,
    )!;
    assert.equal(font.value, "18");
    body
      .querySelector<HTMLButtonElement>(`#${config.addonRef}-font-increase`)!
      .click();
    await until(() => result.style.fontSize === "19px");
    assert.equal(getPref("fontSize"), "19");
    body
      .querySelector<HTMLButtonElement>(`#${config.addonRef}-font-decrease`)!
      .click();
    await until(() => result.style.fontSize === "18px");
    font.value = "22";
    const fontChange = body.ownerDocument.createEvent("Event");
    fontChange.initEvent("change", true, false);
    font.dispatchEvent(fontChange);
    await until(() => result.style.fontSize === "22px");
    assert.equal(getPref("fontSize"), "22");
    translate();
    await until(() => status.textContent!.includes("saved, cached"));
    assert.equal(
      requests.length,
      firstTranslationCount,
      "Appearance changes must preserve saved translations and send no requests",
    );
    setPref("fontSize", previousFont);
    assert.equal(
      checkbox.getAttribute("aria-checked"),
      "false",
      "Manual Translate works while automatic is OFF",
    );
    const manualCount = requests.length;
    application.pdfViewer!.currentPageNumber = 2;
    await Zotero.Promise.delay(500);
    assert.equal(
      requests.length,
      manualCount,
      "OFF navigation sends no automatic requests",
    );
    application.pdfViewer!.currentPageNumber = 1;
    const running = (Zotero as any)[config.addonInstance];
    const historyLength = running.data.translate.queue.length;
    checkbox.click();
    await until(() => result.value === "번역 결과");
    assert.equal(
      (body.querySelector(".page-source") as XUL.Textbox).value,
      "First page text",
    );
    assert.deepEqual(requests, ["First page text"]);
    reread();
    await until(() => status.textContent!.includes("· saved"));
    assert.lengthOf(requests, 2);
    assert.equal(running.data.translate.queue.length, historyLength);
    const from = body.querySelector(
      `#${config.addonRef}-langfrom`,
    ) as XUL.MenuList;
    const to = body.querySelector(`#${config.addonRef}-langto`) as XUL.MenuList;
    to.value = "ja";
    to.dispatchEvent(new (Zotero.getMainWindow() as any).Event("command"));
    await until(
      () => requestLanguages.at(-1) === "en→ja" && result.value === "번역 결과",
    );
    body
      .querySelector(`#${config.addonRef}-swap-language`)!
      .dispatchEvent(new (Zotero.getMainWindow() as any).Event("command"));
    await until(
      () => requestLanguages.at(-1) === "ja→en" && result.value === "번역 결과",
    );
    enable(false);
    from.value = "en";
    from.dispatchEvent(new (Zotero.getMainWindow() as any).Event("command"));
    to.value = "ko";
    to.dispatchEvent(new (Zotero.getMainWindow() as any).Event("command"));
    body
      .querySelector<HTMLButtonElement>(`#${config.addonRef}-retranslate-page`)!
      .click();
    await until(
      () => requestLanguages.at(-1) === "en→ko" && result.value === "번역 결과",
    );
    for (const [mode, expected] of [
      ["raw", "First page text"],
      ["result", "번역 결과"],
      ["both", "First page text\n----\n번역 결과"],
    ]) {
      body
        .querySelector(`#${config.addonRef}-copy-${mode}`)!
        .dispatchEvent(new (Zotero.getMainWindow() as any).Event("command"));
      assert.equal(
        Zotero.Utilities.Internal.getClipboard("text/plain"),
        expected,
      );
    }
    enable(true);
    await until(() => result.value === "번역 결과");
    const provider = body.querySelector(
      `#${config.addonRef}-services`,
    ) as XUL.MenuList;
    provider.value = "google";
    provider.dispatchEvent(
      new (Zotero.getMainWindow() as any).Event("command"),
    );
    await until(
      () =>
        requestHosts.at(-1) === "translate.google.com" &&
        result.value === "번역 결과",
    );
    provider.value = "googleapi";
    provider.dispatchEvent(
      new (Zotero.getMainWindow() as any).Event("command"),
    );
    await until(
      () =>
        status.textContent!.includes("googleapi") &&
        result.value === "번역 결과",
    );
    const selection = addTranslateTask(
      "Unrelated selected text",
      item.id,
      "text",
      "googleapi",
    );
    assert.exists(selection);
    selection!.result = "Unrelated selected result";
    running.hooks.onReaderTabPanelRefresh();
    await Zotero.Promise.delay(100);
    assert.equal(
      (body.querySelector(".page-source") as XUL.Textbox).value,
      "First page text",
    );
    assert.equal(result.value, "번역 결과");
  });

  it("updates with real PDF navigation and ignores an older in-flight response", async function () {
    slow = true;
    application.pdfViewer!.currentPageNumber = 2;
    await until(
      () =>
        status.textContent!.includes("Loading") ||
        status.textContent!.includes("queue") ||
        status.textContent!.includes("Translating"),
    );
    assert.equal(
      result.value,
      "",
      "Ordinary navigation must not display the previous page while the target is loading",
    );
    body
      .querySelector<HTMLButtonElement>(`#${config.addonRef}-retranslate-page`)!
      .click();
    await until(() => !!resolveSlow);
    slow = false;
    application.pdfViewer!.currentPageNumber = 1;
    const old = resolveSlow!;
    resolveSlow = undefined;
    old();
    await until(
      () =>
        status.textContent!.includes("Page 1") &&
        status.textContent!.includes("saved") &&
        result.value === "번역 결과",
    );
    assert.equal(
      (body.querySelector(".page-source") as XUL.Textbox).value,
      "First page text",
    );
    assert.include(status.textContent!, "Page 1");
    await page(3);
    assert.include(status.textContent!, "no extractable text");
    assert.equal(result.value, "");
  });

  it("reuses saved pages after memory eviction, invalidates changed settings, and retries provider errors", async function () {
    for (let number = 4; number <= 15; number++) await page(number);
    const before = requests.length;
    await page(1);
    assert.equal(
      requests.length,
      before,
      "oldest page survives on disk after memory eviction",
    );
    setPref("targetLanguage", "fr");
    fail = true;
    reread();
    await until(() =>
      status.textContent!.includes("Test provider unavailable"),
    );
    assert.equal(
      result.value,
      "번역 결과",
      "A failed manual load retains the prior successful translation",
    );
    fail = false;
    reread();
    await until(() => status.textContent!.includes("· saved"));
    assert.equal(requests.length, before + 2);
  });

  it("disabling cancels pending publication and automatic page-change requests", async function () {
    slow = true;
    application.pdfViewer!.currentPageNumber = 2;
    await until(() => !!resolveSlow);
    enable(false);
    const count = requests.length;
    slow = false;
    resolveSlow!();
    resolveSlow = undefined;
    application.pdfViewer!.currentPageNumber = 4;
    await Zotero.Promise.delay(500);
    assert.equal(result.value, "");
    assert.equal((body.querySelector(".page-source") as XUL.Textbox).value, "");
    assert.equal(checkbox.getAttribute("aria-checked"), "false");
    assert.equal(requests.length, count);
  });

  it("standalone panel publishes the stub response for the selected PDF tab and disables page mode without PDF context", async function () {
    const section = body.closest("item-pane-custom-section")!;
    const open = section.querySelector(".openStandalone") as HTMLElement;
    assert.exists(open, "Use the actual section open-standalone button");
    open.click();
    const running = (Zotero as any)[config.addonInstance];
    await until(
      () =>
        !!running.data.panel.windowPanel &&
        !running.data.panel.windowPanel.closed,
    );
    const win = running.data.panel.windowPanel as Window;
    try {
      const panel = win.document.querySelector(
        `${elementPrefix}-panel`,
      ) as HTMLElement & { render(): void };
      panel.render();
      const standaloneSource = panel.querySelector(
        ".page-source",
      ) as HTMLElement;
      assert.equal(
        standaloneSource.getBoundingClientRect().height,
        0,
        "Standalone defaults to translation-only too",
      );
      assert.include(
        panel.querySelector(".reading-build")!.textContent!,
        version,
      );
      const oldFont = getPref("fontSize") as string;
      const oldSpacing = getPref("lineHeight") as string;
      const beforeAppearance = requests.length;
      const standaloneResult =
        panel.querySelector<HTMLElement>(".page-result")!;
      setPref("fontSize", "24");
      setPref("lineHeight", "1.8");
      await until(
        () =>
          standaloneResult.style.fontSize === "24px" &&
          result.style.fontSize === "24px",
      );
      assert.equal(standaloneResult.style.lineHeight, "1.8");
      assert.equal(result.style.lineHeight, "1.8");
      assert.equal(
        (
          panel.querySelector(
            `#${config.addonRef}-font-size`,
          ) as HTMLInputElement
        ).value,
        "24",
      );
      assert.equal(requests.length, beforeAppearance);
      setPref("fontSize", oldFont);
      setPref("lineHeight", oldSpacing);
      const standaloneToggle = panel.querySelector(
        `#${config.addonRef}-show-original`,
      ) as HTMLButtonElement;
      standaloneToggle.click();
      assert.isFalse(standaloneSource.hidden);
      assert.isAbove(standaloneSource.getBoundingClientRect().height, 0);
      standaloneToggle.click();
      assert.equal(standaloneSource.getBoundingClientRect().height, 0);
      const pageControl = panel.querySelector(
        '[role="switch"]',
      ) as HTMLButtonElement;
      assert.exists(pageControl);
      assert.isFalse(pageControl.disabled);
      assert.isAbove(pageControl.getBoundingClientRect().width, 0);
      pageControl.click();
      await until(
        () =>
          (panel.querySelector(".page-result") as XUL.Textbox).value ===
          "번역 결과",
      );
      assert.equal(
        (panel.querySelector(".page-source") as XUL.Textbox).value,
        "Cache page 0",
      );
      win.resizeTo(1200, 760);
      await Zotero.Promise.delay(150);
      const beforeResize = requests.length;
      standaloneToggle.click();
      try {
        for (const pane of [standaloneSource, standaloneResult]) {
          const paragraph = pane.querySelector(".reading-body") as HTMLElement;
          assert.exists(paragraph);
          const style = win.getComputedStyle(pane)!;
          const available =
            pane.clientWidth -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight);
          assert.isAbove(
            available,
            800,
            "Exercise a genuinely wide reading pane",
          );
          assert.closeTo(
            paragraph.getBoundingClientRect().width,
            available,
            1,
            "Body paragraphs fill the expanded reader instead of stopping at a fixed reading width",
          );
        }
      } finally {
        standaloneToggle.click();
      }
      assert.equal(
        requests.length,
        beforeResize,
        "Resizing only reflows saved text",
      );
      win.resizeTo(360, 760);
      await Zotero.Promise.delay(150);
      const taskButtons = Array.from(
        panel.querySelectorAll(".page-tasks button"),
      ) as HTMLButtonElement[];
      const left = taskButtons[0].getBoundingClientRect();
      const right = taskButtons[1].getBoundingClientRect();
      assert.deepEqual(
        taskButtons.map((button) => button.textContent),
        ["Translate", "Translate all"],
      );
      assert.equal(
        taskButtons[0].getAttribute("aria-label"),
        "Translate current page",
      );
      assert.isBelow(
        Math.abs(left.y - right.y),
        1,
        "Task buttons stay on the same row at narrow width",
      );
      assert.isBelow(
        Math.abs(left.width - right.width),
        1,
        "Task buttons share width equally",
      );
      assert.isAtMost(
        right.right,
        panel.getBoundingClientRect().right + 1,
        "Task row must not overflow",
      );
      const toolbar = panel.querySelector(".reader-toolbar") as HTMLElement;
      const typography = panel.querySelector(
        ".reader-typography",
      ) as HTMLElement;
      const options = panel.querySelector(".page-actions") as HTMLElement;
      assert.isBelow(
        Math.abs(
          typography.getBoundingClientRect().y +
            typography.offsetHeight / 2 -
            options.getBoundingClientRect().y -
            options.offsetHeight / 2,
        ),
        2,
        "Reading switches and font controls share the toolbar's first row",
      );
      panel.style.width = "260px";
      await Zotero.Promise.delay(100);
      const bounds = toolbar.getBoundingClientRect();
      for (const control of Array.from(
        toolbar.querySelectorAll("button, input"),
      ) as HTMLElement[]) {
        const rect = control.getBoundingClientRect();
        assert.isAbove(rect.width, 0);
        assert.isAtLeast(
          rect.left,
          bounds.left,
          "Controls stay inside the narrow toolbar",
        );
        assert.isAtMost(
          rect.right,
          bounds.right + 1,
          "Controls do not overflow the narrow toolbar",
        );
      }
      assert.isAtMost(
        options.getBoundingClientRect().right,
        typography.getBoundingClientRect().left,
        "Wrapped reading switches never overlap the font control",
      );
      panel.style.removeProperty("width");

      Zotero.getMainWindow().Zotero_Tabs.select("zotero-pane");
      panel.render();
      assert.isTrue(pageControl.disabled);
      assert.isAbove(pageControl.getBoundingClientRect().width, 0);
      assert.include(
        panel.querySelector("[role=status]")!.textContent!,
        "requires an open PDF reader tab",
      );
      Zotero.getMainWindow().Zotero_Tabs.select(reader.tabID);
      panel.render();
      assert.isFalse(pageControl.disabled);
    } finally {
      Zotero.getMainWindow().Zotero_Tabs.select(reader.tabID);
      win.close();
    }
  });

  it("splits extracted PDF text into bounded requests and publishes the returned chunks", async function () {
    application.pdfViewer!.currentPageNumber = 16;
    const before = requests.length;
    enable(true);
    await until(() => status.textContent === "Page 16 · googleapi · saved");
    const chunks = requests.slice(before);
    assert.isAbove(chunks.length, 1);
    assert.isTrue(chunks.every((chunk) => chunk.length <= 1201));
    assert.equal(
      chunks.join(" ").replace(/\s+/g, " "),
      longPageText.replace(/\s+/g, " "),
    );
    assert.equal(
      result.value.replace(/\s+/g, " "),
      Array(chunks.length).fill("번역 결과").join(" "),
    );
  });

  it("reopens saved structured pages, preserves a saved success on retranslate failure, and resumes cancellable whole-document work", async function () {
    enable(false);
    application.pdfViewer!.currentPageNumber = 1;
    reread();
    await until(
      () =>
        result.value === "번역 결과" && status.textContent!.includes("saved"),
    );
    let beforeReopen = requests.length;
    (reader as unknown as _ZoteroTypes.ReaderTab).close();
    reader = (await Zotero.Reader.open(
      item.id,
    )) as _ZoteroTypes.ReaderInstance<"pdf">;
    await reader._initPromise;
    await reader._internalReader._primaryView.initializedPromise;
    application =
      reader._internalReader._primaryView._iframeWindow!.PDFViewerApplication;
    application.pdfViewer!.currentPageNumber = 1;
    const doc = Zotero.getMainWindow().document as Document;
    const details = () =>
      (Array.from(doc.querySelectorAll("item-details")) as HTMLElement[]).find(
        (element) => (element as any).tabID === reader.tabID,
      );
    await until(() => !!details()?.querySelector(".page-source"));
    body = details()!.querySelector(`${elementPrefix}-panel`)!;
    checkbox = body.querySelector('[role="switch"]')!;
    result = body.querySelector(".page-result")!;
    status = body.querySelector('[role="status"]')!;
    const actions = [
      checkbox,
      body.querySelector(`#${config.addonRef}-show-original`)!,
      body.querySelector(`#${config.addonRef}-translate-all`)!,
      body.querySelector(`#${config.addonRef}-retranslate-page`)!,
    ] as HTMLElement[];
    assert.deepEqual(
      actions.map((action) => action.getAttribute("role") || "button"),
      ["switch", "switch", "button", "button"],
    );
    assert.equal(actions[1].id, `${config.addonRef}-show-original`);
    assert.equal(actions[2].id, `${config.addonRef}-translate-all`);
    assert.equal(actions[3].id, `${config.addonRef}-retranslate-page`);
    await until(() => status.textContent!.includes("saved, cached"));
    assert.equal(
      requests.length,
      beforeReopen,
      "A new reader and new in-memory maps reuse the actual saved file",
    );
    const beforeUpperManual = requests.length;
    reread();
    await until(
      () =>
        !status.textContent!.includes("…") &&
        status.textContent!.includes("saved"),
    );
    assert.equal(
      requests.length,
      beforeUpperManual + 1,
      "Upper manual Translate must force a fresh request despite a real saved success",
    );
    beforeReopen = requests.length;
    const filePath = (await item.getFilePathAsync()) as string;
    const movedPath = `${filePath}.temporarily-unavailable`;
    await IOUtils.move(filePath, movedPath);
    try {
      (actions[3] as HTMLButtonElement).click();
      await until(
        () =>
          status.textContent!.includes("Page 1:") &&
          !status.textContent!.includes("…"),
      );
      assert.equal(
        result.value,
        "번역 결과",
        "Native file failure cannot erase a previous success",
      );
      assert.equal(
        requests.length,
        beforeReopen,
        "Missing attachment fails before any provider request",
      );
    } finally {
      await IOUtils.move(movedPath, filePath);
    }
    reread();
    await until(() => status.textContent!.includes("· saved"));
    assert.equal(
      requests.length,
      beforeReopen + 1,
      "Manual retry after native storage failure requests a fresh result",
    );
    beforeReopen = requests.length;
    fail = true;
    (actions[3] as HTMLButtonElement).click();
    await until(() =>
      status.textContent!.includes("Test provider unavailable"),
    );
    assert.equal(
      result.value,
      "번역 결과",
      "Failed forced translation retains last successful visible result",
    );
    fail = false;
    reread();
    await until(() => status.textContent!.includes("· saved"));
    assert.equal(
      requests.length,
      beforeReopen + 2,
      "Upper manual retry also forces a fresh request after failure",
    );
    const secrets = JSON.parse(String(getPref("secretObj")));
    secrets.storageProof = "private-token-must-not-be-persisted";
    setPref("secretObj", JSON.stringify(secrets));
    (actions[3] as HTMLButtonElement).click();
    await until(() => status.textContent!.includes("· saved"));
    assert.equal(
      requests.length,
      beforeReopen + 3,
      "Explicit retranslate bypasses both caches",
    );
    const root = PathUtils.join(
      Zotero.DataDirectory.dir,
      config.addonRef,
      "page-translations",
    );
    const files: { path: string; modified: number }[] = [];
    for (const directory of await IOUtils.getChildren(root)) {
      const file = PathUtils.join(directory, "page-1.json");
      if (await IOUtils.exists(file))
        files.push({
          path: file,
          modified: (await IOUtils.stat(file)).lastModified!,
        });
    }
    files.sort((a, b) => b.modified - a.modified);
    const written = files[0].path;
    const stored = (await IOUtils.readJSON(written)) as {
      schema: number;
      source: { blocks: { text: string }[] };
      result: unknown[];
    };
    assert.notInclude(
      await IOUtils.readUTF8(written),
      "private-token-must-not-be-persisted",
    );
    assert.equal(stored.schema, 1);
    assert.equal(stored.source.blocks[0].text, "First page text");
    await IOUtils.writeUTF8(written, "{broken");
    const beforeRepair = requests.length;
    reread();
    await until(() => status.textContent!.includes("· saved"));
    assert.equal(
      requests.length,
      beforeRepair + 1,
      "Corrupt disk record is rejected and real provider path recomputes it",
    );
    application.pdfViewer!.currentPageNumber = 2;
    reread();
    await until(
      () =>
        status.textContent!.includes("Page 2") &&
        status.textContent!.includes("saved"),
    );
    application.pdfViewer!.currentPageNumber = 1;
    await until(
      () =>
        status.textContent!.includes("Page 1") &&
        status.textContent!.includes("cached"),
    );
    slow = true;
    (actions[2] as HTMLButtonElement).click();
    await until(() => !!resolveSlow);
    const interrupted = requests.length;
    assert.include(
      status.textContent!,
      "page 4/16",
      "Saved pages 1–2 and blank page 3 are skipped before the next request",
    );
    application.pdfViewer!.currentPageNumber = 2;
    await until(
      () =>
        (body.querySelector(".page-source") as any).value ===
        "Second page text",
    );
    assert.equal(
      result.value,
      "번역 결과",
      "Committed page is visible before the later HTTP request is released",
    );
    assert.exists(
      resolveSlow,
      "Batch request remains paused while saved browsing completes",
    );
    assert.equal(
      requests.length,
      interrupted,
      "Saved browsing cannot add provider work",
    );
    assert.equal(
      actions[2].textContent,
      "Cancel",
      "Saved browsing does not cancel the batch",
    );
    assert.include(
      status.textContent!,
      "page 4/16",
      "Batch progress remains visible alongside current-page status",
    );

    checkbox.click();
    assert.equal(checkbox.getAttribute("aria-checked"), "true");
    application.pdfViewer!.currentPageNumber = 1;
    await until(
      () =>
        (body.querySelector(".page-source") as any).value === "First page text",
    );
    application.pdfViewer!.currentPageNumber = 2;
    await until(
      () =>
        (body.querySelector(".page-source") as any).value ===
        "Second page text",
    );
    assert.equal(
      requests.length,
      interrupted,
      "Automatic ON saved browsing also bypasses provider serialization",
    );
    assert.exists(
      resolveSlow,
      "Browsing in both modes does not release/cancel the paused batch",
    );
    application.pdfViewer!.currentPageNumber = 15;
    await until(() =>
      status.textContent!.includes("Page 15 has not been translated yet"),
    );
    assert.equal(
      result.value,
      "",
      "Uncommitted target shows waiting, not an older page",
    );
    assert.notInclude(
      (body.querySelector(".page-source") as XUL.Textbox).value,
      "Second page text",
      "Background page never replaces navigated page",
    );
    (actions[2] as HTMLButtonElement).click();
    slow = false;
    resolveSlow!();
    resolveSlow = undefined;
    await until(() => status.textContent!.includes("Translate all stopped"));
    assert.equal(
      requests.length,
      interrupted,
      "Cancellation prevents subsequent page requests",
    );
    (actions[2] as HTMLButtonElement).click();
    await until(() => status.textContent!.includes("Translate all complete"));
    assert.equal(
      (body.querySelector(".page-source") as any).value,
      "Cache page 11",
      "An unsaved browsed target appears when its own batch page commits; later pages cannot overwrite it",
    );
    const completeCount = requests.length;
    (actions[2] as HTMLButtonElement).click();
    await until(() => status.textContent!.includes("Translate all complete"));
    assert.equal(
      requests.length,
      completeCount,
      "Completed document resumes entirely from durable saved pages",
    );
    application.pdfViewer!.currentPageNumber = 1;
    reread();
    await until(() => status.textContent!.includes("· saved"));
    const attachedPath = await item.getFilePathAsync();
    assert.isString(attachedPath);
    const stat = await IOUtils.stat(attachedPath as string);
    await IOUtils.setModificationTime(
      attachedPath as string,
      stat.lastModified! + 2000,
    );
    const beforeChangedFile = requests.length;
    reread();
    await until(
      () =>
        status.textContent!.includes("· saved") &&
        !status.textContent!.includes("cached"),
    );
    assert.equal(
      requests.length,
      beforeChangedFile + 1,
      "File-change evidence invalidates saved records even with the same page number",
    );
  });

  it("reads authored scientific geometry with overlapping full paragraphs independently of navigation order", async function () {
    enable(false);
    setPref("targetLanguage", "ko");
    const fixturePath = PathUtils.join(
      PathUtils.tempDir,
      `reading-geometry-${Date.now()}.pdf`,
    );
    let fixtureItem: Zotero.Item | undefined;
    let fixtureReader: _ZoteroTypes.ReaderInstance<"pdf"> | undefined;
    let matchingWindow: Window | undefined;
    try {
      await IOUtils.writeUTF8(fixturePath, makeReadingFixturePDF());
      fixtureItem = await Zotero.Attachments.importFromFile({
        file: fixturePath,
      });
      fixtureReader = (await Zotero.Reader.open(
        fixtureItem.id,
      )) as _ZoteroTypes.ReaderInstance<"pdf">;
      await fixtureReader._initPromise;
      await fixtureReader._internalReader._primaryView.initializedPromise;
      const fixtureApplication =
        fixtureReader._internalReader._primaryView._iframeWindow!
          .PDFViewerApplication;
      const doc = Zotero.getMainWindow().document as Document;
      const fixtureDetails = () =>
        (
          Array.from(doc.querySelectorAll("item-details")) as HTMLElement[]
        ).find((element) => (element as any).tabID === fixtureReader!.tabID);
      await until(() => !!fixtureDetails()?.querySelector(".page-source"));
      const fixturePanel = fixtureDetails()!.querySelector(
        `${elementPrefix}-panel`,
      ) as HTMLElement & { render(): void };
      fixturePanel.render();
      const section = fixturePanel.closest("item-pane-custom-section")!;
      (
        section.querySelector("collapsible-section") as HTMLElement & {
          open: boolean;
        }
      ).open = true;
      const source = fixturePanel.querySelector(
        ".page-source",
      ) as HTMLElement & { value: string };
      const translated = fixturePanel.querySelector(
        ".page-result",
      ) as HTMLElement & { value: string };
      const fixtureStatus = fixturePanel.querySelector("[role=status]")!;
      const switchControl = fixturePanel.querySelector('[role="switch"]')!;
      assert.equal(switchControl.getAttribute("aria-checked"), "false");
      await until(() => translated.getBoundingClientRect().width > 0);
      assert.isAbove(translated.getBoundingClientRect().width, 0);
      assert.equal(
        source.getBoundingClientRect().height,
        0,
        "Hidden original retains source mapping without occupying pane space",
      );
      const fixtureRequests = requests.length;
      const visitedPages = new Set<number>();
      async function translatePage(number: number) {
        fixtureApplication.pdfViewer!.currentPageNumber = number;
        await until(
          () => fixtureApplication.pdfViewer!.currentPageNumber === number,
        );
        if (!visitedPages.has(number))
          fixturePanel
            .querySelector(`#${config.addonRef}-translate`)!
            .dispatchEvent(
              new (Zotero.getMainWindow() as any).Event("command"),
            );
        await until(
          () =>
            fixtureStatus.textContent!.includes(`Page ${number}`) &&
            (number === 4 || source.value.length > 0) &&
            (fixtureStatus.textContent!.includes("saved") ||
              fixtureStatus.textContent!.includes("no extractable text")),
        );
        assert.equal(switchControl.getAttribute("aria-checked"), "false");
        visitedPages.add(number);
      }
      // Page 2 must not require page 1 to have been visited or translated first.
      await translatePage(2);
      assert.include(source.value, readingFixture.continued);
      assert.include(source.value, readingFixture.remaining);
      assert.exists(source.querySelector('[data-pages="1,2"]'));
      assert.equal(
        source.querySelector(".reading-caption")!.textContent,
        "Figure 3. An intervening boundary caption.",
      );
      assert.notInclude(
        source.querySelector('.reading-body[data-pages="1,2"]')!.textContent!,
        "Figure 3",
      );
      const secondPageFirst = source.value;
      const secondPageResult = translated.value;
      const beforeUpperProse = requests.length;
      fixturePanel
        .querySelector<HTMLButtonElement>(
          `#${config.addonRef}-retranslate-page`,
        )!
        .click();
      await until(
        () =>
          requests.length > beforeUpperProse &&
          fixtureStatus.textContent!.includes("· saved"),
      );
      assert.include(
        requests.slice(beforeUpperProse).join("\n"),
        readingFixture.continued,
        "Explicit retranslation sends real prose despite saved success",
      );
      assert.isTrue(
        requestLanguages
          .slice(beforeUpperProse)
          .every((language) => language === "en→ko"),
      );
      const beforeLowerProse = requests.length;
      echoProse = true;
      (
        fixturePanel.querySelector(
          `#${config.addonRef}-retranslate-page`,
        ) as HTMLButtonElement
      ).click();
      await until(() =>
        fixtureStatus.textContent!.includes("original prose unchanged"),
      );
      assert.include(
        requests.slice(beforeLowerProse).join("\n"),
        readingFixture.continued,
        "Lower current-page action bypasses saved success and sends fresh prose",
      );
      assert.isTrue(
        requestLanguages
          .slice(beforeLowerProse)
          .every((language) => language === "en→ko"),
      );
      assert.equal(
        translated.value,
        secondPageResult,
        "Unchanged substantial prose cannot replace a known successful result",
      );
      echoProse = false;

      await translatePage(1);
      const firstPageSource = source.value;
      assert.equal(
        source.querySelector(".reading-title")!.textContent,
        readingFixture.title,
      );
      assert.equal(
        source.querySelector(".reading-authors")!.textContent,
        readingFixture.markedAuthors,
      );
      assert.equal(
        source.querySelector(".reading-authors sup")!.textContent,
        "1",
      );
      assert.equal(
        translated.querySelector("h3.reading-abstract")!.textContent,
        "초록",
      );
      assert.equal(
        source.querySelector(".reading-affiliation")!.textContent,
        readingFixture.affiliation,
      );
      assert.equal(
        source.querySelector(".reading-equation")!.textContent,
        readingFixture.equation,
      );
      assert.equal(
        source.querySelector(".reading-caption")!.textContent,
        readingFixture.caption,
      );
      assert.include(
        source.querySelector(".reading-heading")!.textContent!,
        "1. Observations",
      );
      const columnTokens = firstPageSource.match(
        /(?:LEFT|RIGHT)-(?:ONE|TWO|THREE)/g,
      );
      assert.deepEqual(
        columnTokens,
        [
          "LEFT-ONE",
          "LEFT-TWO",
          "LEFT-THREE",
          "RIGHT-ONE",
          "RIGHT-TWO",
          "RIGHT-THREE",
        ],
        "Geometry must override the deliberately interleaved PDF content stream",
      );
      for (const text of readingFixture.columns)
        assert.include(firstPageSource, text);
      assert.include(firstPageSource, readingFixture.abstract);
      assert.include(firstPageSource, readingFixture.header);
      assert.isTrue(
        Array.from(source.querySelectorAll(".reading-running")).some(
          (element) => element?.textContent === "1",
        ),
        "The page footer is preserved literally",
      );
      const continued = source.querySelector('.reading-body[data-pages="1,2"]');
      assert.exists(continued);
      assert.equal(continued!.textContent, readingFixture.continued);
      assert.notInclude(firstPageSource, readingFixture.remaining);
      assert.equal(
        translated.querySelector('.reading-body[data-pages="1,2"]')!
          .textContent,
        "번역 결과",
      );
      for (const text of [
        readingFixture.authors,
        readingFixture.affiliation,
        readingFixture.equation,
      ]) {
        assert.include(translated.value, text);
      }
      assert.include(
        translated.value,
        "번역 결과",
        "Stub response proves wiring, not translation quality",
      );

      await translatePage(2);
      assert.equal(source.value, secondPageFirst);
      assert.equal(translated.value, secondPageResult);
      assert.include(source.value, readingFixture.continued);
      assert.include(
        source.querySelector('.reading-body[data-pages="2"]')!.textContent!,
        readingFixture.remaining,
      );

      await translatePage(3);
      assert.include(source.value, readingFixture.unsafe);
      assert.include(
        source.value,
        "A conservative reconstruction keeps uncertain text.",
      );
      assert.isNull(
        source.querySelector("script"),
        "PDF markup is literal text, never parsed HTML",
      );
      assert.isNull(translated.querySelector("script"));
      assert.equal(
        source.querySelector(".reading-reference")!.textContent,
        readingFixture.reference,
      );
      assert.include(translated.value, readingFixture.reference);
      const sent = requests.slice(fixtureRequests).join("\n");
      for (const text of [
        readingFixture.authors,
        readingFixture.affiliation,
        readingFixture.equation,
        readingFixture.reference,
        readingFixture.header,
      ]) {
        assert.notInclude(
          sent,
          text,
          "Preserved scientific apparatus must not enter provider requests",
        );
      }
      assert.include(sent, readingFixture.continued);
      assert.include(sent, readingFixture.remaining);
      assert.include(sent, readingFixture.unsafe);
      assert.lengthOf(
        sent.match(/measured result \[2\]\./g)!,
        4,
        "Two page views and both explicit manual retries request full context",
      );
      const beforeBlank = requests.length;
      await translatePage(4);
      assert.include(fixtureStatus.textContent!, "no extractable text");
      assert.equal(source.value, "");
      assert.equal(translated.value, "");
      assert.equal(
        requests.length,
        beforeBlank,
        "A blank adjacent page sends no request",
      );
      await translatePage(7);
      assert.include(source.value, readingFixture.acrossThree);
      assert.include(source.value, "Local material stays.");
      const seventhFirst = source.value;
      await translatePage(6);
      assert.include(source.value, readingFixture.acrossThree);
      assert.exists(source.querySelector('[data-pages="5,6,7"]'));
      assert.include(
        source.value,
        readingFixture.header,
        "Running text is retained, not silently erased",
      );
      await translatePage(5);
      assert.include(source.value, readingFixture.acrossThree);
      assert.exists(source.querySelector('[data-pages="5,6,7"]'));
      await translatePage(7);
      assert.equal(source.value, seventhFirst);
      await translatePage(8);
      assert.include(source.value, "A bounded sentence remains");
      assert.notInclude(source.value, "unfinished measurements");
      assert.include(
        source.querySelector(".reading-incomplete")!.textContent!,
        "1,200",
      );
      await translatePage(9);
      assert.include(
        source.value,
        readingFixture.capText,
        "An over-cap continuation remains on its original page in full",
      );
      await translatePage(10);
      assert.include(source.value, "The final page stays unfinished");
      assert.exists(source.querySelector(".reading-incomplete"));
      assert.lengthOf(
        translated.querySelectorAll(".reading-incomplete"),
        1,
        "A genuinely unresolved page-edge paragraph still has one warning",
      );
      const beforeReconstruction = requests.length;
      await translatePage(11);
      assert.equal(
        source.querySelector(".reading-body")!.textContent,
        readingFixture.indentedProse,
      );
      assert.deepEqual(
        requests.slice(beforeReconstruction),
        [readingFixture.indentedProse],
        "One genuine paragraph reaches the provider with repaired linebreak words",
      );
      assert.notInclude(
        translated.value,
        "\n",
        "One paragraph never gains arbitrary provider-chunk linebreaks",
      );
      const beforeFigure = requests.length;
      await translatePage(12);
      const figureRequests = requests.slice(beforeFigure).join(" ");
      assert.notInclude(
        figureRequests,
        "ChartLabel",
        "Drawing-backed internal labels are not prose translation",
      );
      assert.include(
        figureRequests,
        "Figure 2. Eight plotted measurements. The caption retains its complete explanatory continuation.",
      );
      assert.include(
        figureRequests,
        "We measured 77.7 percent in 2026 with 8 samples.",
      );
      assert.include(
        figureRequests,
        "12.5 24.0 36.5",
        "Table values outside the graphic region remain",
      );
      assert.include(translated.value, "E = mc^2", "Equation remains literal");
      assert.include(translated.value, "Figure 2 — see original PDF");
      assert.notInclude(translated.value, "ChartLabel");
      assert.include(
        source.value,
        "ChartLabel0",
        "Raw original retains figure labels and coordinate origins",
      );
      const beforeMerit = requests.length;
      for (const number of [14, 13, 14]) {
        await translatePage(number);
        const joined = source.querySelector(
          '.reading-body[data-pages="13,14"]',
        )!;
        assert.equal(
          joined.textContent,
          readingFixture.meritBoundary,
          "Both views translate the full user-supplied paragraph, including the second sentence on the next page",
        );
        assert.equal(
          source.querySelectorAll('.reading-body[data-pages="13,14"]').length,
          1,
        );
        assert.notInclude(joined.textContent!, "Figure 4");
        assert.notInclude(joined.textContent!, "To address");
      }
      assert.equal(
        requests
          .slice(beforeMerit)
          .filter((text) => text === readingFixture.meritBoundary).length,
        2,
        "Each distinct page sends the complete paragraph, while the revisit uses disk",
      );
      assert.equal(
        source.querySelector(".reading-caption")!.textContent,
        "Figure 4. Boundary context skips this full caption.",
      );
      assert.include(
        source.querySelector('.reading-body[data-pages="14"]')!.textContent!,
        "To address long-range dependencies",
      );
      const beforeRunIn = requests.length;
      for (const number of [16, 15, 16]) {
        await translatePage(number);
        const paragraph = source.querySelector(
          '.reading-body[data-pages="15,16"]',
        )!;
        assert.equal(
          paragraph.textContent,
          readingFixture.runInParagraph,
          "Same-size run-in typography starts a separate paragraph before continuation limits are checked",
        );
        assert.notInclude(paragraph.textContent!, "Prior models");
        assert.notInclude(paragraph.textContent!, "Another subsection");
        assert.isNull(
          source.querySelector(
            '.reading-body[data-pages="15,16"] + .reading-incomplete',
          ),
          "Complete run-in context must not produce an uncertainty warning",
        );
      }
      assert.equal(
        requests
          .slice(beforeRunIn)
          .filter((text) => text === readingFixture.runInParagraph).length,
        2,
      );
      assert.include(
        source.querySelector(".reading-heading")!.textContent!,
        "6.2",
      );
      const beforeEquations = requests.length;
      await translatePage(17);
      const equationElements = Array.from(
        translated.querySelectorAll(".reading-equation"),
      ) as HTMLElement[];
      assert.deepEqual(
        equationElements.map((element) => element.textContent),
        ["M = F(V), (1)", "A = G(Q, M), (2)"],
      );
      assert.deepEqual(
        equationElements.map(
          (element) => element.querySelector(".equation-number")!.textContent,
        ),
        ["(1)", "(2)"],
      );
      assert.isNull(
        source.querySelector(".reading-incomplete"),
        "Internal colon-ended prose and math are not page-boundary uncertainty",
      );
      assert.isNull(translated.querySelector(".reading-incomplete"));
      const mathRequests = requests.slice(beforeEquations).join(" ");
      assert.notInclude(mathRequests, "M = F(V)");
      assert.notInclude(mathRequests, "A = G(Q, M)");
      assert.include(mathRequests, "where F denotes construction");
      assert.include(mathRequests, "where G denotes the solver");
      assert.include(mathRequests, "77.7 percent of 12 samples");
      for (const equationElement of equationElements) {
        const origins = JSON.parse(equationElement.dataset.origins!) as {
          rects: number[][];
        }[];
        assert.equal(
          origins.length,
          2,
          "Expression and number retain their distinct PDF source rectangles",
        );
      }
      await translatePage(19);
      const indexed = translated.querySelector(
        ".reading-equation img",
      ) as HTMLImageElement;
      await until(() => indexed.complete && indexed.naturalWidth > 0);
      assert.isAbove(
        indexed.naturalHeight,
        5,
        "Actual native PDF render creates visible original indexed math",
      );

      assert.isFalse(
        (
          Array.from(source.querySelectorAll(".reading-body")) as HTMLElement[]
        ).some((block) => /^i(?:\s+i)*$/.test(block.textContent!)),
        "Script fragments stay attached, not standalone translatable prose",
      );
      const list = (
        Array.from(source.querySelectorAll(".reading-body")) as HTMLElement[]
      ).filter((block) => block.textContent!.startsWith("- "));
      assert.lengthOf(list, 2, "Each hanging bullet remains its own paragraph");
      assert.include(list[0].textContent!, "interactions between entities.");
      const beforeTable = requests.length;
      await translatePage(20);
      const table = translated.querySelector(
        ".reading-table img",
      ) as HTMLImageElement;
      await until(() => table.complete && table.naturalWidth > 0);
      assert.include(
        (source.querySelector(".reading-table") as HTMLElement).textContent!,
        "12.5",
      );
      assert.notInclude(requests.slice(beforeTable).join(" "), "Baseline");
      assert.include(
        requests.slice(beforeTable).join(" "),
        "ordinary readable prose",
      );
      const beforeAlgorithm = requests.length;
      await translatePage(21);
      const algorithm = translated.querySelector(
        ".reading-algorithm img",
      ) as HTMLImageElement;
      await until(() => algorithm.complete && algorithm.naturalHeight > 0);
      assert.include(
        source.querySelector(".reading-algorithm")!.textContent!,
        "return replay(A, q)",
      );
      const algorithmRequests = requests.slice(beforeAlgorithm).join(" ");

      assert.notInclude(algorithmRequests, "Initialize anchors");
      assert.notInclude(algorithmRequests, "while budget remains");
      assert.include(algorithmRequests, "independently translated prose");
      assert.include(algorithmRequests, "first numbered explanation");
      assert.include(algorithmRequests, "third explanation stays readable");
      assert.lengthOf(
        source.querySelectorAll(".reading-algorithm"),
        1,
        "Numbered explanatory prose is not a second algorithm",
      );
      await translatePage(22);
      assert.include(
        source.value.replace(/\s+/g, " "),
        "The measured result remains in sequence after training for three days, followed by the next sentence.",
        "Smaller full prose lines are not attached to an earlier baseline as scripts",
      );
      assert.include(
        source.value,
        "A complete left column begins with careful evidence and ends before the right column starts its own discussion.",
      );
      assert.isBelow(
        source.value.indexOf("ends before the right"),
        source.value.indexOf("An unrelated right column"),
        "Narrow gutter paragraphs stay column-local",
      );
      assert.include(
        source.querySelector(".reading-footnote")!.textContent!,
        "Supplementary protocol details",
        "Rule-separated small note is not body continuation",
      );
      const beforeBibliography = requests.length;
      await translatePage(23);
      assert.exists(
        source.querySelector(".reading-body"),
        "Inferred citations retain a separate translatable prose block",
      );
      assert.include(
        source.querySelector(".reading-body")!.textContent!,
        "Our independent evaluation",
        "Inferred citations must not suppress adjacent ordinary prose",
      );
      assert.lengthOf(
        source.querySelectorAll(".reading-reference"),
        4,
        "Headingless author-year citations use complete paragraphs, not year-bearing first lines",
      );
      assert.deepEqual(
        requests.slice(beforeBibliography),
        ["Our independent evaluation remains open for further experiments."],
        "Only ordinary prose enters the provider on a mixed bibliography page",
      );
      const beforeAnnotatedMath = requests.length;
      await translatePage(24);
      const displays = Array.from(
        translated.querySelectorAll(".reading-equation"),
      ) as HTMLElement[];
      assert.lengthOf(
        displays,
        2,
        "A column-local multiline display is one crop, not separate terms or annotations",
      );
      assert.deepEqual(
        displays.map(
          (element) => element.querySelector(".equation-number")?.textContent,
        ),
        ["(7)", "(8)"],
      );
      const annotated = displays[0];
      for (const text of [
        "r = max sim(step_num, warmup_steps)",
        "g(y) + h(z)",
        "FirstTerm",
        "SecondTerm",
      ])
        assert.include(annotated.textContent!, text);
      const displayImage = annotated.querySelector("img") as HTMLImageElement;
      await until(
        () => displayImage.complete && displayImage.naturalHeight > 0,
      );
      const displayOrigins = JSON.parse(annotated.dataset.origins!) as {
        rects: number[][];
      }[];
      const displayRects = displayOrigins.flatMap((origin) => origin.rects);
      assert.isAtMost(Math.min(...displayRects.map((rect) => rect[1])), 615);
      assert.isAtLeast(Math.max(...displayRects.map((rect) => rect[3])), 668);
      assert.isBelow(Math.max(...displayRects.map((rect) => rect[2])), 310);
      const annotatedRequests = requests.slice(beforeAnnotatedMath).join(" ");
      for (const text of [
        "FirstTerm",
        "SecondTerm",
        "g(y)",
        "max sim(x)",
        "warmup_steps",
      ])
        assert.notInclude(annotatedRequests, text);
      for (const text of [
        "The rate x = y + z remains readable prose.",
        "Right-hand evidence overlaps the display vertically.",
        "The final sentence stays outside both crops.",
      ])
        assert.include(annotatedRequests, text);
      const beforeRaster = requests.length;
      await translatePage(25);
      const rasterFigures = Array.from(
        translated.querySelectorAll(".reading-figure"),
      ) as HTMLElement[];
      assert.lengthOf(
        rasterFigures,
        2,
        "Raster figures without text items still render; clipping paths cannot fuse them",
      );
      for (const [index, figure] of rasterFigures.entries()) {
        const image = figure.querySelector("img") as HTMLImageElement;
        assert.exists(image);
        await until(() => image.complete && image.naturalWidth > 0);
        assert.isAbove(image.naturalHeight, 200);
        const origins = JSON.parse(figure.dataset.origins!) as {
          rects: number[][];
        }[];
        const rect = origins[0].rects[0];
        assert.closeTo(rect[1], index === 0 ? 540 : 310, 1);
        assert.closeTo(rect[3], index === 0 ? 680 : 450, 1);
      }
      const rasterRequests = requests.slice(beforeRaster).join(" ");
      for (const text of [
        "Figure 2.1. A raster-only chart.",
        "This caption explanation remains translatable.",
        "Figure 2.2. An independent raster-only chart.",
        "Ordinary prose follows both separate figures.",
      ])
        assert.include(rasterRequests, text);
      const beforeShortProse = requests.length;
      await translatePage(26);
      assert.include(
        requests.slice(beforeShortProse).join(" "),
        "Let x = y.",
        "A short mathematical sentence preceding a display still reaches the provider",
      );
      assert.include(requests.slice(beforeShortProse).join(" "), "Thus x = y.");
      assert.notInclude(
        requests.slice(beforeShortProse).join(" "),
        "z = x + 1",
      );
      const beforeLegend = requests.length;
      await translatePage(27);
      const legendFigure = translated.querySelector(
        ".reading-figure",
      ) as HTMLElement;
      assert.exists(
        legendFigure,
        "A detached legend cannot hide its associated plot",
      );
      const legendImage = legendFigure.querySelector("img") as HTMLImageElement;
      await until(() => legendImage.complete && legendImage.naturalHeight > 0);
      assert.include(source.value, "Series1");
      assert.include(source.value, "Legend4");
      const legendOrigins = JSON.parse(legendFigure.dataset.origins!) as {
        rects: number[][];
      }[];
      assert.isAtMost(legendOrigins[0].rects[0][1], 480);
      assert.isAbove(
        legendOrigins[0].rects[0][1],
        470,
        "Label descenders fit without including the caption",
      );
      assert.closeTo(legendOrigins[0].rects[0][3], 620, 1);
      assert.notInclude(requests.slice(beforeLegend).join(" "), "Series1");
      assert.notInclude(requests.slice(beforeLegend).join(" "), "Legend4");
      assert.include(
        requests.slice(beforeLegend).join(" "),
        "explanation below the chart",
      );
      await translatePage(28);
      const wideFigure = translated.querySelector(
        ".reading-figure",
      ) as HTMLElement;
      assert.exists(
        wideFigure,
        "An earlier column caption cannot hide a later full-width figure",
      );
      const wideImage = wideFigure.querySelector("img") as HTMLImageElement;
      await until(() => wideImage.complete && wideImage.naturalWidth > 0);
      const wideOrigins = JSON.parse(wideFigure.dataset.origins!) as {
        rects: number[][];
      }[];
      assert.closeTo(wideOrigins[0].rects[0][0], 54, 1);
      assert.closeTo(wideOrigins[0].rects[0][2], 550, 1);
      const beforeInline = requests.length;
      await translatePage(29);
      const inlineSource = Array.from(
        source.querySelectorAll(".reading-inline-math"),
      ) as HTMLElement[];
      const inlineResult = Array.from(
        translated.querySelectorAll(".reading-inline-math"),
      ) as HTMLElement[];
      assert.deepEqual(
        inlineSource.map((node) => node.textContent!.replace(/\s/g, "")),
        ["E=mc2", "RN(P2+C)", "x2", "y3", "Dclass"],
        "Nested scripts stay with their bases inside the surrounding prose",
      );
      assert.deepEqual(
        inlineResult.map((node) => node.textContent!.replace(/\s/g, "")),
        ["E=mc2", "RN(P2+C)", "y3", "x2", "Dclass"],
        "Translated marker order relocates original crops, not the source sentence order",
      );
      for (const node of inlineResult) {
        const image = node.querySelector("img") as HTMLImageElement;
        await until(() => image.complete && image.naturalHeight > 0);
        assert.equal(
          image.ownerDocument.defaultView!.getComputedStyle(image)!.display,
          "inline-block",
        );
      }
      const nestedRect = (
        JSON.parse(inlineSource[1].dataset.origins!) as { rects: number[][] }[]
      )[0].rects[0];
      assert.isAtLeast(
        nestedRect[3],
        681,
        "Native crop contains the nested superscript, not just its base row",
      );
      const inlineInput = requests.slice(beforeInline).join(" ");
      assert.include(inlineInput, "The two variables [MATH_0] and [MATH_1]");
      assert.include(
        inlineInput,
        "is an anchor for this independent measurement.",
        "Short ordinary words beside math are translated, not hidden inside its crop",
      );

      assert.notInclude(inlineInput, "RN(P2");
      assert.notInclude(translated.value, "[MATH_");
      assert.include(translated.value.replace(/\s/g, ""), "먼저y3,다음x2");
      const savedInline = translated.value;
      for (const mode of ["drop", "duplicate"] as const) {
        inlineFailure = mode;
        const beforeFailure = requests.length;
        fixturePanel
          .querySelector<HTMLButtonElement>(
            `#${config.addonRef}-retranslate-page`,
          )!
          .click();
        await until(
          () =>
            requests.length > beforeFailure &&
            fixtureStatus.textContent!.includes("inline equation marker"),
        );
        assert.equal(
          translated.value,
          savedInline,
          "Invalid marker output never replaces the last successful page",
        );
      }
      inlineFailure = undefined;
      await translatePage(28);
      const beforeInlineRestore = requests.length;
      await translatePage(29);
      assert.equal(requests.length, beforeInlineRestore);
      assert.equal(translated.value, savedInline);
      for (const number of [31, 30]) {
        await translatePage(number);
        const paragraph = translated.querySelector(
          '.reading-body[data-pages="30,31"]',
        )!;
        assert.exists(paragraph);
        const math = Array.from(
          paragraph.querySelectorAll(".reading-inline-math"),
        ) as HTMLElement[];
        assert.deepEqual(
          math.map(
            (node) =>
              (JSON.parse(node.dataset.origins!) as { page: number }[])[0].page,
          ),
          [30, 31],
        );
        assert.deepEqual(
          math.map((node) => node.textContent!.replace(/\s/g, "")),
          ["E=mc2", "y3"],
        );
      }
      const beforePairedTables = requests.length;
      await translatePage(32);
      const pairedTables = Array.from(
        translated.querySelectorAll(".reading-table"),
      ) as HTMLElement[];
      assert.lengthOf(
        pairedTables,
        2,
        "Caption-separated grids with nearly identical widths remain two tables",
      );
      for (const table of pairedTables) {
        const image = table.querySelector("img") as HTMLImageElement;
        await until(() => image.complete && image.naturalHeight > 0);
        assert.notInclude(table.textContent!, "Caption text");
        assert.notInclude(table.textContent!, "second caption");
      }
      const pairedInput = requests.slice(beforePairedTables).join(" ");
      assert.include(
        pairedInput,
        "Table 5. A paired comparison across independent measurement conditions. Caption text remains translated.",
      );
      assert.include(
        pairedInput,
        "Table 6. A separate comparison uses different measurements and controls. The entire second caption is translated.",
      );
      assert.include(pairedInput, "Ordinary left-column prose stays readable.");
      assert.include(pairedInput, "body below both tables");
      for (const cell of [
        "Baseline",
        "Adapted",
        "Control",
        "Improved",
        "18.5",
        "45.0",
      ])
        assert.notInclude(pairedInput, cell);
      const beforeTallTable = requests.length;
      await translatePage(33);
      assert.lengthOf(translated.querySelectorAll(".reading-table"), 1);
      const tallTable = translated.querySelector(
        ".reading-table",
      ) as HTMLElement;
      assert.include(tallTable.textContent!, "Dataset34");
      assert.include(tallTable.textContent!, "Third metric");
      const tallRect = (
        JSON.parse(tallTable.dataset.origins!) as { rects: number[][] }[]
      )[0].rects[0];
      assert.isAtMost(tallRect[1], 230);
      assert.isAtLeast(tallRect[3], 700);
      const tallInput = requests.slice(beforeTallTable).join(" ");
      assert.include(
        tallInput,
        "Table C.1. Continuous rows belong to one tall original table.",
      );
      assert.include(
        tallInput,
        "This complete caption remains ordinary translated text.",
      );
      assert.notInclude(tallInput, "Dataset34");
      const beforeLabels = requests.length;
      await translatePage(34);
      const labelled = translated.querySelector(
        ".reading-figure",
      ) as HTMLElement;
      assert.exists(labelled);
      const labelRect = (
        JSON.parse(labelled.dataset.origins!) as { rects: number[][] }[]
      )[0].rects[0];
      assert.isAtMost(
        labelRect[0],
        67,
        "Rotated axis glyphs are owned outside the painted rectangles",
      );
      assert.isAtMost(
        labelRect[1],
        526.5,
        "Subpanel descenders fit inside the crop",
      );
      assert.isAtLeast(
        labelRect[3],
        638,
        "Panel titles fit above the painted shapes",
      );
      const labelInput = requests.slice(beforeLabels).join(" ");
      for (const label of [
        "First panel",
        "Rate",
        "descenders gyp",
        "Second panel grouping",
      ])
        assert.notInclude(labelInput, label);
      assert.include(labelInput, "Figure 5. Caption stays outside");
      assert.include(labelInput, "Do not include this ordinary prose");
      const beforePanels = requests.length;
      await translatePage(35);
      assert.lengthOf(translated.querySelectorAll(".reading-figure"), 1);
      const panels = translated.querySelector(".reading-figure") as HTMLElement;
      const panelsRect = (
        JSON.parse(panels.dataset.origins!) as { rects: number[][] }[]
      )[0].rects[0];
      assert.isAtMost(panelsRect[0], 80);
      assert.isAtLeast(panelsRect[2], 480);
      assert.isAtLeast(panelsRect[3], 682);
      assert.notInclude(
        requests.slice(beforePanels).join(" "),
        "Input projection",
      );
      assert.notInclude(
        requests.slice(beforePanels).join(" "),
        "Output projection",
      );
      assert.include(requests.slice(beforePanels).join(" "), "Figure 6.");
      const beforeSentenceCells = requests.length;
      await translatePage(36);
      assert.lengthOf(
        translated.querySelectorAll(".reading-table"),
        1,
        "Repeated two-column sentence cells form a table; spanning prose between rules does not",
      );
      assert.notInclude(
        requests.slice(beforeSentenceCells).join(" "),
        "Method 1 uses",
      );
      assert.notInclude(
        requests.slice(beforeSentenceCells).join(" "),
        "Method 2 uses",
      );
      assert.include(
        requests.slice(beforeSentenceCells).join(" "),
        "An ordinary sentence carries explanatory context",
      );
      const beforeIndependentCharts = requests.length;
      await translatePage(37);
      const independentCharts = Array.from(
        translated.querySelectorAll(".reading-figure"),
      ) as HTMLElement[];
      assert.lengthOf(
        independentCharts,
        2,
        "Aligned titles cannot fuse diagrams backed by separate captions",
      );
      const independentRects = independentCharts.map(
        (node) =>
          (JSON.parse(node.dataset.origins!) as { rects: number[][] }[])[0]
            .rects[0],
      );
      assert.isTrue(independentRects.some((rect) => rect[2] <= 201));
      assert.isTrue(independentRects.some((rect) => rect[0] >= 399));
      assert.isTrue(independentRects.every((rect) => rect[3] >= 667));
      assert.notInclude(
        requests.slice(beforeIndependentCharts).join(" "),
        "First chart title",
      );
      assert.notInclude(
        requests.slice(beforeIndependentCharts).join(" "),
        "Second chart title",
      );
      assert.include(
        requests.slice(beforeIndependentCharts).join(" "),
        "A note remains prose.",
      );
      const beforeCenteredTable = requests.length;
      await translatePage(38);
      assert.lengthOf(
        translated.querySelectorAll(".reading-table"),
        1,
        "A narrow centered grid under an offset full-width caption stays one table",
      );
      const centeredTable = translated.querySelector(
        ".reading-table",
      ) as HTMLElement;
      const centeredImage = centeredTable.querySelector(
        "img",
      ) as HTMLImageElement;
      await until(
        () => centeredImage.complete && centeredImage.naturalHeight > 0,
      );
      for (const cell of [
        "Model",
        readingFixture.centeredHeader,
        "Group Alpha",
        "Group Beta",
        "Grid Model A",
        "Grid Model H",
        "70.8",
      ])
        assert.include(
          centeredTable.textContent!,
          cell,
          "The single crop retains header, category rows and the last numeric row",
        );
      const centeredRect = (
        JSON.parse(centeredTable.dataset.origins!) as { rects: number[][] }[]
      )[0].rects[0];
      assert.isAtMost(centeredRect[0], 225.06);
      assert.isAtLeast(centeredRect[2], 384.8);
      assert.isAtLeast(centeredRect[3], 619.8);
      assert.isAtMost(centeredRect[1], 432.6);
      const centeredInput = requests.slice(beforeCenteredTable).join(" ");
      assert.include(centeredInput, readingFixture.centeredCaption);
      assert.include(centeredInput, readingFixture.centeredBody);
      for (const cell of [
        "Model",
        readingFixture.centeredHeader,
        "Group Alpha",
        "Group Beta",
        "Grid Model A",
        "41.2",
        "70.8",
      ])
        assert.notInclude(
          centeredInput,
          cell,
          "Table cells never enter translatable text or the provider payload",
        );
      assert.include(
        source.querySelector(".reading-caption")!.textContent!,
        "Table 9.",
        "Only the caption above the grid remains translated prose",
      );
      assert.include(translated.value, "번역 결과");

      const beforeStackedTables = requests.length;
      await translatePage(39);
      const stackedTables = Array.from(
        translated.querySelectorAll(".reading-table"),
      ) as HTMLElement[];
      assert.lengthOf(
        stackedTables,
        3,
        "A lower caption cannot reclaim the upper grid and leave its own table as prose",
      );
      for (const [lastRow, bounds] of [
        ["Left-last", [54, 525, 280, 670]],
        ["Upper-last", [322, 595, 558, 660]],
        ["Lower-last", [322, 478, 558, 540]],
      ] as const) {
        const table = stackedTables.find((node) =>
          node.textContent!.includes(lastRow),
        );
        assert.exists(table, "Each independent grid retains its final row");
        const image = table!.querySelector("img") as HTMLImageElement;
        await until(() => image.complete && image.naturalHeight > 0);
        const rect = (
          JSON.parse(table!.dataset.origins!) as { rects: number[][] }[]
        )[0].rects[0];
        for (let index = 0; index < 4; index++)
          assert.closeTo(
            rect[index],
            bounds[index],
            3,
            "Crop covers only its own ruled grid",
          );
        assert.notInclude(table!.textContent!, "comparison.");
      }
      const stackedInput = requests.slice(beforeStackedTables).join(" ");
      for (const text of [
        "Table 10. Independent left results.",
        "Table 11. Upper comparison. Its explanation remains translated.",
        "Table 12. Lower comparison. Its wrapped explanation is independent.",
        "Ordinary prose below the three grids stays translatable.",
      ])
        assert.include(
          stackedInput,
          text,
          "All complete captions and surrounding prose reach translation",
        );
      for (const text of [
        "Left-last",
        "Upper-last",
        "Lower-last",
        "22.7",
        "42.8",
        "64.2",
      ])
        assert.notInclude(
          stackedInput,
          text,
          "No original table cell reaches the provider",
        );

      // Strongest owner: actual PDF.js text-layer DOM selection, not mocked
      // matching or translated-string comparison. Automatic remains OFF.
      await translatePage(1);
      const pdfDoc =
        fixtureReader._internalReader._primaryView._iframeWindow!.document;
      fixtureApplication.pdfViewer!.pagesRotation = 90;
      fixtureApplication.pdfViewer!.currentScale = 1.2;
      await Zotero.Promise.delay(200);
      const spans = () =>
        Array.from(
          pdfDoc.querySelectorAll(
            '.page[data-page-number="1"] .textLayer span',
          ),
        ) as HTMLElement[];
      await until(() =>
        spans().some((span) => span.textContent === readingFixture.columns[0]),
      );
      const firstSpan = spans().find(
        (span) => span.textContent === readingFixture.columns[0],
      )!;
      const secondSpan = spans().find(
        (span) => span.textContent === readingFixture.columns[1],
      )!;
      const range = pdfDoc.createRange();
      range.setStart(firstSpan.firstChild!, 0);
      range.setEnd(secondSpan.firstChild!, secondSpan.textContent!.length);
      const selection = pdfDoc.getSelection()!;
      const beforeMatch = requests.length;
      const annotationsBefore = fixtureItem.numAnnotations();
      selection.removeAllRanges();
      selection.addRange(range);
      const selectedText = selection.toString();
      await until(
        () => translated.querySelectorAll("p.reading-match").length >= 2,
      );
      assert.equal(
        selection.toString(),
        selectedText,
        "Matching must not replace native DOM text selection",
      );
      assert.equal(switchControl.getAttribute("aria-checked"), "false");
      assert.equal(
        requests.length,
        beforeMatch,
        "Selection matching does not translate",
      );
      const matchedOrigins = (
        Array.from(
          translated.querySelectorAll("p.reading-match"),
        ) as HTMLElement[]
      ).map((element) => JSON.parse(element.dataset.origins!));
      assert.isAtLeast(
        matchedOrigins.length,
        2,
        "All intersected paragraphs receive background highlighting",
      );
      selection.removeAllRanges();
      await until(() => !translated.querySelector(".reading-match"));

      // Zotero may hide its item pane while PDF selection is active. Exercise
      // actual visible copy/navigation behavior in the standalone panel too.
      (
        fixturePanel
          .closest("item-pane-custom-section")!
          .querySelector(".openStandalone") as HTMLElement
      ).click();
      const running = (Zotero as any)[config.addonInstance];
      await until(
        () =>
          !!running.data.panel.windowPanel &&
          !running.data.panel.windowPanel.closed,
      );
      const matchWindow = running.data.panel.windowPanel as Window;
      matchingWindow = matchWindow;
      const matchPanel = matchWindow.document.querySelector(
        `${elementPrefix}-panel`,
      ) as HTMLElement & { render(): void };
      matchPanel.render();
      const beforeStandaloneRefresh = requests.length;
      matchPanel
        .querySelector<HTMLButtonElement>(
          `#${config.addonRef}-retranslate-page`,
        )!
        .click();
      const matchResult = matchPanel.querySelector(
        ".page-result",
      ) as HTMLElement & { value: string };
      await until(() => !!matchResult.querySelector('p[data-pages="1,2"]'));
      // Saved paragraphs can already be visible while explicit Translate
      // above is still queued. Only start counting navigation after it saves.
      await until(
        () =>
          requests.length > beforeStandaloneRefresh &&
          matchPanel
            .querySelector("[role=status]")!
            .textContent!.includes("· saved"),
      );
      const beforeReverse = requests.length;
      const originButtons = Array.from(
        matchResult.querySelectorAll(".reading-origin button"),
      ) as HTMLButtonElement[];
      const pageTwoLink = originButtons.find(
        (button) => button.textContent === "2",
      )!;
      assert.exists(
        pageTwoLink,
        "Continued paragraph exposes its actual second-page fragment",
      );
      const continuedForCopy = matchResult.querySelector(
        'p[data-pages="1,2"]',
      ) as HTMLElement;
      const copyRange = matchWindow.document.createRange();
      copyRange.selectNodeContents(continuedForCopy);
      const uiSelection = matchWindow.getSelection()!;
      uiSelection.removeAllRanges();
      uiSelection.addRange(copyRange);
      assert.isAbove(continuedForCopy.getBoundingClientRect().width, 0);
      assert.equal(uiSelection.toString(), continuedForCopy.textContent);
      pageTwoLink.click();
      await Zotero.Promise.delay(100);
      assert.equal(
        fixtureApplication.pdfViewer!.currentPageNumber,
        1,
        "Selecting translation text for copying must not navigate",
      );
      uiSelection.removeAllRanges();
      pageTwoLink.click();
      await Zotero.Promise.delay(100);
      await until(() => fixtureApplication.pdfViewer!.currentPageNumber === 2);
      const secondSpans = () =>
        Array.from(
          pdfDoc.querySelectorAll(
            '.page[data-page-number="2"] .textLayer span',
          ),
        ) as HTMLElement[];
      await until(() =>
        secondSpans().some((span) =>
          span.textContent?.startsWith("measured result"),
        ),
      );
      const continuationSpan = secondSpans().find((span) =>
        span.textContent?.startsWith("measured result"),
      )!;
      const continuationRange = pdfDoc.createRange();
      continuationRange.setStart(continuationSpan.firstChild!, 0);
      continuationRange.setEnd(
        continuationSpan.firstChild!,
        "measured result [2].".length,
      );
      selection.removeAllRanges();
      selection.addRange(continuationRange);
      await until(
        () => !!matchResult.querySelector('p.reading-match[data-pages="1,2"]'),
      );

      selection.removeAllRanges();
      await until(() => !matchResult.querySelector(".reading-match"));
      const continuedParagraph = matchResult.querySelector(
        'p[data-pages="1,2"]',
      ) as HTMLElement;
      assert.exists(
        continuedParagraph,
        "Programmatic source navigation retains displayed paragraphs",
      );
      continuedParagraph.click();
      await until(() => fixtureApplication.pdfViewer!.currentPageNumber === 1);
      assert.equal(
        requests.length,
        beforeReverse,
        "Reverse navigation must not trigger a provider request",
      );
      assert.equal(
        fixtureItem.numAnnotations(),
        annotationsBefore,
        "Source navigation must not save annotations",
      );
      assert.include(
        matchPanel.querySelector('[role="status"]')!.textContent!,
        "Source highlight remains",
      );
      await Zotero.Promise.delay(2200);
      const sourceMarks = () =>
        Array.from(
          pdfDoc.querySelectorAll("[data-personal-source-match] > div"),
        ) as HTMLElement[];
      assert.isAbove(
        sourceMarks().length,
        0,
        "Source overlay survives native navigate highlight expiry",
      );
      const originalMark = sourceMarks()[0];
      assert.isAbove(originalMark.getBoundingClientRect().width, 0);
      assert.equal(
        pdfDoc.defaultView!.getComputedStyle(originalMark)!.pointerEvents,
        "none",
        "Overlay never captures native text/link events",
      );

      const view = Components.utils.waiveXrays(
        fixtureApplication.pdfViewer!.getPageView(0),
      );
      const origin = (
        JSON.parse(continuedParagraph.dataset.origins!) as {
          page: number;
          rects: number[][];
        }[]
      ).find((origin) => origin.page === 1)!;
      const a = view.viewport.convertToViewportPoint(
        origin.rects[0][0],
        origin.rects[0][1],
      );
      const b = view.viewport.convertToViewportPoint(
        origin.rects[0][2],
        origin.rects[0][3],
      );
      assert.closeTo(
        parseFloat(originalMark.style.width),
        Math.abs(b[0] - a[0]),
        1,
        "Rotated zoomed source highlight follows actual viewport",
      );
      fixtureApplication.pdfViewer!.currentScale = 1.5;
      await until(
        () => sourceMarks().length > 0 && sourceMarks()[0] !== originalMark,
      );
      assert.equal(
        selection.toString(),
        "",
        "Persistent match never reapplies native text selection",
      );
      continuationSpan.dispatchEvent(
        new (pdfDoc.defaultView as any).PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
        }),
      );
      assert.lengthOf(
        sourceMarks(),
        0,
        "Next explicit PDF interaction clears old source match",
      );
      continuedParagraph.click();
      await until(() => sourceMarks().length > 0);
      fixtureApplication.pdfViewer!.currentPageNumber = 3;
      assert.lengthOf(
        sourceMarks(),
        0,
        "User page navigation clears persistent source geometry",
      );
      await until(
        () =>
          matchPanel
            .querySelector("[role=status]")!
            .textContent!.includes("Page 3") &&
          matchPanel
            .querySelector("[role=status]")!
            .textContent!.includes("cached"),
      );
      assert.include(
        (matchPanel.querySelector(".page-source") as any).value,
        readingFixture.unsafe,
        "Manual navigation after reverse matching restores the selected saved page while OFF",
      );
      assert.equal(requests.length, beforeReverse);
      fixtureApplication.pdfViewer!.currentPageNumber = 18;
      await until(() =>
        matchPanel
          .querySelector("[role=status]")!
          .textContent!.includes("Page 18 has not been translated"),
      );
      assert.equal(
        matchResult.value,
        "",
        "An unsaved OFF page never displays old translation",
      );
      assert.equal(requests.length, beforeReverse);
      (matchPanel.querySelector("[role=switch]") as HTMLButtonElement).click();
      await until(
        () =>
          matchPanel
            .querySelector("[role=status]")!
            .textContent!.includes("Page 18") &&
          matchPanel
            .querySelector("[role=status]")!
            .textContent!.includes("saved"),
      );
      assert.include(
        (matchPanel.querySelector(".page-source") as any).value,
        "A newly visited page needs explicit translation.",
      );
      const afterNavigation = requests.length;
      (matchResult.querySelector(".reading-body") as HTMLElement).click();
      await until(() => sourceMarks().length > 0);
      const closingLayer = sourceMarks()[0].parentElement!;
      matchWindow.close();
      await until(() => !closingLayer.isConnected);
      assert.equal(fixtureItem.numAnnotations(), annotationsBefore);
      (fixtureReader as unknown as _ZoteroTypes.ReaderTab).close();
      fixtureReader = undefined;
      await until(() => source.value === "");
      assert.isNull(
        translated.querySelector(".reading-match"),
        "Reader closure clears paragraph highlighting",
      );
      await Zotero.Promise.delay(100);
      assert.equal(requests.length, afterNavigation);
      fixtureReader = (await Zotero.Reader.open(
        fixtureItem.id,
      )) as _ZoteroTypes.ReaderInstance<"pdf">;
      await fixtureReader._initPromise;
      await fixtureReader._internalReader._primaryView.initializedPromise;
      const reopenedApp =
        fixtureReader._internalReader._primaryView._iframeWindow!
          .PDFViewerApplication;
      await until(() => !!fixtureDetails()?.querySelector(".page-source"));
      const reopened = fixtureDetails()!.querySelector(
        `${elementPrefix}-panel`,
      )! as HTMLElement & { render(): void };
      reopened.render();
      const reopenedStatus = reopened.querySelector("[role=status]")!;
      const reopenedSource = reopened.querySelector(
        ".page-source",
      ) as HTMLElement & { value: string };
      for (const number of [2, 1]) {
        reopenedApp.pdfViewer!.currentPageNumber = number;
        await until(
          () =>
            reopenedStatus.textContent!.includes(`Page ${number}`) &&
            reopenedStatus.textContent!.includes("saved, cached"),
        );
        assert.equal(
          reopenedSource.querySelector('.reading-body[data-pages="1,2"]')!
            .textContent,
          readingFixture.continued,
        );
        const origins = JSON.parse(
          (
            reopenedSource.querySelector(
              '.reading-body[data-pages="1,2"]',
            ) as HTMLElement
          ).dataset.origins!,
        ) as { page: number; rects: number[][] }[];
        assert.deepEqual(
          [...new Set(origins.map((origin) => origin.page))],
          [1, 2],
        );
        assert.isTrue(
          origins.every((origin) => origin.rects.length > 0),
          "Both source fragments retain native coordinates after disk restore",
        );
        assert.equal(
          reopenedSource.querySelectorAll('.reading-body[data-pages="1,2"]')
            .length,
          1,
          "A page never displays the overlapping paragraph twice",
        );
      }
      assert.equal(
        requests.length,
        afterNavigation,
        "Both saved page views restore full context without provider requests",
      );
      reopenedApp.pdfViewer!.currentPageNumber = 29;
      await until(
        () =>
          reopenedStatus.textContent!.includes("Page 29") &&
          reopenedStatus.textContent!.includes("saved, cached"),
      );
      const reopenedResult = reopened.querySelector(
        ".page-result",
      ) as HTMLElement & { value: string };
      assert.equal(reopenedResult.value, savedInline);
      assert.deepEqual(
        Array.from(reopenedResult.querySelectorAll(".reading-inline-math")).map(
          (node) => node!.textContent!.replace(/\s/g, ""),
        ),
        ["E=mc2", "RN(P2+C)", "y3", "x2", "Dclass"],
      );
      assert.equal(requests.length, afterNavigation);
      const root = PathUtils.join(
        Zotero.DataDirectory.dir,
        config.addonRef,
        "page-translations",
      );
      let inlinePath = "";
      for (const directory of await IOUtils.getChildren(root)) {
        const file = PathUtils.join(directory, "page-29.json");
        if (await IOUtils.exists(file)) {
          inlinePath = file;
          break;
        }
      }
      assert.isNotEmpty(inlinePath);
      const originalInlineRecord = await IOUtils.readUTF8(inlinePath);
      try {
        for (const invalid of ["range", "media-page", "foreign-page"]) {
          reopenedApp.pdfViewer!.currentPageNumber = 1;
          await until(
            () =>
              reopenedStatus.textContent!.includes("Page 1") &&
              reopenedStatus.textContent!.includes("saved, cached"),
          );
          const record = JSON.parse(originalInlineRecord) as {
            source: { blocks: ReadingBlock[] };
            result: ReadingBlock[];
            checksum: string;
          };
          const block = record.result.find(
            (block) => block.inlineMath?.length,
          )!;
          if (invalid === "range")
            block.inlineMath![0].end = block.text.length + 1;
          else if (invalid === "media-page")
            block.inlineMath![0].media!.page = 28;
          else {
            block.inlineMath![0].page = 1000000;
            block.inlineMath![0].media!.page = 1000000;
          }
          const bytes = new TextEncoder().encode(
            JSON.stringify({ source: record.source, result: record.result }),
          );
          const digest = await Zotero.getMainWindow().crypto.subtle.digest(
            "SHA-256",
            bytes,
          );
          record.checksum = Array.from(new Uint8Array(digest), (value) =>
            value.toString(16).padStart(2, "0"),
          ).join("");
          await IOUtils.writeJSON(inlinePath, record);
          reopenedApp.pdfViewer!.currentPageNumber = 29;
          await until(
            () =>
              reopenedStatus.textContent!.includes("Page 29") &&
              (reopenedStatus.textContent!.includes("saved cache invalid") ||
                reopenedStatus.textContent!.includes("saved, cached")),
          );
          assert.include(
            reopenedStatus.textContent!,
            "saved cache invalid",
            `Invalid ${invalid} metadata cannot restore as a saved source link`,
          );
          assert.equal(
            requests.length,
            afterNavigation,
            "Malformed inline metadata fails its own validation, with a valid checksum and automatic translation OFF",
          );
        }
      } finally {
        await IOUtils.writeUTF8(inlinePath, originalInlineRecord);
      }
    } finally {
      inlineFailure = undefined;
      matchingWindow?.close();
      if (fixtureReader)
        (fixtureReader as unknown as _ZoteroTypes.ReaderTab).close();
      try {
        if (fixtureItem) await fixtureItem.eraseTx();
      } finally {
        await IOUtils.remove(fixturePath, { ignoreAbsent: true });
        Zotero.getMainWindow().Zotero_Tabs.select(reader.tabID);
      }
    }
  });

  it("closing the reader prevents publication of a pending provider response", async function () {
    const provider = (Zotero as any)[
      config.addonInstance
    ].data.translate.services.getServiceById("googleapi") as TranslateService;
    const translate = provider.translate;
    let signal: AbortSignal | undefined;
    provider.translate = (data) => {
      signal = data.signal;
      return translate(data);
    };
    try {
      enable(true);
      await until(() => result.value !== "");
      slow = true;
      application.pdfViewer!.currentPageNumber = 2;
      body
        .querySelector<HTMLButtonElement>(
          `#${config.addonRef}-retranslate-page`,
        )!
        .click();
      await until(() => !!resolveSlow);
      assert.exists(
        signal,
        "The real page task must carry its cancellation signal",
      );
      assert.isFalse(signal!.aborted);
      (Zotero as any)[config.addonInstance].hooks.onShutdown();
      assert.isTrue(
        signal!.aborted,
        "Addon shutdown must abort the provider's active page operation",
      );
      assert.include(
        status.textContent!,
        "Off.",
        "Actual addon shutdown must dispose window-owned sessions before its global is removed",
      );
      (reader as unknown as _ZoteroTypes.ReaderTab).close();
      closed = true;
      await until(() => status.textContent!.includes("Off."));
      slow = false;
      resolveSlow!();
      resolveSlow = undefined;
      const count = requests.length;
      await Zotero.Promise.delay(500);
      assert.equal(result.value, "");
      assert.include(status.textContent!, "Off.");
      assert.equal(requests.length, count);
    } finally {
      provider.translate = translate;
    }
  });
});
