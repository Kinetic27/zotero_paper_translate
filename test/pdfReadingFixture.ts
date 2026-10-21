/** Authored independently of the extractor: positions, fonts and expected order are fixed. */
export const readingFixture = {
  title: "Geometry and Scientific Reading",
  authors: "Alice Smith, Bob Jones",
  markedAuthors: "Alice Smith, Bob Jones1",
  indentedProse:
    "A defining property is structural separation with simple temporal reconstruction. Multi-key Episodic Retrieval preserves query-agnostic evidence.",
  abstract: "We examine spatial reading order in scientific documents.",
  columns: [
    "LEFT-ONE establishes the first observation.",
    "LEFT-TWO records a separate measurement.",
    "LEFT-THREE completes the left column.",
    "RIGHT-ONE begins only after the left column.",
    "RIGHT-TWO checks the second observation.",
    "RIGHT-THREE completes the right column.",
  ],
  equation: "E = mc^2",
  caption: "Figure 1. A measured scientific relationship.",
  continued:
    "The analysis includes several controls, including e.g. the measured result [2]. A second sentence belongs to this paragraph.",
  remaining: "A new paragraph remains here.",
  unsafe: "Literal markup stays visible: <script>unsafe</script>.",
  reference: "[2] Jones, B. Scientific measurements. Journal 12, 34 (2024).",
  header: "SCIENTIFIC READING STUDY",
  affiliation: "Department of Physics, Example University",
  acrossThree:
    "We carry the sentence across intermediate evidence without a gap.",
  capText:
    Array(22)
      .fill("unfinished measurements continue without a terminal sentence")
      .join(" ") + " end.",
  meritBoundary:
    "A defining property of ultra-long video understanding is the structural separation between memory construction time and inference time. During memory construction, the system processes the entire video without knowledge of future queries and builds an external memory. At inference time, a specific question is posed, and the system must retrieve relevant evidence and perform reasoning. This decoupling fundamentally distinguishes long-video settings from conventional short-video Question Answering (QA).",
  runInParagraph:
    "Our Work. Rather than retraining the backbone, we provide relevant evidence. Since these models are constrained by limited context windows, feed them evidence that matters. The model can then reason effectively.",
  centeredCaption:
    "Table 9. A centered grid reports each grouped condition across four measured columns for every evaluated model, with baseline values and per-model solver notes attached to each row.",
  centeredHeader: "Short Med. Long Avg.",
  centeredBody:
    "The paragraph below the centered table remains ordinary readable prose.",
};

interface DrawText {
  text: string;
  x: number;
  y: number;
  size: number;
  font?: "F1" | "F2" | "F3";
  rotated?: boolean;
}

