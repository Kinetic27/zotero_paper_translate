import { config, version } from "../../package.json";
import { elementPrefix } from "../utils/elementIdentity";
import { PluginCEBase } from "./base";
import {
  getPref,
  setPref,
  registerPrefObserver,
  unregisterPrefObserver,
} from "../utils/prefs";
import {
  getReaderFontSize,
  getReaderLineHeight,
  setReaderFontSize,
  READER_FONT_MAX,
  READER_FONT_MIN,
} from "../utils/readerSettings";
import { LANG_CODE } from "../utils/config";
import {
  pageReaderMarkup,
  initPageReader,
  renderPageReader,
  destroyPageReader,
} from "../modules/pageReader";
import type { TranslationServices } from "../modules/services";

export class TranslatorPanel extends PluginCEBase {
  item: Zotero.Item | null = null;
  private prefObservers: symbol[] = [];

  get content() {
    const services = this._addon.data.translate.services as TranslationServices;
    return this._parseContentID(
      MozXULElement.parseXULToFragment(`
<linkset>
  <html:link rel="localization" href="${config.addonRef}-panel.ftl" />
  <html:link rel="stylesheet" href="chrome://${config.addonRef}/content/styles/panel.css?v=${version}" />
</linkset>
<hbox id="engine" align="center">
  <menulist id="services" native="true"><menupopup>${services
    .getAllServicesWithType("sentence")
    .map(
      (service) =>
        `<menuitem label="${services.getServiceNameByID(service.id)}" value="${service.id}" />`,
    )
    .join("\n")}</menupopup></menulist>
  <button id="translate" label="Read page" tooltiptext="Open the saved page translation, or translate if none exists" />
</hbox>
<hbox id="language" align="center">
  <menulist id="langfrom" class="lang-menulist" native="true"><menupopup>${LANG_CODE.map((lang) => `<menuitem label="${lang.name}" value="${lang.code}" />`).join("\n")}</menupopup></menulist>
  <toolbarbutton id="swap-language" class="icon-button" data-l10n-id="swapLanguage" />
  <menulist id="langto" class="lang-menulist" native="true"><menupopup>${LANG_CODE.map((lang) => `<menuitem label="${lang.name}" value="${lang.code}" />`).join("\n")}</menupopup></menulist>
</hbox>
<html:div class="reader-toolbar">
${pageReaderMarkup}
<html:div class="reader-typography" role="group" aria-label="Reader text appearance">
  <html:button id="font-decrease" type="button" aria-label="Decrease font size" title="Decrease font size">A−</html:button>
  <html:input id="font-size" type="number" min="${READER_FONT_MIN}" max="${READER_FONT_MAX}" step="1" aria-label="Font size" title="Font size" />
  <html:button id="font-increase" type="button" aria-label="Increase font size" title="Increase font size">A+</html:button>
</html:div>
</html:div>
<html:div class="reading-build">Zotero Translation Reader ${version} · PDF page mode</html:div>
<html:${elementPrefix}-reading-pane id="raw-text" class="page-source" hidden="true" role="region" tabindex="0" aria-label="Current PDF page text" />
<html:div id="source-separator" class="separator" hidden="true" />
<html:${elementPrefix}-reading-pane id="result-text" class="page-result" role="region" tabindex="0" aria-label="Current PDF page translation" />
<hbox id="copy-container" align="center">
  <html:label data-l10n-id="copy" />
  <button id="copy-raw" data-l10n-id="copyRaw" />
  <button id="copy-result" data-l10n-id="copyResult" />
  <button id="copy-both" data-l10n-id="copyBoth" />
</hbox>
`),
    );
  }

  init() {
    this._queryID("show-original")!.addEventListener(
      "click",
      this.toggleOriginal,
    );
    this._queryID("font-decrease")?.addEventListener(
      "click",
      this.decreaseFont,
    );
    this._queryID("font-increase")?.addEventListener(
      "click",
      this.increaseFont,
    );
    this._queryID("font-size")?.addEventListener(
      "change",
      this.onFontSizeChange,
    );
    this.unregisterPrefObservers();
    this.prefObservers = [
      registerPrefObserver("fontSize", this.applyTypography),
      registerPrefObserver("lineHeight", this.applyTypography),
    ];
    initPageReader(this);
    this.render();
  }
  destroy() {
    this._queryID("show-original")?.removeEventListener(
      "click",
      this.toggleOriginal,
    );
    this._queryID("font-decrease")?.removeEventListener(
      "click",
      this.decreaseFont,
    );
    this._queryID("font-increase")?.removeEventListener(
      "click",
      this.increaseFont,
    );
    this._queryID("font-size")?.removeEventListener(
      "change",
      this.onFontSizeChange,
    );
    this.unregisterPrefObservers();
    destroyPageReader(this);
  }

  private unregisterPrefObservers() {
    for (const observer of this.prefObservers) {
      unregisterPrefObserver(observer);
    }
    this.prefObservers = [];
  }

  private applyTypography = () => {
    if (!this.isConnected) return;
    const fontSize = getReaderFontSize();
    const lineHeight = String(getReaderLineHeight());
    for (const id of ["raw-text", "result-text"]) {
      const area = this._queryID(id) as HTMLElement | null;
      if (!area) continue;
      area.style.fontSize = `${fontSize}px`;
      area.style.lineHeight = lineHeight;
    }
    const input = this._queryID("font-size") as HTMLInputElement | null;
    if (input) input.value = String(fontSize);
  };

  private decreaseFont = () => {
    setReaderFontSize(getReaderFontSize() - 1);
    this.applyTypography();
  };

  private increaseFont = () => {
    setReaderFontSize(getReaderFontSize() + 1);
    this.applyTypography();
  };

  private onFontSizeChange = () => {
    const input = this._queryID("font-size") as HTMLInputElement | null;
    if (!input) return;
    const text = input.value.trim();
    const value = Number(text);
    if (text && Number.isFinite(value)) setReaderFontSize(value);
    // Restore the normalized/clamped value even when the input was invalid.
    this.applyTypography();
  };

  private toggleOriginal = () => {
    setPref("showOriginalPage", !getPref("showOriginalPage"));
    this._addon.hooks.onReaderTabPanelRefresh();
    this.render();
  };

  render() {
    const showOriginal = getPref("showOriginalPage") === true;
    for (const id of ["raw-text", "source-separator"]) {
      const element = this._queryID(id) as HTMLElement;
      element.hidden = !showOriginal;
      if (showOriginal) element.style.removeProperty("display");
      else element.style.setProperty("display", "none", "important");
    }
    (this._queryID("result-text") as HTMLElement).style.setProperty(
      "flex",
      "1 1 0%",
    );
    this._queryID("show-original")!.setAttribute(
      "aria-checked",
      String(showOriginal),
    );
    this._queryID("show-original")!.textContent = "Original";
    this._queryID("show-original")!.setAttribute(
      "title",
      `Show original: ${showOriginal ? "ON" : "OFF"}`,
    );
    for (const [id, pref] of [
      ["services", "translateSource"],
      ["langfrom", "sourceLanguage"],
      ["langto", "targetLanguage"],
    ]) {
      (this._queryID(id) as XUL.MenuList).value = String(getPref(pref));
    }
    this.applyTypography();
    renderPageReader(this);
  }
}
