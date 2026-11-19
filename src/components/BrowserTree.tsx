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

const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter() : undefined;
const characters = (text: string) => graphemes
  ? Array.from(graphemes.segment(text), part => part.segment)
  : Array.from(text);

function longestFit(length: number, label: (count: number) => string, fits: (text: string) => boolean) {
  let low = 0, high = length;
  while (low < high) {
    const count = Math.ceil((low + high) / 2);
    if (fits(label(count))) low = count;
    else high = count - 1;
  }
  return label(low);
}

function fitLabel(name: string, folder: boolean, fits: (text: string) => boolean) {
  if (fits(name)) return name;
  if (folder) {
    const separator = name.lastIndexOf(" / ");
    if (separator < 0) return name; // Let CSS end-truncate an individual folder.
    const leaf = name.slice(separator + 3);
    const tail = `… / ${leaf}`;
    if (!fits(tail)) return leaf;
    const ancestors = characters(name.slice(0, separator));
    return longestFit(ancestors.length, count => ancestors.slice(0, count).join("").trimEnd() + tail, fits);
  }

  const extension = name.match(/.+?((?:\.(?:test|spec|d))?\.[a-z0-9]{1,6})$/i)?.[1] || "";
  const stem = characters(name.slice(0, name.length - extension.length));
  // Give the prefix most of the space, but keep enough of the end to tell
  // similarly named files apart. Fall back to end ellipsis on very tight rows.
  const middle = (count: number) => {
    const suffix = Math.floor(count * 0.4);
    return stem.slice(0, count - suffix).join("") + "…" +
      (suffix ? stem.slice(-suffix).join("") : "") + extension;
  };
  if (stem.length < 4 || !fits(middle(3))) return name;
  return longestFit(stem.length - 1, middle, fits);
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
  newChanges,
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
  reviewed: string[];
  newChanges: ReadonlySet<string>;
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
  const fileStats = useMemo(() => {
    const stats = new Map<string, Stat>();
    for (const entry of entries) {
      const additions = entry.additions || 0, deletions = entry.deletions || 0;
      if (!additions && !deletions) continue;
      const stat = stats.get(entry.path) || { additions: 0, deletions: 0 };
      stat.additions += additions;
      stat.deletions += deletions;
      stats.set(entry.path, stat);
    }
    return stats;
  }, [entries]);
  const reviewedPaths = useMemo(() => new Set(reviewed), [reviewed]);
  const unreviewedDirectories = useMemo(
    () => new Set(directoryPaths(paths.filter(path => !reviewedPaths.has(path)))),
    [paths, reviewedPaths],
  );
  const decorations = { fileStats, reviewedPaths, newChanges };
  const decorationsRef = useRef(decorations);
  decorationsRef.current = decorations;
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
  const { model } = useFileTree({
    paths: treePaths,
    sort: (left, right) =>
      left.path === MESSAGE_TREE_PATH ? -1 : right.path === MESSAGE_TREE_PATH ? 1 :
        compareTreePaths(left.path, right.path),
    initialExpansion: "open",
    density: "compact",
    icons: "standard",
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
      :host {
        container-type: inline-size;
        --trees-padding-inline-override: 8px;
        --trees-item-padding-x-override: 4px;
        --trees-item-row-gap-override: 4px;
        --trees-level-gap-override: 4px;
        --trees-icon-width-override: 14px;
        --trees-action-lane-width-override: 18px;
        --trees-git-lane-width-override: var(--trees-action-lane-width-override);
      }
      :host(:not([data-file-review-action])) [data-type="context-menu-anchor"] {
        display: none !important;
      }
      [data-item-section="content"] { flex: 1; }
      /* One review/Git slot instead of an empty action column on every row. */
      [data-item-section="action"],
      [data-item-section="git"]:empty,
      [data-item-context-hover="true"] > [data-item-section="git"] { display: none; }
      [data-item-context-hover="true"] > [data-item-section="action"] { display: flex; }
      /* Replace the library's per-segment clipping; the original accessible
         name is still on the row, along with the full path tooltip. */
      [data-tree-label] { white-space: pre; }
      [data-tree-label] > * { display: none; }
      [data-tree-label]::before {
        content: attr(data-tree-label);
        content: attr(data-tree-label) / "";
      }
      [data-type="context-menu-trigger"] svg { display: none; }
      [data-type="context-menu-trigger"]::before {
        content: "✓";
        font-size: 13px;
        font-weight: 600;
      }
      [data-type="context-menu-trigger"][data-mark-unreviewed]::before { content: "↩"; }
      [data-item-section="decoration"] { flex: none; }
      [data-item-section="decoration"]:empty { display: none; }
      [data-item-section="decoration"] > span {
        gap: 4px;
        overflow: visible;
        font-size: 11px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      [data-item-section="decoration"] > span > span:empty { display: none; }
      [data-item-section="decoration"] > span[title^="Reviewed"] > span:last-child {
        font-size: 13px;
        line-height: 1;
      }
      @container (max-width: 200px) {
        [data-item-section="decoration"]:not(:has(> span[title^="Reviewed"])),
        [data-item-section="decoration"] > span > span:not(:last-child) { display: none; }
      }
      [data-item-section="decoration"] > span[title^="New changes since review"] > span:first-child {
        border: 1px solid var(--accent-border);
        border-radius: 999px;
        background: var(--accent-soft);
        padding: 2px 5px;
        font-size: 8px;
        font-weight: 600;
        line-height: 1.2;
      }
    `,
    renderRowDecoration: ({ row }) => {
      if (row.kind !== "file") return null;
      const path = fromTree(row.path);
      const { fileStats, reviewedPaths, newChanges } = decorationsRef.current;
      const stat = fileStats.get(path);
      const done = reviewedPaths.has(path);
      const changed = newChanges.has(path);
      if (!stat && !done && !changed) return null;
      return {
        text: "",
        title: [
          done ? "Reviewed" : changed ? "New changes since review" : "",
          stat ? `${stat.additions} lines added, ${stat.deletions} lines removed` : "",
        ].filter(Boolean).join(" · "),
        parts: [
          ...(changed ? [{ text: "NEW", color: "var(--accent)" }] : []),
          { text: stat?.additions ? `+${compact(stat.additions)}` : "", color: "#66d98b" },
          { text: stat?.deletions ? `−${compact(stat.deletions)}` : "", color: "#ff7b72" },
          { text: done ? "✓" : "", color: "var(--reviewed)" },
        ],
      };
    },
    gitStatus: entries.map((entry) => ({
      path: entry.path,
      status: statuses[entry.status] || "modified",
    })),
  });
  useEffect(() => {
    // Tree options are initial-only; repaint mounted rows when decorations change.
    if (model.getFileTreeContainer()?.isConnected) model.render({});
  }, [model, fileStats, reviewedPaths, newChanges]);
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
    let resizeObserver: ResizeObserver | undefined;
    const frame = requestAnimationFrame(() => {
      const host = model.getFileTreeContainer();
      const root = host?.shadowRoot;
      if (!host || !root) return;
      const canvas = document.createElement("canvas").getContext("2d");
      const labels = new Map<HTMLElement, string>();
      const layout = (content: HTMLElement, name: string) => {
        const row = content.parentElement!;
        const width = content.clientWidth - 1; // Allow for integer DOM width rounding.
        const style = getComputedStyle(content);
        if (canvas) canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const text = canvas ? fitLabel(name, row.dataset.itemType === "folder",
          value => canvas.measureText(value).width <= width) : name;
        if (content.dataset.treeLabel !== text) content.dataset.treeLabel = text;
      };
      // Only mounted (virtualized) labels need fitting. Resizing a panel or
      // changing a row's decorations changes its actual label width.
      resizeObserver = new ResizeObserver(entries => {
        for (const { target } of entries) {
          const content = target as HTMLElement;
          const name = labels.get(content);
          if (name) layout(content, name);
        }
      });
      const updateRows = (mutations?: MutationRecord[]) => {
        for (const content of labels.keys()) {
          if (root.contains(content)) continue;
          resizeObserver?.unobserve(content);
          labels.delete(content);
        }
        const refit = new Set(mutations?.filter(mutation => mutation.attributeName === "data-item-search-match")
          .map(mutation => mutation.target));
        for (const row of root.querySelectorAll<HTMLElement>('[data-type="item"][data-item-path]')) {
          const path = row.dataset.itemPath!;
          const name = path === MESSAGE_TREE_PATH ? "Commit message" : row.getAttribute("aria-label");
          const content = row.querySelector<HTMLElement>('[data-item-section="content"]');
          if (name && content) {
            if (path === MESSAGE_TREE_PATH && row.getAttribute("aria-label") !== name)
              row.setAttribute("aria-label", name);
            const title = path === MESSAGE_TREE_PATH ? name : path;
            if (row.title !== title) row.title = title;
            if (labels.get(content) !== name || refit.has(row)) {
              if (!labels.has(content)) resizeObserver?.observe(content);
              labels.set(content, name);
              layout(content, name);
            }
          }
          if (row.dataset.itemType !== "file") continue;
          const done = reviewedPaths.has(fromTree(path));
          if (done) row.setAttribute("aria-description", "Reviewed");
          else row.removeAttribute("aria-description");
        }
        const hovered = root.querySelector<HTMLElement>(
          '[data-type="item"][data-item-context-hover="true"]',
        );
        const type = hovered?.dataset.itemType;
        const path = hovered?.dataset.itemPath || "";
        host.toggleAttribute("data-file-review-action", type === "file" || type === "folder");
        const done = type === "folder" ? !unreviewedDirectories.has(path.replace(/\/?$/, "/"))
          : type === "file" && reviewedPaths.has(fromTree(path));
        const label = done ? "Mark unreviewed" : "Mark reviewed";
        const trigger = root.querySelector('[data-type="context-menu-trigger"]');
        trigger?.toggleAttribute("data-mark-unreviewed", done);
        trigger?.setAttribute("aria-label", label);
        trigger?.setAttribute("title", label);
        trigger?.removeAttribute("aria-haspopup");
      };
      observer = new MutationObserver(updateRows);
      observer.observe(root, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-item-context-hover", "data-item-path", "data-item-search-match"],
      });
      updateRows();
    });
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      resizeObserver?.disconnect();
    };
  }, [model, reviewedPaths, unreviewedDirectories]);
  return (
    <FileTree
      model={model}
      className="file-tree"
      style={selected ? treeStyle : inactiveTreeStyle}
    />
  );
}
