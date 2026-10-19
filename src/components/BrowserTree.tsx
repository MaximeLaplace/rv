import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { themeToTreeStyles, type GitStatus } from "@pierre/trees";
import { rememberScroll, restoreScroll } from "../lib/scroll";
import { compareTreePaths } from "../lib/sort";
import { MESSAGE_PATH, MESSAGE_TREE_PATH, type Entry } from "../types";

// The commit message has a reserved review path; the tree shows a label.
const toTree = (path: string) => path === MESSAGE_PATH ? MESSAGE_TREE_PATH : path;
const fromTree = (path: string) => path === MESSAGE_TREE_PATH ? MESSAGE_PATH : path;

const statuses: Record<string, GitStatus> = {
  M: "modified",
  A: "added",
  D: "deleted",
  U: "untracked",
  T: "modified",
};
const treeStyle = themeToTreeStyles({
  type: "dark",
  bg: "#1b2230",
  fg: "#c7cbd4",
  colors: {
    "sideBar.background": "#1b2230",
    "sideBar.foreground": "#c7cbd4",
    "sideBarSectionHeader.foreground": "#a2aec0",
    "sideBar.border": "#3e4a61",
    "list.hoverBackground": "#2c3546",
    "list.activeSelectionBackground": "#2e425a",
    "list.activeSelectionForeground": "#ffcc66",
    "list.focusOutline": "#ffcc66",
    "input.background": "#171e2b",
    "scrollbarSlider.background": "#525e75",
    "gitDecoration.addedResourceForeground": "#a8cc83",
    "gitDecoration.modifiedResourceForeground": "#80bfff",
    "gitDecoration.deletedResourceForeground": "#f28779",
    "gitDecoration.untrackedResourceForeground": "#a8cc83",
  },
});
const inactiveTreeStyle = {
  ...treeStyle,
  "--trees-focus-ring-color-override": "transparent",
} as CSSProperties;

type Stat = { additions: number; deletions: number };
const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

// Line change counts per file and summed per directory ("dir/" keys).
function diffStats(entries: Entry[]) {
  const stats = new Map<string, Stat>();
  for (const entry of entries) {
    const additions = entry.additions || 0, deletions = entry.deletions || 0;
    if (!additions && !deletions) continue;
    for (const key of [entry.path, ...directoryPaths([entry.path])]) {
      const stat = stats.get(key) || { additions: 0, deletions: 0 };
      stat.additions += additions;
      stat.deletions += deletions;
      stats.set(key, stat);
    }
  }
  return stats;
}

export function directoryPaths(paths: string[]) {
  return [...new Set(
    paths.flatMap((path) => {
      const parts = path.split("/");
      return parts.slice(0, -1).map((_, i) =>
        parts.slice(0, i + 1).join("/") + "/",
      );
    }),
  )];
}

