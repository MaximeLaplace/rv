// MD5 is only a content-change fingerprint here, not a security primitive.
const shifts = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const constants = Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));

/** @param {string} text */
export function md5(text) {
  const bytes = new TextEncoder().encode(text);
  const padded = new Uint8Array(Math.ceil((bytes.length + 9) / 64) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bytes.length * 8, true);
  view.setUint32(padded.length - 4, Math.floor(bytes.length / 2 ** 29), true);
  const state = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let offset = 0; offset < padded.length; offset += 64) {
    let [a, b, c, d] = state;
    for (let i = 0; i < 64; i++) {
      let f, word;
      if (i < 16) {
        f = (b & c) | (~b & d);
        word = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        word = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        word = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        word = (7 * i) % 16;
      }
      const sum = (a + f + constants[i] + view.getUint32(offset + word * 4, true)) | 0;
      const shift = shifts[(i >> 4) * 4 + i % 4];
      [a, b, c, d] = [d, (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0, b, c];
    }
    for (const [i, value] of [a, b, c, d].entries()) state[i] = (state[i] + value) | 0;
  }
  return state.flatMap(word => [0, 8, 16, 24].map(shift =>
    ((word >>> shift) & 255).toString(16).padStart(2, "0"))).join("");
}

/**
 * A missing, unpreviewable or partially removed selection cannot match.
 * Line hashes cover the selected text, without a trailing line separator.
 * @param {import('../types').Comment} comment
 * @param {import('../types').Source | undefined} source
 */
export function selectionHash(comment, source) {
  if (!source || source.notice) return null;
  if (comment.file) return md5(source.contents);
  const { start, end } = comment;
  const lines = source.contents.split("\n");
  // A final newline terminates the last line; it is not an extra empty line.
  if (lines.at(-1) === "") lines.pop();
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length)
    return null;
  return md5(lines.slice(start - 1, end).join("\n"));
}

/**
 * @param {import('../types').Comment} comment
 * @param {import('../types').Source | undefined} source
 */
export function isCommentOutdated(comment, source) {
  return !comment.general && (!comment.hash || selectionHash(comment, source) !== comment.hash);
}
