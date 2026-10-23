import { config } from "../../package.json";
import { elementPrefix } from "../utils/elementIdentity";
import { getPref, setPref } from "../utils/prefs";
import type { TranslateTask } from "../utils/task";
import type Addon from "../addon";
import { renderReadingMedia } from "./pdfMedia";
import { reconstructStructuredPage } from "./pdfRegions";
import { completeReadingPage } from "./pdfContinuation";
import type {
  ReadingBlock,
  ReadingPage,
  GeometryContent,
  TextOrigin,
} from "./pdfReadingTypes";
import type { ReadingPane } from "../elements/readingPane";
import {
  pageStorageContext,
  readSavedPage,
  writeSavedPage,
} from "./pageStorage";

const sessions = new Map<HTMLElement, PageReader>();
type SourcePosition = {
  pageIndex?: number;
  rects?: number[][];
  nextPageRects?: number[][];
};
export function matchPDFSelection(
  reader: _ZoteroTypes.ReaderInstance,
  position: SourcePosition,
) {
  // Reader hooks live in the addon sandbox; custom elements live in windows.
  // Deliver through the actual DOM, not a module-local registry in another realm.
  const instance = (Zotero as unknown as Record<string, Addon>)[
    config.addonInstance
  ];
  const documents = Zotero.getMainWindows().map((win) => win.document);
  const standalone = instance.data.panel.windowPanel;
  if (standalone && !standalone.closed) documents.push(standalone.document);
  for (const doc of documents)
    for (const panel of Array.from(
      doc.querySelectorAll(`${elementPrefix}-panel`),
    ) as HTMLElement[]) {
      const event = doc.createEvent("CustomEvent");
      event.initCustomEvent(
        `${config.addonRef}-match-selection`,
        false,
        false,
        { reader, position },
      );
      panel.dispatchEvent(event);
    }
}
export const pageReaderMarkup = `<div xmlns="http://www.w3.org/1999/xhtml" class="page-reading-mode"><div class="page-actions" role="group" aria-label="Reading options"><button type="button" role="switch" title="Automatic page translation: OFF" aria-label="Automatic current PDF page translation" aria-checked="false">Auto</button><button id="show-original" type="button" role="switch" title="Show original: OFF" aria-label="Show original" aria-checked="false">Original</button></div><div class="page-tasks" role="group" aria-label="Translation actions"><button id="retranslate-page" type="button" title="Translate this page again; replace the saved result only on success" aria-label="Translate current page">Translate</button><button id="translate-all" type="button" title="Translate unsaved pages in this document">Translate all</button></div><p role="status" aria-live="polite"></p></div>`;
export function initPageReader(body: HTMLElement) {
  sessions.set(body, new PageReader(body));
}
export function renderPageReader(body: HTMLElement) {
  sessions.get(body)?.updateContext();
}
export function destroyPageReader(body: HTMLElement) {
  sessions.get(body)?.destroy();
  sessions.delete(body);
}
export function unregisterPageReader() {
  // The addon sandbox and custom-element windows have separate module maps.
  // Shutdown must reach the live DOM owners, not just this realm's empty map.
  const instance = (Zotero as unknown as Record<string, Addon>)[
    config.addonInstance
  ];
  const documents = Zotero.getMainWindows().map((win) => win.document);
  const standalone = instance?.data.panel.windowPanel;
  if (standalone && !standalone.closed) documents.push(standalone.document);
  for (const doc of documents)
    for (const panel of Array.from(
      doc.querySelectorAll("[data-personal-reader]"),
    ) as HTMLElement[]) {
      const event = doc.createEvent("Event");
      event.initEvent(`${config.addonRef}-dispose-reader`, false, false);
      panel.dispatchEvent(event);
    }
  for (const session of sessions.values()) session.destroy();
  sessions.clear();
}

class PageReader {
  private application?: _ZoteroTypes.Reader.PDFViewerApplication;
  private reader?: _ZoteroTypes.ReaderInstance;
  private generation = 0;
  private activeController?: AbortController;
  private timer?: number;
  private cache = new Map<string, ReadingBlock[]>();
  private pages = new Map<number, Promise<ReadingPage>>();
  private document?: _ZoteroTypes.Reader.PDFDocumentProxy;
  private automatic = false;
  private toggle: HTMLButtonElement;
  private status: HTMLElement;
  private source: ReadingPane;
  private result: ReadingPane;
  private win: Window;
  private destroyed = false;
  private contextReader?: _ZoteroTypes.ReaderInstance;
  private settings = "";
  private selectionDocument?: Document;
  private selectionTimer?: number;
  private navigationPage?: number;
  private navigationExpiry?: number;
  private lastPage?: number;
  private pointerStart?: [number, number];
  private sourceMatch: TextOrigin[] = [];
  private sourceMatchEpoch = 0;
  private clearSourceMatch = () => {
    ++this.sourceMatchEpoch;
    this.sourceMatch = [];
    this.removeSourceOverlay();
  };
  private removeSourceOverlay() {
    for (const layer of Array.from(
      this.selectionDocument?.querySelectorAll(
        `[data-personal-source-match="${this.owner}"]`,
      ) || [],
    ) as Element[])
      layer.remove();
  }
  private renderSourceMatch = () => {
    this.removeSourceOverlay();
    const doc = this.selectionDocument,
      viewer = this.application?.pdfViewer;
    if (!doc || !viewer || this.destroyed) return;
    for (const origin of this.sourceMatch) {
      const page = doc.querySelector<HTMLElement>(
        `.page[data-page-number="${origin.page}"]`,
      );
      const view = Components.utils.waiveXrays(
        viewer.getPageView(origin.page - 1),
      );
      if (!page || !view?.viewport) continue;
      const layer = doc.createElement("div");
      layer.dataset.personalSourceMatch = this.owner;
      layer.setAttribute("aria-hidden", "true");
      layer.style.cssText =
        "position:absolute;inset:0;pointer-events:none;z-index:5;overflow:hidden;";
      for (const rect of origin.rects || []) {
        const a = view.viewport.convertToViewportPoint(rect[0], rect[1]);
        const b = view.viewport.convertToViewportPoint(rect[2], rect[3]);
        const mark = doc.createElement("div");
        mark.style.cssText = `position:absolute;pointer-events:none;background:rgba(255,190,0,.32);left:${Math.min(a[0], b[0])}px;top:${Math.min(a[1], b[1])}px;width:${Math.abs(a[0] - b[0])}px;height:${Math.abs(a[1] - b[1])}px;`;
        layer.append(mark);
      }
      page.append(layer);
    }
  };
  private work: Promise<unknown> = Promise.resolve();
  private bulk = false;
  private bulkEpoch = 0;
  private bulkRun?: symbol;
  private bypass = false;
  private lastReadOK = true;
  private lastReadError = "";
  private starting = false;
  private owner = Zotero.Utilities.randomString();
  private storageIdentity = "";
  private savedViewEpoch = 0;
  private bulkProgress = "";
  private visiblePageStatus = "";
  private showPageStatus(message: string) {
    this.visiblePageStatus = message;
    this.status.textContent = [this.bulk ? this.bulkProgress : "", message]
      .filter(Boolean)
      .join(" · ");
  }
  private listeners: {
    element: Element;
    type: string;
    listener: EventListener;
  }[] = [];

