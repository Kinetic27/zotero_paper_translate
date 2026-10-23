import { config, homepage } from "../../package.json";
import { LANG_CODE } from "../utils/config";
import { getString } from "../utils/locale";
import {
  getPref,
  setPref,
  registerPrefObserver,
  unregisterPrefObserver,
} from "../utils/prefs";
import {
  getServiceSecret,
  setServiceSecret,
  validateServiceSecret,
} from "../utils/secret";
import { createServiceSettingsDialog } from "../utils";
import { services } from "./services";
import {
  getReaderFontSize,
  setReaderFontSize,
  getReaderLineHeight,
  setReaderLineHeight,
} from "../utils/readerSettings";

export function registerPrefsWindow() {
  Zotero.PreferencePanes.register({
    pluginID: config.addonID,
    src: rootURI + "chrome/content/preferences.xhtml",
    label: getString("pref-title"),
    image: `chrome://${config.addonRef}/content/icons/favicon.png`,
    helpURL: homepage,
  });
}

export function registerPrefsScripts(window: Window) {
  addon.data.prefs.window = window;
  const doc = window.document;
  const typography = [
    ["fontSize", getReaderFontSize, setReaderFontSize],
    ["lineHeight", getReaderLineHeight, setReaderLineHeight],
  ] as const;
  const updateTypography = () => {
    for (const [id, get] of typography) {
      const input = doc.getElementById(makeId(id)) as HTMLInputElement | null;
      if (input) input.value = String(get());
    }
  };
  for (const [id, get, set] of typography) {
    const input = doc.getElementById(makeId(id)) as HTMLInputElement;
    input.value = String(get());
    input.addEventListener("change", () => {
      set(input.valueAsNumber);
      input.value = String(get());
    });
  }
  const typographyObservers = typography.map(([id]) =>
    registerPrefObserver(id, updateTypography),
  );
  window.addEventListener(
    "unload",
    () => {
      for (const observer of typographyObservers)
        unregisterPrefObserver(observer);
    },
    { once: true },
  );

  ztoolkit.UI.replaceElement(
    {
      tag: "menulist",
      id: makeId("sentenceServices"),
      attributes: {
        value: getPref("translateSource") as string,
        native: "true",
      },
      listeners: [
        {
          type: "command",
          listener: () => {
            const control = doc.getElementById(makeId("sentenceServices"))!;
            setPref("translateSource", control.getAttribute("value")!);
            updateSentenceSecret(true);
            addon.hooks.onReaderTabPanelRefresh();
          },
        },
      ],
      children: [
        {
          tag: "menupopup",
          children: services
            .getAllServicesWithType("sentence")
            .map((service) => ({
              tag: "menuitem",
              attributes: {
                label: services.getServiceNameByID(service.id),
                value: service.id,
              },
            })),
        },
      ],
    },
    doc.getElementById(makeId("sentenceServices-placeholder"))!,
  );

  for (const [id, preference] of [
    ["langfrom", "sourceLanguage"],
    ["langto", "targetLanguage"],
  ] as const) {
    ztoolkit.UI.replaceElement(
      {
        tag: "menulist",
        id: makeId(id),
        attributes: {
          value: getPref(preference) as string,
          native: "true",
        },
        listeners: [
          {
            type: "command",
            listener: () => {
              const control = doc.getElementById(makeId(id))!;
              setPref(preference, control.getAttribute("value")!);
              addon.hooks.onReaderTabPanelRefresh();
            },
          },
        ],
        styles: { maxWidth: "250px" },
        children: [
          {
            tag: "menupopup",
            children: LANG_CODE.map((language) => ({
              tag: "menuitem",
              attributes: { label: language.name, value: language.code },
            })),
          },
        ],
      },
      doc.getElementById(makeId(`${id}-placeholder`))!,
    );
  }

  const secret = doc.getElementById(
    makeId("sentenceServicesSecret"),
  ) as HTMLInputElement;
  secret.addEventListener("blur", () => {
    const serviceId = getPref("translateSource") as string;
    const value = secret.value.trim();
    secret.value = value;
    if (value !== getServiceSecret(serviceId))
      setServiceSecret(serviceId, value);
  });
  updateSentenceSecret(false);
}

function updateSentenceSecret(showValidationError: boolean) {
  const window = addon.data.prefs.window;
  if (!window) return;
  const doc = window.document;
  const serviceId = getPref("translateSource") as string;
  const result = validateServiceSecret(serviceId, (validation) => {
    if (showValidationError && !validation.status) {
      window.alert(
        `You see this because the translation service ${serviceId} requires SECRET, which is NOT correctly set.\n\nDetails:\n${validation.info}`,
      );
    }
  });
  (
    doc.getElementById(makeId("sentenceServicesSecret")) as HTMLInputElement
  ).value = result.secret;
  const status = doc.querySelector<XUL.Button>(
    `#${makeId("sentenceServicesStatus")}`,
  )!;
  const service = addon.data.translate.services.getServiceById(serviceId)!;
  status.hidden = !service.config;
  status.onclick = null;
  if (service.config) {
    status.label = getString("service-dialog-config");
    status.onclick = () => {
      void createServiceSettingsDialog(service);
    };
  }
}

function makeId(type: string) {
  return `${config.addonRef}-${type}`;
}
