import type {
  GeometryContent,
  GeometryItem,
  ReadingPage,
} from "./pdfReadingTypes";

type Rect = number[];
interface Operators {
  fnArray: number[];
  argsArray: unknown[][];
}

interface Graphic {
  rect: Rect;
  image: boolean;
}

/** Text advances follow the baseline; ascent/descent follow the font axis. */
function labelBounds(item: GeometryItem, content: GeometryContent): Rect {
  const [a, b, c, d, x, y] = item.transform;
  const advance = Math.hypot(a, b) || 1;
  const style = content.styles[item.fontName];
  // Some embedded fonts report zero for both metrics, not an empty glyph.
  const ascent = style?.ascent || 0.9;
  const descent = style?.descent || -0.25;
  const points = [0, item.width].flatMap((offset) =>
    [Math.min(0, descent), Math.max(0, ascent)].map((extent) => [
      x + (a / advance) * offset + c * extent,
      y + (b / advance) * offset + d * extent,
    ]),
  );
  return [
    Math.min(...points.map((point) => point[0])),
    Math.min(...points.map((point) => point[1])),
    Math.max(...points.map((point) => point[0])),
    Math.max(...points.map((point) => point[1])),
  ];
}

/** Read painted bounds, not the (often much larger) paths used only to clip. */
function drawingBounds(
  operators: Operators,
  ops: Record<string, number>,
  width: number,
  height: number,
): Graphic[] {
  let matrix = [1, 0, 0, 1, 0, 0];
  let clip = [0, 0, width, height];
  const stack: { matrix: number[]; clip: Rect }[] = [];
  const boxes: Graphic[] = [];
  let path: Rect | undefined;
  let pendingClip = false;
  const intersect = (a: Rect, b: Rect) => [
    Math.max(a[0], b[0]),
    Math.max(a[1], b[1]),
    Math.min(a[2], b[2]),
    Math.min(a[3], b[3]),
  ];
  const concatenate = (b: ArrayLike<number>) => {
    const a = matrix;
    matrix = [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];
  };
  const transform = (rect: ArrayLike<number>) => {
    const points = [
      [rect[0], rect[1]],
      [rect[2], rect[1]],
      [rect[0], rect[3]],
      [rect[2], rect[3]],
    ].map(([x, y]) => [
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5],
    ]);
    return [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ];
  };
  const add = (rect: Rect, image = false) => {
    const box = intersect(rect, clip);
    if (
      box.every(Number.isFinite) &&
      box[2] - box[0] >= 0 &&
      box[3] - box[1] >= 0 &&
      Math.max(box[2] - box[0], box[3] - box[1]) > 1 &&
      (box[2] - box[0]) * (box[3] - box[1]) < width * height * 0.5
    )
      boxes.push({ rect: box, image });
  };
  const consume = (paint: boolean) => {
    if (path) {
      if (paint) add(path);
      if (pendingClip) clip = intersect(clip, path);
    }
    path = undefined;
    pendingClip = false;
  };
  const paints = new Set(
    [
      ops.stroke,
      ops.closeStroke,
      ops.fill,
      ops.eoFill,
      ops.fillStroke,
      ops.eoFillStroke,
      ops.closeFillStroke,
      ops.closeEOFillStroke,
    ].filter((op) => typeof op === "number"),
  );
  for (let index = 0; index < operators.fnArray.length; index++) {
    const fn = operators.fnArray[index];
    const args = operators.argsArray[index];
    if (
      fn === ops.save ||
      fn === ops.paintFormXObjectBegin ||
      fn === ops.beginGroup
    ) {
      stack.push({ matrix: matrix.slice(), clip: clip.slice() });
      if (fn === ops.paintFormXObjectBegin) {
        if (args?.[0]) concatenate(args[0] as number[]);
        if (args?.[1]) clip = intersect(clip, transform(args[1] as number[]));
      } else if (fn === ops.beginGroup) {
        const group = args?.[0] as { matrix?: number[]; bbox?: number[] };
        const saved = matrix;
        // Group matrices transform the clipping box, not the group's contents.
        if (group?.matrix) concatenate(group.matrix);
        if (group?.bbox) clip = intersect(clip, transform(group.bbox));
        matrix = saved;
      }
    } else if (
      fn === ops.restore ||
      fn === ops.paintFormXObjectEnd ||
      fn === ops.endGroup
    ) {
      const saved = stack.pop();
      if (saved) ({ matrix, clip } = saved);
    } else if (fn === ops.transform && args?.length === 6) {
      concatenate(args as number[]);
    } else if (
      fn === ops.constructPath &&
      args?.length >= 3 &&
      args[2] &&
      typeof args[2] === "object"
    ) {
      // PDF.js 4 constructs a path and paints/consumes it in a later op;
      // PDF.js 5 includes that consuming op as the first argument.
      const bounds = args[args.length - 1] as ArrayLike<number>;
      if ([bounds[0], bounds[1], bounds[2], bounds[3]].every(Number.isFinite)) {
        const box = transform(bounds);
        path = path
          ? [
              Math.min(path[0], box[0]),
              Math.min(path[1], box[1]),
              Math.max(path[2], box[2]),
              Math.max(path[3], box[3]),
            ]
          : box;
      }
      if (typeof args[0] === "number") consume(paints.has(args[0]));
    } else if (fn === ops.clip || fn === ops.eoClip) {
      pendingClip = true;
    } else if (fn === ops.endPath || paints.has(fn)) {
      consume(paints.has(fn));
    } else if (
      [
        ops.paintImageXObject,
        ops.paintInlineImageXObject,
        ops.paintImageMaskXObject,
      ].includes(fn)
    )
      add(transform([0, 0, 1, 1]), true);
  }
  return boxes;
}

