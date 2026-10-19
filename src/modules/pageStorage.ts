import { config } from "../../package.json";
import type { ReadingBlock, ReadingPage } from "./pdfReadingTypes";

export interface SavedPage {
  source: ReadingPage;
  result: ReadingBlock[];
}

type StorageContext = { directory: string; identity: string };
type ObjectValue = Record<string, unknown>;

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PAGE = 1000000;
const MAX_BLOCKS = 4096;
const MAX_ORIGINS = 4096;
const MAX_TEXT = 120000;
const KINDS = new Set([
  "title",
  "authors",
  "affiliation",
  "abstract",
  "heading",
  "body",
  "caption",
  "equation",
  "table",
  "algorithm",
  "footnote",
  "reference",
  "running",
  "figure",
]);

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Recompute the actual attachment identity each time; never persist configuration. */
export async function pageStorageContext(
  item: Zotero.Item,
  configuration: string,
): Promise<StorageContext> {
  const path = await item.getFilePathAsync();
  if (!path) throw new Error("PDF attachment file is unavailable");
  const before = await IOUtils.stat(path);
  const attachmentHash = await item.attachmentHash;
  const after = await IOUtils.stat(path);
  if (
    !attachmentHash ||
    !Number.isSafeInteger(after.size) ||
    after.size! < 0 ||
    !Number.isFinite(after.lastModified) ||
    before.size !== after.size ||
    before.lastModified !== after.lastModified
  ) {
    throw new Error("PDF attachment changed or has unavailable file metadata");
  }
  const identity = await sha256(
    JSON.stringify([
      item.libraryID,
      item.key,
      attachmentHash,
      after.size,
      after.lastModified,
      "generic-reading-order-v9",
      await sha256(configuration),
    ]),
  );
  const directory = PathUtils.join(
    Zotero.DataDirectory.dir,
    config.addonRef,
    "page-translations",
    identity,
  );
  await IOUtils.makeDirectory(directory, {
    createAncestors: true,
    ignoreExisting: true,
  });
  return { directory, identity };
}

function object(value: unknown): value is ObjectValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function keys(value: ObjectValue, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function integer(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  );
}

function rectangle(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (coordinate: unknown) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    ) &&
    value[0] < value[2] &&
    value[1] < value[3]
  );
}

function media(value: unknown): boolean {
  return (
    object(value) &&
    keys(value, ["data", "width", "height", "page", "rect"]) &&
    typeof value.data === "string" &&
    value.data.length <= 4000000 &&
    /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.data) &&
    integer(value.page, 1, MAX_PAGE) &&
    typeof value.width === "number" &&
    typeof value.height === "number" &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    value.width > 0 &&
    value.height > 0 &&
    rectangle(value.rect)
  );
}

function blocks(value: unknown, page: number, maxText: number): boolean {
  if (!Array.isArray(value) || value.length > MAX_BLOCKS) return false;
  let textLength = 0;
  let originCount = 0;
  let rectCount = 0;
  let inlineCount = 0;
  return value.every((block: unknown) => {
    if (
      !object(block) ||
      !keys(block, [
        "kind",
        "text",
        "origins",
        "translate",
        "continued",
        "incomplete",
        "equationNumber",
        "media",
        "inlineMath",
        "runningCandidate",
        "startsIndented",
        "figureMarker",
        "figureLabel",
      ]) ||
      typeof block.kind !== "string" ||
      !KINDS.has(block.kind) ||
      typeof block.text !== "string" ||
      typeof block.translate !== "boolean" ||
      !Array.isArray(block.origins)
    )
      return false;
    textLength += block.text.length;
    if (block.media !== undefined && !media(block.media)) return false;
    if (block.inlineMath !== undefined) {
      if (!Array.isArray(block.inlineMath)) return false;
      inlineCount += block.inlineMath.length;
      if (inlineCount > maxText) return false;
      let end = 0;
      for (const span of block.inlineMath) {
        if (
          !object(span) ||
          !keys(span, ["start", "end", "page", "rect", "media"]) ||
          !integer(span.start, end, block.text.length - 1) ||
          !integer(span.end, span.start + 1, block.text.length) ||
          !integer(span.page, 1, MAX_PAGE) ||
          !block.origins.some(
            (origin) => object(origin) && origin.page === span.page,
          ) ||
          !rectangle(span.rect) ||
          (span.media !== undefined &&
            (!media(span.media) ||
              !object(span.media) ||
              span.media.page !== span.page))
        )
          return false;
        end = span.end;
      }
    }
    originCount += block.origins.length;
    if (textLength > maxText || originCount > MAX_ORIGINS) return false;
    for (const flag of [
      "continued",
      "runningCandidate",
      "figureMarker",
      "startsIndented",
    ]) {
      if (block[flag] !== undefined && typeof block[flag] !== "boolean")
        return false;
    }
    if (
      block.incomplete !== undefined &&
      (typeof block.incomplete !== "string" || block.incomplete.length > 1024)
    )
      return false;
    if (
      block.equationNumber !== undefined &&
      (typeof block.equationNumber !== "string" ||
        !/^\(\d+[a-z]?\)$/.test(block.equationNumber))
    )
      return false;
    if (
      block.figureLabel !== undefined &&
      (typeof block.figureLabel !== "string" || block.figureLabel.length > 1024)
    )
      return false;
    return block.origins.every((origin: unknown) => {
      if (
        !object(origin) ||
        !keys(origin, ["page", "block", "start", "end", "rects"]) ||
        !integer(
          origin.page,
          Math.max(1, page - 2),
          Math.min(MAX_PAGE, page + 2),
        ) ||
        (origin.block !== undefined &&
          !integer(origin.block, 0, MAX_BLOCKS - 1)) ||
        !integer(origin.start, 0, MAX_TEXT) ||
        !integer(origin.end, origin.start, MAX_TEXT)
      )
        return false;
      // Continuation offsets refer to the original block, not translated text.
      if (origin.rects === undefined) return true;
      if (!Array.isArray(origin.rects)) return false;
      rectCount += origin.rects.length;
      if (rectCount > MAX_ORIGINS) return false;
      return origin.rects.every(
        (rect: unknown) =>
          Array.isArray(rect) &&
          rect.length === 4 &&
          rect.every(
            (coordinate: unknown) =>
              typeof coordinate === "number" && Number.isFinite(coordinate),
          ) &&
          rect[0] <= rect[2] &&
          rect[1] <= rect[3],
      );
    });
  });
}

