import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { reviewHash, reviewStatus } from "../src/lib/reviewHash.js";
import { repository } from "../server/repository.js";
import { fixture } from "./fixture.js";

const file = contents => ({ name: "file.ts", contents });
const fingerprint = contents => reviewHash({ oldFile: null, newFile: file(contents) });
const md5 = data => createHash("md5").update(data).digest("hex");

test("review fingerprints cover the full file, not its diff stats or old revision", () => {
  const newFile = file("first\nsecond\n");
  const hash = reviewHash({ oldFile: file("previous\n"), newFile });
  assert.equal(hash, md5(newFile.contents));
  assert.equal(reviewHash({ oldFile: file("different base\n"), newFile }), hash);
  assert.notEqual(fingerprint("first\nsecond"), hash);
  assert.notEqual(fingerprint("first\nchanged\n"), hash);
});

test("deletions, missing files and empty files are distinct review snapshots", () => {
  const empty = file("");
  const deleted = reviewHash({ oldFile: empty, newFile: null });
  assert.notEqual(deleted, fingerprint(""));
  assert.equal(reviewHash({ oldFile: null, newFile: null }), null);
  assert.notEqual(reviewHash({ oldFile: file("changed"), newFile: null }), deleted);
});

test("review status retains matching files, flags changed files and ignores unknown reads", () => {
  const saved = { stable: fingerprint("same"), changed: fingerprint("old"), deleted: fingerprint("text"), pending: fingerprint("pending") };
  const original = { ...saved };
  const status = reviewStatus(saved, { stable: fingerprint("same"), changed: fingerprint("new"), deleted: null });
  assert.deepEqual(status.reviewed, ["stable"]);
  assert.deepEqual([...status.changed], ["changed", "deleted"]);
  assert.deepEqual(saved, original, "Keep the old fingerprint so the pill survives another reload");
  assert.deepEqual(reviewStatus(saved, { changed: saved.changed }).reviewed, ["changed"]);
  assert.deepEqual(reviewStatus({}, { changed: fingerprint("new") }).changed, new Set());
  const special = Object.fromEntries(["constructor", "__proto__"].map(path => [path, fingerprint("same")]));
  assert.deepEqual(reviewStatus(special, {}).changed, new Set(), "Inherited object keys are not file reads");
  assert.deepEqual(reviewStatus(special, { ...special }).reviewed, ["constructor", "__proto__"]);
});

test("opaque-file review fingerprints use the actual bytes, not preview notices", () => {
  const snapshot = hash => ({ oldFile: null, newFile: { ...file(""), notice: "Binary file", hash } });
  assert.equal(reviewHash(snapshot(md5("first"))), md5("first"));
  assert.notEqual(reviewHash(snapshot(md5("first"))), reviewHash(snapshot(md5("other"))));
  assert.equal(reviewHash(snapshot(undefined)), null);
});

test("file snapshots provide MD5 for text, binary and on-demand large files at both revisions", async t => {
  const f = await fixture();
  t.after(f.cleanup);
  const binary = Buffer.from([1, 0, 2, 255]);
  const large = "a".repeat(2 * 1024 * 1024 + 1);
  await f.write("binary.dat", binary);
  await f.write("large.txt", large);
  f.git("add", "binary.dat", "large.txt");
  f.git("commit", "-qm", "Add opaque files");
  const ref = f.git("rev-parse", "HEAD");
  const repo = await repository(f.root);
  for (const revision of ["", ref]) {
    assert.equal((await repo.file("README.md", revision)).hash, md5("# Parcel\n\nA small, predictable shipping calculator.\n"));
    const opaque = await repo.file("binary.dat", revision);
    assert.equal(opaque.contents, "");
    assert.equal(opaque.hash, md5(binary));
    assert.equal((await repo.file("large.txt", revision)).hash, undefined, "Do not stream large files merely to render their headers");
    const big = await repo.file("large.txt", revision, true);
    assert.equal(big.contents, "");
    assert.equal(big.hash, md5(large));
  }
  await f.write("binary.dat", Buffer.from([1, 0, 3, 255]));
  assert.notEqual((await repo.file("binary.dat")).hash, (await repo.file("binary.dat", ref)).hash);
});
