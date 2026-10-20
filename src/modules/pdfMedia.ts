import type { ReadingPage, ReadingMedia } from "./pdfReadingTypes";

/** Use PDF.js's actual font/vector renderer; never infer TeX from extracted text. */
export async function renderReadingMedia(
  reading: ReadingPage,
  page: _ZoteroTypes.Reader.PDFPageProxy,
  win: Window,
): Promise<ReadingPage> {
  const selected = reading.blocks.filter(
    (block) =>
      block.kind === "equation" ||
      block.kind === "table" ||
      block.kind === "algorithm" ||
      block.kind === "figure" ||
      !!block.inlineMath?.length,
  );
  if (!selected.length) return reading;
  const canvas = win.document.createElementNS(
    "http://www.w3.org/1999/xhtml",
    "canvas",
  ) as HTMLCanvasElement;
  const viewport = Components.utils.waiveXrays(
    page.getViewport(Components.utils.cloneInto({ scale: 1.5 }, win)),
  );
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height))
    throw new Error("PDF media viewport is not finite");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  if (canvas.width * canvas.height > 12000000)
    throw new Error("PDF media page exceeds render pixel limit");
  const options = Components.utils.waiveXrays(
    Components.utils.createObjectIn(win),
  ) as Record<string, unknown>;
  options.canvas = Components.utils.waiveXrays(canvas);
  options.canvasContext = Components.utils.waiveXrays(canvas.getContext("2d")!);
  options.viewport = viewport;
  options.intent = "print";
  const task = Components.utils.waiveXrays(
    page.render(options as unknown as Parameters<typeof page.render>[0]),
  );
  await task.promise;
  const cropRegion = (rects: number[][], padding: number): ReadingMedia => {
    const box = [
      Math.min(...rects.map((rect) => rect[0])) - padding,
      Math.min(...rects.map((rect) => rect[1])) - padding,
      Math.max(...rects.map((rect) => rect[2])) + padding,
      Math.max(...rects.map((rect) => rect[3])) + padding,
    ];
    const a = viewport.convertToViewportPoint(box[0], box[1]);
    const b = viewport.convertToViewportPoint(box[2], box[3]);
    const converted = [a[0], a[1], b[0], b[1]];
    const x = Math.max(0, Math.floor(Math.min(converted[0], converted[2]))),
      y = Math.max(0, Math.floor(Math.min(converted[1], converted[3])));
    const width = Math.min(
        canvas.width - x,
        Math.ceil(Math.abs(converted[2] - converted[0])),
      ),
      height = Math.min(
        canvas.height - y,
        Math.ceil(Math.abs(converted[3] - converted[1])),
      );
    if (width <= 0 || height <= 0 || width * height > 2500000)
      throw new Error("Original PDF region exceeds crop pixel bounds");
    const crop = win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "canvas",
    ) as HTMLCanvasElement;
    crop.width = width;
    crop.height = height;
    crop
      .getContext("2d")!
      .drawImage(canvas, x, y, width, height, 0, 0, width, height);
    return {
      data: crop.toDataURL("image/png"),
      width: width / 1.5,
      height: height / 1.5,
      page: reading.page,
      rect: box,
    };
  };
  for (const block of selected) {
    if (["equation", "table", "algorithm", "figure"].includes(block.kind)) {
      const rects = block.origins.flatMap((origin) => origin.rects || []);
      if (rects.length) block.media = cropRegion(rects, 1.5);
    }
    for (const span of block.inlineMath || [])
      span.media = cropRegion([span.rect], 0.6);
  }
  canvas.width = canvas.height = 0;
  return reading;
}
