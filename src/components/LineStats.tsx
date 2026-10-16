// Line totals for repository files, or +/− change counts for diffs.
export function LineStats({
  lines,
  additions = 0,
  deletions = 0,
  title,
  loading = false,
  unavailable = false,
  changedFilesOnly = false,
  className = "line-stats",
}: {
  lines?: number;
  additions?: number;
  deletions?: number;
  title?: string;
  loading?: boolean;
  unavailable?: boolean;
  changedFilesOnly?: boolean;
  className?: string;
}) {
  const total = lines?.toLocaleString("en-US");
  if (loading || unavailable)
    return (
      <span
        className={`${className} lines-total`}
        role="status"
        title={unavailable ? "Line counts unavailable. Refresh to try again." : "Counting lines…"}
        aria-label={unavailable ? "Line counts unavailable" : "Counting lines…"}
      >
        {loading ? <span className="stats-spinner" aria-hidden="true" /> : "—"}
      </span>
    );
  return (
    <span
      className={className}
      title={title}
      aria-label={total !== undefined
        ? `${total} total lines ${changedFilesOnly ? "in changed and untracked files" : "of code"}`
        : `${additions} lines added, ${deletions} lines removed`}
    >
      {total !== undefined ? (
        <span className="lines-total">{total} {changedFilesOnly ? "changed-file lines" : "lines"}</span>
      ) : (
        <>
          <span className="lines-added">+{additions}</span>
          <span className="lines-removed">−{deletions}</span>
        </>
      )}
    </span>
  );
}
