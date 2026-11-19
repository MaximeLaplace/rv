import { useEffect, useRef, useState } from "react";
import { isTyping } from "../lib/events";

export type ReviewScope = { mode: string; from?: string; to?: string };

// Poll a small metadata fingerprint, not diffs or file contents. Refresh in
// place only after a change, and never while the user is composing feedback.
export function useScopeRefresh(
  scope: ReviewScope,
  paused: boolean,
  refresh: (isCurrent: () => boolean) => Promise<boolean>,
) {
  const [error, setError] = useState("");
  const latest = useRef({ paused, refresh });
  latest.current = { paused, refresh };
  const key = JSON.stringify(scope);
  useEffect(() => {
    let active = true;
    let pending = false;
    let revision: string | undefined;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const canRefresh = () => active && !latest.current.paused &&
      document.visibilityState !== "hidden" && !isTyping(document.activeElement);
    const poll = async () => {
      if (!active || pending) return;
      clearTimeout(timer);
      pending = true;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        if (!canRefresh()) return;
        controller = new AbortController();
        timeout = setTimeout(() => controller?.abort(), 10_000);
        const params = new URLSearchParams({ mode: scope.mode, from: scope.from || "", to: scope.to || "" });
        const response = await fetch(`/api/revision?${params}`, {
          headers: { "X-Rv": "1" }, signal: controller.signal,
        });
        if (response.status === 404)
          throw new Error("Automatic refresh needs an updated server. Restart rv when no feedback is pending, then refresh this page.");
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not check for changes.");
        if (typeof data.revision !== "string") throw new Error("Invalid change notification.");
        if (!canRefresh()) return;
        // Reconcile once on connection too: edits between initial page load and
        // the first poll must not become a silently stale baseline.
        if (revision !== data.revision && await latest.current.refresh(canRefresh) && active)
          revision = data.revision;
        if (active) setError("");
      } catch (cause) {
        if (active) setError((cause as Error).message === "Failed to fetch"
          ? "Automatic refresh paused: server unreachable. Your comments are still here."
          : (cause as Error).message);
      } finally {
        clearTimeout(timeout);
        pending = false;
        if (active) timer = setTimeout(poll, 3000);
      }
    };
    const onVisible = () => { if (document.visibilityState !== "hidden") void poll(); };
    setError("");
    void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [key]);
  return error;
}
