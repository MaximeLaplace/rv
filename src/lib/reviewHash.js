import { md5 } from "./commentHash.js";

/** @param {import('../types').Source} source */
function sourceHash(source) {
  if (!source) return null;
  // Server fingerprints also cover binary files and files over the preview
  // limit. Locally generated sources (commit messages) use the same MD5.
  return source.hash ?? (source.notice ? null : md5(source.contents));
}

/** @param {import('../types').Content} content */
export function reviewHash({ oldFile, newFile }) {
  if (newFile) return sourceHash(newFile);
  const oldHash = sourceHash(oldFile);
  // Deleting a reviewed file is a change even when its old contents match.
  // Missing and empty files must never share a fingerprint.
  return oldHash === null ? null : md5(`deleted:${oldHash}`);
}

/**
 * Unknown hashes (pending/failed reads) cannot confirm a review or a change.
 * @param {import('../types').ReviewFingerprints} saved
 * @param {Record<string, string | null>} current
 */
export function reviewStatus(saved, current) {
  const reviewed = [];
  const changed = new Set();
  for (const [path, hash] of Object.entries(saved)) {
    if (!Object.hasOwn(current, path)) continue;
    if (current[path] === hash) reviewed.push(path);
    else changed.add(path);
  }
  return { reviewed, changed };
}
