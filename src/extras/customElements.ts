import { TranslatorPanel } from "../elements/panel";
import { MathTextboxElement } from "../elements/mathTextbox";
import { config } from "../../package.json";
import { elementPrefix } from "../utils/elementIdentity";
import { ReadingPane } from "../elements/readingPane";

const elements = {
  [`${elementPrefix}-reading-pane`]: ReadingPane,
  [`${elementPrefix}-panel`]: TranslatorPanel,
  [`${elementPrefix}-math-textbox`]: MathTextboxElement,
} as unknown as Record<string, CustomElementConstructor>;

for (const [key, constructor] of Object.entries(elements)) {
  if (!customElements.get(key)) {
    customElements.define(key, constructor);
  }
}
