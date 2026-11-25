import { useCallback, useEffect, useRef, useState } from "react";
import { shortcuts, type Command, type ShortcutOverrides } from "../lib/shortcuts";

export function useShortcutSettings(panelOpen: boolean) {
  const [overrides, setOverrides] = useState<ShortcutOverrides>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const writing = useRef(false);
  const refresh = useCallback(async () => {
    if (writing.current) return;
    const id = ++revision.current;
    try {
      const response = await fetch("/api/shortcuts", { headers: { "X-Rv": "1" } });
      if (!response.ok) throw new Error("Could not load saved shortcuts.");
      const bindings = await response.json();
      if (id !== revision.current) return;
      setOverrides(bindings);
      setError("");
    } catch {
      if (id === revision.current) setError("Could not load saved shortcuts.");
    }
  }, []);
  useEffect(() => {
    void refresh();
    const onFocus = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      revision.current++;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [refresh]);
  useEffect(() => {
    if (panelOpen) void refresh();
  }, [panelOpen, refresh]);

  async function update(command: Command, binding: string | null | undefined) {
    if (writing.current) return;
    writing.current = true;
    revision.current++;
    setSaving(true);
    try {
      const response = await fetch("/api/shortcuts", {
        method: "PATCH",
        headers: { "X-Rv": "1", "Content-Type": "application/json" },
        body: JSON.stringify({ command, binding }),
      });
      const data = await response.json();
      if (!response.ok) {
        const conflict = shortcuts.find(item => item.command === data.conflict);
        throw new Error(conflict ? `This shortcut conflicts with “${conflict.label}”.` : data.error || "Could not save shortcut.");
      }
      setOverrides(data);
      setError("");
    } finally {
      writing.current = false;
      setSaving(false);
    }
  }

  return { overrides, error, saving, update };
}
