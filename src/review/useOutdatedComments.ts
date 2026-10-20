import { useEffect, useState } from "react";
import { api, loadFile } from "../lib/api";
import { isCommentOutdated } from "../lib/commentHash.js";
import type { Comment, Comparison, Source } from "../types";

const none: ReadonlySet<string> = new Set();

// Check each comment's own source, not the currently selected file/comparison.
// File requests share the viewer's snapshot cache and are invalidated on refresh.
export function useOutdatedComments(comments: Comment[], refresh: number) {
  const [checked, setChecked] = useState<{
    comments: Comment[];
    refresh: number;
    outdated: ReadonlySet<string>;
    error: string;
  }>();
  useEffect(() => {
    let active = true;
    const outdated = new Set<string>();
    let failed = false;
    void Promise.all(comments.filter(comment => !comment.general).map(async comment => {
      try {
        let source: Source;
        if (comment.commit) {
          const comparison = await api<Comparison>("compare", {
            mode: "commit", to: comment.commit, refresh: String(refresh),
          });
          source = comparison.message === undefined ? null
            : { name: "COMMIT_MESSAGE.txt", contents: comparison.message };
        } else {
          source = await loadFile(comment.path, comment.sourceRef || "", refresh);
        }
        if (isCommentOutdated(comment, source)) outdated.add(comment.id);
      } catch {
        // A transport/read failure does not prove that a selection changed.
        // In particular, never make these comments eligible for bulk deletion.
        failed = true;
      }
    })).then(() => {
      if (active) setChecked({ comments, refresh, outdated,
        error: failed ? "Could not check some comments for outdated selections. Refresh to retry." : "" });
    });
    return () => { active = false; };
  }, [comments, refresh]);
  // Do not clear comments using results from an older snapshot or comment list.
  const current = checked?.comments === comments && checked.refresh === refresh ? checked : undefined;
  return { outdated: current?.outdated || none, error: current?.error || "" };
}
