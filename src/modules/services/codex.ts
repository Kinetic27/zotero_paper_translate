import type { TranslateService } from "./base";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import type { CodexModel } from "../codexHttp";
import {
  loginCodex,
  cancelCodexLogin,
  logoutCodex,
  getCodexStatus,
  getCodexModelCatalog,
  getCodexAuthState,
  subscribeCodexAuthState,
  type CodexAuthState,
  translateWithCodex,
} from "../codex";

function bindModelSelectors(window: Window) {
  const document = window.document;
  const model = document.querySelector<HTMLSelectElement>(
    '[data-setting-key="codex.model"]',
  )!;
  const effort = document.querySelector<HTMLSelectElement>(
    '[data-setting-key="codex.reasoningEffort"]',
  )!;
  const status = document.getElementById("codex-model-status")!;
  let models: CodexModel[] | undefined;
  let pending: AbortController | undefined;
  let loading = false;
  let closed = false;
  let auth: CodexAuthState | "error" | undefined;

  function showAuth(state: typeof auth) {
    auth = state;
    const visible: Record<string, boolean> = {
      "codex-login": state === "signed-out",
      "codex-logout": state === "signed-in" || state === "error",
      "codex-status": state === "signed-in",
      "codex-cancel-login": state === "signing-in",
    };
    for (const [id, show] of Object.entries(visible)) {
      const button = document.getElementById(id) as HTMLElement;
      button.hidden = !show;
      button.style.display = show ? "" : "none";
      const container = button.parentElement!;
      container.hidden = !show;
      container.style.display = show ? "" : "none";
    }
  }

  function fill(
    select: HTMLSelectElement,
    options: { value: string; label: string }[],
    value: string,
  ) {
    if (value && !options.some((option) => option.value === value)) {
      options.push({
        value,
        label: getString("service-codex-unavailable", { args: { value } }),
      });
    }
    select.replaceChildren(
      ...options.map((entry) => {
        const option = document.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "option",
        );
        option.setAttribute("value", entry.value);
        option.textContent = entry.label;
        return option;
      }),
    );
    select.value = value;
    const updated = document.createEvent("Event");
    updated.initEvent("optionschange", false, false);
    select.dispatchEvent(updated);
  }

  function selectedModel() {
    return model.value
      ? models?.find((entry) => entry.id === model.value)
      : models?.[0];
  }

  function fillEfforts(resetUnsupported = false) {
    const selected = selectedModel();
    const supported = selected?.reasoningEfforts || [];
    let value = effort.value;
    if (resetUnsupported && !supported.includes(value)) value = "";
    const defaultLabel =
      getString("service-codex-default-effort") +
      (selected?.defaultReasoningEffort
        ? ` (${selected.defaultReasoningEffort})`
        : "");
    fill(
      effort,
      [
        { value: "", label: defaultLabel },
        ...supported.map((value) => ({ value, label: value })),
      ],
      value,
    );
    effort.disabled =
      auth !== "signed-in" || loading || (!supported.length && !value);
  }

  model.addEventListener("change", () => fillEfforts(true));
  window.addEventListener(
    "unload",
    () => {
      closed = true;
      pending?.abort();
      unsubscribe();
    },
    { once: true },
  );

  const controls = {
    async refresh() {
      if (closed) return;
      pending?.abort();
      const active = new AbortController();
      pending = active;
      loading = true;
      model.disabled = effort.disabled = true;
      status.textContent = getString("service-codex-loading");
      try {
        const state = await getCodexAuthState(active.signal);
        if (closed || active.signal.aborted) return;
        showAuth(state);
        const result =
          state === "signed-in"
            ? await getCodexModelCatalog(active.signal)
            : [];
        if (closed || active.signal.aborted) return;
        models = result;
        fill(
          model,
          [
            { value: "", label: getString("service-codex-automatic") },
            ...models.map((entry) => ({
              value: entry.id,
              label:
                entry.name === entry.id
                  ? entry.id
                  : `${entry.name} (${entry.id})`,
            })),
          ],
          model.value,
        );
        status.textContent =
          state === "signing-in"
            ? getString("service-codex-signing-in")
            : models.length
              ? getString("service-codex-loaded", {
                  args: { count: models.length },
                })
              : getString("service-codex-signin-required");
      } catch (error) {
        if (closed || active.signal.aborted) return;
        if (auth === undefined) showAuth("error");
        models = undefined;
        status.textContent =
          error instanceof Error
            ? error.message
            : getString("service-codex-selection-invalid");
      } finally {
        if (!closed && pending === active) {
          loading = false;
          model.disabled = auth !== "signed-in";
          fillEfforts();
          window.sizeToContent();
        }
      }
    },
    valid(modelId: string, reasoningEffort: string) {
      if (loading || !models) return false;
      const selected = modelId
        ? models.find((entry) => entry.id === modelId)
        : models[0];
      return (
        (!modelId || !!selected) &&
        (!reasoningEffort ||
          !!selected?.reasoningEfforts.includes(reasoningEffort))
      );
    },
  };
  const unsubscribe = subscribeCodexAuthState(() => {
    void controls.refresh();
  });
  showAuth(undefined);
  return controls;
}