function savedPage(value: unknown, page: number): value is SavedPage {
  return (
    object(value) &&
    keys(value, ["source", "result"]) &&
    object(value.source) &&
    keys(value.source, ["page", "blocks"]) &&
    value.source.page === page &&
    blocks(value.source.blocks, page, 60000) &&
    blocks(value.result, page, MAX_TEXT) &&
    Array.isArray(value.result) &&
    Array.isArray(value.source.blocks) &&
    value.result.length === value.source.blocks.length
  );
}

function pagePath(context: StorageContext, page: number): string {
  if (!integer(page, 1, MAX_PAGE))
    throw new RangeError("Invalid saved PDF page");
  if (!/^[a-f0-9]{64}$/.test(context.identity))
    throw new TypeError("Invalid saved PDF identity");
  return PathUtils.join(context.directory, `page-${page}.json`);
}

function errorName(error: unknown): unknown {
  return object(error) ? error.name : undefined;
}

export async function readSavedPage(
  context: StorageContext,
  page: number,
): Promise<{ record?: SavedPage; invalid?: boolean }> {
  const path = pagePath(context, page);
  try {
    if (!(await IOUtils.exists(path))) return {};
    const stat = await IOUtils.stat(path);
    if (!integer(stat.size, 0, MAX_FILE_BYTES)) return { invalid: true };
    const value: unknown = await IOUtils.readJSON(path);
    if (
      !object(value) ||
      !keys(value, [
        "schema",
        "identity",
        "page",
        "source",
        "result",
        "checksum",
      ]) ||
      value.schema !== 1 ||
      value.identity !== context.identity ||
      value.page !== page
    )
      return { invalid: true };
    const record = { source: value.source, result: value.result };
    if (value.checksum !== (await sha256(JSON.stringify(record))))
      return { invalid: true };
    return savedPage(record, page) ? { record } : { invalid: true };
  } catch (error) {
    const name = errorName(error);
    if (name === "NotFoundError") return {};
    if (
      name === "SyntaxError" ||
      name === "EncodingError" ||
      name === "DataError"
    )
      return { invalid: true };
    throw error;
  }
}

export async function writeSavedPage(
  context: StorageContext,
  page: number,
  record: SavedPage,
): Promise<void> {
  const path = pagePath(context, page);
  if (!savedPage(record, page))
    throw new TypeError("Invalid saved PDF page record");
  const value = {
    schema: 1,
    identity: context.identity,
    page,
    source: record.source,
    result: record.result,
    checksum: await sha256(JSON.stringify(record)),
  };
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_FILE_BYTES
  )
    throw new RangeError("Saved PDF page exceeds the storage size limit");
  await IOUtils.makeDirectory(context.directory, {
    createAncestors: true,
    ignoreExisting: true,
  });
  const random = new Uint8Array(16);
  crypto.getRandomValues(random);
  const nonce = Array.from(random, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  await IOUtils.writeJSON(path, value, {
    tmpPath: `${path}.${nonce}.tmp`,
    flush: true,
  });
}
