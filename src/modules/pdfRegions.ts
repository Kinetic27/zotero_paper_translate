import type {
  GeometryContent,
  GeometryItem,
  ReadingPage,
  ReadingBlock,
} from "./pdfReadingTypes";
import { graphicBounds, figureRegions } from "./pdfFigures";
import { reconstructPage } from "./pdfLayout";
type Rect = number[];
interface Operators {
  fnArray: number[];
  argsArray: unknown[][];
}
interface Region {
  rect: Rect;
  kind: "table" | "figure" | "algorithm";
  caption?: GeometryItem;
}
/** Caption-anchored drawing regions, before text columns/paragraphs can fuse cells. */
export function reconstructStructuredPage(
  number: number,
  content: GeometryContent,
  operators: Operators,
  ops: Record<string, number>,
  width: number,
  height: number,
): ReadingPage {
  const items = content.items.filter(
    (i): i is GeometryItem => "str" in i && !!i.str.trim(),
  );
  const boxes = graphicBounds(operators, ops, width, height);
  const regions: Region[] = figureRegions(
    content,
    operators,
    ops,
    width,
    height,
  ).map((rect) => ({ rect, kind: "figure" }));
  const captions = items.flatMap((item) => {
    if (
      /^(?:Algorithm|Table|Fig(?:ure)?\.?)\s*(?:[A-Z]\.\d+|\d+)(?:\.\d+)*\s*[.:]?/i.test(
        item.str.trim(),
      )
    )
      return [item];
    if (!/^(?:Algorithm|Table|Fig(?:ure)?\.?)$/i.test(item.str.trim()))
      return [];
    const number = items.find(
      (next) =>
        /^(?:[A-Z]\.\d+|\d+)(?:\.\d+)*\s*[.:]$/.test(next.str.trim()) &&
        Math.abs(next.transform[5] - item.transform[5]) < 2 &&
        next.transform[4] >= item.transform[4] + item.width - 1 &&
        next.transform[4] - item.transform[4] - item.width < item.height * 3,
    );
    return number ? [{ ...item, str: `${item.str} ${number.str}` }] : [];
  });
  const rules = boxes.filter(
    (b) => b[2] - b[0] > width * 0.16 && b[3] - b[1] < 2,
  );
  // PDF.js can merge abbreviated column labels into one sentence-like item,
  // so a single-line table header can look like spanning prose. Accept a
  // compact top ruled band of separated label groups when the next aligned
  // band is numerically populated; merged labels may span several columns.
  const ruledHeader = (
    upper: Rect,
    lower: Rect,
    row: GeometryItem[],
    size: number,
  ) => {
    const bandTop = upper[1];
    const bandBottom = lower[3];
    if (bandTop - bandBottom > size * 2.2) return false;
    if (
      rules.some(
        (box) =>
          box[3] > upper[3] &&
          box[3] - upper[3] < size * 4 &&
          Math.abs(box[0] - upper[0]) < size * 3 &&
          Math.abs(box[2] - upper[2]) < size * 3,
      )
    )
      return false;
    const band = items.filter(
      (item) =>
        item.transform[4] >= upper[0] - 2 &&
        item.transform[4] < upper[2] + 2 &&
        item.transform[5] > bandBottom &&
        item.transform[5] < bandTop,
    );
    if (band.length !== row.length || band.some((item) => !row.includes(item)))
      return false;
    const labels = [...row].sort(
      (left, right) => left.transform[4] - right.transform[4],
    );
    if (
      labels.length < 2 ||
      labels.some((label) => label.width >= (upper[2] - upper[0]) * 0.5) ||
      !labels
        .slice(1)
        .every(
          (label, index) =>
            label.transform[4] -
              labels[index].transform[4] -
              labels[index].width >
            size,
        )
    )
      return false;
    const next = rules
      .filter(
        (box) =>
          box[3] < bandBottom &&
          Math.abs(box[0] - upper[0]) < size * 3 &&
          Math.abs(box[2] - upper[2]) < size * 3,
      )
      .sort((left, right) => right[3] - left[3])[0];
    if (!next || bandBottom - next[3] > size * 8) return false;
    const columns = new Map<number, Set<number>>();
    for (const item of items) {
      if (
        !/^\d+(?:[.,]\d+)?$/.test(item.str.trim()) ||
        item.transform[4] < next[0] - 2 ||
        item.transform[4] >= next[2] + 2 ||
        item.transform[5] <= next[3] ||
        item.transform[5] >= bandBottom
      )
        continue;
      const column = Math.round(item.transform[4] / size);
      const rows = columns.get(column) ?? new Set<number>();
      rows.add(Math.round(item.transform[5] / 2));
      columns.set(column, rows);
    }
    return (
      Array.from(columns.values()).filter((rows) => rows.size >= 2).length >= 2
    );
  };
  // Equal-width rules alone do not connect tables: captions and prose can
  // separate two grids in the same column. Tall grids need continuous rows,
  // rather than an arbitrary maximum distance between their outer rules.
  const tableInterval = (a: Rect, b: Rect, size: number) => {
    const bottom = Math.min(a[1], b[1]);
    const top = Math.max(a[3], b[3]);
    if (
      captions.some(
        (caption) =>
          caption.transform[5] > bottom &&
          caption.transform[5] < top &&
          caption.transform[4] < a[2] &&
          caption.transform[4] + Math.max(caption.width, size * 4) > a[0],
      )
    )
      return false;
    const inside = items.filter(
      (item) =>
        item.transform[4] >= a[0] - 2 &&
        item.transform[4] < a[2] + 2 &&
        item.transform[5] > bottom &&
        item.transform[5] < top,
    );
    const intervalWidth = a[2] - a[0];
    if (
      inside.some((item) => {
        const row = inside.filter(
          (other) =>
            Math.abs(other.transform[5] - item.transform[5]) < size * 0.35,
        );
        const cells = row.filter((other) => other.width < intervalWidth * 0.5);
        const orderedCells = [...cells].sort(
          (left, right) => left.transform[4] - right.transform[4],
        );
        const repeatedColumns =
          orderedCells.length >= 2 &&
          orderedCells
            .slice(1)
            .every(
              (cell, index) =>
                cell.transform[4] -
                  orderedCells[index].transform[4] -
                  orderedCells[index].width >
                size,
            ) &&
          orderedCells.every((cell) => {
            const support = inside.filter(
              (other) =>
                Math.abs(other.transform[5] - cell.transform[5]) > size * 0.5 &&
                Math.abs(other.transform[4] - cell.transform[4]) < size &&
                Math.abs(other.width - cell.width) < size * 2,
            );
            return (
              new Set(
                support.map((other) => Math.round(other.transform[5] / size)),
              ).size >= 2
            );
          });
        const sentence =
          /[.!?]["”')\]]?\s*$/.test(row.map((other) => other.str).join(" ")) &&
          row.reduce(
            (count, other) => count + other.str.trim().split(/\s+/).length,
            0,
          ) >= 5;
        const span =
          Math.max(...row.map((other) => other.transform[4] + other.width)) -
          Math.min(...row.map((other) => other.transform[4]));
        return (
          (item.str.length > 100 && item.width > intervalWidth * 0.7) ||
          (sentence &&
            span > intervalWidth * 0.7 &&
            cells.length < 3 &&
            !repeatedColumns &&
            !ruledHeader(a, b, row, size))
        );
      })
    )
      return false;
    if (top - bottom <= size * 16) return true;
    const baselines = [
      ...new Set(inside.map((item) => Math.round(item.transform[5] / 2) * 2)),
    ].sort((x, y) => x - y);
    const edges = [bottom, ...baselines, top];
    const cellRows = baselines.filter(
      (baseline) =>
        inside.filter(
          (item) =>
            Math.abs(item.transform[5] - baseline) <= 2 &&
            item.width < (a[2] - a[0]) * 0.5,
        ).length >= 3,
    );
    return (
      baselines.length >= 4 &&
      cellRows.length >= baselines.length * 0.6 &&
      edges.slice(1).every((y, index) => y - edges[index] < size * 4)
    );
  };
  // Resolve captions in visual order, not PDF object order. A lower caption
  // must not reclaim an upper table whose own caption already owns its grid.
  for (const caption of [...captions].sort(
    (a, b) =>
      b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4],
  )) {
    const size = caption.height || 10,
      x = caption.transform[4],
      y = caption.transform[5];
    const table = /^Table/i.test(caption.str);
    if (/^Algorithm/i.test(caption.str)) {
      const aligned = rules
        .filter(
          (box) =>
            Math.abs(box[0] - x) < size * 3 &&
            box[2] > x + width * 0.2 &&
            box[3] < y &&
            y - box[1] < height * 0.65,
        )
        .sort((a, b) => b[3] - a[3]);
      const top = aligned[0];
      if (!top || y - top[3] > size * 3) continue;
      for (const bottom of aligned.slice(1)) {
        if (
          Math.abs(bottom[0] - top[0]) > size * 2 ||
          Math.abs(bottom[2] - top[2]) > size * 2 ||
          top[1] - bottom[3] < size * 4
        )
          continue;
        const inside = items.filter(
          (item) =>
            item.transform[4] >= top[0] - 2 &&
            item.transform[4] < top[2] + 2 &&
            item.transform[5] < top[3] &&
            item.transform[5] > bottom[1],
        );
        const numbers = new Set(
          inside
            .filter((item) => /^\d{1,3}\s*[:.]?(?:\s|$)/.test(item.str.trim()))
            .map((item) => Math.round(item.transform[5] / 2)),
        );
        const controls = new Set(
          inside.flatMap((item) =>
            Array.from(
              item.str.matchAll(/\b(for|while|if|return|end)\b/gi),
              (match) => match[1].toLowerCase(),
            ),
          ),
        );
        if (numbers.size >= 3 && controls.size >= 2) {
          regions.push({
            kind: "algorithm",
            rect: [top[0] - 2, bottom[1] - 2, top[2] + 2, top[3] + 1],
            caption,
          });
          break;
        }
      }
    } else if (table) {
      const above = rules
        .filter(
          (box) =>
            box[1] > y + size * 0.5 &&
            box[1] - y < size * 7 &&
            box[2] > x + width * 0.15 &&
            box[0] < x + width * 0.2,
        )
        .sort((a, b) => a[1] - b[1]);
      const floor = above[0];
      if (
        floor &&
        !regions.some(
          (region) =>
            region.kind === "table" &&
            floor[0] >= region.rect[0] &&
            floor[2] <= region.rect[2] &&
            floor[1] >= region.rect[1] &&
            floor[3] <= region.rect[3],
        )
      ) {
        const ceilingLimit = Math.min(
          height,
          ...captions
            .filter(
              (other) =>
                other !== caption &&
                other.transform[5] > y + size * 2 &&
                other.transform[4] < floor[2] &&
                other.transform[4] >= floor[0] - size * 3,
            )
            .map((other) => other.transform[5] - size),
        );
        const aligned = rules
          .filter(
            (box) =>
              box[1] >= floor[1] &&
              box[3] < ceilingLimit &&
              Math.abs(box[0] - floor[0]) < size * 3 &&
              Math.abs(box[2] - floor[2]) < size * 3,
          )
          .sort((a, b) => a[1] - b[1]);
        const connected = [floor];
        for (const rule of aligned) {
          if (!tableInterval(connected.at(-1)!, rule, size)) break;
          connected.push(rule);
        }
        const top = connected.at(-1)!;
        const cells = items.filter(
          (item) =>
            item.transform[4] >= floor[0] - 2 &&
            item.transform[4] < floor[2] + 2 &&
            item.transform[5] > floor[1] &&
            item.transform[5] < top[3],
        );
        if (
          top[3] - floor[1] > size * 2 &&
          cells.filter((item) => /\d/.test(item.str)).length >= 4 &&
          cells.filter((item) => item.str.length > 100).length === 0
        ) {
          regions.push({
            kind: "table",
            rect: [floor[0] - 2, floor[1] - 2, floor[2] + 2, top[3] + 2],
            caption,
          });
          continue;
        }
      }
      const below = rules
        .filter(
          (b) =>
            b[3] < y - size * 0.4 &&
            y - b[1] < height &&
            b[0] <= x + width * 0.2 &&
            b[2] > x + width * 0.1,
        )
        .sort((a, b) => b[3] - a[3]);
      const top = below[0];
      if (!top || y - top[3] > size * 10) continue;
      const aligned = below.filter(
        (b) =>
          Math.abs(b[0] - top[0]) < size * 3 &&
          Math.abs(b[2] - top[2]) < size * 3,
      );
      const connected = [top];
      for (const b of aligned.slice(1)) {
        if (!tableInterval(connected.at(-1)!, b, size)) break;
        connected.push(b);
      }
      if (connected.length < 2) continue;
      const bottom = connected.at(-1)!;
      const rect = [top[0] - 2, bottom[1] - 2, top[2] + 2, top[3] + 2];
      if (
        items.filter(
          (i) =>
            i.transform[4] >= rect[0] &&
            i.transform[4] < rect[2] &&
            i.transform[5] >= rect[1] &&
            i.transform[5] <= rect[3],
        ).length >= 6
      )
        regions.push({ rect, kind: "table", caption });
    } else {
      // Large closed frames preserve qualitative examples and literal prompt boxes.
      const enclosing = boxes.filter(
        (b) =>
          b[2] - b[0] > width * 0.35 &&
          b[3] - b[1] > height * 0.12 &&
          b[1] > y + size * 0.5 &&
          b[1] - y < size * 10,
      );
      if (enclosing.length) {
        const b = enclosing.sort(
          (a, b) =>
            (b[2] - b[0]) * (b[3] - b[1]) - (a[2] - a[0]) * (a[3] - a[1]),
        )[0];
        regions.push({ rect: b, kind: "figure" });
      }
    }
  }
  const merged: Region[] = [];
  for (const region of regions.sort(
    (a, b) =>
      (b.rect[2] - b.rect[0]) * (b.rect[3] - b.rect[1]) -
      (a.rect[2] - a.rect[0]) * (a.rect[3] - a.rect[1]),
  )) {
    if (
      !merged.some(
        (other) =>
          region.rect[0] >= other.rect[0] - 3 &&
          region.rect[2] <= other.rect[2] + 3 &&
          region.rect[1] >= other.rect[1] - 3 &&
          region.rect[3] <= other.rect[3] + 3,
      )
    )
      merged.push(region);
  }
  const owner = (item: GeometryItem) =>
    merged.findIndex(
      ({ rect }) =>
        item.transform[4] >= rect[0] - 1 &&
        item.transform[4] + Math.min(item.width, 4) <= rect[2] + 1 &&
        item.transform[5] >= rect[1] - 1 &&
        item.transform[5] <= rect[3] + 1,
    );
  const captionItems = new Set<GeometryItem>();
  const captionBlocks: ReadingBlock[] = [];
  for (const region of merged) {
    if (!region.caption) continue;
    const caption = region.caption;
    const other = captions
      .filter(
        (c) =>
          c.transform[4] > caption.transform[4] + 20 &&
          Math.abs(c.transform[5] - caption.transform[5]) < 20,
      )
      .sort((a, b) => a.transform[4] - b.transform[4])[0];
    const end = other
      ? other.transform[4] - 4
      : region.kind === "table"
        ? region.rect[2] < width * 0.52 && caption.transform[4] < width * 0.45
          ? width * 0.5
          : width
        : Math.max(region.rect[2] + 4, caption.transform[4] + width * 0.24);
    const captionAbove = caption.transform[5] > region.rect[3];
    let inside = items.filter(
      (i) =>
        i.transform[4] >= caption.transform[4] - 2 &&
        i.transform[4] < end &&
        i.transform[5] <= caption.transform[5] + 2 &&
        i.transform[5] >
          (captionAbove
            ? region.rect[3] + 2
            : caption.transform[5] - caption.height * 0.5),
    );
    if (region.kind === "table") {
      const size = caption.height || 10;
      // Follow complete caption baselines, including hanging/wrapped lines.
      // A font change, drawing boundary or paragraph-sized gap ends ownership.
      const candidates = items
        .filter(
          (item) =>
            item.transform[4] >= caption.transform[4] - 2 &&
            item.transform[4] < end &&
            item.transform[5] <= caption.transform[5] + size * 0.6 &&
            item.height >= size * 0.45 &&
            item.height <= size * 1.08 &&
            (!captionAbove || item.transform[5] > region.rect[3] + 2),
        )
        .sort((a, b) => b.transform[5] - a.transform[5]);
      let baseline = caption.transform[5];
      inside = [];
      for (const item of candidates) {
        const y = item.transform[5];
        if (
          baseline - y > size * 1.6 ||
          rules.some(
            (rule) =>
              rule[1] < baseline &&
              rule[3] > y &&
              rule[0] < end &&
              rule[2] > caption.transform[4],
          ) ||
          captions.some(
            (other) =>
              other !== caption &&
              other.transform[5] < baseline - 2 &&
              other.transform[5] >= y - 2 &&
              other.transform[4] >= caption.transform[4] - 2 &&
              other.transform[4] < end,
          )
        )
          break;
        baseline = Math.min(baseline, y);
        inside.push(item);
      }
    }
    if (!inside.length) continue;
    inside.forEach((i) => captionItems.add(i));
    const reconstructed = reconstructPage(
      number,
      {
        ...content,
        items: inside,
      },
      width,
      height,
    ).blocks;
    const joined: ReadingBlock = {
      kind: "caption",
      text: "",
      translate: true,
      origins: [],
    };
    for (const block of reconstructed) {
      const offset = joined.text.length + (joined.text ? 1 : 0);
      joined.text += `${joined.text ? " " : ""}${block.text}`;
      joined.origins.push(
        ...block.origins.map((origin) => ({
          ...origin,
          start: origin.start + offset,
          end: origin.end + offset,
        })),
      );
      if (block.inlineMath?.length)
        joined.inlineMath = [
          ...(joined.inlineMath || []),
          ...block.inlineMath.map((span) => ({
            ...span,
            start: span.start + offset,
            end: span.end + offset,
          })),
        ];
    }
    if (joined.text) captionBlocks.push(joined);
  }
  const remaining: GeometryContent = {
    ...content,
    items: content.items.filter(
      (i) => !("str" in i) || (owner(i) < 0 && !captionItems.has(i)),
    ),
  };
  const proseSizes = items
    .filter((item) => item.str.length > 45)
    .map((item) => item.height)
    .sort((a, b) => a - b);
  const bodySize = proseSizes[Math.floor(proseSizes.length / 2)] || 10;
  const footnoteRules = boxes.filter(
    (box) =>
      box[3] < height * 0.3 &&
      box[3] - box[1] < 2 &&
      box[2] - box[0] > width * 0.07 &&
      box[2] - box[0] < width * 0.4,
  );
  const additions: ReadingBlock[] = [...captionBlocks];
  merged.forEach((region, index) => {
    const inside = items.filter(
      (item) => owner(item) === index && !captionItems.has(item),
    );
    if (!inside.length && region.kind !== "figure") return;
    const caption = captions
      .filter(
        (item) =>
          item.transform[5] < region.rect[1] &&
          item.transform[4] < region.rect[2] &&
          item.transform[4] + Math.max(item.width, item.height * 4) >
            region.rect[0],
      )
      .sort((a, b) => b.transform[5] - a.transform[5])[0];
    const label = caption?.str.match(
      /(?:Fig(?:ure)?\.?)\s*(\d+(?:\.\d+)*)/i,
    )?.[1];
    const figureLabel = label
      ? `Figure ${label} — see original PDF`
      : "Figure — original PDF rendering";
    const text =
      inside
        .sort((a, b) =>
          Math.abs(b.transform[5] - a.transform[5]) > 3
            ? b.transform[5] - a.transform[5]
            : a.transform[4] - b.transform[4],
        )
        .map((item) => item.str)
        .join(" ") || figureLabel;
    additions.push({
      kind: region.kind,
      text,
      translate: false,
      origins: [
        { page: number, start: 0, end: text.length, rects: [region.rect] },
      ],
      ...(region.kind === "figure"
        ? {
            figureMarker: true,
            figureLabel,
          }
        : {}),
    });
  });
  const reading = reconstructPage(number, remaining, width, height, additions);
  for (const block of reading.blocks) {
    if (!["body", "abstract", "affiliation"].includes(block.kind)) continue;
    const rects = block.origins.flatMap((origin) => origin.rects || []);
    const rule = footnoteRules.find(
      (rule) =>
        rects.length > 0 &&
        rects.every(
          (rect) =>
            rect[3] < rule[1] + bodySize * 0.3 &&
            rect[0] >= rule[0] - bodySize * 2,
        ),
    );
    if (!rule) continue;
    const spans = items.filter((item) =>
      block.origins.some((origin) =>
        origin.rects?.some(
          (rect) =>
            item.transform[5] >= rect[1] &&
            item.transform[5] <= rect[3] &&
            item.transform[4] >= rect[0] - 1 &&
            item.transform[4] < rect[2],
        ),
      ),
    );
    if (
      spans.length &&
      spans.filter((item) => item.height < bodySize * 0.92).length >
        spans.length * 0.7
    ) {
      block.kind = "footnote";
      block.translate = true;
    }
  }
  return reading;
}
