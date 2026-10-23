import { getLocaleID } from "../utils/locale";
import { config } from "../../package.json";
import { getPref, setPref } from "../utils/prefs";
import { getLastTranslateTask } from "../utils/task";
import { TranslatorPanel } from "../elements/panel";
import { isWindowAlive } from "../utils/window";
import { services } from "./services";
import { elementPrefix } from "../utils/elementIdentity";

let paneKey = "";
const heightObservers = new WeakMap<
  HTMLElement,
  { schedule: () => void; destroy: () => void }
>();

export function registerReaderTabPanel() {
  const key = Zotero.ItemPaneManager.registerSection({
    paneID: "translate",
    pluginID: config.addonID,
    header: {
      l10nID: getLocaleID("itemPaneSection-header"),
      icon: `chrome://${config.addonRef}/content/icons/section-16.svg`,
    },
    sidenav: {
      l10nID: getLocaleID("itemPaneSection-sidenav"),
      icon: `chrome://${config.addonRef}/content/icons/section-20.svg`,
      // @ts-ignore
      orderable: false,
    },
    bodyXHTML: `<${elementPrefix}-panel />`,
    onInit,
    onDestroy,
    onRender: ({ body, item }) => {
      const panel = body.querySelector(
        `${elementPrefix}-panel`,
      ) as TranslatorPanel;
      panel.item = item;
      panel.render();
      observePanelHeight(body);
      onUpdateHeight({ body });
    },
    onToggle: ({ body }) => heightObservers.get(body)?.schedule(),
    onItemChange,
    sectionButtons: [
      {
        type: "openStandalone",
        icon: "chrome://zotero/skin/16/universal/open-link.svg",
        l10nID: getLocaleID("itemPaneSection-openStandalone"),
        onClick: ({ event }) => {
          openWindowPanel();
        },
      },
      {
        type: "fullHeight",
        icon: `chrome://${config.addonRef}/content/icons/full-16.svg`,
        l10nID: getLocaleID("itemPaneSection-fullHeight"),
        onClick: ({ body }) => {
          const details = body.closest("item-details");
          onUpdateHeight({ body });
          // @ts-ignore 'item-details' is a custom element on Zotero
          details.scrollToPane(paneKey);
        },
      },
    ],
  });
  if (key) paneKey = key;
}

async function openWindowPanel() {
  if (addon.data.panel.windowPanel && !addon.data.panel.windowPanel.closed) {
    addon.data.panel.windowPanel.close();
  }
  const dialogData = {
    loadLock: Zotero.Promise.defer(),
  };
  const win: Window = ztoolkit.getGlobal("openDialog")(
    `chrome://${config.addonRef}/content/standalone.xhtml`,
    `${config.addonRef}-standalone`,
    `chrome,extrachrome,menubar,resizable=yes,scrollbars,status,dialog=no,${
      getPref("keepWindowTop") ? ",alwaysRaised=yes" : ""
    }`,
    dialogData,
  )!;
  await dialogData.loadLock.promise;
  buildExtraPanel(win.document);
  updateExtraPanel(win.document);
  addon.data.panel.windowPanel = win;
}

export function updateReaderTabPanels() {
  Object.values(addon.data.panel.activePanels).forEach((refresh: any) =>
    refresh(),
  );
  const win = addon.data.panel.windowPanel;
  if (win && isWindowAlive(win)) {
    updateExtraPanel(win.document);
  }
}

function onInit({ body, refresh }: { body: HTMLElement; refresh: () => void }) {
  const paneUID = Zotero.Utilities.randomString(8);
  body.dataset.paneUid = paneUID;
  addon.data.panel.activePanels[paneUID] = refresh;
  observePanelHeight(body);
}

