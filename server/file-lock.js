import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const LOCK_TIMEOUT = 10_000;
const INITIALIZE_TIMEOUT = 2000;

export async function withFileLock(lock, operation) {
  await mkdir(path.dirname(lock), { recursive: true, mode: 0o700 });
  const owner = { pid: process.pid, token: randomUUID() };
  const deadline = Date.now() + LOCK_TIMEOUT;
  while (true) {
    try {
      await mkdir(lock, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await reapLock(lock);
      if (Date.now() >= deadline)
        throw new Error(`Timed out waiting for ${lock}`);
      await delay(50);
    }
  }
  try {
    await writeFile(path.join(lock, "owner.json"), JSON.stringify(owner), { mode: 0o600, flag: "wx" });
    return await operation();
  } finally {
    try {
      const current = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8"));
      if (current.token === owner.token)
        await rm(lock, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function reapLock(lock) {
  const abandoned = await staleLock(lock);
  if (!abandoned) return;
  const claim = path.join(lock, "reaping");
  try {
    // Only one waiter may reap a stale directory. Recheck after claiming it:
    // another waiter could have already replaced it with a fresh lock.
    await mkdir(claim);
  } catch (error) {
    if (error.code === "EEXIST") {
      if (await staleLock(claim)) await rm(claim, { recursive: true, force: true });
      return;
    }
    if (error.code === "ENOENT") return;
    throw error;
  }
  let discarded;
  try {
    await writeFile(path.join(claim, "owner.json"), JSON.stringify({ pid: process.pid }));
    const current = await stat(lock);
    // Creating the reaping directory changes its parent's mtime. Preserve the
    // initial age check, but verify this is still the same abandoned directory.
    if (current.dev === abandoned.dev && current.ino === abandoned.ino &&
        await staleLock(lock, true)) {
      discarded = `${lock}.${randomUUID()}.stale`;
      await rename(lock, discarded);
      await rm(discarded, { recursive: true, force: true });
    }
  } catch (error) {
    // A newer owner may have released its lock while we were rechecking it.
    if (error.code !== "ENOENT") throw error;
  } finally {
    if (!discarded) await rm(claim, { recursive: true, force: true });
  }
}

async function staleLock(lock, ageChecked = false) {
  let info;
  try {
    info = await stat(lock);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const owner = JSON.parse(await readFile(path.join(lock, "owner.json"), "utf8"));
    if (Number.isInteger(owner?.pid) && owner.pid > 0) {
      try {
        process.kill(owner.pid, 0);
        return null;
      } catch (error) {
        if (error.code === "ESRCH") return info;
        if (error.code === "EPERM") return null;
        throw error;
      }
    }
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  // Recover if a process exited between mkdir and writing owner.json.
  return ageChecked || Date.now() - info.mtimeMs >= INITIALIZE_TIMEOUT ? info : null;
}
