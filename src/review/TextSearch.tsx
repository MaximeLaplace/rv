import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { FileDiffMetadata } from "@pierre/diffs";
import type { CodeViewHandle } from "@pierre/diffs/react";
import {
  highlightStyles,
  lineSide,
  rangeForMatch,
  textSearchHighlightName,
  textSearchMatches,
  textSearchMatchesHighlightName,
} from "../lib/textSearch";
import type { Comment, Source, ViewerMode } from "../types";

function clearHighlights() {
  CSS.highlights.delete(textSearchHighlightName);
  CSS.highlights.delete(textSearchMatchesHighlightName);
}

// A file to search, in the order it is shown.
export type TextSearchSource = {
  path: string;
  file?: Source;
  diff?: FileDiffMetadata | null;
};

// Find (Cmd/Ctrl+F) in the viewed file, or in every file of the all-files
// diff, plus highlighting other occurrences of text selected on a single line.
export function useTextSearch({
  sources,
  split,
  expanded,
  contentKey,
  viewerMode,
  selected,
  viewer,
}: {
  sources: TextSearchSource[];
  split: boolean;
  expanded: boolean;
  contentKey: string;
  viewerMode: ViewerMode;
  selected: string;
  viewer: RefObject<CodeViewHandle<Comment, undefined> | null>;
}) {
  const [open, setOpen] = useState(false);
  const [highlightSelectedText, setHighlightSelectedText] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const selectedMatch = useRef<number | null>(null);
  const findAll = (text: string) => sources.flatMap(({ path, file, diff }) =>
    textSearchMatches(text, file || null, diff || null, split, expanded)
      .map((match) => ({ ...match, path })));
  const matches = useMemo(() => findAll(query), [query, sources, split, expanded]);
  const current = matches[active];
  // The rendered <diffs-container> of each file in the virtual window.
  const hosts = () => viewer.current?.getInstance()?.getRenderedItems() || [];

  useEffect(() => {
    const onTextSelection = (event: Event) => {
      const host = hosts().find((item) => event.composedPath().includes(item.element));
      const shadow = host?.element.shadowRoot;
      if (!host) return;
      const selection = (
        shadow as ShadowRoot & { getSelection?: () => Selection | null }
      )?.getSelection?.() || document.getSelection();
      const range = selection?.rangeCount === 1 ? selection.getRangeAt(0) : null;
      const lineOf = (node: Node | undefined) =>
        (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-line]");
      const startLine = lineOf(range?.startContainer);
      const text = selection?.toString() || "";
      if (
        !range || range.collapsed || !shadow || !startLine ||
        startLine !== lineOf(range.endContainer) || !shadow.contains(startLine) ||
        text.includes("\n")
      ) {
        setHighlightSelectedText(false);
        return;
      }
      const beforeSelection = document.createRange();
      beforeSelection.selectNodeContents(startLine);
      beforeSelection.setEnd(range.startContainer, range.startOffset);
      const start = beforeSelection.toString().length;
      const side = lineSide(startLine);
      const index = findAll(text).findIndex((match) =>
        match.path === host.id && match.line === Number(startLine.dataset.line) &&
        match.start === start && match.side === side);
      if (index === -1) {
        setHighlightSelectedText(false);
        return;
      }
      setQuery(text);
      selectedMatch.current = index;
      setActive(index);
      setHighlightSelectedText(true);
      setOpen(false);
    };
    document.addEventListener("pointerup", onTextSelection);
    document.addEventListener("dblclick", onTextSelection);
    return () => {
      document.removeEventListener("pointerup", onTextSelection);
      document.removeEventListener("dblclick", onTextSelection);
    };
  }, [sources, split, expanded]);
  useEffect(() => setHighlightSelectedText(false), [contentKey, viewerMode]);
  useEffect(() => {
    // Start at the first match in or after the selected file.
    const after = new Set(sources
      .slice(Math.max(0, sources.findIndex((source) => source.path === selected)))
      .map((source) => source.path));
    setActive(selectedMatch.current ??
      Math.max(0, matches.findIndex((match) => after.has(match.path))));
    selectedMatch.current = null;
  }, [query, contentKey, viewerMode, split, expanded]);
  useEffect(() => {
    // In the all-files diff, the viewed file follows the match first:
    // re-rendering for a new selection would cancel an earlier scroll.
    if (!open || !current || current.path !== selected || !viewer.current) return;
    viewer.current.scrollTo({
      type: "line",
      id: current.path,
      lineNumber: current.line,
      side: current.side,
      align: "center",
    });
  }, [open, current, selected]);
  useEffect(() => {
    clearHighlights();
    if ((!open && !highlightSelectedText) || !current) return;
    const styled = new Map<ShadowRoot, HTMLStyleElement>();
    const observer = new MutationObserver(() => applyHighlights());
    const applyHighlights = () => {
      clearHighlights();
      const renderedLines = new Map<string, Map<number, HTMLElement[]>>();
      for (const host of hosts()) {
        const shadow = host.element.shadowRoot;
        if (!shadow) continue;
        if (!styled.has(shadow)) {
          const style = document.createElement("style");
          style.textContent = highlightStyles;
          shadow.append(style);
          styled.set(shadow, style);
          observer.observe(shadow, {
            attributes: true,
            characterData: true,
            childList: true,
            subtree: true,
          });
        }
        const lines = new Map<number, HTMLElement[]>();
        for (const line of shadow.querySelectorAll<HTMLElement>("[data-line]")) {
          const number = Number(line.dataset.line);
          lines.set(number, [...lines.get(number) || [], line]);
        }
        renderedLines.set(host.id, lines);
      }
      const rangeFor = (match: typeof current) => {
        const lines = renderedLines.get(match.path);
        return lines ? rangeForMatch(match, lines) : null;
      };
      const otherRanges = matches
        .filter((match) => match !== current)
        .map(rangeFor)
        .filter((range): range is Range => range !== null);
      if (otherRanges.length)
        CSS.highlights.set(textSearchMatchesHighlightName, new Highlight(...otherRanges));
      const activeRange = rangeFor(current);
      if (activeRange) CSS.highlights.set(textSearchHighlightName, new Highlight(activeRange));
    };
    applyHighlights();
    // CodeView first mounts plain text and later replaces it with highlighted
    // token nodes. It also replaces lines as they enter and leave the virtual
    // window, and mounts files as they scroll into view, so rebuild the Ranges
    // after any of these DOM changes.
    const container = viewer.current?.getInstance()?.getContainerElement();
    if (container) observer.observe(container, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      clearHighlights();
      for (const style of styled.values()) style.remove();
    };
  }, [open, highlightSelectedText, matches, current, contentKey, viewerMode]);

  const move = (offset: number) => {
    if (!matches.length) return;
    setActive((index) => (index + offset + matches.length) % matches.length);
  };
  const show = () => {
    setHighlightSelectedText(false);
    setOpen(true);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
  };
  const findNext = (offset: number) => {
    if (!query) return show();
    setHighlightSelectedText(false);
    setOpen(true);
    move(offset);
  };
  return {
    open, query, setQuery, matches, active, input, move, show, findNext,
    close: () => setOpen(false),
  };
}

export function TextSearchBar({
  search,
  onClose,
}: {
  search: ReturnType<typeof useTextSearch>;
  onClose: () => void;
}) {
  const { query, matches, active, move } = search;
  return (
    <div className="text-search" role="search">
      <input
        ref={search.input}
        aria-label="Find in viewed file"
        placeholder="Find"
        value={query}
        onChange={(event) => search.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            move(event.shiftKey ? -1 : 1);
          }
        }}
      />
      <span aria-live="polite">
        {query ? `${matches.length ? active + 1 : 0}/${matches.length}` : "0/0"}
      </span>
      <button aria-label="Previous match" disabled={!matches.length} onClick={() => move(-1)}>
        ↑
      </button>
      <button aria-label="Next match" disabled={!matches.length} onClick={() => move(1)}>
        ↓
      </button>
      <button aria-label="Close find" onClick={onClose}>
        ×
      </button>
    </div>
  );
}
