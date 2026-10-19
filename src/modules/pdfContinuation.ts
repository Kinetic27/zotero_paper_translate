import type { InlineMath, ReadingBlock, ReadingPage } from "./pdfReadingTypes";

const MAX_PARAGRAPH_CHARS = 1200;
const MAX_PARAGRAPH_PAGES = 3;

function key(text: string): string {
  return text
    .trim()
    .replace(/^\d+\s+|\s+\d+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}
function complete(text: string): boolean {
  const trimmed = text.trim();
  if (
    /\b(?:e\.g|i\.e|et\s+al|dr|mr|mrs|ms|prof|fig|figs|eq|eqs|ref|refs|vs|etc|no|vol|pp)\.[\]"'”’)]*$/i.test(
      trimmed,
    ) ||
    /(?:^|\s)[A-Z]\.$/.test(trimmed)
  )
    return false;
  return /[.!?][\]"'”’)}]*(?:\s*\[\s*\d[\d\s,;–—-]*\])*$/u.test(trimmed);
}
function join(left: string, right: string): string {
  const word = /([A-Za-z]+)[\u00ad-]\s*$/.exec(left);
  if (word && /^[a-z]/.test(right)) {
    const compound =
      /^(?:multi|Multi|ultra|Ultra|two|three|high|low|query|memory|retrieval|inference|state|self|end|pre|long|short)$/u.test(
        word[1],
      );
    if (compound) return left.trimEnd() + right;
    if (/^[a-z]{2,}$/.test(word[1]))
      return left.replace(/[\u00ad-]\s*$/, "") + right;
  }
  return `${left.trimEnd()} ${right.trimStart()}`;
}
interface Fragment {
  page: number;
  index: number;
  block: ReadingBlock;
}