function action(run: () => Promise<string>): (event: Event) => void {
  return (event) => {
    const button = event.currentTarget as HTMLButtonElement;
    const owner = button.ownerDocument.defaultView!;
    button.disabled = true;
    void run()
      .then(
        (message) => {
          if (owner.closed) return;
          Zotero.alert(
            Zotero.getMainWindow(),
            getString("service-codex"),
            message,
          );
        },
        (error) => {
          if (owner.closed) return;
          Zotero.alert(
            Zotero.getMainWindow(),
            getString("service-codex"),
            error instanceof Error
              ? error.message
              : "ChatGPT operation failed. Check sign-in and the network connection.",
          );
        },
      )
      .finally(() => {
        if (!owner.closed && button.isConnected) button.disabled = false;
      });
  };
}

export const Codex: TranslateService = {
  id: "codex",
  type: "sentence",
  requireExternalConfig: true,
  helpUrl:
    "https://github.com/Kinetic27/zotero_paper_translate#설치-없이-chatgpt-로그인으로-번역하기",
  async translate(data) {
    data.result = await translateWithCodex(
      data.raw,
      data.langfrom,
      data.langto,
      data.signal,
    );
  },
  config(settings) {
    let selectors: ReturnType<typeof bindModelSelectors> | undefined;
    const model = String(getPref("codex.model") || "");
    const effort = String(getPref("codex.reasoningEffort") || "");
    const initialOptions = (value: string, label: string) => [
      { value: "", label },
      ...(value
        ? [
            {
              value,
              label: getString("service-codex-unavailable", {
                args: { value },
              }),
            },
          ]
        : []),
    ];
    settings
      .setWidth(640)
      .addDynamicSelectSetting({
        nameKey: "service-codex-model",
        prefKey: "codex.model",
        options: initialOptions(model, getString("service-codex-automatic")),
      })
      .addDynamicSelectSetting({
        nameKey: "service-codex-effort",
        prefKey: "codex.reasoningEffort",
        options: initialOptions(
          effort,
          getString("service-codex-default-effort"),
        ),
      })
      .addStaticRow("", {
        tag: "description",
        id: "codex-model-status",
        properties: { textContent: getString("service-codex-loading") },
      })
      .onOpen((window) => {
        selectors = bindModelSelectors(window);
        void selectors.refresh();
        window.sizeToContent();
      })
      .onSave((data) => {
        return selectors?.valid(
          String(data["codex.model"] || ""),
          String(data["codex.reasoningEffort"] || ""),
        )
          ? true
          : getString("service-codex-selection-invalid");
      })
      .addStaticRow("", {
        tag: "description",
        properties: { textContent: getString("service-codex-hint") },
      })
      .addButton(getString("service-codex-login"), "codex-login", {
        noClose: true,
        callback: action(loginCodex),
      })
      .addButton(getString("service-codex-status"), "codex-status", {
        noClose: true,
        callback: action(async () => {
          const message = await getCodexStatus();
          await selectors?.refresh();
          return message;
        }),
      })
      .addButton(
        getString("service-codex-cancel-login"),
        "codex-cancel-login",
        { noClose: true, callback: action(cancelCodexLogin) },
      )
      .addButton(getString("service-codex-logout"), "codex-logout", {
        noClose: true,
        callback: action(async () => {
          const message = await logoutCodex();
          await selectors?.refresh();
          return message;
        }),
      });
  },
};