function buildExtraPanel(doc: Document) {
  doc.querySelector("#add-source")?.addEventListener("click", () => {
    const extraServices = getPref("extraEngines");
    const allServices = services.getAllServices();
    setPref(
      "extraEngines",
      extraServices
        ? `${extraServices},${allServices[0].id}`
        : allServices[0].id,
    );
    openWindowPanel();
  });
  const pinButton = doc.querySelector("#pin-window") as XUL.Button;
  pinButton?.addEventListener("click", () => {
    setPref("keepWindowTop", !getPref("keepWindowTop"));
    openWindowPanel();
  });
  pinButton.dataset.l10nArgs = JSON.stringify({
    mode: getPref("keepWindowTop") ? "pinned" : "unpinned",
  });

  const extraEngines = (getPref("extraEngines") as string)
    .split(",")
    .filter((thisServiceId) => services.getServiceById(thisServiceId));
  if (!extraEngines.length) {
    return;
  }
  ztoolkit.UI.appendElement(
    {
      tag: "vbox",
      styles: {
        flexShrink: "1",
        flexGrow: "1",
      },
      children: extraEngines.map((serviceId, idx) => {
        return {
          tag: "vbox",
          styles: {
            flexShrink: "1",
            flexGrow: "1",
          },
          children: [
            {
              tag: "hbox",
              id: `${serviceId}-${idx}`,
              attributes: {
                align: "center",
              },
              classList: [serviceId],
              children: [
                {
                  tag: "menulist",
                  attributes: {
                    value: serviceId,
                    native: "true",
                  },
                  listeners: [
                    {
                      type: "command",
                      listener: (ev: Event) => {
                        const menulist = ev.currentTarget as XUL.MenuList;
                        const newService = menulist.value;
                        const [serviceId, idx] =
                          menulist.parentElement?.id.split("-") || [];
                        const extraServices = (
                          getPref("extraEngines") as string
                        ).split(",");
                        if (extraServices[Number(idx)] === serviceId) {
                          // If the idx and service matches
                          extraServices[Number(idx)] = newService;
                          menulist.parentElement!.id = `${newService}-${idx}`;
                          menulist.parentElement!.className = newService;
                          setPref("extraEngines", extraServices.join(","));
                        } else {
                          // Otherwise reload window
                          openWindowPanel();
                        }
                      },
                    },
                  ],
                  children: [
                    {
                      tag: "menupopup",
                      children: services
                        .getAllServicesWithType("sentence")
                        .map((s) => ({
                          tag: "menuitem",
                          attributes: {
                            label: services.getServiceNameByID(s.id),
                            value: s.id,
                          },
                        })),
                    },
                  ],
                },
                {
                  tag: "button",
                  namespace: "xul",
                  attributes: {
                    "data-l10n-id": getLocaleID("remove-source"),
                  },
                  listeners: [
                    {
                      type: "click",
                      listener: (ev) => {
                        const [serviceId, idx] =
                          (ev.target as XUL.Button).parentElement?.id.split(
                            "-",
                          ) || [];
                        const extraServices = (
                          getPref("extraEngines") as string
                        ).split(",");
                        // If the idx and service matches
                        if (extraServices[Number(idx)] === serviceId) {
                          extraServices.splice(Number(idx), 1);
                          setPref("extraEngines", extraServices.join(","));
                        }
                        openWindowPanel();
                      },
                    },
                  ],
                },
              ],
            },
            {
              tag: "editable-text",
              namespace: "xul",
              attributes: {
                multiline: "true",
              },
              styles: {
                fontSize: `${getPref("fontSize")}px`,
                lineHeight: getPref("lineHeight") as string,
              },
            },
          ],
        };
      }),
    },
    doc.querySelector("#extra-container")!,
  );
}

function onItemChange({
  tabType,
  item,
  body,
  setEnabled,
}: {
  tabType: string;
  item: Zotero.Item;
  body: HTMLElement;
  setEnabled: (enabled: boolean) => void;
}) {
  if (tabType !== "reader") {
    setEnabled(false);
  }
  body.dataset.itemID = String(item?.id);
  return true;
}

