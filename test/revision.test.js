import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { repository } from "../server/repository.js";
import { fixture } from "./fixture.js";

test("revision detects repeat edits, additions and deletions without changing on idle polls", async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = await repository(f.root);
  let revision = await repo.revision();
  assert.equal(await repo.revision(), revision);
  const filename = path.join(f.root, "src/shipping.ts");
  const before = await stat(filename);
  const contents = await readFile(filename, "utf8");
  await writeFile(filename, contents.replace("THRESHOLD = 75", "THRESHOLD = 74"));
  await utimes(filename, before.atime, before.mtime);
  assert.notEqual(await repo.revision(), revision, "same-size edits with restored mtime still change ctime");
  revision = await repo.revision();
  await f.write("src/new\tfile\n.ts", "new file\n");
  assert.notEqual(await repo.revision(), revision);
  revision = await repo.revision();
  await rm(path.join(f.root, "src/new\tfile\n.ts"));
  assert.notEqual(await repo.revision(), revision);
  revision = await repo.revision();
  await f.write("ignored/secret.txt", "ignored edits must not trigger a refresh");
  assert.equal(await repo.revision(), revision);
});

test("revision respects the opened subdirectory and tracks its untracked files", async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = await repository(path.join(f.root, "src"));
  const revision = await repo.revision("files");
  await f.write("README.md", "Outside the opened scope\n");
  assert.equal(await repo.revision("files"), revision);
  await f.write("src/discount.ts", "Edited an already-untracked file\n");
  assert.notEqual(await repo.revision("files"), revision);
});

test("historical revisions ignore worktree edits but follow moving refs", async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const repo = await repository(f.root);
  f.git("branch", "review-target", f.third);
  const fixed = await repo.revision("commit", "", f.third);
  const moving = await repo.revision("commit", "", "review-target");
  const range = await repo.revision("range", f.first, "review-target");
  await f.write("src/shipping.ts", "Only the working tree changed\n");
  assert.equal(await repo.revision("commit", "", f.third), fixed);
  assert.equal(await repo.revision("range", f.first, "review-target"), range);
  f.git("update-ref", "refs/heads/review-target", f.second);
  assert.notEqual(await repo.revision("commit", "", "review-target"), moving);
  assert.notEqual(await repo.revision("range", f.first, "review-target"), range);
  assert.equal(await repo.revision("commit", "", f.third), fixed);
  await assert.rejects(repo.revision("unknown"), /Unknown comparison/);
  await assert.rejects(repo.revision("commit", "", "missing-ref"), /Unknown commit/);
});

test("plain directories and Git repositories without commits detect file changes", async t => {
  const root = await mkdtemp(path.join(tmpdir(), "rv-revision-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = await repository(root);
  const empty = await folder.revision("files");
  await writeFile(path.join(root, "file.txt"), "First contents\n");
  assert.notEqual(await folder.revision("files"), empty);
  execFileSync("git", ["-C", root, "init", "-q"]);
  const repo = await repository(root);
  const before = await repo.revision();
  await writeFile(path.join(root, "file.txt"), "Other contents\n");
  assert.notEqual(await repo.revision(), before);
  assert.equal(await repo.revision(), await repo.revision());
});