  constructor(private body: HTMLElement) {
    this.body.dataset.personalReader = "true";
    this.win = body.ownerDocument.defaultView!;
    this.listen(this.body, `${config.addonRef}-dispose-reader`, () =>
      this.destroy(),
    );
    this.toggle = body.querySelector('[role="switch"]')!;
    this.status = body.querySelector('[role="status"]')!;
    this.source = body.querySelector(".page-source")!;
    this.result = body.querySelector(".page-result")!;
    this.listen(this.control("retranslate-page"), "click", () => {
      if (this.bulk) return;
      this.bypass = true;
      void this.bindAndRead();
    });
    this.listen(this.control("translate-all"), "click", () => {
      void this.translateAll().catch((error) =>
        this.taskFailure(this.generation, error),
      );
    });
    this.status.textContent =
      "Off. Click Translate to read this page, or turn automatic page translation ON.";
    this.listen(this.body, `${config.addonRef}-match-selection`, ((
      event: CustomEvent<{
        reader: _ZoteroTypes.ReaderInstance;
        position: SourcePosition;
      }>,
    ) =>
      this.matchSelection(
        event.detail.reader,
        event.detail.position,
      )) as EventListener);
    this.listen(this.toggle, "click", () => {
      this.automatic = !this.automatic;
      this.showSwitch();
      if (this.automatic) void this.bindAndRead();
      else this.stop(true);
    });
    this.listen(this.result, "pointerdown", ((event: PointerEvent) => {
      this.pointerStart = [event.clientX, event.clientY];
    }) as EventListener);
    this.listen(this.result, "click", ((event: MouseEvent) => {
      const pointerStart = this.pointerStart;
      this.pointerStart = undefined;
      if (event.button !== 0 || this.win.getSelection()?.isCollapsed === false)
        return;
      if (
        event.detail > 0 &&
        pointerStart &&
        Math.hypot(
          event.clientX - pointerStart[0],
          event.clientY - pointerStart[1],
        ) > 4
      )
        return;
      void this.navigateBlock(event.target as Element);
    }) as EventListener);
    this.listen(this.result, "keydown", ((event: KeyboardEvent) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void this.navigateBlock(event.target as Element);
      }
    }) as EventListener);
    this.listen(this.control("translate"), "command", () => {
      this.updateContext();
      if (this.bulk) return;
      void this.bindAndRead();
    });
    for (const [id, pref] of [
      ["services", "translateSource"],
      ["langfrom", "sourceLanguage"],
      ["langto", "targetLanguage"],
    ]) {
      this.listen(this.control(id), "command", () => {
        setPref(pref, (this.control(id) as XUL.MenuList).value);
        this.refreshSettings();
      });
    }
    this.listen(this.control("swap-language"), "command", () => {
      const from = String(getPref("sourceLanguage"));
      setPref("sourceLanguage", String(getPref("targetLanguage")));
      setPref("targetLanguage", from);
      this.refreshSettings();
    });
    for (const mode of ["raw", "result", "both"]) {
      this.listen(this.control(`copy-${mode}`), "command", () => {
        const text =
          mode === "raw"
            ? this.source.value
            : mode === "result"
              ? this.result.value
              : `${this.source.value}\n----\n${this.result.value}`;
        new this.instance.data.ztoolkit.Clipboard()
          .addText(text, "text/plain")
          .copy();
      });
    }
    this.win.addEventListener("unload", this.onUnload);
    this.updateContext();
  }
  private get instance() {
    return (Zotero as unknown as Record<string, Addon>)[config.addonInstance];
  }
  private control(id: string) {
    return this.body.querySelector(`#${config.addonRef}-${id}`)!;
  }
  private listen(element: Element, type: string, listener: EventListener) {
    element.addEventListener(type, listener);
    this.listeners.push({ element, type, listener });
  }
  private showSwitch() {
    this.toggle.setAttribute("aria-checked", String(this.automatic));
    this.toggle.textContent = "Auto";
    this.toggle.title = `Automatic page translation: ${this.automatic ? "ON" : "OFF"}`;
  }
  private advanceGeneration() {
    const generation = ++this.generation;
    const controller = this.activeController;
    this.activeController = undefined;
    controller?.abort();
    return generation;
  }
  private refreshSettings() {
    this.instance.hooks.onReaderTabPanelRefresh();
    this.updateContext();
  }
  private getReader() {
    const details = this.body.closest("item-details") as
      | (HTMLElement & { tabID: string })
      | null;
    const tabID =
      details?.tabID || Zotero.getMainWindow().Zotero_Tabs.selectedID;
    return tabID ? Zotero.Reader.getByTabID(tabID) : undefined;
  }
  updateContext() {
    const reader = this.getReader();
    if (reader !== this.contextReader) {
      this.stop();
      this.contextReader = reader;
    }
    const available = reader?.type === "pdf";
    this.toggle.disabled = !available;
    (this.control("translate") as XUL.Button).disabled =
      !available || this.bulk;
    (this.control("retranslate-page") as HTMLButtonElement).disabled =
      !available || this.bulk;
    (this.control("translate-all") as HTMLButtonElement).disabled = !available;
    if (!available)
      this.status.textContent =
        "Page mode requires an open PDF reader tab. Select a PDF tab and reopen or refresh this panel.";
    const settings = JSON.stringify([
      getPref("translateSource"),
      getPref("sourceLanguage"),
      getPref("targetLanguage"),
    ]);
    if (settings !== this.settings) {
      this.settings = settings;
      this.advanceGeneration();
      if (available && this.automatic) void this.bindAndRead();
      else if (available && this.application && !this.bulk) {
        this.source.value = "";
        this.result.value = "";
        void this.restoreSaved();
      }
    }
    if (available && !this.application && !this.automatic && !this.bulk)
      void this.bindAndRead(false);
  }
  private configuration(document: _ZoteroTypes.Reader.PDFDocumentProxy) {
    const serviceID = String(getPref("translateSource"));
    const values = Services.prefs
      .getChildList(`${config.prefsPrefix}.`)
      .filter((key) => {
        const name = key.slice(config.prefsPrefix.length + 1);
        return (
          name.startsWith(`${serviceID}.`) ||
          [
            "translateSource",
            "sourceLanguage",
            "targetLanguage",
            "secretObj",
            "extraEngines",
            "resultRegex",
            "stripEmptyLines",
            "splitChar",
          ].includes(name) ||
          name.toLowerCase().startsWith(serviceID.toLowerCase())
        );
      })
      .sort()
      .map((key) => [key, Zotero.Prefs.get(key, true)]);
    return JSON.stringify([values, document.fingerprints]);
  }
  private async restoreSaved() {
    const application = this.application;
    if (!application?.pdfDocument || this.destroyed) return;
    const generation = this.generation;
    const viewEpoch = ++this.savedViewEpoch;
    const document = application.pdfDocument;
    const configuration = this.configuration(document);
    const page = application.pdfViewer?.currentPageNumber || application.page;
    try {
      const storage = await pageStorageContext(
        Zotero.Items.get(this.reader!.itemID!),
        configuration,
      );
      const saved = await readSavedPage(storage, page);
      if (
        this.destroyed ||
        viewEpoch !== this.savedViewEpoch ||
        generation !== this.generation ||
        document !== application.pdfDocument ||
        configuration !== this.configuration(document) ||
        application !== this.application ||
        page !== (application.pdfViewer?.currentPageNumber || application.page)
      )
        return;
      if (saved.record) {
        this.source.setBlocks(saved.record.source.blocks);
        this.result.setBlocks(saved.record.result);
        this.showPageStatus(
          `Page ${page} · ${getPref("translateSource")} (saved, cached)${saved.record.source.blocks.length ? "" : " · no extractable text (OCR is not supported)"}`,
        );
      } else if (saved.invalid)
        this.showPageStatus(
          `Page ${page}: saved cache invalid. ${this.bulk ? "Waiting for document translation; no extra request sent." : "Click Translate to recompute; no request was sent."}`,
        );
      else
        this.showPageStatus(
          this.bulk
            ? `Page ${page} has not been translated yet. Waiting for document translation.`
            : `Page ${page} has not been translated for these settings. Click Translate (automatic OFF).`,
        );
    } catch (error) {
      if (
        generation === this.generation &&
        viewEpoch === this.savedViewEpoch &&
        !this.destroyed
      )
        this.showPageStatus(
          `Saved page unavailable: ${String(error)}. Click Translate to retry.`,
        );
    }
  }
  private onUnload = () => this.destroy();
  private onReaderUnload = () => this.stop();
  private onPDFInput = (event: Event) => {
    this.navigationPage = undefined;
    if (
      event.type === "pointerdown" ||
      (event as KeyboardEvent).key === "Escape"
    )
      this.selectionDocument?.dispatchEvent(
        new (this.selectionDocument.defaultView as any).Event(
          `${config.addonRef}-clear-source-match`,
        ),
      );
  };
  private clearMatches() {
    for (const block of Array.from(
      this.result.querySelectorAll(".reading-match"),
    ) as HTMLElement[])
      block.classList.remove("reading-match");
  }
  matchSelection(
    reader: _ZoteroTypes.ReaderInstance,
    position: SourcePosition | SourcePosition[],
  ) {
    if (this.destroyed || this.getReader() !== reader) return;
    this.selectionDocument?.dispatchEvent(
      new (this.selectionDocument.defaultView as any).Event(
        `${config.addonRef}-clear-source-match`,
      ),
    );
    this.clearMatches();
    let first: HTMLElement | undefined;
    const selections = (
      Array.isArray(position) ? position : [position]
    ).flatMap((part) => [
      { page: (part.pageIndex ?? -1) + 1, rects: part.rects || [] },
      { page: (part.pageIndex ?? -1) + 2, rects: part.nextPageRects || [] },
    ]);
    for (const element of Array.from(
      this.result.querySelectorAll("[data-origins]"),
    ) as HTMLElement[]) {
      const origins = JSON.parse(element.dataset.origins!) as TextOrigin[];
      if (
        origins.some((origin) =>
          selections.some(
            (selected) =>
              origin.page === selected.page &&
              origin.rects?.some((rect) =>
                selected.rects.some(
                  (other) =>
                    Math.min(rect[2], other[2]) - Math.max(rect[0], other[0]) >
                      0.5 &&
                    Math.min(rect[3], other[3]) - Math.max(rect[1], other[1]) >
                      0.5,
                ),
              ),
          ),
        )
      ) {
        element.classList.add("reading-match");
        first ||= element;
      }
    }
    if (first) {
      first.scrollIntoView({ block: "nearest", behavior: "auto" });
      this.status.textContent =
        "Matched PDF selection to displayed paragraphs.";
    } else
      this.status.textContent =
        "No translated paragraph available for this selection. Use Translate on its page; matching sends no request.";
  }
  private onSelectionChange = () => {
    if (this.selectionTimer !== undefined)
      this.win.clearTimeout(this.selectionTimer);
    this.selectionTimer = this.win.setTimeout(() => {
      this.selectionTimer = undefined;
      const selection = this.selectionDocument?.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        this.clearMatches();
        return;
      }
      const reader = this.getReader();
      if (!reader || reader.type !== "pdf") return;
      const app = (reader as _ZoteroTypes.ReaderInstance<"pdf">)._internalReader
        ._primaryView._iframeWindow?.PDFViewerApplication;
      if (!app?.pdfViewer) return;
      const range = selection.getRangeAt(0);
      const matches: SourcePosition[] = [];
      for (const pageElement of Array.from(
        this.selectionDocument!.querySelectorAll(".page[data-page-number]"),
      ) as HTMLElement[]) {
        const number = Number(pageElement.dataset.pageNumber);
        const view = Components.utils.waiveXrays(
          app.pdfViewer.getPageView(number - 1),
        );
        if (!view?.viewport) continue;
        const pageBox = pageElement.getBoundingClientRect();
        const rects: number[][] = [];
        for (const client of Array.from(range.getClientRects() || [])) {
          if (
            client.width <= 0 ||
            client.height <= 0 ||
            client.bottom <= pageBox.top ||
            client.top >= pageBox.bottom ||
            client.right <= pageBox.left ||
            client.left >= pageBox.right
          )
            continue;
          const a = view.viewport.convertToPdfPoint(
            Math.max(client.left, pageBox.left) - pageBox.left,
            Math.max(client.top, pageBox.top) - pageBox.top,
          );
          const b = view.viewport.convertToPdfPoint(
            Math.min(client.right, pageBox.right) - pageBox.left,
            Math.min(client.bottom, pageBox.bottom) - pageBox.top,
          );
          rects.push([
            Math.min(a[0], b[0]),
            Math.min(a[1], b[1]),
            Math.max(a[0], b[0]),
            Math.max(a[1], b[1]),
          ]);
        }
        if (rects.length) matches.push({ pageIndex: number - 1, rects });
      }
      // Gather all selected pages before highlighting, not just the last one.
      if (matches.length) this.matchSelection(reader, matches);
    }, 40);
  };
  private async navigateBlock(target: Element) {
    const element = target.closest<HTMLElement>("[data-origins]");
    const reader = this.getReader();
    if (
      !element ||
      !this.result.contains(element) ||
      !reader ||
      reader.type !== "pdf"
    )
      return;
    const origins = JSON.parse(element.dataset.origins!) as TextOrigin[];
    const first = origins.find((origin) => origin.rects?.length);
    if (!first) {
      this.status.textContent =
        "PDF coordinates are unavailable for this paragraph.";
      return;
    }
    const rects = origins
      .filter((origin) => origin.page === first.page)
      .flatMap((origin) => origin.rects || []);
    const nextPageRects = origins
      .filter((origin) => origin.page === first.page + 1)
      .flatMap((origin) => origin.rects || []);
    this.navigationPage =
      first.page ===
      (this.application?.pdfViewer?.currentPageNumber || this.application?.page)
        ? undefined
        : first.page;
    if (this.navigationExpiry !== undefined)
      this.win.clearTimeout(this.navigationExpiry);
    this.navigationExpiry = this.win.setTimeout(() => {
      this.navigationPage = undefined;
      this.navigationExpiry = undefined;
    }, 1000);
    this.clearMatches();
    element.classList.add("reading-match");
    this.selectionDocument?.dispatchEvent(
      new (this.selectionDocument.defaultView as any).Event(
        `${config.addonRef}-clear-source-match`,
      ),
    );
    const matchEpoch = this.sourceMatchEpoch;
    try {
      await reader.navigate({
        position: {
          pageIndex: first.page - 1,
          rects,
          ...(nextPageRects.length ? { nextPageRects } : {}),
        },
      });
    } catch (error) {
      this.navigationPage = undefined;
      this.status.textContent = `PDF source navigation failed: ${String(error)}`;
      return;
    }
    if (!this.destroyed && matchEpoch === this.sourceMatchEpoch) {
      this.sourceMatch = origins;
      this.renderSourceMatch();
      this.status.textContent = `Showing PDF source on page ${first.page}${origins.some((origin) => origin.page !== first.page) ? "; paragraph includes continued source pages (see tooltip)" : ""}. Source highlight remains until the next match, PDF interaction or page change; no annotation saved.`;
    }
  }
  private onPageChange = (event?: { pageNumber?: number }) => {
    const number =
      event?.pageNumber ||
      this.application?.pdfViewer?.currentPageNumber ||
      this.application?.page;
    if (number === this.lastPage) return;
    this.lastPage = number;
    if (this.navigationPage === number) {
      this.navigationPage = undefined;
      return;
    }
    this.navigationPage = undefined;
    this.clearSourceMatch();
    this.source.value = "";
    this.result.value = "";
    this.clearMatches();
    if (this.bulk) {
      this.showPageStatus(`Page ${number}: checking saved translation…`);
      void this.restoreSaved();
      return;
    }
    if (this.automatic) this.schedule();
    else {
      this.advanceGeneration();
      this.source.value = "";
      this.result.value = "";
      this.status.textContent = `Page ${number}: checking saved translation (automatic OFF)…`;
      void this.restoreSaved();
    }
  };
  private async bindAndRead(read = true) {
    if (this.destroyed) return;
    if (this.application) {
      if (read && !this.bulk) this.schedule();
      return this.application;
    }
    const reader = this.getReader();
    if (!reader || reader.type !== "pdf") return;
    const generation = this.advanceGeneration();
    this.status.textContent = "Waiting for PDF reader…";
    try {
      await reader._initPromise;
      const view = (reader as _ZoteroTypes.ReaderInstance<"pdf">)
        ._internalReader._primaryView;
      await view.initializedPromise;
      if (generation !== this.generation || this.destroyed) return;
      const application = view._iframeWindow?.PDFViewerApplication;
      if (!application?.pdfDocument || !application.eventBus)
        throw new Error("PDF.js page text API is unavailable in this reader.");
      this.reader = reader;
      this.application = application;
      this.lastPage =
        application.pdfViewer?.currentPageNumber || application.page;
      const doc = view._iframeWindow!.document;
      if (doc !== this.selectionDocument) {
        this.selectionDocument?.removeEventListener(
          "selectionchange",
          this.onSelectionChange,
        );
        this.selectionDocument?.removeEventListener(
          `${config.addonRef}-clear-source-match`,
          this.clearSourceMatch,
        );
        for (const type of ["wheel", "keydown", "pointerdown"])
          this.selectionDocument?.removeEventListener(
            type,
            this.onPDFInput,
            true,
          );
        this.selectionDocument?.defaultView?.removeEventListener(
          "unload",
          this.onReaderUnload,
        );
        this.selectionDocument = doc;
        doc.addEventListener("selectionchange", this.onSelectionChange);
        doc.addEventListener(
          `${config.addonRef}-clear-source-match`,
          this.clearSourceMatch,
        );
        for (const type of ["wheel", "keydown", "pointerdown"])
          doc.addEventListener(type, this.onPDFInput, true);
        doc.defaultView?.addEventListener("unload", this.onReaderUnload);
      }
      application.eventBus.on("pagechanging", this.onPageChange);
      for (const event of ["pagerendered", "scalechanging", "rotationchanging"])
        application.eventBus.on(event, this.renderSourceMatch);
      if (read && !this.bulk) this.schedule();
      else if (!this.bulk) void this.restoreSaved();
      return application;
    } catch (error) {
      if (generation === this.generation)
        this.status.textContent = String(error);
    }
  }
  private schedule() {
    if (this.bulk) return;
    if (
      this.instance.data.pageBulkOwner &&
      this.instance.data.pageBulkOwner !== this.owner
    ) {
      this.status.textContent =
        "Whole-document translation is running in another panel. Cancel it there before translating.";
      return;
    }
    const generation = this.advanceGeneration();
    if (this.timer !== undefined) this.win.clearTimeout(this.timer);
    const fresh = this.bypass;
    this.bypass = false;
    this.status.textContent = "Loading current page…";
    this.timer = this.win.setTimeout(() => {
      this.timer = undefined;
      if (!this.destroyed && generation === this.generation)
        this.status.textContent = "Waiting for page translation queue…";
      this.work = this.work
        .then(() => this.enqueueRead(generation, undefined, fresh))
        .catch((error) => this.taskFailure(generation, error));
    }, 350);
  }
  private async translateAll() {
    if (this.bulk) {
      ++this.bulkEpoch;
      this.advanceGeneration();
      this.status.textContent =
        "Cancelling whole-document translation; completed pages remain saved.";
      return;
    }
    if (this.starting) return;
    this.starting = true;
    this.status.textContent = "Translate all: preparing PDF…";
    const intendedReader = this.getReader();
    let bound;
    try {
      bound = await this.bindAndRead(false);
    } finally {
      this.starting = false;
    }
    if (
      !bound?.pdfDocument ||
      bound !== this.application ||
      intendedReader !== this.getReader() ||
      this.destroyed
    )
      return;
    if (
      this.instance.data.pageBulkOwner &&
      this.instance.data.pageBulkOwner !== this.owner
    ) {
      this.status.textContent =
        "Whole-document translation is already running in another panel.";
      return;
    }
    this.instance.data.pageBulkOwner = this.owner;
    if (this.timer !== undefined) this.win.clearTimeout(this.timer);
    const generation = this.advanceGeneration();
    const epoch = ++this.bulkEpoch;
    const run = Symbol();
    this.bulkRun = run;
    this.bulk = true;
    this.bulkProgress = "Translate all: starting";
    this.visiblePageStatus = "";
    (this.control("translate") as XUL.Button).disabled = true;
    (this.control("retranslate-page") as HTMLButtonElement).disabled = true;
    (this.control("translate-all") as HTMLButtonElement).textContent = "Cancel";
    const count = bound.pdfDocument.numPages;
    this.work = this.work
      .then(async () => {
        let completed = 0;
        try {
          for (let page = 1; page <= count; page++) {
            if (!this.bulk || epoch !== this.bulkEpoch || this.destroyed) break;
            this.bulkProgress = `Translate all: page ${page}/${count}`;
            this.status.textContent = [
              this.bulkProgress,
              this.visiblePageStatus,
            ]
              .filter(Boolean)
              .join(" · ");
            await this.enqueueRead(generation, page);
            if (!this.lastReadOK || generation !== this.generation) break;
            completed++;
            if (!this.bulk || epoch !== this.bulkEpoch) break;
            await Zotero.Promise.delay(250);
          }
          if (!this.destroyed && this.bulkRun === run)
            this.status.textContent =
              completed === count
                ? `Translate all complete: ${completed}/${count} pages saved.`
                : `Translate all stopped: ${completed}/${count} pages completed; saved pages retained.${this.lastReadOK || !this.lastReadError ? "" : ` Failed page: ${this.lastReadError}`}`;
        } finally {
          if (this.bulkRun === run) {
            this.bulkRun = undefined;
            if (this.instance?.data.pageBulkOwner === this.owner)
              this.instance.data.pageBulkOwner = undefined;
            this.bulk = false;
            this.bulkProgress = "";
            if (!this.destroyed) {
              (this.control("translate") as XUL.Button).disabled =
                this.getReader()?.type !== "pdf";
              (this.control("retranslate-page") as HTMLButtonElement).disabled =
                this.getReader()?.type !== "pdf";
            }
            (this.control("translate-all") as HTMLButtonElement).textContent =
              "Translate all";
          }
        }
      })
      .catch((error) => this.taskFailure(generation, error));
    await this.work;
  }
  private enqueueRead(generation: number, page?: number, fresh = false) {
    return this.instance.enqueuePageWork(() =>
      this.read(generation, page, fresh),
    );
  }
  private taskFailure(generation: number, error: unknown) {
    this.lastReadOK = false;
    this.lastReadError = String(error);
    if (!this.destroyed && generation === this.generation)
      this.status.textContent = `Page operation failed: ${String(error)}. Retry Translate.`;
  }
  private async read(
    generation: number,
    requestedPage?: number,
    fresh = false,
  ) {
    this.lastReadOK = false;
    this.lastReadError = "";
    if (this.destroyed || generation !== this.generation) return;
    const application = this.application;
    if (!application?.pdfDocument) return;
    const pageNumber =
      requestedPage ??
      (application.pdfViewer?.currentPageNumber || application.page);
    const document = application.pdfDocument;
    if (document !== this.document) {
      this.document = document;
      this.pages.clear();
      this.cache.clear();
    }
    const configuration = this.configuration(document);
    const controller = new AbortController();
    this.activeController = controller;
    const current = () =>
      !this.destroyed &&
      generation === this.generation &&
      application === this.application &&
      document === application.pdfDocument &&
      configuration === this.configuration(document) &&
      (requestedPage !== undefined ||
        pageNumber ===
          (application.pdfViewer?.currentPageNumber || application.page));
    const visible = () =>
      current() &&
      pageNumber ===
        (application.pdfViewer?.currentPageNumber || application.page);
    try {
      const serviceID = String(getPref("translateSource"));
      const translator = this.instance.data.translate.services;
      const service = translator.getServiceById(serviceID);
      if (!service || service.type !== "sentence")
        throw new Error(
          "Choose a sentence translation provider in Zotero Translation Reader settings.",
        );
      const langfrom = String(getPref("sourceLanguage"));
      const langto = String(getPref("targetLanguage"));
      if (visible() && !this.bulk)
        this.status.textContent = `Page ${pageNumber}: checking PDF file identity…`;
      const item = Zotero.Items.get(this.reader!.itemID!);
      const storage = await pageStorageContext(item, configuration);
      if (storage.identity !== this.storageIdentity) {
        this.storageIdentity = storage.identity;
        this.pages.clear();
        this.cache.clear();
      }
      const saved = fresh ? {} : await readSavedPage(storage, pageNumber);
      if (!current()) return;
      if (saved.record) {
        if (visible()) {
          ++this.savedViewEpoch;
          this.source.setBlocks(saved.record.source.blocks);
          this.result.setBlocks(saved.record.result);
          this.showPageStatus(
            `Page ${pageNumber} · ${serviceID} (saved, cached)${saved.record.source.blocks.length ? "" : " · no extractable text (OCR is not supported)"}`,
          );
        }
        this.lastReadOK = true;
        return;
      }
      if (saved.invalid && visible())
        this.status.textContent = `Page ${pageNumber}: saved cache invalid; recomputing safely.`;
      else if (visible() && !this.bulk)
        this.status.textContent = `Page ${pageNumber}: extracting structured PDF text…`;
      const load = (number: number): Promise<ReadingPage> => {
        let pending = this.pages.get(number);
        if (!pending) {
          pending = (async () => {
            if (!current()) throw new Error("Page read superseded");
            const page = Components.utils.waiveXrays(
              await document.getPage(number),
            ) as _ZoteroTypes.Reader.PDFPageProxy;
            const content = await page.getTextContent();
            // Text transforms use unrotated PDF user space. Read the native crop
            // box directly: passing a chrome-realm options object into PDF.js
            // getViewport can hide scale through Gecko Xrays and yield NaN.
            const [left, bottom, right, top] = page.view;
            const geometry = content as GeometryContent;
            const normalized: GeometryContent = {
              ...geometry,
              items: geometry.items.map((item) =>
                "str" in item
                  ? {
                      ...item,
                      transform: item.transform.map((value, index) =>
                        index === 4
                          ? value - left
                          : index === 5
                            ? value - bottom
                            : value,
                      ),
                    }
                  : item,
              ),
            };
            const operators = Components.utils.waiveXrays(
              await page.getOperatorList(),
            );
            const pdfjs = (this.reader as _ZoteroTypes.ReaderInstance<"pdf">)
              ._internalReader._primaryView._iframeWindow!.pdfjsLib;
            const structured = reconstructStructuredPage(
              number,
              normalized,
              operators,
              pdfjs.OPS as unknown as Record<string, number>,
              right - left,
              top - bottom,
            );
            for (const block of structured.blocks) {
              for (const origin of block.origins)
                origin.rects = origin.rects?.map((rect) => [
                  rect[0] + left,
                  rect[1] + bottom,
                  rect[2] + left,
                  rect[3] + bottom,
                ]);
              for (const span of block.inlineMath || [])
                span.rect = [
                  span.rect[0] + left,
                  span.rect[1] + bottom,
                  span.rect[2] + left,
                  span.rect[3] + bottom,
                ];
            }
            return await renderReadingMedia(
              structured,
              page,
              (this.reader as _ZoteroTypes.ReaderInstance<"pdf">)
                ._internalReader._primaryView._iframeWindow!,
            );
          })();
          this.pages.set(number, pending);
          if (this.pages.size > 10)
            this.pages.delete(this.pages.keys().next().value!);
          pending.catch(() => this.pages.delete(number));
        }
        return pending;
      };
      const reading = await completeReadingPage(
        pageNumber,
        document.numPages,
        load,
      );
      if (!current()) return;
      const text = reading.blocks.map((block) => block.text).join("\n\n");
      if (!text) {
        await writeSavedPage(storage, pageNumber, {
          source: reading,
          result: [],
        });
        if (visible()) {
          this.source.setBlocks(reading.blocks);
          this.result.value = "";
          ++this.savedViewEpoch;
          this.showPageStatus(
            `Page ${pageNumber}: no extractable text (OCR is not supported).`,
          );
        }
        this.lastReadOK = true;
        return;
      }
      if (text.length > 60000)
        throw new Error(
          "This page exceeds the 60,000-character page translation limit.",
        );
      const key = JSON.stringify([storage.identity, reading]);
      const cached = fresh || saved.invalid ? undefined : this.cache.get(key);
      if (cached !== undefined) {
        this.cache.delete(key);
        this.cache.set(key, cached);
        if (visible()) {
          this.source.setBlocks(reading.blocks);
          this.result.setBlocks(cached);
          ++this.savedViewEpoch;
          this.showPageStatus(`Page ${pageNumber} · ${serviceID} (cached)`);
        }
        await writeSavedPage(storage, pageNumber, {
          source: reading,
          result: cached,
        });
        this.lastReadOK = true;
        return;
      }
      if (visible() && !this.bulk)
        this.status.textContent = `Translating page ${pageNumber} · ${serviceID}…`;
      const translated: ReadingBlock[] = [];
      for (const block of reading.blocks) {
        if (
          block.kind === "abstract" &&
          /^Abstract[.:]?$/i.test(block.text.trim())
        ) {
          const labels: Record<string, string> = {
            ko: "초록",
            en: "Abstract",
            ja: "要旨",
            zh: "摘要",
            fr: "Résumé",
            de: "Zusammenfassung",
            es: "Resumen",
          };
          translated.push({
            ...block,
            text: labels[langto.split(/[-_]/)[0]] || block.text,
          });
          continue;
        }
        if (!block.translate) {
          translated.push({ ...block });
          continue;
        }
        let markerPrefix = "MATH";
        while (block.text.includes(`[${markerPrefix}_`))
          markerPrefix = `X${markerPrefix}`;
        const protectedMath = (block.inlineMath || []).map((span, index) => ({
          span,
          token: `[${markerPrefix}_${index}]`,
          text: block.text.slice(span.start, span.end),
        }));
        let providerText = "",
          from = 0,
          proseText = "";
        for (const math of protectedMath) {
          const prose = block.text.slice(from, math.span.start);
          providerText += prose + math.token;
          proseText += prose;
          from = math.span.end;
        }
        providerText += block.text.slice(from);
        proseText += block.text.slice(from);
        if (protectedMath.length && !/\p{L}/u.test(proseText)) {
          translated.push({ ...block });
          continue;
        }
        const chunks: string[] = [];
        let remaining = providerText;
        while (remaining.length > 1200) {
          const window = remaining.slice(0, 1200);
          const sentences = Array.from(window.matchAll(/[.!?]["'”’\])]*\s+/g));
          const sentence = sentences
            .filter((match) => match.index! > 400)
            .at(-1);
          let cut = sentence
            ? sentence.index! + sentence[0].length
            : window.lastIndexOf(" ");
          if (cut < 1) cut = 1200;
          const tokenStart = remaining.lastIndexOf(
            `[${markerPrefix}_`,
            cut - 1,
          );
          if (tokenStart >= 0 && remaining.indexOf("]", tokenStart) >= cut)
            cut = tokenStart || remaining.indexOf("]", tokenStart) + 1;
          chunks.push(remaining.slice(0, cut).trim());
          remaining = remaining.slice(cut).trimStart();
        }
        if (remaining.trim()) chunks.push(remaining.trim());
        const translations: string[] = [];
        for (const raw of chunks) {
          if (!current()) return;
          await Zotero.Promise.delay(100);
          if (!current()) return;
          const task: TranslateTask = {
            id: `page-${pageNumber}`,
            type: "custom",
            raw,
            result: "",
            audio: [],
            service: serviceID,
            candidateServices: [],
            itemId: this.reader?.itemID,
            langfrom,
            langto,
            status: "waiting",
            extraTasks: [],
            signal: controller.signal,
          };
          // Providers execute in the plugin sandbox, never the custom-element window.
          await translator.runTranslationTask(task, {
            noDisplay: true,
            noCache: true,
            noCheckZoteroItemLanguage: true,
          });
          if (!current()) return;
          if (task.status !== "success") throw new Error(task.result);
          if (!task.result.trim())
            throw new Error("The provider returned an empty translation.");
          if (
            langfrom.split(/[-_]/)[0] !== langto.split(/[-_]/)[0] &&
            ["body", "abstract", "footnote"].includes(block.kind) &&
            (raw.match(/\p{Ll}{3,}/gu) || []).length >= 12 &&
            /[.!?:;]/.test(raw) &&
            task.result.replace(/\s+/g, " ").trim() ===
              raw.replace(/\s+/g, " ").trim()
          )
            throw new Error(
              "The provider returned the original prose unchanged. No replacement was saved; check the source/target languages and retry Translate.",
            );
          translations.push(task.result);
        }
        let resultText = translations
          .map((text) => text.replace(/\s*\n\s*/g, " ").trim())
          .join(" ");
        const restoredMath: NonNullable<ReadingBlock["inlineMath"]> = [];
        if (protectedMath.length) {
          const found = protectedMath
            .map((math) => {
              const start = resultText.indexOf(math.token);
              if (
                start < 0 ||
                resultText.indexOf(math.token, start + math.token.length) >= 0
              )
                throw new Error(
                  "The provider changed or omitted an inline equation marker. No replacement was saved; retry Translate or choose another provider.",
                );
              return { ...math, start };
            })
            .sort((a, b) => a.start - b.start);
          let restored = "",
            end = 0;
          for (const math of found) {
            restored += resultText.slice(end, math.start);
            const start = restored.length;
            restored += math.text;
            restoredMath.push({ ...math.span, start, end: restored.length });
            end = math.start + math.token.length;
          }
          restored += resultText.slice(end);
          if (restored.includes(`[${markerPrefix}_`))
            throw new Error(
              "The provider returned an unknown inline equation marker. No replacement was saved.",
            );
          resultText = restored;
        }
        translated.push({
          ...block,
          text: resultText,
          ...(restoredMath.length ? { inlineMath: restoredMath } : {}),
        });
      }
      if (
        translated.reduce((sum, block) => sum + block.text.length, 0) <= 120000
      ) {
        this.cache.set(key, translated);
        if (this.cache.size > 12)
          this.cache.delete(this.cache.keys().next().value!);
      }
      if (!current()) return;
      await writeSavedPage(storage, pageNumber, {
        source: reading,
        result: translated,
      });
      this.lastReadOK = true;
      if (visible()) {
        ++this.savedViewEpoch;
        this.source.setBlocks(reading.blocks);
        this.result.setBlocks(translated);
        if (this.bulk)
          this.showPageStatus(`Page ${pageNumber} · ${serviceID} · saved`);
      }
      const spans = [
        ...new Set(
          reading.blocks.flatMap((block) =>
            block.origins.map((origin) => origin.page),
          ),
        ),
      ];
      if (visible() && !this.bulk)
        this.status.textContent = `Page ${pageNumber} · ${serviceID}${spans.length > 1 ? ` · includes continuation from pages ${spans.join(", ")}` : ""} · saved${saved.invalid ? " · invalid saved cache recomputed" : ""}`;
    } catch (error) {
      this.lastReadError = String(error);
      if (visible()) {
        this.showPageStatus(`Page ${pageNumber}: ${String(error)}`);
      }
    } finally {
      if (this.activeController === controller)
        this.activeController = undefined;
    }
  }
  stop(preserve = false) {
    this.clearSourceMatch();
    ++this.savedViewEpoch;
    if (this.navigationExpiry !== undefined)
      this.win.clearTimeout(this.navigationExpiry);
    this.navigationExpiry = undefined;
    this.navigationPage = undefined;
    if (this.instance?.data.pageBulkOwner === this.owner)
      this.instance.data.pageBulkOwner = undefined;
    this.bulk = false;
    ++this.bulkEpoch;
    const translateAll = this.control(
      "translate-all",
    ) as HTMLButtonElement | null;
    if (translateAll) translateAll.textContent = "Translate all";
    this.advanceGeneration();
    if (this.timer !== undefined) this.win.clearTimeout(this.timer);
    this.timer = undefined;
    this.clearMatches();
    this.automatic = false;
    this.showSwitch();
    if (preserve) {
      this.cache.clear();
      this.pages.clear();
      this.status.textContent =
        "Automatic page translation: OFF. Displayed paragraphs remain available for matching.";
      return;
    }
    this.selectionDocument?.removeEventListener(
      "selectionchange",
      this.onSelectionChange,
    );
    this.selectionDocument?.removeEventListener(
      `${config.addonRef}-clear-source-match`,
      this.clearSourceMatch,
    );
    for (const type of ["wheel", "keydown", "pointerdown"])
      this.selectionDocument?.removeEventListener(type, this.onPDFInput, true);
    this.selectionDocument?.defaultView?.removeEventListener(
      "unload",
      this.onReaderUnload,
    );
    this.selectionDocument = undefined;
    if (this.selectionTimer !== undefined)
      this.win.clearTimeout(this.selectionTimer);
    this.selectionTimer = undefined;
    this.navigationPage = undefined;
    this.lastPage = undefined;
    this.application?.eventBus?.off("pagechanging", this.onPageChange);
    for (const event of ["pagerendered", "scalechanging", "rotationchanging"])
      this.application?.eventBus?.off(event, this.renderSourceMatch);
    this.application = undefined;
    this.reader = undefined;
    this.automatic = false;
    this.showSwitch();
    this.cache.clear();
    this.pages.clear();
    this.document = undefined;
    this.source.value = "";
    this.result.value = "";
    this.status.textContent =
      "Off. Click Translate to read this page, or turn automatic page translation ON.";
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    delete this.body.dataset.personalReader;
    this.stop();
    for (const { element, type, listener } of this.listeners)
      element.removeEventListener(type, listener);
    this.listeners = [];
    this.win.removeEventListener("unload", this.onUnload);
  }
}