function updateExtraPanel(container: HTMLElement | Document) {
  const lastTask = getLastTranslateTask();
  const panel = container.querySelector(
    `${elementPrefix}-panel`,
  ) as TranslatorPanel;
  if (panel) {
    panel.item = Zotero.Items.get(lastTask?.itemId || -1);
    panel.render();
  }

  const extraTasks = lastTask?.extraTasks;
  if (extraTasks?.length === 0) {
    return;
  }
  extraTasks?.forEach((task) => {
    Array.from(
      container.querySelectorAll(`.${task.service}+editable-text`),
    ).forEach((elem) => ((elem as HTMLTextAreaElement).value = task.result));
  });
}

function onDestroy(options: any) {
  const { body } = options;
  heightObservers.get(body)?.destroy();
  heightObservers.delete(body);
  const paneUID = body.dataset.paneUid;
  delete addon.data.panel.activePanels[paneUID];
}

function observePanelHeight(body: HTMLElement) {
  if (heightObservers.has(body)) return;
  const viewport = body.closest<HTMLElement>("#zotero-view-item");
  const section = body.closest<HTMLElement>("collapsible-section");
  const head = section?.querySelector<HTMLElement>(":scope > .head");
  const win = body.ownerDocument.defaultView as
    | (Window & typeof globalThis)
    | null;
  if (!viewport || !head || !win) return;

  let frame: number | null = null;
  const schedule = () => {
    if (frame !== null) return;
    frame = win.requestAnimationFrame(() => {
      frame = null;
      onUpdateHeight({ body });
    });
  };
  // Watch inputs, not the body whose height we write. This also catches a
  // previously hidden reader/sidebar becoming visible and header wrapping.
  const observer = new win.ResizeObserver(schedule);
  observer.observe(viewport);
  observer.observe(head);
  heightObservers.set(body, {
    schedule,
    destroy: () => {
      observer.disconnect();
      if (frame !== null) win.cancelAnimationFrame(frame);
    },
  });
  schedule();
}

function onUpdateHeight({ body }: { body: HTMLElement }) {
  // ItemDetails puts its sections directly inside this scroll viewport. A
  // descendant query on item-details can instead find a nested plugin pane.
  const viewport = body.closest<HTMLElement>("#zotero-view-item");
  const section = body.closest<HTMLElement>("collapsible-section");
  const head = section?.querySelector<HTMLElement>(":scope > .head");
  const panel = body.querySelector<HTMLElement>(`${elementPrefix}-panel`);
  const win = body.ownerDocument.defaultView;
  if (!viewport || !section || !head || !panel || !win || !body.isConnected)
    return;
  if (
    !section.hasAttribute("open") ||
    !viewport.clientHeight ||
    !head.clientHeight
  )
    return;

  const viewportStyle = win.getComputedStyle(viewport);
  const sectionStyle = win.getComputedStyle(section);
  const bodyStyle = win.getComputedStyle(body);
  if (!viewportStyle || !sectionStyle || !bodyStyle) return;
  const pixels = (value: string) => parseFloat(value) || 0;
  const verticalSpace = (style: CSSStyleDeclaration) =>
    pixels(style.paddingTop) +
    pixels(style.paddingBottom) +
    pixels(style.borderTopWidth) +
    pixels(style.borderBottomWidth);
  const height = Math.floor(
    viewport.clientHeight -
      pixels(viewportStyle.paddingTop) -
      pixels(viewportStyle.paddingBottom) -
      head.getBoundingClientRect().height -
      verticalSpace(sectionStyle) -
      pixels(sectionStyle.rowGap) -
      verticalSpace(bodyStyle) -
      pixels(bodyStyle.marginTop) -
      pixels(bodyStyle.marginBottom),
  );
  // Hidden initialization must not replace the last usable viewport size.
  if (height <= 0) return;
  const heightKey = `--${config.addonRef}-reader-height`;
  const value = `${height}px`;
  if (panel.style.getPropertyValue(heightKey) !== value) {
    panel.style.setProperty(heightKey, value);
  }
}
