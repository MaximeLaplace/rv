import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { reviewStatus } from "../lib/reviewHash.js";
import type { ReviewFingerprints } from "../types";

export function useReviewedFiles(
  saved: ReviewFingerprints,
  snapshot: string,
  hashFor: (path: string) => Promise<string | null>,
) {
  const requests = useMemo(() => new Map<string, Promise<string | null>>(), [snapshot, hashFor]);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const [checked, setChecked] = useState<{
    snapshot: string;
    hashes: Record<string, string | null>;
    error: string;
  }>();
  const loadHashes = useCallback(async (paths: string[]) => {
    let failed = false;
    const results = await Promise.all(paths.map(async path => {
      let request = requests.get(path);
      if (!request) {
        request = hashFor(path);
        requests.set(path, request);
        request.catch(() => requests.delete(path));
      }
      try {
        return [path, await request] as const;
      } catch {
        failed = true;
        return null;
      }
    }));
    const hashes = Object.fromEntries(results.filter(result => result !== null));
    if (latest.current === snapshot) setChecked(previous => ({
      snapshot,
      hashes: { ...(previous?.snapshot === snapshot ? previous.hashes : {}), ...hashes },
      error: failed ? "Could not check some reviewed files. Refresh to retry." : "",
    }));
    return hashes;
  }, [snapshot, hashFor, requests]);
  useEffect(() => {
    void loadHashes(Object.keys(saved));
  }, [saved, loadHashes]);
  const current = checked?.snapshot === snapshot ? checked : undefined;
  const status = useMemo(() => reviewStatus(saved, current?.hashes || {}), [saved, current]);
  return { ...status, loadHashes, error: current?.error || "" };
}
