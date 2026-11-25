import { useEffect, useMemo, useRef } from "react";
import { isTyping } from "../lib/events";
import { recordStroke, shortcuts, type Command, type ShortcutOverrides } from "../lib/shortcuts";
import { bindingsFor, isEditableCommand, isPlainStroke } from "../../server/shortcut-bindings.js";

export function useKeyboard({ run, escape, dialogOpen, overrides }: {
  run: (command: Command) => void;
  escape: () => boolean;
  dialogOpen: boolean;
  overrides: ShortcutOverrides;
}) {
  const sequence = useRef<{ key: string; expires: number } | null>(null);
  const map = useMemo(() => {
    const commands = new Map<string, Command>();
    const prefixes = new Set<string>();
    for (const { command } of shortcuts) {
      if (!isEditableCommand(command)) continue;
      for (const binding of bindingsFor(command, overrides)) {
        const [first, second] = binding.split(" ");
        if (second) prefixes.add(first);
        commands.set(binding, command);
      }
    }
    return { commands, prefixes };
  }, [overrides]);
  useEffect(() => { sequence.current = null; }, [map, dialogOpen]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        sequence.current = null;
        if (escape()) event.preventDefault();
        return;
      }
      const stroke = recordStroke(event);
      if (!stroke || dialogOpen ||
          ((!event.metaKey && !event.ctrlKey && !event.altKey) && isTyping(event.target))) return;
      const prefix = sequence.current;
      if (event.repeat && prefix?.key === stroke) return;
      sequence.current = null;
      const pair = prefix && prefix.expires > Date.now() && isPlainStroke(stroke)
        ? map.commands.get(`${prefix.key} ${stroke}`) : undefined;
      const command = pair || map.commands.get(stroke);
      if (command) {
        event.preventDefault();
        run(command);
      } else if (map.prefixes.has(stroke)) {
        event.preventDefault();
        sequence.current = { key: stroke, expires: Date.now() + 1000 };
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [run, escape, dialogOpen, map]);
}
