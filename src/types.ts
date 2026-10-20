export type Entry = {
  path: string;
  status: string;
  additions?: number | null;
  deletions?: number | null;
};
export type CompareMode = "working" | "commit" | "range";
export type Comparison = {
  mode: CompareMode;
  base: string;
  target: string;
  entries: Entry[];
  message?: string;
};
export const MESSAGE_PATH = "\0commit-message";
export const MESSAGE_TREE_PATH = "\uE000Commit message";
export type Source = { name: string; contents: string; hash?: string; notice?: string; cacheKey?: string } | null;
export type Info = {
  root: string;
  name: string;
  isGit: boolean;
  agent: boolean;
  branch: string;
  files: string[];
  working: Comparison;
  commits: { id: string; short: string; subject: string; date: string }[];
};
export type Comment = {
  id: string;
  path: string;
  start: number;
  end: number;
  text: string;
  // Fingerprint of the selected text (or whole file) at its source revision.
  // General comments have neither field; an empty ref means the working tree.
  hash?: string | null;
  sourceRef?: string;
  general?: boolean;
  // Whole-file comments have no line or side; start/end are zero.
  file?: boolean;
  side?: "additions" | "deletions";
  context: string;
  // Absent for comments on repository files.
  comparison?: { mode: CompareMode; base: string; target: string };
  commit?: string;
};
export type Content = { oldFile: Source; newFile: Source };
export type ViewerMode = "diff" | "old" | "new";
export type TextSearchMatch = {
  line: number;
  start: number;
  end: number;
  side?: "additions" | "deletions";
};
// Last-reviewed file fingerprints, retained after changes to show the warning
// until the file is reviewed again or explicitly marked unreviewed.
export type ReviewFingerprints = Record<string, string>;
// The server-side disk cache, loaded once and saved back debounced.
export type SavedState = {
  view?: Record<string, unknown>;
  reviewed?: Record<string, ReviewFingerprints>;
  comments?: Comment[];
};
