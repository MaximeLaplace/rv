import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { md5, selectionHash, isCommentOutdated } from "../src/lib/commentHash.js";

const source = contents => ({ name: "file.ts", contents });
const selection = { start: 2, end: 3 };

test("dependency-free MD5 matches native MD5 for UTF-8 and padding boundaries", () => {
  for (const text of [
    "", "a", "abc", "message digest", "é漢字🙂\r\n", "\ud800",
    ...[55, 56, 63, 64, 65, 119, 120, 127, 128, 1024, 262144].map(n => "x".repeat(n)),
  ]) {
    assert.equal(md5(text), createHash("md5").update(text).digest("hex"));
  }
});

test("line fingerprints cover exactly the selected lines and preserve whitespace", () => {
  const original = source("before\n  selected\nlines\nafter\n");
  const hash = selectionHash(selection, original);
  assert.equal(hash, md5("  selected\nlines"));
  assert.equal(selectionHash(selection, source("changed\n  selected\nlines\nelsewhere\n")), hash);
  assert.notEqual(selectionHash(selection, source("before\nselected\nlines\nafter\n")), hash);
  assert.notEqual(selectionHash(selection, source("before\n  selected\nchanged\nafter\n")), hash);
  assert.equal(selectionHash({ start: 2, end: 2 }, source("first\n\nlast\n")), md5(""));
});

test("missing or partially removed selections cannot be fingerprinted", () => {
  assert.equal(selectionHash(selection, null), null);
  assert.equal(selectionHash(selection, { ...source(""), notice: "Binary file" }), null);
  assert.equal(selectionHash(selection, source("first\nsecond\n")), null);
  assert.equal(selectionHash({ start: 1, end: 1 }, source("")), null);
  for (const range of [
    { start: 0, end: 1 }, { start: 2, end: 1 }, { start: 1, end: 1.5 },
  ]) assert.equal(selectionHash(range, source("first\nsecond\n")), null);
});

test("line fingerprints do not invent an extra line after a final newline", () => {
  const line = { start: 1, end: 1 };
  assert.equal(selectionHash(line, source("one\n")), selectionHash(line, source("one")));
  assert.equal(selectionHash({ start: 2, end: 2 }, source("one\n")), null);
  assert.equal(selectionHash({ start: 2, end: 2 }, source("one\n\n")), md5(""));
});

test("outdated detection distinguishes changed, missing and unchanged selections", () => {
  const original = source("first\nsecond\nthird\n");
  const comment = { ...selection, hash: selectionHash(selection, original) };
  assert.equal(isCommentOutdated(comment, original), false);
  assert.equal(isCommentOutdated(comment, source("elsewhere\nsecond\nthird\n")), false);
  assert.equal(isCommentOutdated(comment, source("first\nnew second\nthird\n")), true);
  assert.equal(isCommentOutdated(comment, source("first\nsecond\n")), true);
  assert.equal(isCommentOutdated(comment, null), true);
  assert.equal(isCommentOutdated({ general: true }, null), false);
});

test("whole-file comments fingerprint the entire file, including empty files", () => {
  const file = { file: true, start: 0, end: 0 };
  const original = source("first\nsecond\n");
  const comment = { ...file, hash: selectionHash(file, original) };
  assert.equal(comment.hash, md5(original.contents));
  assert.equal(isCommentOutdated(comment, original), false);
  assert.equal(isCommentOutdated(comment, source("first\nsecond")), true);
  assert.equal(isCommentOutdated(comment, null), true);
  assert.equal(selectionHash(file, source("")), md5(""));
});
