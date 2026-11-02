import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentConnection } from "../types";

export function useAgentConnection(enabled: boolean, connectable: boolean) {
  const [connection, setConnection] = useState<AgentConnection>({
    enabled, connectable, waiting: false, queued: 0,
  });
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const request = useRef(0);
  const mounted = useRef(true);
  const changing = useRef(false);
  const update = useCallback(async (method: "GET" | "POST") => {
    const id = ++request.current;
    try {
      const response = await fetch("/api/agent/connection", {
        method,
        headers: { "X-Rv": "1" },
        signal: AbortSignal.timeout(5000),
      });
      if (response.status === 404)
        throw new Error("This server needs a restart. Run rv ensure --agent, then refresh this page.");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not connect to the review server.");
      if (mounted.current && id === request.current) {
        setConnection((current) =>
          current.enabled === data.enabled && current.connectable === data.connectable &&
          current.waiting === data.waiting && current.queued === data.queued ? current : data,
        );
        setError("");
      }
      return data as AgentConnection;
    } catch (cause) {
      const message = (cause as Error).message;
      if (mounted.current && id === request.current)
        setError(message === "Failed to fetch" ? "Review server unreachable. Your comments are still here." : message);
      throw cause;
    }
  }, []);
  const refresh = useCallback(() => changing.current ? Promise.resolve(null) : update("GET").catch(() => null), [update]);
  const enable = async () => {
    changing.current = true;
    setConnecting(true);
    try {
      return await update("POST");
    } finally {
      changing.current = false;
      if (mounted.current) setConnecting(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    // Only handoff status is live; repository files still refresh on demand.
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.visibilityState !== "hidden") await refresh();
      if (active) timer = setTimeout(poll, 2000);
    };
    void poll();
    const onVisible = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      mounted.current = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { connection, error, connecting, enable, refresh };
}