/** Read PDF.js drawing bounds in PDF user space, never text length alone. */
export function graphicBounds(
  operators: Operators,
  ops: Record<string, number>,
  width: number,
  height: number,
): Rect[] {
  return drawingBounds(operators, ops, width, height).map(({ rect }) => rect);
}
export function figureRegions(
  content: GeometryContent,
  operators: Operators,
  ops: Record<string, number>,
  width: number,
  height: number,
): Rect[] {
  const drawings = drawingBounds(operators, ops, width, height);
  const items = content.items.filter(
    (item): item is import("./pdfReadingTypes").GeometryItem =>
      "str" in item && !!item.str.trim(),
  );
  const captionPattern =
    /^(?:Table|Fig(?:ure)?\.?)\s*\d+(?:\.\d+)*(?:\s*[:.]|\s*$)/i;
  const captions = items.flatMap((item) => {
    if (captionPattern.test(item.str.trim())) return [item];
    if (!/^(?:Table|Fig(?:ure)?\.?)$/i.test(item.str.trim())) return [];
    const number = items.find(
      (next) =>
        /^\d+(?:\.\d+)*(?:\s*[:.]|\s*$)/.test(next.str.trim()) &&
        Math.abs(next.transform[5] - item.transform[5]) < item.height * 0.3 &&
        next.transform[4] >= item.transform[4] + item.width - 1 &&
        next.transform[4] - item.transform[4] - item.width < item.height * 2,
    );
    return number ? [{ ...item, str: `${item.str} ${number.str}` }] : [];
  });
  // Establish direct caption claims independently of component growth. A shared
  // title row must not merge two figures just because their captions are staggered.
  const captionOwners = new Map(
    drawings.map((drawing) => {
      const owner = captions
        .filter((caption) => {
          const size = caption.height || 10;
          const gap = drawing.rect[1] - caption.transform[5];
          return (
            gap > size * 0.6 &&
            gap <= Math.max(40, size * 4) &&
            drawing.rect[2] > caption.transform[4] &&
            drawing.rect[0] <
              caption.transform[4] + Math.max(caption.width, size * 4)
          );
        })
        .sort((a, b) => b.transform[5] - a.transform[5])[0];
      return [drawing, owner] as const;
    }),
  );
  const regions: Rect[] = [];
  for (const caption of captions) {
    if (/^Table/i.test(caption.str)) continue;
    const y = caption.transform[5];
    const size =
      caption.height || Math.hypot(caption.transform[0], caption.transform[1]);
    const peers = captions.filter(
      (other) =>
        other !== caption && Math.abs(other.transform[5] - y) < size * 2,
    );
    const left = Math.max(
      0,
      ...peers
        .filter((other) => other.transform[4] < caption.transform[4])
        .map(() => caption.transform[4] - size),
    );
    const right = Math.min(
      width,
      ...peers
        .filter((other) => other.transform[4] > caption.transform[4])
        .map((other) => other.transform[4] - size),
    );
    const boundary = Math.min(
      height,
      ...captions
        .filter(
          (item) =>
            item.transform[5] > y + size * 2 &&
            item.transform[4] <
              Math.min(
                right,
                caption.transform[4] + Math.max(caption.width, size * 4),
              ) &&
            item.transform[4] + item.width >
              Math.max(left, caption.transform[4] - size),
        )
        .map((item) => item.transform[5] - size * 0.5),
    );
    // Only directly-above, drawing-backed material: retain uncertain labels,
    // table material and equations elsewhere. Caption itself is never inside.
    const nearby = drawings.filter(
      ({ rect: box }) =>
        box[1] > y + size * 0.6 &&
        box[3] < boundary &&
        box[0] >= left &&
        box[2] <= right &&
        // Earlier column captions constrain only their own vertical band;
        // a later full-width figure below that band may span both columns.
        !captions.some(
          (other) =>
            other.transform[5] > y + size * 2 &&
            box[3] >= other.transform[5] - size * 8 &&
            ((other.transform[4] + other.width < caption.transform[4] - size &&
              box[0] <
                (other.transform[4] + other.width + caption.transform[4]) /
                  2) ||
              (other.transform[4] >
                caption.transform[4] + caption.width + size &&
                box[2] >
                  (other.transform[4] + caption.transform[4] + caption.width) /
                    2)),
        ),
    );
    // Grow only connected drawing material from the closest caption-backed
    // component; unrelated graphics farther up the page are not one figure.
    const seed = nearby
      .filter(
        ({ rect }) =>
          rect[2] > caption.transform[4] - size &&
          rect[0] < caption.transform[4] + Math.max(caption.width, size * 4),
      )
      .sort((a, b) => a.rect[1] - b.rect[1])[0];
    if (!seed || seed.rect[1] - y > Math.max(40, size * 4)) continue;
    const connected = new Set([seed]);
    const selected = [seed];
    const panelTitles = new Set<GeometryItem>();
    const titles = (drawing: Graphic) =>
      drawing.rect[3] - drawing.rect[1] > size * 3
        ? items.filter((item) => {
            const box = labelBounds(item, content);
            const center = (box[0] + box[2]) / 2;
            return (
              !captionPattern.test(item.str.trim()) &&
              item.str.trim().split(/\s+/).length <= 8 &&
              item.height >= size * 0.8 &&
              item.height <= size * 1.15 &&
              box[1] >= drawing.rect[3] &&
              box[1] - drawing.rect[3] <= size * 2 &&
              center >= drawing.rect[0] &&
              center <= drawing.rect[2]
            );
          })
        : [];
    const titleRows = new Map(
      nearby
        .filter((drawing) => drawing.image)
        .map((drawing) => [drawing, titles(drawing)]),
    );
    for (let index = 0; index < selected.length; index++) {
      const a = selected[index].rect;
      for (const drawing of nearby) {
        if (connected.has(drawing)) continue;
        const b = drawing.rect;
        const horizontalGap = Math.max(a[0] - b[2], b[0] - a[2]);
        const verticalGap = Math.max(a[1] - b[3], b[1] - a[3]);
        const overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
        // Detached legend rows and stacked panels can have a larger gap,
        // but must share horizontal support and have no prose between them.
        const detached =
          verticalGap > size &&
          verticalGap <= size * 4 &&
          overlap > 0 &&
          overlap >= Math.min(a[2] - a[0], b[2] - b[0]) * 0.5 &&
          !items.some(
            (item) =>
              item.transform[5] > Math.min(a[3], b[3]) &&
              item.transform[5] < Math.max(a[1], b[1]) &&
              item.transform[4] + item.width > Math.min(a[0], b[0]) &&
              item.transform[4] < Math.max(a[2], b[2]) &&
              (item.str.trim().length > 100 ||
                (item.height >= size * 0.95 &&
                  item.str.trim().split(/\s+/).length > 12)),
          );
        // Separate raster panels may have no connecting paths at all. A shared
        // short title baseline provides ownership across their horizontal gap.
        const pairedTitles =
          selected[index].image && drawing.image
            ? (titleRows.get(selected[index]) || []).flatMap((first) =>
                (titleRows.get(drawing) || [])
                  .filter(
                    (second) =>
                      first !== second &&
                      first.fontName === second.fontName &&
                      Math.abs(first.transform[5] - second.transform[5]) <
                        size * 0.3,
                  )
                  .flatMap((second) => [first, second]),
              )
            : [];
        const panels =
          horizontalGap > 0 &&
          verticalGap < -Math.min(a[3] - a[1], b[3] - b[1]) * 0.5 &&
          pairedTitles.length > 0 &&
          (!captionOwners.get(drawing) ||
            captionOwners.get(drawing) === caption) &&
          (!captionOwners.get(selected[index]) ||
            captionOwners.get(selected[index]) === caption) &&
          !items.some((item) => {
            const box = labelBounds(item, content);
            return (
              item.height >= size * 0.95 &&
              (item.str.trim().length > 40 ||
                item.str.trim().split(/\s+/).length > 6) &&
              box[0] < Math.max(a[0], b[0]) &&
              box[2] > Math.min(a[2], b[2]) &&
              box[1] < Math.min(a[3], b[3]) &&
              box[3] > Math.max(a[1], b[1])
            );
          });
        if (
          (horizontalGap <= size * 4 && (verticalGap <= size || detached)) ||
          panels
        ) {
          if (panels) pairedTitles.forEach((item) => panelTitles.add(item));
          connected.add(drawing);
          selected.push(drawing);
        }
      }
    }
    const region = [
      Math.min(...selected.map(({ rect }) => rect[0])),
      Math.min(...selected.map(({ rect }) => rect[1])),
      Math.max(...selected.map(({ rect }) => rect[2])),
      Math.max(...selected.map(({ rect }) => rect[3])),
    ];
    if (region[2] - region[0] < width * 0.2 || region[3] - region[1] < size * 3)
      continue;
    const interior = items.filter(
      (item) =>
        item.transform[4] >= region[0] - 2 &&
        item.transform[4] <= region[2] + 2 &&
        item.transform[5] >= region[1] - 2 &&
        item.transform[5] <= region[3] + 2,
    );
    const image = selected.some(
      ({ rect, image }) =>
        image &&
        rect[2] - rect[0] >= width * 0.15 &&
        rect[3] - rect[1] >= size * 3,
    );
    if (!image && (selected.length < 4 || interior.length < 2)) continue;
    // Caption-scale prose is a veto; smaller diagram annotations can be
    // sentences too (for example, questions in a visualization).
    if (
      interior.some(
        (item) =>
          item.str.trim().length > 100 ||
          (item.height >= size * 0.95 &&
            item.str.trim().split(/\s+/).length > 12 &&
            item.width > (region[2] - region[0]) * 0.6),
      )
    )
      continue;
    if (
      !image &&
      interior.filter((item) => item.str.trim().length < 60).length <
        interior.length * 0.75
    )
      continue;
    // Vector panel titles can use exactly the caption's font and size. Require
    // a repeated title row supported by distinct, horizontally separate painted
    // panels, rather than treating any nearby same-font line as an annotation.
    const supportedTitles = selected.flatMap((drawing) =>
      titles(drawing).map((item) => ({ drawing, item })),
    );
    // A raster's direct caption claim is sufficient support for its own title;
    // independently captioned neighbors must not need a merge to keep labels.
    for (const drawing of selected) {
      if (!drawing.image || captionOwners.get(drawing) !== caption) continue;
      for (const item of titleRows.get(drawing) || []) {
        if (item.str.trim().length <= 60 && !/[.!?;:]$/.test(item.str.trim()))
          panelTitles.add(item);
      }
    }
    for (const first of supportedTitles) {
      const firstBox = labelBounds(first.item, content);
      if (
        first.item.str.trim().length > 60 ||
        /[.!?;:]$/.test(first.item.str.trim())
      )
        continue;
      const paired = supportedTitles.some((second) => {
        if (
          first.drawing === second.drawing ||
          first.item === second.item ||
          first.item.fontName !== second.item.fontName ||
          second.item.str.trim().length > 60 ||
          /[.!?;:]$/.test(second.item.str.trim()) ||
          Math.abs(first.item.transform[5] - second.item.transform[5]) >=
            size * 0.3
        )
          return false;
        const secondBox = labelBounds(second.item, content);
        return (
          Math.max(
            first.drawing.rect[0] - second.drawing.rect[2],
            second.drawing.rect[0] - first.drawing.rect[2],
          ) > 0 &&
          Math.max(firstBox[0] - secondBox[2], secondBox[0] - firstBox[2]) >
            size
        );
      });
      if (paired) panelTitles.add(first.item);
    }
    // Drawings establish ownership, but do not bound text: panel names, axis
    // labels and rotated annotations frequently extend beyond painted paths.
    // Attach text to the fixed drawing component, never to other labels (which
    // could otherwise walk through a caption into the surrounding paragraph).
    const annotationFonts = new Set(interior.map((item) => item.fontName));
    const captionTop = labelBounds(caption, content)[3];
    const labels = items.filter((item) => {
      const text = item.str.trim();
      if (captionPattern.test(text)) return false;
      const fontSize = Math.hypot(item.transform[2], item.transform[3]);
      const panel = /^\([a-z0-9]+\)(?:\s|$)/i.test(text);
      const annotation =
        fontSize < size * 0.95 ||
        (item.fontName !== caption.fontName &&
          annotationFonts.has(item.fontName) &&
          fontSize <= size * 1.4);
      if (
        (!panel && !annotation && !panelTitles.has(item)) ||
        text.length > 100 ||
        (fontSize >= size * 0.95 && text.split(/\s+/).length > 12)
      )
        return false;
      const box = labelBounds(item, content);
      if (
        !box.every(Number.isFinite) ||
        box[0] < left ||
        box[2] > right ||
        box[1] <= captionTop + size * 0.25 ||
        box[3] >= boundary
      )
        return false;
      return (
        panelTitles.has(item) ||
        selected.some(({ rect }) => {
          const horizontalGap = Math.max(rect[0] - box[2], box[0] - rect[2]);
          const verticalGap = Math.max(rect[1] - box[3], box[1] - rect[3]);
          return (
            horizontalGap <= Math.max(size, fontSize) * 1.5 &&
            verticalGap <= Math.max(size, fontSize) * 1.5 &&
            (horizontalGap <= 0 || verticalGap <= 0)
          );
        })
      );
    });
    for (const item of labels) {
      const box = labelBounds(item, content);
      region[0] = Math.min(region[0], box[0]);
      region[1] = Math.min(region[1], box[1]);
      region[2] = Math.max(region[2], box[2]);
      region[3] = Math.max(region[3], box[3]);
    }
    regions.push(region);
  }
  return regions;
}

