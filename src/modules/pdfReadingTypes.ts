export type BlockKind =
  | "title"
  | "authors"
  | "affiliation"
  | "abstract"
  | "heading"
  | "body"
  | "caption"
  | "equation"
  | "reference"
  | "table"
  | "algorithm"
  | "footnote"
  | "running";
// Figure interiors retain raw text/origins but are not prose provider input.
export interface TextOrigin {
  page: number;
  block?: number;
  start: number;
  end: number;
  rects?: number[][];
}
export interface ReadingMedia {
  data: string;
  width: number;
  height: number;
  page: number;
  rect: number[];
}
export interface InlineMath {
  start: number;
  end: number;
  page: number;
  rect: number[];
  media?: ReadingMedia;
}
export interface ReadingBlock {
  kind: BlockKind | "figure";
  text: string;
  origins: TextOrigin[];
  translate: boolean;
  continued?: boolean;
  incomplete?: string;
  equationNumber?: string;
  media?: ReadingMedia;
  inlineMath?: InlineMath[];
  runningCandidate?: boolean;
  startsIndented?: boolean;
  figureMarker?: boolean;
  figureLabel?: string;
}
export interface ReadingPage {
  page: number;
  blocks: ReadingBlock[];
}
export interface GeometryItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
  dir: string;
  hasEOL: boolean;
}
export interface GeometryContent {
  items: Array<GeometryItem | { type: string; id?: string }>;
  styles: Record<
    string,
    {
      fontFamily: string;
      ascent?: number;
      descent?: number;
      vertical?: boolean;
    }
  >;
}
