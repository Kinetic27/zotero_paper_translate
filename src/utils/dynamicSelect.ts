const HTML = "http://www.w3.org/1999/xhtml";
const XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

type Choice = { value: string; label: string };

/** A live settings picker, outside the toolkit's snapshot-based select renderer. */
export function mountDynamicSelect(input: HTMLInputElement, choices: Choice[]) {
  const document = input.ownerDocument;
  const window = document.defaultView! as Window & typeof globalThis;
  const value = input.value;
  const label = input.previousElementSibling;
  const select = document.createElementNS(HTML, "select") as HTMLSelectElement;
  select.id = input.id;
  select.hidden = true;
  select.style.display = "none";
  select.setAttribute(
    "data-setting-key",
    input.getAttribute("data-setting-key")!,
  );
  select.setAttribute("data-setting-type", "string");
  for (const choice of choices) {
    const option = document.createElementNS(HTML, "option");
    option.setAttribute("value", choice.value);
    option.textContent = choice.label;
    select.appendChild(option);
  }
  select.value = value;

  const button = document.createElementNS(HTML, "button") as HTMLButtonElement;
  button.id = `${select.id}-picker`;
  button.type = "button";
  button.setAttribute(
    "data-setting-picker",
    select.getAttribute("data-setting-key")!,
  );
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  Object.assign(button.style, {
    width: "100%",
    minWidth: "0",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "6px 10px",
    textAlign: "start",
    whiteSpace: "nowrap",
  });
  const text = document.createElementNS(HTML, "span");
  Object.assign(text.style, {
    flex: "1",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });
  const arrow = document.createElementNS(HTML, "span");
  arrow.setAttribute("aria-hidden", "true");
  Object.assign(arrow.style, {
    borderInlineStart: "4px solid transparent",
    borderInlineEnd: "4px solid transparent",
    borderTop: "4px solid currentColor",
    flexShrink: "0",
  });
  button.append(text, arrow);
  if (label?.getAttribute("for") === input.id)
    label.setAttribute("for", button.id);
  input.replaceWith(select, button);

  const popup = document.createElementNS(
    XUL,
    "menupopup",
  ) as XULMenuPopupElement;
  popup.id = `${button.id}-popup`;
  popup.setAttribute(
    "data-setting-popup",
    select.getAttribute("data-setting-key")!,
  );
  button.setAttribute("aria-controls", popup.id);
  document.body.appendChild(popup);

  function sync() {
    button.disabled = select.disabled;
    const selected = Array.from(select.options).find(
      (option) => option.getAttribute("value") === select.value,
    );
    text.textContent = selected?.textContent || "";
    button.setAttribute(
      "aria-label",
      `${label?.textContent || ""}: ${text.textContent}`,
    );
    if (button.disabled && popup.state !== "closed") popup.hidePopup();
  }

  function fillPopup() {
    const items = Array.from(select.options, (option) => {
      const item = document.createElementNS(XUL, "menuitem");
      item.setAttribute("value", option.getAttribute("value") || "");
      item.setAttribute("label", option.textContent || "");
      item.setAttribute("type", "radio");
      item.setAttribute("name", button.id);
      item.setAttribute(
        "checked",
        String(option.getAttribute("value") === select.value),
      );
      if (option.hasAttribute("disabled"))
        item.setAttribute("disabled", "true");
      // about:blank dialog documents do not supply the usual XUL label markup.
      const caption = document.createElementNS(XUL, "label");
      caption.classList.add("menu-text");
      caption.setAttribute("value", option.textContent || "");
      caption.setAttribute("crop", "end");
      item.appendChild(caption);
      const highlighted = document.createElementNS(XUL, "label");
      highlighted.classList.add("menu-highlightable-text");
      highlighted.textContent = option.textContent || "";
      highlighted.setAttribute("crop", "end");
      item.appendChild(highlighted);
      return item;
    });
    popup.replaceChildren(...items);
    popup.style.minWidth = `${button.getBoundingClientRect().width}px`;
  }

  function open() {
    if (select.disabled || popup.state === "open" || popup.state === "showing")
      return;
    fillPopup();
    popup.openPopup(button, "after_start", 0, 0, false, false);
  }
  button.addEventListener("click", open);
  button.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    open();
  });
  popup.addEventListener("popupshowing", () =>
    button.setAttribute("aria-expanded", "true"),
  );
  popup.addEventListener("popuphidden", () =>
    button.setAttribute("aria-expanded", "false"),
  );
  popup.addEventListener("command", (event) => {
    const target = event.target as Element;
    const item = target.closest("menuitem");
    if (!item || !popup.contains(item) || select.disabled) return;
    const selected = item.getAttribute("value") || "";
    if (
      !Array.from(select.options).some(
        (option) =>
          option.getAttribute("value") === selected &&
          !option.hasAttribute("disabled"),
      )
    )
      return;
    const changed = select.value !== selected;
    select.value = selected;
    sync();
    popup.hidePopup();
    if (changed) {
      const change = document.createEvent("Event");
      change.initEvent("change", true, false);
      select.dispatchEvent(change);
    }
    button.focus();
  });
  select.addEventListener("change", sync);
  select.addEventListener("optionschange", sync);
  const observer = new window.MutationObserver(sync);
  observer.observe(select, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true,
  });
  window.addEventListener("unload", () => observer.disconnect(), {
    once: true,
  });
  sync();
}
