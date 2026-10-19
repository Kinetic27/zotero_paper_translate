import { getPref, setPref } from "../../utils/prefs";
import { getString } from "../../utils/locale";

export async function renameServicesDialog() {
  const dialog = new ztoolkit.Dialog(4, 1);
  const dialogData: { [key: string | number]: any } = {
    chatgpt: getPref("renameServices.chatgpt") || "",
    claude: getPref("renameServices.claude") || "",
    gemini: getPref("renameServices.gemini") || "",
  };
  dialog
    .setDialogData(dialogData)
    .addCell(
      0,
      0,
      {
        tag: "div",
        namespace: "html",
        styles: {
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "15px 20px",
          alignItems: "center",
          padding: "20px",
        },
        children: [
          {
            tag: "label",
            namespace: "html",
            properties: {
              innerHTML: getString("service-renameServices-head"),
            },
            styles: {
              gridColumn: "1 / span 2",
              marginBottom: "5px",
            },
          },
          {
            tag: "label",
            namespace: "html",
            attributes: {
              for: "chatgpt",
            },
            properties: {
              innerHTML: getString("service-chatgpt"),
            },
          },
          {
            tag: "input",
            id: "chatgpt",
            attributes: {
              "data-bind": "chatgpt",
              "data-prop": "value",
              type: "string",
              placeholder: "Maximum 15 characters",
              maxlength: "15",
            },
          },
          {
            tag: "label",
            namespace: "html",
            attributes: {
              for: "claude",
            },
            properties: {
              innerHTML: getString("service-claude"),
            },
          },
          {
            tag: "input",
            id: "claude",
            attributes: {
              "data-bind": "claude",
              "data-prop": "value",
              type: "string",
              placeholder: "Maximum 15 characters",
              maxlength: "15",
            },
          },
          {
            tag: "label",
            namespace: "html",
            attributes: {
              for: "gemini",
            },
            properties: {
              innerHTML: getString("service-gemini"),
            },
          },
          {
            tag: "input",
            id: "gemini",
            attributes: {
              "data-bind": "gemini",
              "data-prop": "value",
              type: "string",
              placeholder: "Maximum 15 characters",
              maxlength: "15",
            },
          },
          {
            tag: "label",
            namespace: "html",
            properties: {
              innerHTML: getString("service-renameServices-hint"),
            },
            styles: {
              gridColumn: "1 / span 2",
              fontSize: "0.9rem",
            },
          },
        ],
      },
      false,
    )
    .addButton(getString("service-renameServices-close"), "close")
    .addButton(getString("service-renameServices-save"), "save")
    .open(getString("service-renameServices-title"));

  await dialogData.unloadLock?.promise;
  switch (dialogData._lastButtonId) {
    case "save":
      {
        setPref("renameServices.chatgpt", dialogData.chatgpt);
        setPref("renameServices.claude", dialogData.claude);
        setPref("renameServices.gemini", dialogData.gemini);
      }
      break;
    default:
      break;
  }
}
