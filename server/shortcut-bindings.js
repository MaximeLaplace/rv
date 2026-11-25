// Shared by the keyboard dispatcher and the settings API so both validate
// the same bindings, including conflicts with defaults.
export const defaultBindings = {
  palette: ["?", "meta+k"],
  "find-viewed-file": ["meta+f", "ctrl+f"],
  "next-text-match": ["meta+g", "ctrl+g"],
  "previous-text-match": ["shift+meta+g", "ctrl+shift+g"],
  "find-file": ["f"],
  "search-files": ["/"],
  "next-file": ["j"],
  "previous-file": ["k"],
  "file-browser": ["g f"],
  "recent-commit": ["g c"],
  uncommitted: ["g u"],
  "review-palette": ["g r"],
  comment: ["l"],
  "toggle-reviewed": ["r"],
  undo: ["u"],
  "save-comment": ["meta+Enter", "ctrl+Enter"],
  "copy-prompt": ["y"],
  "submit-prompt": [],
  "preview-prompt": ["p"],
  "toggle-diff": ["v"],
  "toggle-wrap": ["w"],
  "toggle-files": ["b"],
  "toggle-comments": ["m"],
  "expand-diff": ["e"],
  "collapse-diff": ["c"],
  refresh: ["shift+r"],
  cancel: ["Escape"],
};

/** @typedef {keyof typeof defaultBindings} Command */
/** @typedef {Partial<Record<Command, string | null>>} ShortcutOverrides */

/** @param {unknown} command @returns {command is Command} */
export function isEditableCommand(command) {
  // Escape and the composer submit gesture are contextual, not global.
  return typeof command === "string" && Object.hasOwn(defaultBindings, command) &&
    command !== "cancel" && command !== "save-comment";
}

/** @param {Command} command @param {ShortcutOverrides} overrides */
export function bindingsFor(command, overrides) {
  const value = overrides[command];
  return value === undefined ? defaultBindings[command] : value === null ? [] : [value];
}

const key = /^[!-~]$/;
const modifiers = /^(?:ctrl\+)?(?:alt\+)?(?:shift\+)?(?:meta\+)?/;

/** @param {string} stroke */
export function isPlainStroke(stroke) {
  return /^(?:shift\+)?[!-~]$/.test(stroke);
}

/** @param {unknown} binding @returns {binding is string} */
export function isShortcutBinding(binding) {
  if (typeof binding !== "string" || binding.length > 50) return false;
  const strokes = binding.split(" ");
  if (strokes.length === 2 && !strokes.every(isPlainStroke)) return false;
  if (strokes.length > 2) return false;
  return strokes.every(stroke => {
    const prefix = stroke.match(modifiers)?.[0] || "";
    const name = stroke.slice(prefix.length);
    // Keep navigation keys and Escape available to focused controls. Enter
    // may be bound with a modifier (except for the reserved composer gesture).
    const printable = key.test(name) && !/[A-Z]/.test(name) &&
      (!prefix.includes("shift+") || /^[a-z]$/.test(name));
    return printable || /^F(?:[1-9]|1[0-2])$/.test(name) ||
      (name === "Enter" && /(?:ctrl|alt|meta)\+/.test(prefix));
  });
}

/** @param {ShortcutOverrides} overrides @param {Command} command */
export function conflictingCommand(overrides, command) {
  const bindings = bindingsFor(command, overrides);
  for (const other of /** @type {Command[]} */ (Object.keys(defaultBindings))) {
    if (other === command) continue;
    if (bindings.some(binding => bindingsFor(other, overrides).some(candidate =>
      candidate === binding || candidate.startsWith(binding + " ") || binding.startsWith(candidate + " "))))
      return other;
  }
}