/** Each page gets the entire bounded boundary paragraph. Raw pages stay immutable. */
export async function completeReadingPage(
  page: number,
  pageCount: number,
  load: (page: number) => Promise<ReadingPage>,
): Promise<ReadingPage> {
  if (!Number.isInteger(page) || page < 1 || page > pageCount)
    throw new RangeError("Reading page is outside the document");
  const pages = new Map<number, ReadingPage>();
  await Promise.all(
    Array.from({ length: 7 }, (_, i) => page + i - 3)
      .filter((n) => n >= 1 && n <= pageCount)
      .map(async (n) => {
        pages.set(n, await load(n));
      }),
  );
  const counts = new Map<string, number>();
  for (const raw of pages.values()) {
    const keys = new Set(
      raw.blocks
        .filter((block) => block.runningCandidate && block.text.length <= 160)
        .map((block) => key(block.text)),
    );
    for (const value of keys) counts.set(value, (counts.get(value) || 0) + 1);
  }
  const normalized = new Map<number, ReadingPage>();
  for (const [number, raw] of pages)
    normalized.set(number, {
      ...raw,
      blocks: raw.blocks.map((block) =>
        block.runningCandidate && (counts.get(key(block.text)) || 0) > 1
          ? { ...block, kind: "running", translate: false }
          : {
              ...block,
              origins: block.origins.map((origin) => ({ ...origin })),
            },
      ),
    });
  for (const raw of normalized.values())
    for (const block of raw.blocks) {
      if (
        !["body", "reference"].includes(block.kind) ||
        block.text.trim() !== String(raw.page)
      )
        continue;
      const rect = block.origins[0]?.rects?.[0];
      if (
        rect &&
        raw.blocks.some(
          (peer) =>
            peer.kind === "running" &&
            peer.origins.some((origin) =>
              origin.rects?.some(
                (other) =>
                  Math.abs(other[1] - rect[1]) < Math.max(3, rect[3] - rect[1]),
              ),
            ),
        )
      ) {
        block.kind = "running";
        block.translate = false;
      }
    }
  // Figures/captions and footnote metadata may physically interrupt a body
  // boundary. Headings, equations and references are real barriers, not skipped.
  const apparatus = new Set([
    "running",
    "figure",
    "table",
    "algorithm",
    "caption",
    "authors",
    "affiliation",
    "footnote",
  ]);
  const significant = (number: number): Fragment[] =>
    (normalized.get(number)?.blocks || [])
      .map((block, index) => ({ page: number, index, block }))
      .filter(
        (fragment) =>
          fragment.block.text.trim() && !apparatus.has(fragment.block.kind),
      );
  const id = (fragment: Fragment) => `${fragment.page}:${fragment.index}`;
  const next = new Map<string, Fragment>();
  const previous = new Map<string, Fragment>();
  for (
    let number = Math.max(1, page - 2);
    number < Math.min(pageCount, page + 2);
    number++
  ) {
    const left = significant(number).at(-1);
    const right = significant(number + 1)[0];
    if (
      !left ||
      !right ||
      left.block.kind !== "body" ||
      right.block.kind !== "body" ||
      complete(left.block.text)
    )
      continue;
    // A lower-case leading fragment corroborates continuation; an uppercase
    // fresh paragraph is not silently absorbed merely because its neighbor ends.
    if (
      !/^[\p{Ll}]/u.test(right.block.text.trimStart()) &&
      !(
        right.block.startsIndented === false &&
        /^(?:\p{Lu}|\d+[.,]\d+\s+\p{L}|\[\d+)/u.test(
          right.block.text.trimStart(),
        ) &&
        right.block.text.length > 35
      )
    )
      continue;
    next.set(id(left), right);
    previous.set(id(right), left);
  }
  const raw = normalized.get(page)!;
  const replacements = new Map<number, ReadingBlock>();
  const pageEdges = significant(page);
  for (const fragment of pageEdges.filter(
    (fragment) =>
      fragment.block.kind === "body" &&
      (fragment === pageEdges[0] || fragment === pageEdges.at(-1)),
  )) {
    let first = fragment;
    const seen = new Set<string>();
    while (previous.has(id(first)) && !seen.has(id(first))) {
      seen.add(id(first));
      first = previous.get(id(first))!;
    }
    const chain: Fragment[] = [first];
    while (
      next.has(id(chain[chain.length - 1])) &&
      chain.length <= MAX_PARAGRAPH_PAGES
    )
      chain.push(next.get(id(chain[chain.length - 1]))!);
    let text = "";
    const inlineMath: InlineMath[] = [];
    for (const [index, part] of chain.entries()) {
      text = index
        ? inlineMath.at(-1)?.end === text.length
          ? `${text} ${part.block.text}`
          : join(text, part.block.text)
        : part.block.text;
      const offset = text.length - part.block.text.length;
      inlineMath.push(
        ...(part.block.inlineMath || []).map((span) => ({
          ...span,
          start: span.start + offset,
          end: span.end + offset,
        })),
      );
    }
    const firstIsUncertain =
      first.page > 1 &&
      id(first) === id(significant(first.page)[0]) &&
      /^[\p{Ll}]/u.test(first.block.text.trimStart()) &&
      !previous.has(id(first));
    const last = chain[chain.length - 1];
    const unresolvedEnd =
      id(last) === id(significant(last.page).at(-1)!) &&
      !complete(last.block.text);
    if (
      chain.length > MAX_PARAGRAPH_PAGES ||
      (chain.length > 1 && text.length > MAX_PARAGRAPH_CHARS)
    ) {
      replacements.set(fragment.index, {
        ...fragment.block,
        incomplete:
          "This paragraph exceeds the 3-page / 1,200-character context limit. Only this page's text is shown; see the adjacent PDF pages.",
      });
    } else if (chain.length > 1) {
      replacements.set(fragment.index, {
        ...fragment.block,
        text,
        origins: chain.flatMap((part) => part.block.origins),
        ...(inlineMath.length ? { inlineMath } : {}),
        continued: true,
        ...(firstIsUncertain || unresolvedEnd
          ? {
              incomplete:
                "This paragraph may continue outside the checked pages. Available text is shown; check the adjacent PDF pages for the rest.",
            }
          : {}),
      });
    } else if (firstIsUncertain || unresolvedEnd) {
      replacements.set(fragment.index, {
        ...fragment.block,
        incomplete:
          "This paragraph may be incomplete. A safe continuation was not found on the adjacent pages; this page's text is kept in full.",
      });
    }
  }
  return {
    ...raw,
    blocks: raw.blocks.map((block, index) => replacements.get(index) || block),
  };
}
