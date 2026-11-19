import { useCallback, type Dispatch, type RefObject, type SetStateAction } from "react";
import { BrowserTree, directoryPaths } from "../components/BrowserTree";
import { LineStats } from "../components/LineStats";
import { PanelResizeHandle } from "../components/PanelResizeHandle";
import { MESSAGE_PATH, type Entry } from "../types";

// The file browser: one tree with review status, search, and line stats.
export function Sidebar({
  tab,
  paths,
  entries,
  lineCounts,
  lineCountsFailed,
  changedFilesOnly,
  hasMessage,
  reviewed,
  newChanges,
  reviewScope,
  selected,
  onSelect,
  fileHref,
  root,
  search,
  onSearch,
  collapsed,
  onCollapsedChange,
  onToggleReviewed,
  onToggleDirectoryReviewed,
  revealSelected,
  treeOrder,
  onHide,
  onResize,
  hidden,
}: {
  tab: string;
  paths: string[];
  entries: Entry[];
  lineCounts?: Record<string, number | null>;
  lineCountsFailed: boolean;
  changedFilesOnly: boolean;
  hasMessage: boolean;
  reviewed: string[];
  newChanges: ReadonlySet<string>;
  reviewScope: string;
  selected: string;
  onSelect: (path: string) => void;
  fileHref: (path: string) => string;
  root: string;
  search: string;
  onSearch: (search: string) => void;
  collapsed: string[];
  onCollapsedChange: Dispatch<SetStateAction<string[]>>;
  onToggleReviewed: (path: string) => void;
  onToggleDirectoryReviewed: (directory: string) => void;
  revealSelected: boolean;
  // Visible file order of the tree, for J/K.
  treeOrder: RefObject<string[]>;
  onHide: () => void;
  onResize: (width: number) => void;
  hidden: boolean;
}) {
  const includeMessage = hasMessage && "commit message".includes(search.toLowerCase());
  const setTreeOrder = useCallback((order: string[]) => {
    treeOrder.current = order;
  }, [treeOrder]);
  const fileSearch = search.trim().replaceAll("\\", "/").toLowerCase();
  // Stats follow the file search. Repository totals cover changed/untracked
  // files only; unchanged files remain browsable without reading their contents.
  function totalStats() {
    const visible = new Set(paths.filter((path) => path.toLowerCase().includes(fileSearch)));
    if (tab === "files") {
      const counted = changedFilesOnly
        ? [...new Set(entries.filter((entry) => entry.status !== "D" && visible.has(entry.path))
            .map((entry) => entry.path))]
        : [...visible];
      const missing = counted.some((path) => lineCounts?.[path] == null);
      return {
        lines: counted.reduce((sum, path) => sum + (lineCounts?.[path] || 0), 0),
        loading: counted.length > 0 && !lineCounts && !lineCountsFailed,
        unavailable: counted.length > 0 && lineCountsFailed,
        changedFilesOnly,
        title: `${changedFilesOnly ? "Total lines in changed and untracked files only; unchanged files are not counted" : "Total lines of code"}${missing ? "; excludes binary or unpreviewable files" : ""}`,
      };
    }
    const changes = entries.filter((entry) => visible.has(entry.path));
    const pending = changes.some((entry) => entry.status === "U" && entry.additions == null);
    const missing = changes.some((entry) => entry.additions == null || entry.deletions == null);
    return {
      additions: changes.reduce((sum, entry) => sum + (entry.additions || 0), 0),
      deletions: changes.reduce((sum, entry) => sum + (entry.deletions || 0), 0),
      loading: pending && !lineCounts && !lineCountsFailed,
      unavailable: pending && lineCountsFailed,
      title: `Lines changed${missing ? "; excludes files with unavailable line counts (binary or unpreviewable text)" : ""}`,
    };
  }

  return (
    <aside
      className="sidebar"
      id="file-browser"
      aria-label="File browser"
      hidden={hidden}
    >
      <PanelResizeHandle side="files" onResize={onResize} />
      <div className="sidebar-header">
        <strong>{tab === "files" ? "Files" : "Changed files"}</strong>
        <span className="file-count">
          {paths.length + (hasMessage ? 1 : 0)}
        </span>
        <LineStats {...totalStats()} />
        <button
          className="panel-toggle"
          aria-label="Hide file browser"
          title="Hide file browser"
          aria-controls="file-browser"
          onClick={onHide}
        >
          ‹
        </button>
      </div>
      <div className="tree-toolbar">
        <div className="search">
          <span aria-hidden="true">⌕</span>
          <input
            aria-label="Find a file"
            placeholder="Find a file…"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
          />
        </div>
        <button
          className="tree-action"
          aria-label="Collapse all directories"
          title="Collapse all directories"
          onClick={() => onCollapsedChange(directoryPaths(paths))}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
            <path d="M2 3.5h3l1 1h6v6.5H2z" />
            <path d="M4.5 7.75h5" />
          </svg>
        </button>
        <button
          className="tree-action"
          aria-label="Expand all directories"
          title="Expand all directories"
          onClick={() => onCollapsedChange([])}
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
            <path d="M2 3.5h3l1 1h6v6.5H2z" />
            <path d="M4.5 7.75h5 M7 5.25v5" />
          </svg>
        </button>
      </div>
      {paths.length || includeMessage ? (
        <BrowserTree
          key={`${reviewScope}:${includeMessage}:${JSON.stringify(paths)}`}
          paths={paths}
          entries={entries}
          selected={paths.includes(selected) ||
            includeMessage && selected === MESSAGE_PATH ? selected : ""}
          includeMessage={includeMessage}
          onSelect={onSelect}
          onOrderChange={setTreeOrder}
          fileHref={fileHref}
          scrollRoot={root}
          scrollKey={JSON.stringify(["explorer", reviewScope])}
          reviewed={reviewed}
          newChanges={newChanges}
          onToggleReviewed={onToggleReviewed}
          onToggleDirectoryReviewed={onToggleDirectoryReviewed}
          search={search}
          collapsed={collapsed}
          reveal={revealSelected}
          onCollapse={(path, closed) =>
            onCollapsedChange((current) => closed
              ? [...new Set([...current, path])]
              : current.filter((item) => item !== path))
          }
        />
      ) : (
        <p className="sidebar-empty">
          {tab === "files" ? "No files yet." : "No changed files."}
        </p>
      )}
    </aside>
  );
}
