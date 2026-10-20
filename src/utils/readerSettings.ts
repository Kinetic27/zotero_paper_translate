import { getPref, setPref } from "./prefs";

export const READER_FONT_MIN = 8;
export const READER_FONT_MAX = 40;

const READER_LINE_MIN = 1;
const READER_LINE_MAX = 3;
const READER_FONT_DEFAULT = 12;
const READER_LINE_DEFAULT = 1.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** Read the stored value without writing normalized defaults back. */
function readStoredNumber(key: string, fallback: number) {
  const raw = getPref(key);
  if (typeof raw !== "string" && typeof raw !== "number") return fallback;
  const text = String(raw).trim();
  if (!text) return fallback;
  const value = Number(text);
  return Number.isFinite(value) ? value : fallback;
}

export function getReaderFontSize(): number {
  const size = Math.round(readStoredNumber("fontSize", READER_FONT_DEFAULT));
  return clamp(size, READER_FONT_MIN, READER_FONT_MAX);
}

export function setReaderFontSize(value: number): void {
  const size = Number.isFinite(value) ? Math.round(value) : READER_FONT_DEFAULT;
  setPref("fontSize", String(clamp(size, READER_FONT_MIN, READER_FONT_MAX)));
}

export function getReaderLineHeight(): number {
  return clamp(
    readStoredNumber("lineHeight", READER_LINE_DEFAULT),
    READER_LINE_MIN,
    READER_LINE_MAX,
  );
}

export function setReaderLineHeight(value: number): void {
  const lineHeight = Number.isFinite(value) ? value : READER_LINE_DEFAULT;
  setPref(
    "lineHeight",
    String(clamp(lineHeight, READER_LINE_MIN, READER_LINE_MAX)),
  );
}