export function markFigureMaterial(
  page: ReadingPage,
  regions: Rect[],
): ReadingPage {
  if (!regions.length) return page;
  const used = new Set<number>();
  const result = {
    ...page,
    blocks: page.blocks.flatMap((block) => {
      if (
        ["caption", "equation", "reference", "heading", "title"].includes(
          block.kind,
        )
      )
        return [block];
      const rects = block.origins.flatMap((origin) => origin.rects || []);
      const index = regions.findIndex(
        (region) =>
          rects.length > 0 &&
          rects.every(
            (rect) =>
              rect[0] >= region[0] - 3 &&
              rect[2] <= region[2] + 3 &&
              rect[1] >= region[1] - 8 &&
              rect[3] <= region[3] + 8,
          ),
      );
      if (index < 0) return [block];
      const marker = !used.has(index);
      used.add(index);
      const caption = page.blocks.find(
        (candidate) =>
          candidate.kind === "caption" &&
          candidate.origins.some((origin) =>
            origin.rects?.some((rect) => rect[3] < regions[index][1]),
          ),
      );
      const number = caption?.text.match(/^(?:Fig(?:ure)?\.?)\s*(\d+)/i)?.[1];
      return [
        {
          ...block,
          kind: "figure" as const,
          translate: false,
          figureMarker: marker,
          figureLabel: number
            ? `Figure ${number} — see original PDF`
            : "Figure — see original PDF",
          text: block.text,
        },
      ];
    }),
  };
  for (const marker of result.blocks.filter((block) => block.figureMarker)) {
    const region = regions.find((box) =>
      marker.origins.some((origin) =>
        origin.rects?.some(
          (rect) =>
            rect[0] >= box[0] - 3 &&
            rect[2] <= box[2] + 3 &&
            rect[1] >= box[1] - 8 &&
            rect[3] <= box[3] + 8,
        ),
      ),
    );
    if (region)
      marker.origins = result.blocks
        .filter(
          (block) =>
            block.kind === "figure" &&
            block.origins.some((origin) =>
              origin.rects?.some(
                (rect) =>
                  rect[0] >= region[0] - 3 &&
                  rect[2] <= region[2] + 3 &&
                  rect[1] >= region[1] - 8 &&
                  rect[3] <= region[3] + 8,
              ),
            ),
        )
        .flatMap((block) => block.origins);
  }
  return result;
}
