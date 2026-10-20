import type { ReadingBlock } from "../modules/pdfReadingTypes";
import { getPref } from "../utils/prefs";

/** DOM text only: provider output and PDF strings are never parsed as markup. */
export class ReadingPane extends HTMLElement {
  private blocks: ReadingBlock[] = [];
  get value(): string {
    return this.blocks.map((block) => block.text).join("\n\n");
  }
  set value(text: string) {
    this.setBlocks(
      text ? [{ kind: "body", text, translate: true, origins: [] }] : [],
    );
  }
  setBlocks(blocks: ReadingBlock[]) {
    this.blocks = this.classList.contains("page-result")
      ? blocks
          .filter(
            (block) =>
              block.kind !== "running" &&
              (block.kind !== "figure" || block.figureMarker),
          )
          .map((block) =>
            block.kind === "figure"
              ? {
                  ...block,
                  text: block.figureLabel || "Figure — see original PDF",
                }
              : block,
          )
      : blocks;
    const doc = this.ownerDocument;
    const fragment = doc.createDocumentFragment();
    for (const block of this.blocks) {
      const element = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        block.kind === "title"
          ? "h2"
          : block.kind === "heading" ||
              (block.kind === "abstract" &&
                /^(?:Abstract|초록|要旨|摘要|Résumé|Zusammenfassung|Resumen)[.:]?$/i.test(
                  block.text,
                ))
            ? "h3"
            : block.kind === "equation"
              ? "pre"
              : "p",
      );
      element.className = `reading-${block.kind}`;
      if (block.media) {
        const image = doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "img",
        ) as HTMLImageElement;
        image.className = "reading-original-media";
        image.src = block.media.data;
        image.alt = "";
        image.title =
          "Original PDF rendering; Copy exports extracted text, not LaTeX.";
        image.style.width = `${block.media.width}px`;
        image.style.maxWidth = "100%";
        image.style.height = "auto";
        const fallback = doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "span",
        );
        fallback.className = "reading-media-text";
        if (block.equationNumber) {
          fallback.append(
            doc.createTextNode(
              block.text.slice(0, -block.equationNumber.length),
            ),
          );
          const number = doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            "span",
          );
          number.className = "equation-number";
          number.textContent = block.equationNumber;
          fallback.append(number);
        } else fallback.textContent = block.text;
        element.append(image, fallback);
      } else if (block.inlineMath?.length) {
        let end = 0;
        for (const math of block.inlineMath) {
          element.append(doc.createTextNode(block.text.slice(end, math.start)));
          const text = block.text.slice(math.start, math.end);
          if (math.media) {
            const wrapper = doc.createElementNS(
              "http://www.w3.org/1999/xhtml",
              "span",
            );
            wrapper.className = "reading-inline-math";
            wrapper.dataset.origins = JSON.stringify([
              {
                page: math.page,
                start: math.start,
                end: math.end,
                rects: [math.rect],
              },
            ]);
            wrapper.title = `Original math on PDF page ${math.page}; Copy exports extracted text, not LaTeX.`;
            const image = doc.createElementNS(
              "http://www.w3.org/1999/xhtml",
              "img",
            ) as HTMLImageElement;
            image.className = "reading-original-media reading-inline-media";
            image.src = math.media.data;
            image.alt = "";
            image.draggable = false;
            image.style.width = `${math.media.width}px`;
            image.style.maxWidth = "100%";
            image.style.height = "auto";
            const fallback = doc.createElementNS(
              "http://www.w3.org/1999/xhtml",
              "span",
            );
            fallback.className = "reading-media-text";
            fallback.textContent = text;
            wrapper.append(image, fallback);
            element.append(wrapper);
          } else element.append(doc.createTextNode(text));
          end = math.end;
        }
        element.append(doc.createTextNode(block.text.slice(end)));
      } else if (block.kind === "equation" && block.equationNumber) {
        element.classList.add("numbered-equation");
        const math = doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "span",
        );
        math.className = "equation-expression";
        math.textContent = block.text
          .slice(0, -block.equationNumber.length)
          .trimEnd();
        const number = doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "span",
        );
        number.className = "equation-number";
        number.textContent = block.equationNumber;
        element.append(math, doc.createTextNode(" "), number);
      } else if (block.kind === "authors" || block.kind === "affiliation") {
        // Keep literal text/copy intact while visually attaching numeric/dagger
        // author markers rather than placing each superscript on its own line.
        for (const piece of block.text.split(/([\d†‡∗]+(?:,[\d†‡∗]+)*)/)) {
          if (/^[\d†‡∗]+(?:,[\d†‡∗]+)*$/.test(piece)) {
            const marker = doc.createElementNS(
              "http://www.w3.org/1999/xhtml",
              "sup",
            );
            marker.textContent = piece;
            element.append(marker);
          } else element.append(doc.createTextNode(piece));
        }
      } else element.textContent = block.text;
      if (block.origins.length) {
        if (this.classList.contains("page-result")) {
          element.tabIndex = 0;
          element.setAttribute("role", "link");
          element.setAttribute(
            "aria-label",
            `Show PDF source: ${block.text.slice(0, 100)}`,
          );
        }
        const pages = [...new Set(block.origins.map((origin) => origin.page))];
        element.dataset.pages = pages.join(",");
        element.dataset.origins = JSON.stringify(block.origins);
        element.title = `Source page${pages.length === 1 ? "" : "s"} ${pages.join(", ")}${block.continued ? " (continued paragraph)" : ""}`;
      }
      if (block.continued) {
        const label = doc.createElementNS(
          "http://www.w3.org/1999/xhtml",
          "small",
        );
        label.className = "reading-origin";
        label.textContent = "Continued · source pages ";
        for (const page of [
          ...new Set(block.origins.map((origin) => origin.page)),
        ]) {
          const link = doc.createElementNS(
            "http://www.w3.org/1999/xhtml",
            this.classList.contains("page-result") ? "button" : "span",
          );
          link.textContent = String(page);
          link.setAttribute("type", "button");
          link.dataset.origins = JSON.stringify(
            block.origins.filter((origin) => origin.page === page),
          );
          link.title = `Show source fragment on PDF page ${page}`;
          label.append(link);
        }
        fragment.append(label);
      }
      fragment.append(element);
    }
    const incomplete = this.blocks
      .filter((block) => block.incomplete)
      .map((block) => block.incomplete!);
    if (incomplete.length) {
      const message =
        incomplete.find((text) => text.includes("limit")) || incomplete[0];
      const warning = doc.createElementNS(
        "http://www.w3.org/1999/xhtml",
        "small",
      );
      warning.className = "reading-origin reading-incomplete";
      const korean =
        String(getPref("targetLanguage")).split(/[-_]/)[0] === "ko";
      warning.textContent = !korean
        ? message
        : message.includes("limit")
          ? "문단 연결 한도(3쪽·1,200자)를 넘었습니다. 현재 쪽의 원문은 모두 유지했습니다. 나머지는 PDF 앞뒤 쪽에서 확인하세요."
          : message.includes("outside")
            ? "문단이 확인한 쪽 범위 밖으로 이어질 수 있습니다. 확인된 내용은 표시했으며, 나머지는 PDF 앞뒤 쪽에서 확인하세요."
            : "이어지는 문단을 확실히 찾지 못했습니다. 현재 쪽의 내용은 모두 유지했습니다. PDF 앞뒤 쪽을 확인하세요.";
      fragment.append(warning);
    }
    this.replaceChildren(fragment);
  }
}