export function BrowserTree({
  paths,
  entries,
  selected,
  includeMessage,
  onSelect,
  onOrderChange,
  fileHref,
  scrollRoot,
  scrollKey,
  reviewed,
  onToggleReviewed,
  onToggleDirectoryReviewed,
  search,
  collapsed,
  onCollapse,
  reveal,
}: {
  paths: string[];
  entries: Entry[];
  selected: string;
  includeMessage: boolean;
  onSelect: (path: string) => void;
  onOrderChange: (paths: string[]) => void;
  fileHref: (path: string) => string;
  scrollRoot: string;
  scrollKey: string;
  reviewed: boolean;
  onToggleReviewed: (path: string) => void;
  onToggleDirectoryReviewed: (directory: string) => void;
  search: string;
  collapsed: string[];
  onCollapse: (path: string, closed: boolean) => void;
  // Scroll the selected file into view, as the all-files diff scrolls.
  reveal: boolean;
}) {
  const selectRef = useRef(onSelect);
  const hrefRef = useRef(fileHref);
  hrefRef.current = fileHref;
  const toggleReviewedRef = useRef(onToggleReviewed);
  const toggleDirectoryRef = useRef(onToggleDirectoryReviewed);
  const collapseRef = useRef(onCollapse);
  const collapsedRef = useRef(collapsed);
  const searchRef = useRef(search);
  const entryByPath = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry])),
    [entries],
  );
  const entriesRef = useRef(entryByPath);
  entriesRef.current = entryByPath;
  toggleReviewedRef.current = onToggleReviewed;
  toggleDirectoryRef.current = onToggleDirectoryReviewed;
  collapseRef.current = onCollapse;
  collapsedRef.current = collapsed;
  searchRef.current = search;
  const syncingSelection = useRef(false);
  const syncingExpansion = useRef(false);
  const treePaths = useMemo(
    () => includeMessage ? [MESSAGE_TREE_PATH, ...paths] : paths,
    [includeMessage, paths],
  );
  selectRef.current = (path) => {
    if (treePaths.includes(path)) onSelect(fromTree(path));
  };
  const statsRef = useRef(new Map<string, Stat>());
  statsRef.current = useMemo(() => diffStats(entries), [entries]);
  const { model } = useFileTree({
    paths: treePaths,
    sort: (left, right) =>
      left.path === MESSAGE_TREE_PATH ? -1 : right.path === MESSAGE_TREE_PATH ? 1 :
        compareTreePaths(left.path, right.path),
    initialExpansion: "open",
    density: "compact",
    icons: "standard",
    renderRowDecoration: ({ item }) => {
      const entry = item.kind === "file" ? entriesRef.current.get(item.path) : undefined;
      if (!entry) return null;
      if (entry.additions == null || entry.deletions == null)
        return { text: "—", title: "Line change counts not available" };
      return {
        text: `+${entry.additions} −${entry.deletions}`,
        title: `${entry.additions} lines added, ${entry.deletions} lines removed`,
        parts: [
          { text: `+${entry.additions}`, color: "var(--success)" },
          { text: `−${entry.deletions}`, color: "var(--danger)" },
        ],
      };
    },
    initialSelectedPaths: selected
      ? [toTree(selected)]
      : [],
    onSelectionChange: (items) => {
      if (syncingSelection.current) return;
      const item = items.at(-1);
      if (item) selectRef.current(item);
    },
    composition: {
      contextMenu: {
        enabled: true,
        triggerMode: "button",
        buttonVisibility: "when-needed",
        onOpen: (item, context) => {
          context.close({ restoreFocus: false });
          if (item.kind === "file")
            toggleReviewedRef.current(fromTree(item.path));
          else if (item.kind === "directory")
            toggleDirectoryRef.current(item.path);
        },
      },
    },
    unsafeCSS: `
      :host { container-type: inline-size; }
      :host(:not([data-file-review-action])) [data-type="context-menu-anchor"] {
        display: none !important;
      }
      [data-item-section="content"] { flex: 1; }
      [data-item-section="decoration"] {
        flex: 0 1 auto;
        font-size: 10px;
        font-variant-numeric: tabular-nums;
      }
      [data-item-section="decoration"] > span { gap: 4px; }
      @container (max-width: 200px) {
        [data-item-type="file"] > [data-item-section="decoration"] { display: none; }
      }
      [data-type="context-menu-trigger"] svg { display: none; }
      [data-type="context-menu-trigger"]::before {
        content: "${reviewed ? "↩" : "✓"}";
        font-size: 13px;
        font-weight: 600;
      }
      [data-item-section="decoration"] { flex: 1 0 auto; }
      [data-item-section="decoration"] > span {
        gap: 4px;
        overflow: visible;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
      }
      [data-item-section="decoration"] > span > span:empty { display: none; }
      [data-item-type="file"] > [data-item-section="decoration"] { font-weight: 700; }
      [data-item-type="folder"] > [data-item-section="decoration"] { opacity: 0.55; }
    `,
    renderRowDecoration: ({ row }) => {
      const stat = statsRef.current.get(
        row.kind === "directory" ? row.path.replace(/\/?$/, "/") : row.path,
      );
      if (!stat) return null;
      return {
        text: "",
        title: `${stat.additions} lines added, ${stat.deletions} lines removed`,
        parts: [
          { text: stat.additions ? `+${compact(stat.additions)}` : "", color: row.kind === "directory" ? "#a2aec0" : "#66d98b" },
          { text: stat.deletions ? `−${compact(stat.deletions)}` : "", color: row.kind === "directory" ? "#a2aec0" : "#ff7b72" },
        ],
      };
    },
    gitStatus: entries.map((entry) => ({
      path: entry.path,
      status: statuses[entry.status] || "modified",
    })),
  });
  useEffect(() => {
    // Tree options are initial-only; repaint mounted rows when counts change.
    if (model.getFileTreeContainer()?.isConnected) model.render({});
  }, [model, entryByPath]);
  useEffect(() => {
    const updateOrder = () => {
      onOrderChange(
        model.getVisibleRows(0, model.getVisibleCount())
          .filter((row) => row.kind === "file")
          .map((row) => fromTree(row.path)),
      );
    };
    const unsubscribe = model.subscribe(updateOrder);
    updateOrder();
    return () => {
      unsubscribe();
      onOrderChange([]);
    };
  }, [model, onOrderChange]);
  useEffect(() => {
    const directories = directoryPaths(paths);
    return model.subscribe(() => {
      if (searchRef.current && !model.getSearchValue()) {
        queueMicrotask(() => {
          if (!searchRef.current || model.getSearchValue()) return;
          syncingExpansion.current = true;
          model.setSearch(searchRef.current);
          syncingExpansion.current = false;
        });
        return;
      }
      // Searching temporarily expands matches; it must not overwrite user choices.
      if (syncingExpansion.current || model.getSearchValue()) return;
      for (const path of directories) {
        const item = model.getItem(path);
        if (!item || !("isExpanded" in item)) continue;
        const closed = !item.isExpanded();
        if (closed === collapsedRef.current.includes(path)) continue;
        collapseRef.current(path, closed);
      }
    });
  }, [model]);
  useEffect(() => {
    syncingExpansion.current = true;
    model.setSearch(search);
    if (!search) {
      for (const path of directoryPaths(paths)) {
        const item = model.getItem(path);
        if (!item || !("collapse" in item)) continue;
        if (collapsed.includes(path)) item.collapse();
        else item.expand();
      }
    }
    syncingExpansion.current = false;
  }, [model, search, collapsed]);
  useEffect(() => {
    const treeSelected = toTree(selected);
    syncingSelection.current = true;
    for (const path of model.getSelectedPaths()) {
      if (path !== treeSelected) model.getItem(path)?.deselect();
    }
    const item = model.getItem(treeSelected);
    if (item && !item.isSelected()) item.select();
    syncingSelection.current = false;
    if (item && reveal) model.scrollToPath(treeSelected, { offset: "nearest" });
  }, [model, selected, treePaths, reveal]);
  useEffect(() => {
    // Pierre renders rows as buttons, with no link renderer. Intercept before
    // its selection handler so opening a tab leaves this tab untouched.
    let host: HTMLElement | undefined;
    const openTab = (event: MouseEvent) => {
      if (event.type === "auxclick" ? event.button !== 1
        : event.button !== 0 || !(event.metaKey || event.ctrlKey)) return;
      const row = event.composedPath().find((node): node is HTMLElement =>
        node instanceof HTMLElement && node.dataset.type === "item");
      if (row?.dataset.itemType !== "file" || !row.dataset.itemPath) return;
      event.preventDefault();
      event.stopPropagation();
      window.open(hrefRef.current(fromTree(row.dataset.itemPath)), "_blank", "noopener");
    };
    const frame = requestAnimationFrame(() => {
      host = model.getFileTreeContainer() || undefined;
      host?.addEventListener("click", openTab, true);
      host?.addEventListener("auxclick", openTab, true);
    });
    return () => {
      cancelAnimationFrame(frame);
      host?.removeEventListener("click", openTab, true);
      host?.removeEventListener("auxclick", openTab, true);
    };
  }, [model]);
  useEffect(() => {
    let scroller: HTMLElement | null | undefined;
    const frame = requestAnimationFrame(() => {
      scroller = model.getFileTreeContainer()?.shadowRoot?.querySelector(
        '[data-file-tree-virtualized-scroll="true"]',
      );
      if (!scroller) return;
      restoreScroll(scrollRoot, scrollKey, scroller);
      scroller.addEventListener("scroll", save, { passive: true });
    });
    const save = () => {
      if (scroller) rememberScroll(scrollRoot, scrollKey, scroller);
    };
    return () => {
      cancelAnimationFrame(frame);
      save();
      scroller?.removeEventListener("scroll", save);
    };
  }, [model, scrollRoot, scrollKey]);
  useEffect(() => {
    let observer: MutationObserver | undefined;
    const frame = requestAnimationFrame(() => {
      const host = model.getFileTreeContainer();
      const root = host?.shadowRoot;
      if (!host || !root) return;
      const label = reviewed ? "Mark unreviewed" : "Mark reviewed";
      const updateAction = () => {
        const message = root.querySelector(
          `[data-type="item"][data-item-path=${JSON.stringify(MESSAGE_TREE_PATH)}]`,
        );
        if (message) {
          message.setAttribute("aria-label", "Commit message");
          const content = message.querySelector('[data-item-section="content"]');
          if (content && content.textContent !== "Commit message")
            content.textContent = "Commit message";
        }
        const hovered = root.querySelector(
          '[data-type="item"][data-item-context-hover="true"]',
        );
        const type = hovered?.getAttribute("data-item-type");
        host.toggleAttribute(
          "data-file-review-action",
          type === "file" || type === "folder",
        );
        const trigger = root.querySelector('[data-type="context-menu-trigger"]');
        trigger?.setAttribute("aria-label", label);
        trigger?.setAttribute("title", label);
        trigger?.removeAttribute("aria-haspopup");
      };
      observer = new MutationObserver(updateAction);
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-item-context-hover"],
      });
      updateAction();
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [model, reviewed]);
  return (
    <FileTree
      model={model}
      className="file-tree"
      style={selected ? treeStyle : inactiveTreeStyle}
    />
  );
}
