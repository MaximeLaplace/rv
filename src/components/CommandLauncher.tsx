import { useRef, useState, type KeyboardEvent } from "react";
import { isEditableCommand, isPlainStroke } from "../../server/shortcut-bindings.js";
import { useListNavigation } from "../lib/events";
import { bindingKeys, recordStroke, shortcutKeys, shortcuts, type Command, type ShortcutOverrides } from "../lib/shortcuts";
import { Modal } from "./Modal";

export function CommandLauncher({ onClose, onChoose, overrides, saving, error, onUpdate }: {
  onClose: () => void;
  onChoose: (command: Command) => void;
  overrides: ShortcutOverrides;
  saving: boolean;
  error: string;
  onUpdate: (command: Command, binding: string | null | undefined) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [customizing, setCustomizing] = useState(false);
  const [editing, setEditing] = useState<Command | null>(null);
  const [strokes, setStrokes] = useState<string[]>([]);
  const [editError, setEditError] = useState("");
  const recorder = useRef<HTMLButtonElement>(null);
  const normalized = query.trim().toLowerCase();
  const matches = shortcuts.map(shortcut => ({ ...shortcut, keys: shortcutKeys(shortcut.command, overrides) }))
    .filter(shortcut => `${shortcut.label} ${shortcut.category} ${shortcut.keys.join(" ")}`.toLowerCase().includes(normalized));
  const choose = (shortcut: typeof shortcuts[number]) => {
    if (!customizing) return onChoose(shortcut.command);
    if (!isEditableCommand(shortcut.command)) return;
    setEditing(shortcut.command);
    setStrokes([]);
    setEditError("");
  };
  const list = useListNavigation(matches, choose);
  const command = editing && shortcuts.find(item => item.command === editing);
  const binding = strokes.join(" ");

  async function save(value: string | null | undefined) {
    if (!editing || saving) return;
    setEditError("");
    try {
      await onUpdate(editing, value);
      setEditing(null);
    } catch (cause) {
      setEditError((cause as Error).message || "Could not save shortcut.");
    }
  }

  function record(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Tab") return;
    event.preventDefault();
    if (event.key === "Escape" || saving || event.repeat) return;
    const stroke = recordStroke(event.nativeEvent);
    if (!stroke) return;
    setEditError("");
    setStrokes(current => current.length === 1 && isPlainStroke(current[0]) && isPlainStroke(stroke)
      ? [current[0], stroke] : [stroke]);
  }

  function clearRecording() {
    setStrokes([]);
    setEditError("");
    recorder.current?.focus();
  }

  return (
    <Modal
      className="shortcut-dialog"
      aria-labelledby="shortcut-title"
      onClose={onClose}
      onKeyDown={event => {
        if (editing && event.key === "Escape") {
          event.preventDefault();
          if (!saving) setEditing(null);
        }
      }}
    >
      <div className="shortcut-heading">
        <div>
          <h2 id="shortcut-title">Commands</h2>
          <p>{customizing ? "Choose a command to change its shortcut." : "Run a command or look up its shortcut."}</p>
        </div>
        <div className="shortcut-heading-actions">
          {!editing && <button type="button" className="text-button" onClick={() => setCustomizing(value => !value)}>
            {customizing ? "Run commands" : "Customize shortcuts"}
          </button>}
          <button type="button" onClick={onClose} aria-label="Close command launcher">✕</button>
        </div>
      </div>
      {editing && command ? (
        <div className="shortcut-editor">
          <h3>{command.label}</h3>
          <p>Current: <KeyCaps keys={shortcutKeys(editing, overrides)} empty="Unassigned" /></p>
          <div className="shortcut-recording">
            <button
              ref={recorder}
              type="button"
              className="shortcut-recorder"
              autoFocus
              onKeyDown={record}
              aria-label="Record shortcut"
              aria-describedby="shortcut-recording-help"
            >
              <span aria-live="polite" aria-atomic="true">
                <KeyCaps keys={binding ? bindingKeys(binding) : []} empty="Press your shortcut here…" />
              </span>
            </button>
            <button type="button" onClick={clearRecording} disabled={saving || !binding}>Clear recording</button>
          </div>
          <p id="shortcut-recording-help">Press one key, a key combination, or two printable keys in sequence. Browser and OS shortcuts may take priority.</p>
          {editError && <p className="error" role="alert">{editError}</p>}
          <div className="shortcut-editor-actions">
            <button type="button" onClick={() => void save(undefined)} disabled={saving || overrides[editing] === undefined}>Reset to default</button>
            <button type="button" onClick={() => void save(null)} disabled={saving || !shortcutKeys(editing, overrides).length}>Unbind</button>
            <button type="button" onClick={() => setEditing(null)} disabled={saving}>Cancel</button>
            <button type="button" className="primary" onClick={() => void save(binding)} disabled={saving || !binding}>
              {saving ? "Saving…" : "Save shortcut"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="shortcut-search">
            <span aria-hidden="true">⌕</span>
            <input
              autoFocus
              aria-label="Search commands and keyboard shortcuts"
              placeholder="Search commands…"
              value={query}
              onChange={event => { setQuery(event.target.value); list.setActive(0); }}
              onKeyDown={list.onKeyDown}
            />
          </div>
          {error && <p className="shortcut-settings-error" role="alert">{error}</p>}
          <div className="shortcut-list" role="listbox" aria-label="Commands">
            {matches.map((shortcut, index) => {
              const fixed = customizing && !isEditableCommand(shortcut.command);
              return (
                <button
                  type="button"
                  className={`shortcut-row${index === list.active ? " active" : ""}`}
                  key={shortcut.command}
                  role="option"
                  aria-selected={index === list.active}
                  disabled={fixed || saving}
                  onMouseEnter={() => list.setActive(index)}
                  onClick={() => choose(shortcut)}
                >
                  <span className="shortcut-label">
                    {shortcut.label}
                    <small>{fixed ? `${shortcut.category} · Fixed shortcut` : shortcut.category}</small>
                  </span>
                  <KeyCaps keys={shortcut.keys} empty={customizing ? "Unassigned" : ""} />
                </button>
              );
            })}
            {!matches.length && <p className="shortcut-empty">No shortcuts found.</p>}
          </div>
          <p className="shortcut-note"><kbd>↑</kbd><kbd>↓</kbd> Navigate · <kbd>Enter</kbd> {customizing ? "Edit" : "Run"} · <kbd>Esc</kbd> Close</p>
        </>
      )}
    </Modal>
  );
}

function KeyCaps({ keys, empty }: { keys: string[]; empty: string }) {
  return <span className="shortcut-keys">
    {keys.length ? keys.map((key, index) => key === "or" ? <small key={index}>or</small> : <kbd key={index}>{key}</kbd>) : empty}
  </span>;
}
