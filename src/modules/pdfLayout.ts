import type {
  BlockKind,
  GeometryContent,
  GeometryItem,
  InlineMath,
  ReadingBlock,
  ReadingPage,
} from "./pdfReadingTypes";

interface Run {
  text: string;
  x: number;
  right: number;
  y: number;
  size: number;
  font: string;
  math: boolean;
  eol: boolean;
  marginal: boolean;
  originalY: number;
}
interface Line {
  text: string;
  x: number;
  right: number;
  y: number;
  size: number;
  font: string;
  math: boolean;
  column: number;
  runIn: boolean;
  top: number;
  bottom: number;
  display?: boolean;
  displayBounds?: number[];
  numberBounds?: number[];
  equationNumber?: string;
  inlineMath?: Omit<InlineMath, "page">[];
}
interface Row {
  y: number;
  size: number;
  runs: Run[];
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 1;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function joinRuns(
  runs: Run[],
  proseFont: string,
): {
  text: string;
  inlineMath: Omit<InlineMath, "page">[];
} {
  let text = "";
  let previous: Run | undefined;
  const spans: { run: Run; start: number; end: number }[] = [];
  for (const run of runs) {
    const gap = previous ? run.x - previous.right : 0;
    const separated =
      previous &&
      (/\s$/.test(previous.text) ||
        /^\s/.test(run.text) ||
        gap > Math.min(previous.size, run.size) * 0.22);
    if (separated) text += " ";
    const start = text.length;
    text += normalize(run.text);
    spans.push({ run, start, end: text.length });
    previous = run;
  }
  const inlineMath: Omit<InlineMath, "page">[] = [];
  const proseContext = runs.some((run) => /[a-z]{3,}\s+[a-z]/i.test(run.text));
  let group: typeof spans = [];
  const flush = () => {
    const symbolic = group.some(
      ({ run }) =>
        run.math ||
        /[\u{1D400}-\u{1D7FF}α-ωΑ-Ω=+−×÷∑∫√∞≈≠≤≥∂∇∈∏^_]/u.test(run.text) ||
        Math.abs(run.originalY - run.y) > run.size * 0.15 ||
        (proseContext &&
          run.font !== proseFont &&
          /^[A-Za-zΑ-Ωα-ω]{1,2}$/u.test(run.text.replace(/[(),.\s]/g, ""))),
    );
    // Superscript citation numbers alone are not mathematical expressions.
    if (
      symbolic &&
      group.some(({ run }) => /[\p{L}=+−×÷∑∫√∞≈≠≤≥∂∇∈∏]/u.test(run.text))
    ) {
      inlineMath.push({
        start: group[0].start,
        end: group.at(-1)!.end,
        rect: [
          Math.min(...group.map(({ run }) => run.x)),
          Math.min(...group.map(({ run }) => run.originalY - run.size * 0.85)),
          Math.max(...group.map(({ run }) => run.right)),
          Math.max(...group.map(({ run }) => run.originalY + run.size * 0.2)),
        ],
      });
    }
    group = [];
  };
  for (const span of spans) {
    const value = span.run.text.trim();
    const compatible =
      !/\s+\p{L}{3}/u.test(value) &&
      (!/[A-Za-z]{3,}/.test(value) ||
        span.run.math ||
        Math.abs(span.run.originalY - span.run.y) > span.run.size * 0.15 ||
        /^(?:argmax|argmin|softmax|sin|cos|tan|log|exp|lim|max|min|sup|inf|det|diag)\b/.test(
          value,
        ) ||
        /^[A-Za-z]+_[A-Za-z]+$/.test(value)) &&
      !/\b(?:is|in|as|to|of|an|or|by|on|at|be|we|it)\b/i.test(value);
    const prior = group.at(-1)?.run;
    if (
      !compatible ||
      (prior &&
        span.run.x - prior.right > Math.max(prior.size, span.run.size) * 0.8)
    )
      flush();
    if (compatible) group.push(span);
  }
  flush();
  return { text, inlineMath };
}

function makeLine(runs: Run[], column: number): Line {
  const dominant = runs.reduce((a, b) =>
    a.text.length >= b.text.length ? a : b,
  );
  const joined = joinRuns(runs, dominant.font);
  return {
    text: joined.text,
    inlineMath: joined.inlineMath,
    x: Math.min(...runs.map((run) => run.x)),
    right: Math.max(...runs.map((run) => run.right)),
    y: median(runs.map((run) => run.y)),
    top: Math.min(...runs.map((run) => run.originalY - run.size * 0.85)),
    bottom: Math.max(...runs.map((run) => run.originalY + run.size * 0.2)),
    size: dominant.size,
    font: dominant.font,
    math:
      runs
        .filter((run) => run.math)
        .reduce((n, run) => n + run.text.length, 0) >
      runs.reduce((n, run) => n + run.text.length, 0) * 0.35,
    column,
    runIn: (() => {
      const prefix = runs.find((run) => run.text.trim());
      return (
        !!prefix &&
        prefix !== dominant &&
        prefix.font !== dominant.font &&
        prefix.text.trim().length <= 60 &&
        /^[\p{Lu}][\p{L}\s-]+[.:]$/u.test(prefix.text.trim()) &&
        Math.abs(prefix.size - dominant.size) < dominant.size * 0.15
      );
    })(),
  };
}

function segments(row: Row, width: number): Run[][] {
  const groups: Run[][] = [];
  let right = -Infinity;
  for (const run of row.runs) {
    const group = groups[groups.length - 1];
    if (!group || run.x - right > Math.max(row.size * 1.4, width * 0.018)) {
      groups.push([run]);
      right = run.right;
    } else {
      group.push(run);
      right = Math.max(right, run.right);
    }
  }
  return groups;
}

// A gutter must be supported by several genuinely separated baseline rows.
// A centered heading or a single short line cannot establish columns.
function findGutter(
  rows: Row[],
  width: number,
  height: number,
): number | undefined {
  const fragments = rows.flatMap((row) =>
    segments(row, width).map((group) => makeLine(group, 0)),
  );
  let best: number[] = [];
  let bestCount = 0;
  // A fixed half-percent grid bounds gutter evaluation even for PDFs with
  // thousands of separate glyph items; never enumerate fragment pairs.
  for (let step = 60; step <= 140; step++) {
    const cut = (width * step) / 200;
    const margin = width * 0.005;
    const left = fragments.filter(
      (line) =>
        line.right <= cut - margin && line.right - line.x >= width * 0.13,
    );
    const right = fragments.filter(
      (line) => line.x >= cut + margin && line.right - line.x >= width * 0.13,
    );
    if (left.length < 3 || right.length < 3) continue;
    const top = Math.max(
      Math.min(...left.map((line) => line.y)),
      Math.min(...right.map((line) => line.y)),
    );
    const bottom = Math.min(
      Math.max(...left.map((line) => line.y)),
      Math.max(...right.map((line) => line.y)),
    );
    const inBand = fragments.filter(
      (line) => line.y >= top && line.y <= bottom,
    );
    const supporting = inBand.filter(
      (line) => line.right <= cut - margin || line.x >= cut + margin,
    );
    if (
      left.filter((line) => line.y >= top && line.y <= bottom).length >= 3 &&
      right.filter((line) => line.y >= top && line.y <= bottom).length >= 3 &&
      bottom - top >=
        Math.max(
          height * 0.035,
          median(inBand.map((line) => line.size)) * 2.5,
        ) &&
      supporting.length >= inBand.length * 0.6 &&
      supporting.length >= bestCount
    ) {
      if (supporting.length > bestCount) best = [];
      best.push(cut);
      bestCount = supporting.length;
    }
  }
  // Prefer the middle of equally supported whitespace, not its left edge:
  // otherwise right-aligned equation numbers drift into the next column.
  return best.find((cut) => cut >= (best[0] + best[best.length - 1]) / 2);
}

function orderLines(rows: Row[], width: number, height: number): Line[] {
  const gutter = findGutter(rows, width, height);
  const columnLines = (runs: Run[], column: number): Line[] => {
    const number = runs.at(-1);
    const before = runs.at(-2);
    if (
      number &&
      before &&
      /^\(\d+[a-z]?\)$/.test(number.text.trim()) &&
      number.x - before.right > number.size * 1.4
    )
      return [makeLine(runs.slice(0, -1), column), makeLine([number], column)];
    return [makeLine(runs, column)];
  };
  if (gutter === undefined) {
    // Without persistent gutter evidence retain baseline order, but do not
    // concatenate remote text fragments into a fictitious sentence.
    return rows.flatMap((row) =>
      segments(row, width).map((runs) => makeLine(runs, 0)),
    );
  }
  const ordered: Line[] = [];
  let band: Line[] = [];
  const flush = () => {
    ordered.push(...band.filter((line) => line.column === 0));
    ordered.push(...band.filter((line) => line.column === 1));
    band = [];
  };
  for (const row of rows) {
    const crosses = row.runs.some(
      (run) => run.x < gutter && run.right > gutter,
    );
    const left = row.runs.filter((run) => (run.x + run.right) / 2 < gutter);
    const right = row.runs.filter((run) => (run.x + run.right) / 2 >= gutter);
    const gap =
      left.length && right.length
        ? Math.min(...right.map((run) => run.x)) -
          Math.max(...left.map((run) => run.right))
        : Infinity;
    if (crosses || gap < Math.max(row.size * 1.4, width * 0.018)) {
      flush();
      ordered.push(...columnLines(row.runs, -1));
    } else {
      if (left.length) band.push(...columnLines(left, 0));
      if (right.length) band.push(...columnLines(right, 1));
    }
  }
  flush();
  return ordered;
}

function equation(line: Line): boolean {
  if (/^\{[A-Za-z_]+\}$/.test(line.text.trim())) return false;
  const compact = line.text.replace(/\s/g, "");
  const symbols = (compact.match(/[=+−×÷∑∫√∞≈≠≤≥∂∇∈∏^_{}]/g) || []).length;
  const letters = (compact.match(/[A-Za-z]/g) || []).length;
  return (
    (line.math && (symbols > 0 || letters < compact.length * 0.7)) ||
    (symbols >= 2 &&
      symbols / Math.max(compact.length, 1) >= 0.22 &&
      letters < 18)
  );
}

function appendLine(text: string, next: string): string {
  // Do not remove hyphens from names, uppercase tokens, digits or punctuation.
  const ending = /([\p{L}]+)[\u00ad-]\s*$/u.exec(text);
  if (ending && /^[A-Z][a-z]/.test(next)) return text.trimEnd() + next;
  if (ending && /^[a-z]+\b/.test(next)) {
    // Common productive compounds keep their hyphen; ordinary lowercase
    // typesetter syllable splits (retrievabil-ity, sim-ple, tempo-ral) join.
    const compound =
      /^(?:multi|Multi|ultra|Ultra|two|three|high|low|query|memory|retrieval|inference|state|self|end|pre|long|short)$/u.test(
        ending[1],
      );
    if (compound) return text.trimEnd() + next;
    if (/^[a-z]{2,}$/.test(ending[1]))
      return text.replace(/[\u00ad-]\s*$/u, "") + next;
  }
  return `${text} ${next}`;
}

/** Reconstruct reading order from PDF.js geometry without discarding text. */
export function reconstructPage(
  page: number,
  content: GeometryContent,
  width: number,
  height: number,
): ReadingPage {
  const runs: Run[] = [];
  for (const entry of content.items) {
    if (!("str" in entry) || !entry.str.trim()) continue;
    const item = entry as GeometryItem;
    const t = item.transform || [];
    const size = Math.max(
      Math.hypot(t[2] || 0, t[3] || 0),
      Math.hypot(t[0] || 0, t[1] || 0),
      Math.abs(item.height || 0),
      1,
    );
    const x = Number.isFinite(t[4]) ? t[4] : 0;
    const y = Number.isFinite(t[5]) ? height - t[5] : runs.length * size;
    const runWidth = Number.isFinite(item.width)
      ? Math.abs(item.width)
      : size * item.str.length * 0.5;
    const family = content.styles[item.fontName]?.fontFamily || "";
    runs.push({
      text: item.str,
      x,
      right: x + runWidth,
      y,
      originalY: y,
      size,
      font: `${item.fontName} ${family}`,
      math: /math|cmsy|cmmi|cmex|symbol|msam|msbm/i.test(
        `${item.fontName} ${family}`,
      ),
      eol: item.hasEOL,
      marginal:
        Math.abs(t[0] || 0) < Math.abs(t[1] || 0) * 0.2 &&
        (x < width * 0.1 || x > width * 0.9),
    });
  }
  if (!runs.length) return { page, blocks: [] };
  width =
    Number.isFinite(width) && width > 0
      ? width
      : Math.max(...runs.map((run) => run.right), 1);
  height =
    Number.isFinite(height) && height > 0
      ? height
      : Math.max(...runs.map((run) => run.y), 1);
  // Attach small raised author/affiliation markers to the nearby real baseline.
  // Do not use every font change as a new line or insert word spaces inside
  // typographic emphasis such as bold M + regular ulti-key.
  const anchors = new Map<Run, Run>();
  const scripts: Run[] = [];
  for (const run of runs) {
    // A smaller prose line is not a script, even when it overlaps a larger
    // heading or inline token on the adjacent baseline.
    const script = run.text.trim();
    const wordScript = /\p{L}{4}/u.test(script);
    if (
      script.length > 16 ||
      /\s/u.test(script) ||
      run.right - run.x > run.size * 5 ||
      run.marginal
    )
      continue;
    const anchor = runs
      .filter(
        (other) =>
          other !== run &&
          !other.marginal &&
          other.size > run.size * 1.2 &&
          other.size < run.size * 2 &&
          (!wordScript ||
            (other.font !== run.font &&
              (other.math ||
                /^[A-Za-zα-ωΑ-Ω\u{1D400}-\u{1D7FF}]{1,2}$/u.test(
                  other.text.trim(),
                )))) &&
          Math.abs(other.originalY - run.originalY) >= other.size * 0.15 &&
          Math.abs(other.originalY - run.originalY) < other.size * 0.65 &&
          run.x >= other.x - other.size &&
          run.x <= other.right + other.size,
      )
      .sort(
        (a, b) =>
          Math.abs(a.originalY - run.originalY) -
            Math.abs(b.originalY - run.originalY) ||
          Math.abs(run.x - a.right) - Math.abs(run.x - b.right),
      )[0];
    if (wordScript && !anchor) continue;
    scripts.push(run);
    if (anchor) anchors.set(run, anchor);
  }
  // A wide exponent can extend beyond its base glyph. Attach connected
  // same-size script runs together, then resolve nested superscripts through
  // their parent script rather than leaving a fictitious prose baseline.
  const scriptGroups: Run[][] = [];
  for (const run of scripts.sort(
    (a, b) => a.originalY - b.originalY || a.x - b.x,
  )) {
    const group = scriptGroups.at(-1);
    const previous = group?.at(-1);
    if (
      previous &&
      Math.abs(run.originalY - previous.originalY) < run.size * 0.3 &&
      Math.abs(run.size - previous.size) < run.size * 0.15 &&
      run.x - previous.right < run.size * 0.8
    )
      group!.push(run);
    else scriptGroups.push([run]);
  }
  for (const group of scriptGroups) {
    const anchor = group.map((run) => anchors.get(run)).find(Boolean);
    if (anchor)
      for (const run of group) if (!anchors.has(run)) anchors.set(run, anchor);
  }
  for (const run of scripts) {
    let anchor = anchors.get(run);
    const seen = new Set<Run>([run]);
    while (anchor && !seen.has(anchor)) {
      seen.add(anchor);
      run.y = anchor.originalY;
      anchor = anchors.get(anchor);
    }
  }
  runs.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Row[] = [];
  for (const run of runs.filter((run) => !run.marginal)) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(run.y - row.y) <= Math.min(run.size, row.size) * 0.3) {
      row.runs.push(run);
    } else {
      rows.push({ y: run.y, size: run.size, runs: [run] });
    }
  }
  for (const row of rows) row.runs.sort((a, b) => a.x - b.x);
  const marginalLines = runs
    .filter((run) => run.marginal)
    .map((run) => makeLine([run], -2));
  let lines = [...orderLines(rows, width, height), ...marginalLines];
  // Numbered displays can contain several baselines (indices, fractions,
  // large delimiters). A right-hand number anchors the local math band.
  const numbers = lines.filter((line) => /^\(\d+[a-z]?\)$/.test(line.text));
  for (const number of numbers) {
    // A display number is right-aligned within its column, not necessarily
    // within the entire page. Prose and another number bound the math band.
    const neighbours = lines.filter(
      (line) =>
        line !== number &&
        !line.display &&
        line.column === number.column &&
        line.right < number.x &&
        Math.abs(line.y - number.y) < number.size * 3.5,
    );
    const prose = (line: Line) =>
      (line.text.match(/\b[A-Za-z]{4,}\b/g) || []).length >= 3 ||
      /[a-z]{5,}\s+[a-z]{5,}/i.test(line.text) ||
      (line.font === number.font &&
        /^[\p{L}]{2,}\s+[\p{L}]+(?:\s|[=])/u.test(line.text) &&
        /[.!?]$/.test(line.text));
    const barriers = [
      ...neighbours.filter(prose),
      ...numbers.filter(
        (other) => other !== number && other.column === number.column,
      ),
    ];
    const upper = Math.max(
      -Infinity,
      ...barriers.filter((line) => line.y < number.y).map((line) => line.y),
    );
    const lower = Math.min(
      Infinity,
      ...barriers.filter((line) => line.y > number.y).map((line) => line.y),
    );
    const band = neighbours.filter(
      (line) => line.y > upper && line.y < lower && !prose(line),
    );
    const math = band.filter(
      (line) => line.math || /[=+−×÷∑∫√∞≈≠≤≥∂∇∈∏^_{}⏟⏞]/u.test(line.text),
    );
    if (
      !math.some((line) => /[=∈⊆≤≥∑∫]/u.test(line.text)) ||
      Math.min(...math.map((line) => Math.abs(line.y - number.y))) >
        number.size * 1.5
    )
      continue;
    const first = Math.min(...math.map((line) => line.y));
    const last = Math.max(...math.map((line) => line.y));
    const left = Math.min(...math.map((line) => line.x));
    const right = Math.max(...math.map((line) => line.right));
    const parts = band.filter(
      (line) =>
        math.includes(line) ||
        (line.x >= left - number.size &&
          line.right <= right + number.size &&
          line.y >= first - number.size &&
          line.y <= last + number.size * 1.5 &&
          (line.text.length <= 3 || line.size < number.size * 0.85)),
    );
    if (parts.reduce((n, line) => n + line.text.length, 0) > 512) continue;
    const at = Math.min(...parts.map((line) => lines.indexOf(line)));
    const combined = {
      ...parts[0],
      text:
        parts
          .slice()
          .sort((a, b) =>
            Math.abs(a.y - b.y) > number.size * 0.3 ? a.y - b.y : a.x - b.x,
          )
          .map((line) => line.text)
          .join(" ") +
        " " +
        number.text,
      x: Math.min(...parts.map((line) => line.x)),
      right: number.right,
      y: number.y,
      size: number.size,
      display: true,
      equationNumber: number.text,
      displayBounds: [
        Math.min(...parts.map((line) => line.x)),
        height - Math.max(...parts.map((line) => line.bottom)),
        Math.max(...parts.map((line) => line.right)),
        height - Math.min(...parts.map((line) => line.top)),
      ],
      numberBounds: [
        number.x,
        height - number.bottom,
        number.right,
        height - number.top,
      ],
    };
    lines = lines.filter((line) => line !== number && !parts.includes(line));
    lines.splice(Math.min(at, lines.length), 0, combined);
  }
  // Weight the body-size estimate by text, not by isolated superscripts.
  const sizes = lines.flatMap(
    (line) =>
      Array(Math.min(80, Math.max(1, line.text.length))).fill(
        line.size,
      ) as number[],
  );
  const bodySize = median(sizes);
  const abstractIndex = lines.findIndex((line) =>
    /^abstract\b/i.test(line.text),
  );
  const titleIndex =
    page === 1
      ? lines.findIndex(
          (line) =>
            line.y < height * 0.25 &&
            line.size >= bodySize * 1.3 &&
            !equation(line),
        )
      : -1;
  const blocks: ReadingBlock[] = [];
  let previous: Line | undefined;
  let previousKind: BlockKind | undefined;
  let references =
    lines.filter((line) => /^(?:\[\d+\]|\d+[.)])\s+[A-ZÀ-ÖØ-Þ]/.test(line.text))
      .length >= 3 &&
    lines.filter((line) =>
      /^(?:\[\d+\]|\d+[.)])\s+\p{Lu}[\p{L}'’-]+,?\s+(?:\p{Lu}\.|[\p{L}]+,)/u.test(
        line.text,
      ),
    ).length >= 2;
  let inAbstract = false;
  let frontMatter = titleIndex >= 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const bold = /bold|black|heavy|semibold/i.test(line.font);
    const abstractLabel = /^abstract\b[\s.:—–-]*/i.test(line.text);
    const referenceHeading =
      /^(?:\d+[.\s]+)?(?:references|bibliography|literature cited)\s*$/i.test(
        line.text,
      );
    const standaloneReference =
      /^(?:\[\d+\]|\d+[.)])\s+[A-ZÀ-ÖØ-Þ]/.test(line.text) &&
      /\b(?:18|19|20)\d{2}[a-z]?\b|\bdoi\s*:|\b10\.\d{4,9}\//i.test(line.text);
    const numberedHeading =
      /^\d+(?:\.\d+)*[.)]?\s+\S/.test(line.text) &&
      (bold ||
        line.size > bodySize * 1.08 ||
        (index + 1 < lines.length &&
          line.font !== lines[index + 1].font &&
          line.y < lines[index + 1].y &&
          lines[index + 1].y - line.y > line.size * 1.3 &&
          /\p{L}/u.test(line.text))) &&
      line.text.length < 160;
    let kind: BlockKind = "body";
    if (line.column === -2 && /arxiv/i.test(line.text)) {
      kind = "running";
    } else if (referenceHeading) {
      kind = "heading";
      references = true;
      inAbstract = false;
      frontMatter = false;
    } else if (references || standaloneReference) {
      kind = "reference";
    } else if (abstractLabel) {
      kind = "abstract";
      inAbstract = true;
      frontMatter = false;
    } else if (
      numberedHeading ||
      (/^(?:[A-Z](?:\.\d+)*\s+\p{Lu}|Supplementary Materials$)/u.test(
        line.text,
      ) &&
        line.text.length < 120 &&
        (line.runIn ||
          line.font !== lines[index + 1]?.font ||
          line.size > bodySize * 1.1))
    ) {
      kind = "heading";
      inAbstract = false;
      frontMatter = false;
    } else if (
      /^(?:fig(?:ure)?\.?|table|plate)\s*\d+\s*[:.]/i.test(line.text)
    ) {
      kind = "caption";
    } else if (
      line.display ||
      equation(line) ||
      (/^[\p{L}\p{N}\s=+−–*/^_(),.{}[\]∑∫∂√∞≤≥<>|]+$/u.test(line.text) &&
        line.text.includes("=") &&
        line.text.replace(/\s/g, "").length < 65 &&
        Math.abs((line.x + line.right) / 2 - width / 2) < width * 0.15 &&
        line.x > width * 0.2)
    ) {
      kind = "equation";
    } else if (
      previousKind === "caption" &&
      previous &&
      line.column === previous.column &&
      line.y - previous.y > 0 &&
      line.y - previous.y < line.size * 1.65 &&
      Math.abs(line.size - previous.size) < bodySize * 0.15 &&
      !/^\d+(?:\.\d+)*\s/.test(line.text)
    ) {
      kind = "caption";
    } else if (
      titleIndex >= 0 &&
      index >= titleIndex &&
      line.y < height * 0.25 &&
      line.size >= bodySize * 1.3
    ) {
      kind = "title";
    } else if (
      page === 1 &&
      frontMatter &&
      index > titleIndex &&
      (abstractIndex < 0 ? line.y < height * 0.35 : index < abstractIndex) &&
      /\b(?:university|institute|department|laborator(?:y|ies)|school of|college|research|project page)\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/i.test(
        line.text,
      )
    ) {
      kind = "affiliation";
    } else if (
      page === 1 &&
      frontMatter &&
      index > titleIndex &&
      (abstractIndex < 0 ? line.y < height * 0.3 : index < abstractIndex) &&
      line.text.length < 180 &&
      (/^[*∗†‡\d\s,]+$/.test(line.text) ||
        (/^[\p{Lu}][\p{L}.'’−-]+(?:\s+(?:[\p{Lu}][\p{L}.'’−-]*|and|de|van|von)|[,;\d*∗†‡ ]+)+$/u.test(
          line.text,
        ) &&
          (/(?:[,;]|\band\b|\b[A-Z]\.)/.test(line.text) ||
            (abstractIndex > index &&
              line.size <= bodySize * 1.15 &&
              line.text.split(/\s+/).length >= 2 &&
              line.text
                .split(/\s+/)
                .every((word) =>
                  /^[\p{Lu}][\p{Ll}'’−-]+[\d*∗†‡]*$/u.test(word),
                )))))
    ) {
      kind = "authors";
    } else if (
      /^[†‡*∗]?\s*(?:Co-corresponding authors|Corresponding authors?|Equal contribution)[.\s]/i.test(
        line.text,
      )
    ) {
      kind = "affiliation";
    } else if (
      (line.column === -2 ||
        line.y < height * 0.045 ||
        line.y > height * 0.955 ||
        (line.y > height * 0.9 &&
          /^\d{1,5}$/.test(line.text) &&
          Math.abs((line.x + line.right) / 2 - width / 2) < width * 0.08 &&
          lines.every(
            (other) =>
              other === line ||
              other.column === -2 ||
              other.y < line.y - line.size * 1.2,
          ))) &&
      line.size <= bodySize * 1.05 &&
      line.text.length < 150 &&
      /^(?:[-–—]?\s*\d{1,5}\s*[-–—]?|arXiv:.*|©.*|Copyright\b.*)$/i.test(
        line.text,
      )
    ) {
      kind = "running";
    } else if (inAbstract) {
      const gap = previous ? line.y - previous.y : 0;
      if (
        previous &&
        (gap > line.size * 3.2 ||
          bold ||
          line.size > bodySize * 1.15 ||
          (line.column === previous.column &&
            !/^abstract\b/i.test(previous.text) &&
            line.size < previous.size * 0.95 &&
            gap > line.size * 1.8))
      ) {
        inAbstract = false;
      } else {
        kind = "abstract";
      }
    }
    if (kind === "affiliation" || kind === "running") inAbstract = false;
    if (kind === "body" && index > titleIndex) frontMatter = false;
    const gap = previous ? line.y - previous.y : Infinity;
    const sameParagraph =
      previous &&
      previousKind === kind &&
      !(
        index < 4 &&
        previous.y <= lines[0].y + bodySize &&
        previous.y < height * 0.16 &&
        previous.text.length < 40
      ) &&
      !/^[–—•]\s|^\d+[.)]\s/.test(line.text) &&
      !(line.runIn && /[.!?][)\]”’]*$/.test(previous.text)) &&
      previous.column === line.column &&
      gap > -line.size * 0.3 &&
      gap <= Math.max(previous.size, line.size) * 1.65 &&
      Math.abs(previous.size - line.size) <= bodySize * 0.15 &&
      (Math.abs(previous.x - line.x) <= bodySize * 2.1 ||
        ["title", "authors", "affiliation"].includes(kind)) &&
      !(
        line.x - previous.x > bodySize * 0.65 &&
        /[.!?][)\]”’]*$/.test(previous.text)
      ) &&
      kind !== "heading" &&
      kind !== "running" &&
      kind !== "equation" &&
      !(kind === "reference" && /^(?:\[\d+\]|\d+[.)])\s/.test(line.text));
    const last = blocks[blocks.length - 1];
    const rect = line.displayBounds || [
      line.x,
      height - line.bottom,
      line.right,
      height - line.top,
    ];
    const inlineMath = ["body", "abstract", "caption", "footnote"].includes(
      kind,
    )
      ? (line.inlineMath || []).map((span) => ({
          ...span,
          page,
          rect: [
            span.rect[0],
            height - span.rect[3],
            span.rect[2],
            height - span.rect[1],
          ],
        }))
      : [];
    if (sameParagraph && last) {
      const before = last.text.length;
      last.text =
        last.inlineMath?.at(-1)?.end === last.text.length
          ? `${last.text} ${line.text}`
          : appendLine(last.text, line.text);
      const start = last.text.length - line.text.length;
      if (start < before) last.origins[last.origins.length - 1].end = start;
      last.origins.push({ page, start, end: last.text.length, rects: [rect] });
      if (inlineMath.length)
        last.inlineMath = [
          ...(last.inlineMath || []),
          ...inlineMath.map((span) => ({
            ...span,
            start: span.start + start,
            end: span.end + start,
          })),
        ];
    } else {
      blocks.push({
        kind,
        text: line.text,
        ...(inlineMath.length ? { inlineMath } : {}),
        startsIndented:
          line.x >
          Math.min(
            ...lines
              .filter(
                (other) =>
                  other.column === line.column &&
                  Math.abs(other.size - bodySize) < bodySize * 0.2 &&
                  other.text.length > 30,
              )
              .map((other) => other.x),
            line.x,
          ) +
            bodySize * 0.65,
        runningCandidate:
          ((index < 3 && line.y <= lines[0].y + bodySize) ||
            line.y < height * 0.12 ||
            line.y > height * 0.91) &&
          (line.size < bodySize * 0.95 ||
            (index < 3 &&
              line.y < height * 0.16 &&
              line.text.length < 40 &&
              lines.some((other) => other.y > line.y + bodySize * 1.8))) &&
          line.text.length < 150,
        origins: [{ page, start: 0, end: line.text.length, rects: [rect] }],
        ...(line.equationNumber
          ? {
              equationNumber: line.equationNumber,
              origins: [
                {
                  page,
                  start: 0,
                  end: line.text.length - line.equationNumber.length - 1,
                  rects: [rect],
                },
                {
                  page,
                  start: line.text.length - line.equationNumber.length,
                  end: line.text.length,
                  rects: [line.numberBounds!],
                },
              ],
            }
          : {}),
        translate: ![
          "authors",
          "affiliation",
          "equation",
          "reference",
          "running",
        ].includes(kind),
      });
    }
    previous = line;
    previousKind = kind;
  }
  // A right-aligned parenthesized number shares the display equation's
  // baseline, not its reading paragraph. Keep both original coordinate spans.
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index];
    if (block.kind !== "equation") continue;
    block.text = block.text
      .replace(/\s+([),\]])/g, "$1")
      .replace(/([([])\s+/g, "$1");
    const rect = block.origins[0]?.rects?.[0];
    if (!rect) continue;
    const numberIndex = blocks.findIndex(
      (candidate, i) =>
        i !== index &&
        candidate.kind === "body" &&
        /^\(\d+[a-z]?\)$/.test(candidate.text.trim()) &&
        candidate.origins.some((origin) =>
          origin.rects?.some(
            (other) =>
              other[0] > rect[2] &&
              Math.abs(other[1] - rect[1]) <
                Math.max(2, (rect[3] - rect[1]) * 0.4),
          ),
        ),
    );
    if (numberIndex < 0) continue;
    const number = blocks[numberIndex];
    block.equationNumber = number.text.trim();
    block.text = block.text.trimEnd() + " " + block.equationNumber;
    block.origins.push(...number.origins);
    blocks.splice(numberIndex, 1);
    if (numberIndex < index) index--;
  }
  blocks.forEach((block, index) => {
    for (const origin of block.origins) origin.block = index;
  });
  const separated = blocks.flatMap((block) => {
    const label =
      block.kind === "abstract" ? /^Abstract[.:]?\s*/i.exec(block.text) : null;
    if (!label || label[0].length === block.text.length) return [block];
    const offset = label[0].length;
    const labelOrigins = block.origins
      .filter((origin) => origin.start < offset)
      .map((origin) => ({ ...origin, end: Math.min(origin.end, offset) }));
    const proseOrigins = block.origins
      .filter((origin) => origin.end > offset)
      .map((origin) => ({
        ...origin,
        start: Math.max(origin.start, offset) - offset,
        end: origin.end - offset,
      }));
    return [
      {
        ...block,
        text: "Abstract",
        origins: labelOrigins,
        translate: false,
        inlineMath: undefined,
      },
      {
        ...block,
        text: block.text.slice(offset),
        origins: proseOrigins,
        ...(block.inlineMath
          ? {
              inlineMath: block.inlineMath
                .filter((span) => span.start >= offset)
                .map((span) => ({
                  ...span,
                  start: span.start - offset,
                  end: span.end - offset,
                })),
            }
          : {}),
      },
    ];
  });
  const prose = separated.filter((block) => block.kind === "body");
  const authorYearEntries = prose.filter(
    (block) =>
      /^\[[A-Z][A-Za-z+\d-]*\d{2}[a-z]?\]\s+\p{Lu}/u.test(block.text) ||
      (/^(?:\p{Lu}\.|\p{Lu}[\p{Ll}'’-]+)(?:\s+(?:\p{Lu}\.|\p{Lu}[\p{Ll}'’-]+)){1,4}(?:[,.;]|\s+and\b)/u.test(
        block.text,
      ) &&
        /\b(?:19|20)\d{2}[a-z]?\./.test(block.text)),
  );
  if (
    authorYearEntries.length >= 4 &&
    authorYearEntries.length >= prose.length * 0.45 &&
    !separated.some((block) =>
      ["title", "abstract", "heading"].includes(block.kind),
    )
  ) {
    // Density corroborates the entries, never unrelated surrounding prose.
    for (const block of authorYearEntries) {
      block.kind = "reference";
      block.translate = false;
    }
  }
  return { page, blocks: separated };
}