/** Authored text PDFs include blank, multi-page, capped and last-page edges. */
export function makeReadingFixturePDF(): string {
  const at = (
    text: string,
    x: number,
    y: number,
    size = 11,
    font: DrawText["font"] = "F1",
  ): DrawText => ({ text, x, y, size, font });
  const running = (page: number) => [
    at(readingFixture.header, 210, 770, 8),
    at(String(page), 302, 22, 8),
  ];
  const pages: DrawText[][] = [
    [
      ...running(1),
      at(readingFixture.title, 130, 732, 20, "F2"),
      at(readingFixture.authors, 240, 708),
      at("1", 354, 712, 7),
      at(readingFixture.affiliation, 180, 691, 9),
      at("Abstract", 54, 676, 14, "F2"),
      at(readingFixture.abstract, 54, 652),
      at("1. Observations", 54, 612, 14, "F2"),
      // Deliberately wrong stream order: right before left, alternating columns.
      at(readingFixture.columns[3], 326, 580),
      at(readingFixture.columns[0], 54, 580),
      at(readingFixture.columns[4], 326, 556),
      at(readingFixture.columns[1], 54, 556),
      at(readingFixture.columns[5], 326, 532),
      at(readingFixture.columns[2], 54, 532),
      at(readingFixture.equation, 270, 450, 12, "F3"),
      at(readingFixture.caption, 54, 410, 9),
      at("The analysis includes several controls, including e.g. the", 54, 354),
    ],
    [
      ...running(2),
      at("Figure 3. An intervening boundary caption.", 54, 740, 9),
      at(
        "measured result [2]. A second sentence belongs to this paragraph.",
        54,
        710,
      ),
      at("A new paragraph remains here.", 54, 680),
      at("2. Further observations", 54, 650, 14, "F2"),
      at("Independent evidence stays on the second page.", 54, 620),
    ],
    [
      ...running(3),
      at(readingFixture.unsafe, 54, 710),
      at("A conser-", 54, 678),
      at("vative reconstruction keeps uncertain text.", 54, 664),
      at("References", 54, 620, 14, "F2"),
      at(readingFixture.reference, 54, 590, 10),
    ],
    [],
    [
      ...running(5),
      at("3. Bounded lookahead", 54, 710, 14, "F2"),
      at("The preceding paragraph is complete.", 54, 674),
      at("We carry the sentence across", 54, 620),
    ],
    [...running(6), at("intermediate evidence without", 54, 710)],
    [
      ...running(7),
      at("a gap.", 54, 710),
      at("Local material stays.", 54, 680),
    ],
    [
      ...running(8),
      at("4. Character limit", 54, 710, 14, "F2"),
      at("A bounded sentence remains", 54, 674),
    ],
    [
      ...running(9),
      ...Array.from({ length: 22 }, (_, i) =>
        at(
          "unfinished measurements continue without a terminal sentence" +
            (i === 21 ? " end." : ""),
          54,
          710 - i * 14,
          10,
        ),
      ),
    ],
    [...running(10), at("The final page stays unfinished", 54, 710)],
    [
      ...running(11),
      at("A defining property is structural sep-", 69.001, 710, 10),
      at("aration with sim-", 54, 698, 10),
      at("ple tempo-", 54, 686, 10),
      at("ral reconstruction. Multi-", 54, 674, 10),
      at("key Episodic Retrieval preserves query-", 54, 662, 10),
      at("agnostic evidence.", 54, 650, 10),
    ],
    [
      ...running(12),
      ...Array.from({ length: 8 }, (_, i) =>
        at(
          `ChartLabel${i} ${70 + i}.5`,
          60 + (i % 4) * 86,
          600 - Math.floor(i / 4) * 52,
          7,
        ),
      ),
      at("Figure 2. Eight plotted measurements.", 54, 465, 10),
      at(
        "The caption retains its complete explanatory continuation.",
        54,
        453,
        10,
      ),
      at("We measured 77.7 percent in 2026 with 8 samples.", 54, 410, 11),
      at("Table 1. Numeric values remain available.", 54, 370, 11),
      at("12.5 24.0 36.5", 54, 348, 11),
      at("E = mc^2", 260, 310, 12, "F3"),
    ],
    [
      ...running(13),
      at("5. Boundary semantics", 54, 710, 14, "F2"),
      at(
        "A defining property of ultra-long video understanding is the structural",
        69,
        670,
        10,
      ),
      at(
        "separation between memory construction time and inference time. During memory",
        54,
        658,
        10,
      ),
      at(
        "construction, the system processes the entire video without knowledge of future",
        54,
        646,
        10,
      ),
      at(
        "queries and builds an external memory. At inference time, a specific question is",
        54,
        634,
        10,
      ),
    ],
    [
      ...running(14),
      at("Figure 4. Boundary context skips this full caption.", 54, 740, 9),
      at(
        "posed, and the system must retrieve relevant evidence and perform reasoning.",
        54,
        690,
        10,
      ),
      at(
        "This decoupling fundamentally distinguishes long-video settings from conventional",
        54,
        678,
        10,
      ),
      at("short-video Question Answering (QA).", 54, 666, 10),
      at(
        "To address long-range dependencies, a fresh paragraph begins.",
        69,
        620,
        10,
      ),
    ],
    [
      ...running(15),
      at("6.1 Related work", 54, 730, 11, "F2"),
      ...Array.from({ length: 12 }, (_, i) =>
        at(
          "Prior models process long videos with expensive retrieval and repeated reasoning.",
          54,
          700 - i * 13,
          11,
        ),
      ),
      at("Prior approaches miss critical events.", 54, 544, 11),
      at("Our Work.", 54, 530, 11, "F2"),
      at(
        "Rather than retraining the backbone, we provide relevant evidence.",
        111,
        530,
        11,
      ),
      at("Since these models are constrained by limited context", 54, 517, 11),
    ],
    [
      ...running(16),
      at("windows, feed them evidence that matters.", 54, 710, 11),
      at("The model can then reason effectively.", 54, 697, 11),
      at("6.2 Another subsection", 54, 660, 11, "F2"),
      at("A fresh section remains separate.", 54, 632, 11),
    ],
    [
      ...running(17),
      at("7. Method", 54, 730, 14, "F2"),
      at("The memory is built from video V:", 54, 690, 11),
      at("M = F(V),", 275, 660, 11),
      at("(1)", 540, 660, 11),
      at("where F denotes construction. The next answer is:", 54, 620, 11),
      at("A = G(Q, M),", 265, 590, 11),
      at("(2)", 540, 590, 11),
      at(
        "where G denotes the solver. We retain 77.7 percent of 12 samples.",
        54,
        550,
        11,
      ),
    ],
    [
      ...running(18),
      at("A newly visited page needs explicit translation.", 54, 710, 11),
    ],
    [
      ...running(19),
      at("8. Structured evidence", 54, 730, 14, "F2"),
      at("Indexed keys are defined as:", 54, 700, 11),
      at("K = {k, k}.", 230, 660, 11, "F3"),
      at("evt", 259, 665, 7),
      at("i", 259, 657, 7),
      at("sum", 279, 665, 7),
      at("i", 279, 657, 7),
      at("(3)", 540, 660, 11),
      at("- Event key captures actions and inter-", 54, 620, 11),
      at("actions between entities.", 64, 607, 11),
      at("- Summary key preserves the overall clip.", 54, 584, 11),
      at("The remaining prose stays readable.", 54, 550, 11),
    ],
    [
      ...running(20),
      at(
        "Table 2. Measurements remain associated with their rows.",
        54,
        730,
        10,
      ),
      at("Method", 70, 685, 10),
      at("Score", 260, 685, 10),
      at("Baseline", 70, 660, 10),
      at("12.5", 260, 660, 10),
      at("Ours", 70, 635, 10),
      at("24.0", 260, 635, 10),
      at("The table is followed by ordinary readable prose.", 54, 570, 11),
    ],
    [
      ...running(21),
      at("Algorithm 1 Structured inference.", 54, 725, 11, "F2"),
      at("Require: video V, question q, budget B", 54, 703, 10),
      at("1: Initialize anchors A = empty.", 58, 685, 10),
      at("2: for t = 1, 2 while budget remains do", 58, 668, 10),
      at("3: if evidence is stable then", 70, 651, 10),
      at("4: return replay(A, q)", 82, 634, 10),
      at("5: end if", 70, 617, 10),
      at("6: end for", 58, 600, 10),
      at("3.1 Surrounding body", 54, 540, 13, "F2"),
      at(
        "The algorithm is followed by independently translated prose.",
        54,
        510,
        11,
      ),
      at("1. The first numbered explanation remains prose.", 54, 480, 11),
      at("2. The second example describes a return policy.", 54, 450, 11),
      at("3. If needed, the third explanation stays readable.", 54, 420, 11),
    ],
    [
      ...running(22),
      at("9. Mixed geometry", 54, 735, 15, "F2"),
      at("The measured result remains in sequence after", 54, 706, 12),
      at(
        "training for three days, followed by the next sentence.",
        54,
        692,
        10,
      ),
      at("A complete left column begins with careful evidence and", 54, 648, 9),
      at("ends before the right column starts its own discussion.", 54, 636, 9),
      at(
        "Further independent measurements corroborate the result.",
        54,
        624,
        9,
      ),
      at("Our final control retains a separate observation.", 54, 612, 9),
      at("An unrelated right column introduces an experimental", 322, 648, 9),
      at("setting without interrupting any left column sentence.", 322, 636, 9),
      at("Different observations occupy this second column.", 322, 624, 9),
      at("These conclusions follow the complete first column.", 322, 612, 9),
      at(
        "1 Supplementary protocol details remain separate from the main argument.",
        54,
        84,
        7,
      ),
    ],
    [
      ...running(23),
      at(
        "Alice Adams, Bob Baker, and Carol Clark. Independent measurement",
        54,
        700,
        10,
      ),
      at(
        "protocols for scientific documents. Journal of Testing, 2019.",
        54,
        686,
        10,
      ),
      at(
        "Daniel Davis, Ellen Evans, and Frank Foster. Robust reading",
        54,
        650,
        10,
      ),
      at(
        "orders for complex layouts. Proceedings of Reliable Systems, 2020.",
        54,
        636,
        10,
      ),
      at(
        "Grace Green, Henry Hall, and Irene Irving. Source geometry",
        54,
        600,
        10,
      ),
      at(
        "preservation across rendering stages. Document Research, 2021.",
        54,
        586,
        10,
      ),
      at(
        "James Jones, Karen King, and Laura Lewis. Durable paragraph",
        54,
        550,
        10,
      ),
      at(
        "restoration for technical articles. Scientific Software, 2022.",
        54,
        536,
        10,
      ),
      at(
        "Our independent evaluation remains open for further experiments.",
        54,
        480,
        10,
      ),
    ],
    [
      ...running(24),
      at("10. Annotated displays", 54, 735, 14, "F2"),
      at("The left column introduces a local model.", 54, 710, 10),
      at("Its two terms have separate annotations.", 54, 696, 10),
      at("Both terms belong to the same display:", 54, 682, 10),
      at("r = max sim(step_num, warmup_steps) +", 80, 660, 10, "F3"),
      at("FirstTerm", 100, 647, 7),
      at("g(y) + h(z)", 100, 628, 10, "F3"),
      at("SecondTerm", 110, 615, 7),
      at("(7)", 278, 639, 10),
      at("The rate x = y + z remains readable prose.", 54, 590, 10),
      at("A separate display follows this explanation:", 54, 570, 10),
      at("max sim(x) = z.", 80, 548, 10),
      at("(8)", 278, 548, 10),
      at("The final sentence stays outside both crops.", 54, 520, 10),
      at("A separate right column contains ordinary prose.", 326, 710, 10),
      at("This column must not enter the left equation.", 326, 696, 10),
      at("Its independent observations remain translatable.", 326, 682, 10),
      at("Right-hand evidence overlaps the display vertically.", 326, 660, 10),
      at("Another right-hand sentence remains readable.", 326, 636, 10),
      at("The right column ends with its own conclusion.", 326, 612, 10),
    ],
    [
      ...running(25),
      at("11. Raster diagrams", 54, 735, 14, "F2"),
      at("Figure 2.1. A raster-only chart.", 54, 515, 10),
      at("This caption explanation remains translatable.", 54, 501, 10),
      at("Figure 2.2. An independent raster-only chart.", 54, 285, 10),
      at("Ordinary prose follows both separate figures.", 54, 250, 11),
    ],
    [
      ...running(26),
      at("12. Short mathematical prose", 54, 735, 14, "F2"),
      at("Let x = y.", 54, 690, 10),
      at("z = x + 1", 160, 660, 10, "F3"),
      at("(9)", 540, 660, 10),
      at("Thus x = y.", 54, 636, 10),
      at("The surrounding explanation is ordinary prose.", 54, 600, 10),
    ],
    [
      ...running(27),
      at("13. Detached chart legends", 54, 735, 14, "F2"),
      ...Array.from({ length: 4 }, (_, i) =>
        at(`Series${i + 1}`, 65 + i * 85, 595, 7),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        at(`Legend${i + 1}`, 65 + i * 85, 480, 7),
      ),
      at("Figure 3. A plot with a detached legend.", 54, 450, 10),
      at("The explanation below the chart remains translatable.", 54, 420, 11),
    ],
    [
      ...running(28),
      at("14. Mixed-width layout bands", 54, 735, 14, "F2"),
      at("Table 4. Earlier column material.", 350, 700, 10),
      at("The earlier column layout ends above the wide chart.", 54, 650, 10),
      at("Figure 4. A full-width raster chart.", 54, 450, 10),
      at("The lower caption belongs to a separate layout band.", 54, 425, 10),
    ],
    [
      ...running(29),
      at("15. Inline mathematical notation", 54, 735, 14, "F2"),
      at("The energy ", 54, 710),
      at("E", 113, 710, 11, "F3"),
      at("=", 121, 710),
      at("mc", 130, 710, 11, "F3"),
      at("2", 143, 714, 7),
      at(" is an an-", 151, 710),
      at("chor for this independent measurement.", 54, 696),
      at("A tensor ", 54, 670),
      at("R", 101, 670, 11, "F3"),
      at("N", 109, 674, 7, "F3"),
      at("(", 115, 674, 7),
      at("P", 118, 674, 7, "F3"),
      at("2", 123, 677, 5),
      at("+", 127, 674, 7),
      at("C", 132, 674, 7, "F3"),
      at(")", 137, 674, 7),
      at(" stores observations.", 145, 670),
      at("The two variables ", 54, 640),
      at("x", 146, 640, 11, "F3"),
      at("2", 152, 644, 7),
      at(" and ", 160, 640),
      at("y", 187, 640, 11, "F3"),
      at("3", 193, 644, 7),
      at(" describe different measurements.", 201, 640),
      at("The latent dimension ", 54, 610),
      at("D", 162, 610, 11, "F3"),
      at("class", 170, 608.3, 7),
      at(" controls the representation.", 190, 610),
    ],
    [
      ...running(30),
      at("16. Boundary notation", 54, 735, 14, "F2"),
      at("The conserved quantity ", 54, 80),
      at("E", 171, 80, 11, "F3"),
      at("=", 179, 80),
      at("mc", 188, 80, 11, "F3"),
      at("2", 201, 84, 7),
      at(" remains", 209, 80),
    ],
    [
      ...running(31),
      at("stable when compared with ", 54, 700),
      at("y", 191, 700, 11, "F3"),
      at("3", 197, 704, 7),
      at(" in the adjacent observation.", 205, 700),
      at("17. Independent material", 54, 650, 14, "F2"),
      at("This paragraph has no mathematical expression.", 54, 620),
    ],
    [
      ...running(32),
      at("18. Adjacent scientific tables", 54, 735, 14, "F2"),
      at("Ordinary left-column prose stays readable.", 54, 700, 10),
      at("It must not become a cell in either grid.", 54, 686, 10),
      ...[690, 660].flatMap((y, i) => [
        at(i ? "Adapted" : "Baseline", 350, y, 9),
        at(i ? "18.5" : "12.5", 430, y, 9),
        at(i ? "30.0" : "24.0", 490, y, 9),
      ]),
      at("Table 5. A paired comparison across", 305, 624, 9),
      at("independent measurement conditions.", 305, 612, 9),
      at("Caption text remains translated.", 305, 600, 9),
      ...[560, 530].flatMap((y, i) => [
        at(i ? "Improved" : "Control", 350, y, 9),
        at(i ? "29.5" : "23.5", 430, y, 9),
        at(i ? "45.0" : "39.0", 490, y, 9),
      ]),
      at("Table 6. A separate comparison uses", 305, 494, 9),
      at("different measurements and controls.", 305, 482, 9),
      at("The entire second caption is translated.", 305, 470, 9),
      at("The body below both tables is independent.", 54, 425, 11),
    ],
    [
      ...running(33),
      at("19. Appendix measurements", 54, 735, 14, "F2"),
      at("Dataset", 60, 686, 9),
      at("First metric", 220, 686, 9),
      at("Second metric", 355, 686, 9),
      at("Third metric", 490, 686, 9),
      ...Array.from({ length: 35 }, (_, i) => [
        at(`Dataset${i}`, 60, 660 - i * 12, 9),
        at(`${i + 10}.5`, 220, 660 - i * 12, 9),
        at(`${i + 20}.5`, 355, 660 - i * 12, 9),
        at(`${i + 30}.5`, 490, 660 - i * 12, 9),
      ]).flat(),
      at(
        "Table C.1. Continuous rows belong to one tall original table.",
        54,
        205,
        9,
      ),
      at(
        "The header and final dataset must stay within the same crop.",
        54,
        193,
        9,
      ),
      at("This complete caption remains ordinary translated text.", 54, 181, 9),
    ],
    [
      ...running(34),
      at("20. Labels outside painted shapes", 54, 735, 14, "F2"),
      at("First panel", 80, 632, 10),
      at("Second panel", 290, 632, 10),
      ...Array.from({ length: 4 }, (_, i) =>
        at(`Cell${i}`, 90 + i * 85, 595, 7),
      ),
      { ...at("Rate", 67, 560, 8), rotated: true },
      at("(a) Lower panel descenders gyp.", 80, 528, 8),
      at("(b) Second panel grouping.", 290, 528, 8),
      at("Figure 5. Caption stays outside the labelled diagram.", 54, 505, 10),
      at("Do not include this ordinary prose sentence.", 54, 475, 11),
    ],
    [
      ...running(35),
      at("21. Detached labelled raster panels", 54, 735, 14, "F2"),
      at("Input projection", 80, 675, 10),
      at("Output projection", 360, 675, 10),
      at("Figure 6. Two independently labelled panels.", 54, 515, 10),
      at(
        "The paired illustration does not include this paragraph.",
        54,
        480,
        11,
      ),
    ],
    [
      ...running(36),
      at("22. Sentence-valued cells", 54, 735, 14, "F2"),
      at("Table 7. Comparison.", 54, 650, 10),
      ...[590, 560, 530].flatMap((y) => [
        at("Method 1 uses the validation set.", 54, y, 10),
        at("Method 2 uses held-out samples.", 304, y, 10),
      ]),
      at("Table 8. Uncertain structure.", 54, 495, 10),
      ...[455, 440, 425, 410, 395, 380].map((y) =>
        at(
          "An ordinary sentence carries explanatory context between these horizontal rules.",
          54,
          y,
          10,
        ),
      ),
    ],
    [
      ...running(37),
      at("23. Independent chart ownership", 54, 735, 14, "F2"),
      at("First chart title", 65, 660, 10),
      at("Second chart title", 415, 660, 10),
      at("A note remains prose.", 235, 570, 10),
      at("Figure 7. First chart.", 50, 500, 10),
      at("Figure 8. Second chart.", 400, 475, 10),
    ],
    [
      ...running(38),
      at("24. Narrow centered tables", 134.765, 735, 11, "F2"),
      // Full-width caption offset from a narrower centered grid, as authored.
      at(
        "Table 9. A centered grid reports each grouped condition across four measured",
        134.765,
        666.7,
        9,
      ),
      at(
        "columns for every evaluated model, with baseline values and per-model solver",
        134.765,
        655.7,
        9,
      ),
      at("notes attached to each row.", 134.765, 644.8, 9),
      // One merged abbreviated header item ending in a period beside the left cell.
      at("Model", 225.06, 619.8, 8),
      at(readingFixture.centeredHeader, 315.78, 619.8, 8),
      at("Group Alpha (uniform)", 225.06, 604.1, 8),
      at("Grid Model A [3]", 225.06, 592.8, 8),
      at("41.2", 318.2, 592.8, 8),
      at("43.5", 340.4, 592.8, 8),
      at("47.8", 362.6, 592.8, 8),
      at("44.1", 384.8, 592.8, 8),
      at("Grid Model B [6]", 225.06, 581.5, 8),
      at("52.1", 318.2, 581.5, 8),
      at("48.2", 340.4, 581.5, 8),
      at("61.2", 362.6, 581.5, 8),
      at("53.4", 384.8, 581.5, 8),
      at("Grid Model C [25]", 225.06, 554.4, 8),
      at("58.1", 318.2, 554.4, 8),
      at("57.9", 340.4, 554.4, 8),
      at("68.0", 362.6, 554.4, 8),
      at("60.1", 384.8, 554.4, 8),
      at("Group Beta (retrieval)", 225.06, 516.2, 8),
      at("Grid Model D [32] (note)", 225.06, 504.9, 8),
      at("31.4", 318.2, 504.9, 8),
      at("31.0", 340.4, 504.9, 8),
      at("30.9", 362.6, 504.9, 8),
      at("31.2", 384.8, 504.9, 8),
      at("Grid Model E [26] (small)", 225.06, 493.6, 8),
      at("31.5", 318.2, 493.6, 8),
      at("35.5", 340.4, 493.6, 8),
      at("36.3", 362.6, 493.6, 8),
      at("33.1", 384.8, 493.6, 8),
      at("Grid Model F [10] (note)", 225.06, 482.2, 8),
      at("29.2", 318.2, 482.2, 8),
      at("27.6", 340.4, 482.2, 8),
      at("33.3", 362.6, 482.2, 8),
      at("29.4", 384.8, 482.2, 8),
      at("Grid Model G [33] (note)", 225.06, 459.6, 8),
      at("57.3", 318.2, 459.6, 8),
      at("64.4", 340.4, 459.6, 8),
      at("71.1", 362.6, 459.6, 8),
      at("60.9", 384.8, 459.6, 8),
      at("Grid Model H [4] (note)", 225.06, 432.6, 8),
      at("70.2", 318.2, 432.6, 8),
      at("71.4", 340.4, 432.6, 8),
      at("68.0", 362.6, 432.6, 8),
      at("70.8", 384.8, 432.6, 8),
      at(
        "The paragraph below the centered table remains ordinary readable prose.",
        134.765,
        382.9,
        10,
      ),
    ],
    [
      ...running(39),
      at("Table 10. Independent left results.", 54, 700, 9),
      at("Left method", 60, 652, 9),
      at("Score", 230, 652, 9),
      at("Left-first", 60, 630, 9),
      at("11.3", 230, 630, 9),
      at("Left-last", 60, 535, 9),
      at("22.7", 230, 535, 9),
      at("Table 11. Upper comparison.", 322, 700, 9),
      at("Its explanation remains translated.", 322, 688, 9),
      at("Upper method", 328, 646, 9),
      at("Time", 472, 646, 9),
      at("Score", 516, 646, 9),
      at("Upper-first", 328, 625, 9),
      at("15.1", 472, 625, 9),
      at("31.6", 516, 625, 9),
      at("Upper-last", 328, 607, 9),
      at("18.2", 472, 607, 9),
      at("42.8", 516, 607, 9),
      at("Table", 322, 580, 9),
      at("12.", 353, 580, 9),
      at("Lower comparison.", 373, 580, 9),
      at("Its wrapped explanation is independent.", 322, 568, 9),
      at("Lower method", 328, 526, 9),
      at("Score", 516, 526, 9),
      at("Lower-first", 328, 510, 9),
      at("53.9", 516, 510, 9),
      at("Lower-last", 328, 490, 9),
      at("64.2", 516, 490, 9),
      at(
        "Ordinary prose below the three grids stays translatable.",
        54,
        420,
        11,
      ),
    ],
  ];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${6 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Italic >>",
  ];
  for (const [index, lines] of pages.entries()) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${7 + index * 2} 0 R >>`,
    );
    const drawing =
      index === 11
        ? Array.from(
            { length: 8 },
            (_, i) =>
              `${54 + (i % 4) * 86} ${535 - Math.floor(i / 4) * 52} 80 85 re S`,
          ).join("\n") + "\n"
        : index === 19
          ? "54 700 m 340 700 l S 54 675 m 340 675 l S 54 620 m 340 620 l S\n"
          : index === 20
            ? "54 738 m 550 738 l S 54 714 m 550 714 l S 54 585 m 550 585 l S\n"
            : index === 21
              ? "54 100 m 200 100 l S\n"
              : index === 24
                ? [540, 310]
                    .map(
                      (y) =>
                        `q 50 280 500 420 re W n 240 0 0 140 54 ${y} cm BI /W 2 /H 2 /CS /RGB /BPC 8 /F /AHx ID ff000000ff000000ffffffff> EI Q\n`,
                    )
                    .join("")
                : index === 26
                  ? Array.from(
                      { length: 4 },
                      (_, i) =>
                        `${54 + i * 85} 480 70 8 re S\n${54 + i * 85} 520 70 100 re S\n`,
                    ).join("")
                  : index === 27
                    ? "q 496 0 0 70 54 480 cm BI /W 2 /H 2 /CS /RGB /BPC 8 /F /AHx ID ff000000ff000000ffffffff> EI Q\n"
                    : index === 31
                      ? "340 710 m 540 710 l S 340 677 m 540 677 l S 340 640 m 540 640 l S 342 580 m 538 580 l S 342 547 m 538 547 l S 342 510 m 538 510 l S\n"
                      : index === 32
                        ? "54 700 m 558 700 l S 54 675 m 558 675 l S 54 230 m 558 230 l S\n"
                        : index === 33
                          ? Array.from(
                              { length: 4 },
                              (_, i) => `${80 + i * 85} 540 75 80 re S\n`,
                            ).join("")
                          : index === 34
                            ? [80, 360]
                                .map(
                                  (x) =>
                                    `q 120 0 0 120 ${x} 540 cm BI /W 2 /H 2 /CS /RGB /BPC 8 /F /AHx ID ff000000ff000000ffffffff> EI Q\n`,
                                )
                                .join("")
                            : index === 35
                              ? "54 620 m 494 620 l S 54 500 m 494 500 l S 54 470 m 494 470 l S 54 370 m 494 370 l S\n"
                              : index === 36
                                ? [50, 400]
                                    .map(
                                      (x) =>
                                        `q 150 0 0 135 ${x} 515 cm BI /W 2 /H 2 /CS /RGB /BPC 8 /F /AHx ID ff000000ff000000ffffffff> EI Q\n`,
                                    )
                                    .join("")
                                : index === 37
                                  ? [632, 616.2, 566.6, 528.3, 444.7, 417.6]
                                      .map(
                                        (y) => `223.9 ${y} m 402.4 ${y} l S\n`,
                                      )
                                      .join("")
                                  : index === 38
                                    ? [
                                        ...[670, 640, 525].map(
                                          (y) => `54 ${y} m 280 ${y} l S\n`,
                                        ),
                                        ...[660, 638, 595, 540, 518, 478].map(
                                          (y) => `322 ${y} m 558 ${y} l S\n`,
                                        ),
                                      ].join("")
                                    : "";
    const stream =
      drawing +
      lines
        .map(({ text, x, y, size, font, rotated }) => {
          const escaped = text.replace(/([\\()])/g, "\\$1");
          return `BT /${font} ${size} Tf ${rotated ? "0 1 -1 0" : "1 0 0 1"} ${x} ${y} Tm (${escaped}) Tj ET`;
        })
        .join("\n");
    objects.push(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  }
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return pdf;
}
