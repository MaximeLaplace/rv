import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { promisify } from "node:util";
import { readdir, lstat, realpath, readFile, readlink } from "node:fs/promises";
import path from "node:path";

const exec = promisify(execFile);
const MAX_FILE = 2 * 1024 * 1024;
const split = (value) => value.split("\0").filter(Boolean);
const countLines = (text) => {
  let lines = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) lines++;
  return lines + (text.length > 0 && !text.endsWith("\n") ? 1 : 0);
};
const unavailable = (name, notice, hash) => ({ name, contents: "", notice, hash });
const TOO_LARGE = "File exceeds the 2 MiB preview limit.";
const md5 = data => createHash("md5").update(data).digest("hex");
async function hashStream(stream) {
  const hash = createHash("md5");
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

export async function repository(directory) {
  const root = await realpath(directory);
  const run = async (args, options = {}) =>
    (
      await exec("git", ["--no-optional-locks", "-C", root, ...args], {
        encoding: "utf8",
        // Metadata (file lists and diff stats) scales with the repository, not
        // the preview size. Individual file contents keep their own bound below.
        maxBuffer: Infinity,
        env: { ...process.env, GIT_PAGER: "cat", GIT_LITERAL_PATHSPECS: "1" },
        ...options,
      })
    ).stdout;
  const git = (...args) => run(args);
  let isGit = true;
  let gitRoot = root;
  try {
    // The opened directory is the review scope: git runs with -C root so
    // ls-files is limited to it and diff --relative limits and names diffs
    // relative to it. Commands like rev-parse and log still work repo-wide.
    gitRoot = (await git("rev-parse", "--show-toplevel")).trim();
  } catch {
    isGit = false;
  }

  // The first worktree is the main checkout, even when Git stores its metadata
  // outside that checkout. NUL-delimited output keeps unusual paths intact.
  const mainRoot = isGit
    ? split(await git("worktree", "list", "--porcelain", "-z"))[0].slice("worktree ".length)
    : root;
  const isWorktree = isGit && mainRoot !== gitRoot;

  async function resolve(ref) {
    if (!ref || ref.length > 256)
      throw new Error("Enter a valid commit or branch.");
    try {
      return (
        await git(
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${ref}^{commit}`,
        )
      ).trim();
    } catch {
      throw new Error(`Unknown commit: ${ref}`);
    }
  }

  async function emptyTree() {
    const result = exec("git", [
      "-C",
      root,
      "hash-object",
      "-t",
      "tree",
      "--stdin",
    ]);
    result.child.stdin.end();
    return (await result).stdout.trim();
  }

  async function head() {
    try {
      return await resolve("HEAD");
    } catch {
      return null;
    }
  }

  function checkPath(name) {
    if (
      !name ||
      name.includes("\0") ||
      name.includes("\\") ||
      path.isAbsolute(name) ||
      name
        .split("/")
        .some((part) => part === ".." || part === ".git" || part === ".")
    ) {
      throw new Error("Invalid file path.");
    }
  }

  async function hashRevisionFile(name, ref) {
    // Large historical files are hashed without buffering them or sending them
    // to the browser. The same preview size limit still applies.
    const child = spawn("git", ["--no-optional-locks", "-C", root, "show", `${ref}:./${name}`], {
      env: { ...process.env, GIT_PAGER: "cat", GIT_LITERAL_PATHSPECS: "1" },
    });
    child.stderr.resume();
    const done = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", code => code === 0 ? resolve() : reject(new Error("Could not hash file at revision.")));
    });
    const [hash] = await Promise.all([hashStream(child.stdout), done]);
    return hash;
  }

  async function file(name, ref = "", fingerprint = false) {
    checkPath(name);
    let data;
    if (ref) {
      if (!/^[a-f0-9]{40,64}$/.test(ref)) throw new Error("Invalid revision.");
      // A missing file is distinct from an empty one. ls-tree also identifies submodules.
      const entry = await git("ls-tree", "-z", ref, "--", name);
      if (!entry) return null;
      if (!entry.startsWith("100"))
        return unavailable(name, "Symbolic links and submodules are not displayed.", md5(entry));
      const size = Number(
        (await git("cat-file", "-s", `${ref}:./${name}`)).trim(),
      );
      if (size > MAX_FILE)
        return unavailable(name, TOO_LARGE, fingerprint ? await hashRevisionFile(name, ref) : undefined);
      data = await run(["show", `${ref}:./${name}`], {
        encoding: "buffer",
        maxBuffer: MAX_FILE + 1024,
      });
    } else {
      const filename = path.join(root, name);
      try {
        const actual = await realpath(filename);
        const relative = path.relative(root, actual);
        if (relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
          throw new Error("File is outside this repository.");
        checkPath(relative.split(path.sep).join("/"));
        const stat = await lstat(filename);
        if (!stat.isFile())
          return unavailable(name, "Symbolic links and directories are not displayed.",
            stat.isSymbolicLink() ? md5(await readlink(filename)) : undefined);
        if (stat.size > MAX_FILE)
          return unavailable(name, TOO_LARGE, fingerprint ? await hashStream(createReadStream(filename)) : undefined);
        data = await readFile(filename);
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    }
    const hash = md5(data);
    if (data.includes(0)) return unavailable(name, "Binary file — no text preview.", hash);
    return { name, contents: data.toString("utf8"), hash };
  }

  async function files() {
    if (isGit) {
      const deleted = new Set(split(await git("ls-files", "-z", "--deleted")));
      return [
        ...new Set(
          split(
            await git(
              "ls-files",
              "-z",
              "--cached",
              "--others",
              "--exclude-standard",
            ),
          ),
        ),
      ]
        .filter((name) => !deleted.has(name))
        .sort();
    }
    const paths = [];
    async function walk(dir = "") {
      for (const item of await readdir(path.join(root, dir), {
        withFileTypes: true,
      })) {
        if ([".git", "node_modules", ".amp"].includes(item.name)) continue;
        const name = path.posix.join(dir, item.name);
        if (item.isDirectory()) await walk(name);
        else if (item.isFile()) paths.push(name);
      }
    }
    await walk();
    return paths.sort();
  }

  async function compare(mode = "working", from = "", to = "", countUntracked = true) {
    if (!isGit) return { mode: "working", base: "", target: "", entries: [] };
    let base, target;
    if (mode === "working") {
      base = (await head()) || (await emptyTree());
      target = "";
    } else if (mode === "commit") {
      target = await resolve(to);
      const parents = (await git("rev-list", "--parents", "-n", "1", target))
        .trim()
        .split(" ");
      base = parents[1] || (await emptyTree());
    } else if (mode === "range") {
      [base, target] = await Promise.all([resolve(from), resolve(to)]);
      // GitHub-style semantics: diff from the merge base so commits already
      // on the base branch never appear as reversals in the range diff.
      const mergeBase = await git("merge-base", base, target).catch(() => "");
      if (mergeBase) base = mergeBase.trim();
    } else throw new Error("Unknown comparison mode.");
    const diffArgs = [
      "--relative",
      "--no-ext-diff",
      "--no-textconv",
      "--no-renames",
      base,
      ...(target ? [target] : []),
      "--",
    ];
    const [names, numstat] = await Promise.all([
      git("diff", "--name-status", "-z", ...diffArgs),
      git("diff", "--numstat", "-z", ...diffArgs),
    ]);
    const stats = new Map(
      split(numstat).map((record) => {
        const [added, removed, ...name] = record.split("\t");
        return [
          name.join("\t"),
          {
            additions: added === "-" ? null : Number(added),
            deletions: removed === "-" ? null : Number(removed),
          },
        ];
      }),
    );
    const tokens = split(names);
    const entries = [];
    for (let i = 0; i < tokens.length; i += 2)
      entries.push({
        status: tokens[i],
        path: tokens[i + 1],
        ...stats.get(tokens[i + 1]),
      });
    if (!target) {
      for (const name of split(
        await git("ls-files", "-z", "--others", "--exclude-standard"),
      )) {
        // Metadata can skip content reads; full comparisons retain exact counts.
        const source = countUntracked ? await file(name).catch(() => null) : null;
        const text = source && !source.notice ? source.contents : null;
        const additions = text === null ? null : countLines(text);
        entries.push({ status: "U", path: name, additions, deletions: 0 });
      }
    }
    return {
      mode,
      base,
      target,
      entries: entries.sort((a, b) => a.path.localeCompare(b.path)),
      ...(mode === "commit"
        ? {
            message: (await git("show", "-s", "--format=%B", target)).replace(
              /\n$/,
              "",
            ),
          }
        : {}),
    };
  }

  async function info() {
    const revision = isGit ? await head() : null;
    const commits = revision
      ? (await git("log", "-60", "--format=%H%x00%h%x00%s%x00%an%x00%aI"))
          .trimEnd()
          .split("\n")
          .map((line) => {
            const [id, short, subject, author, date] = line.split("\0");
            return { id, short, subject, author, date };
          })
      : [];
    let branch = "";
    if (isGit) {
      try {
        branch = (await git("symbolic-ref", "--short", "HEAD")).trim();
      } catch {
        branch = revision?.slice(0, 7) || "";
      }
    }
    const [fileList, working] = await Promise.all([
      files(),
      // Untracked contents and line totals load separately, after the UI opens.
      compare("working", "", "", false),
    ]);
    return {
      root,
      name: path.posix.join(
        path.basename(mainRoot),
        path.relative(gitRoot, root).split(path.sep).join("/"),
      ) + (isWorktree ? " (worktree)" : ""),
      isGit,
      branch,
      commits,
      files: fileList,
      working,
    };
  }

  async function lineCounts() {
    let names;
    if (isGit) {
      const base = (await head()) || (await emptyTree());
      const [changed, untracked] = await Promise.all([
        git("diff", "--relative", "--no-ext-diff", "--no-textconv", "--no-renames",
          "--name-only", "-z", "--diff-filter=d", base, "--"),
        git("ls-files", "-z", "--others", "--exclude-standard"),
      ]);
      names = [...new Set([...split(changed), ...split(untracked)])];
    } else {
      names = await files();
    }
    const counts = Object.create(null);
    const pending = names.values();
    // Bound file opens even when a large checkout has many changes.
    await Promise.all(
      Array.from({ length: Math.min(32, names.length) }, async () => {
        for (const name of pending) {
          const source = await file(name).catch(() => null);
          counts[name] = source && !source.notice ? countLines(source.contents) : null;
        }
      }),
    );
    return counts;
  }

  return { root, info, compare, file, lineCounts };
}
