#!/usr/bin/env node
import { parseArgs, promisify } from "node:util";
import { execFile, spawn } from "node:child_process";
import { realpath } from "node:fs/promises";
import { repository } from "../server/repository.js";
import {
  activeAgentSession,
  ensureInstance,
  listInstances,
  startInstance,
  stopInstances,
} from "../server/instance.js";

const agentSkill = `Use rv to collect review feedback from the user:
1. Run "rv ensure --agent" once to start a detached localhost server. It prints the review URL and exits without opening a browser. Share the URL with the user.
2. Run "rv --wait". It blocks until the user submits the review, then prints the exact prompt to stdout and exits.
3. Apply the submitted feedback, then run "rv --wait" again for the next review round.

The browser UI stays open between rounds. A successful submission clears its comments, and submissions made between wait calls remain queued. Do not run ensure between rounds: it always restarts the server and discards queued submissions. Use "rv stop ." when the session is finished.

Alternatively, start "rv --agent" as a long-running process and keep it alive.`;

const usage = `Usage: rv [directory] [--working | --commit <ref> | --range <from>..<to>]
       [--agent] [--port 4444] [--no-open]
       rv ensure [directory] [--working | --commit <ref> | --range <from>..<to>]
       [--agent] [--port 4444]
       rv list
       rv stop [directory]
       rv [directory] --wait
       rv --skill

Review the current repository in your browser. Refresh the page to see new changes.
If the default port 4444 is busy, a free port is picked automatically.
--host 0.0.0.0 allows remote access; use only behind a trusted proxy.

ensure restarts the Git working-tree root's servers with this installation,
prints the URL, and exits. It never opens a browser and only uses localhost.
The existing port is kept unless --port explicitly overrides it.
list shows registered running local servers (PID, URL, directory).
stop shuts down the servers for a directory; without a directory it stops all.

Open on a specific review view:
  --working             Uncommitted changes
  --commit <ref>        A single commit, e.g. --commit HEAD
  --range <from>..<to>  A commit range, e.g. --range main..HEAD

Agent integration:
  --agent               Enable submitting review prompts to an agent
  --wait                Wait for the next submitted prompt and print it
  --skill               Print instructions for coding agents

Use rv ensure --agent for a detached agent session. Run ensure only once per
session: restarting discards queued prompts and interrupts pending --wait calls.`;

async function waitForSubmission(root) {
  // Prefer an exact foreground scope, then the working-tree root used by ensure.
  let session = await activeAgentSession(root);
  if (!session) {
    const worktree = await worktreeRoot(root).catch(() => root);
    if (worktree !== root) session = await activeAgentSession(worktree);
  }
  if (!session)
    throw new Error("No active agent session. Start rv --agent or rv ensure --agent first.");
  const response = await fetch(`${session.url}/api/agent/wait`, {
    headers: { "X-Rv": "1", "X-Rv-Agent": session.token },
  });
  if (!response.ok) {
    let message = `Agent session returned HTTP ${response.status}.`;
    try {
      message = (await response.json()).error || message;
    } catch {}
    throw new Error(message);
  }
  const prompt = await response.text();
  await new Promise((resolve, reject) =>
    process.stdout.write(`${prompt}\n`, (error) => error ? reject(error) : resolve()),
  );
}

async function main() {
  const args = process.argv.slice(2);
  const command = ["ensure", "list", "stop"].includes(args[0]) ? args[0] : null;
  const ensure = command === "ensure";
  const management = command === "list" || command === "stop";
  const { values, positionals } = parseArgs({
    args: command ? args.slice(1) : args,
    allowPositionals: true,
    options: management ? { help: { type: "boolean", short: "h" } } : {
      port: { type: "string" },
      host: { type: "string", default: "127.0.0.1" },
      "no-open": { type: "boolean" },
      working: { type: "boolean" },
      commit: { type: "string" },
      range: { type: "string" },
      agent: { type: "boolean" },
      wait: { type: "boolean" },
      skill: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      "ensure-server": { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(usage);
    return;
  }
  if (values.skill) {
    console.log(agentSkill);
    return;
  }
  if (command === "list") {
    if (positionals.length) throw new Error("rv list does not accept arguments.");
    const instances = await listInstances();
    if (!instances.length) console.log("No running rv instances.");
    else {
      console.log("PID\tURL\tDIRECTORY");
      for (const instance of instances)
        console.log(`${instance.pid}\t${instance.url}\t${instance.root}`);
    }
    return;
  }
  if (positionals.length > 1)
    throw new Error("Expected at most one directory.");
  if (command === "stop") {
    // Prefer an exact opened scope (also supports non-Git folders). Otherwise,
    // resolve subdirectories the same way ensure resolves a working-tree root.
    let root = null;
    if (positionals.length) {
      root = await realpath(positionals[0]);
      if (!(await listInstances()).some((instance) => instance.root === root))
        root = await worktreeRoot(root).catch(() => root);
    }
    const { stopped, failed } = await stopInstances(root);
    for (const instance of stopped)
      console.log(`Stopped ${instance.pid}\t${instance.url}\t${instance.root}`);
    for (const { root, error } of failed)
      console.error(`rv: ${root}: ${error.message}`);
    if (!stopped.length && !failed.length)
      console.log(root ? `No running rv instances for ${root}.` : "No running rv instances.");
    if (failed.length) process.exitCode = 1;
    return;
  }
  if (values["ensure-server"] && (ensure || !process.send))
    throw new Error("--ensure-server is an internal option.");
  if (ensure && !["127.0.0.1", "localhost"].includes(values.host))
    throw new Error("rv ensure only supports localhost.");
  if (values.wait && (ensure || values.agent || values.working || values.commit || values.range))
    throw new Error("--wait cannot be combined with ensure, --agent or a review view.");
  const view = reviewView(values);
  const port = values.port === undefined ? null : Number(values.port);
  if (port !== null && (!Number.isInteger(port) || port < 0 || port > 65535))
    throw new Error("Invalid port.");
  const directory = positionals[0] || process.cwd();
  if (values.wait) {
    await waitForSubmission(await realpath(directory));
    return;
  }
  if (ensure) {
    const root = await worktreeRoot(directory);
    const instance = await ensureInstance(root, { port, agent: values.agent });
    console.log(instance.url + view);
    return;
  }
  const repo = await repository(directory);
  const { instance } = await startInstance(repo, {
    port, host: values.host, background: values["ensure-server"], agent: values.agent,
  });
  if (values["ensure-server"]) {
    notify({ instance });
    return;
  }
  const url = instance.url + view;
  console.log(
    `\n  rv → ${url}\n  ${repo.root}\n\n  Refresh the page to update. Ctrl+C to stop.\n`,
  );
  if (!values["no-open"]) openBrowser(url);
}

function reviewView(values) {
  const views = [
    values.working && "working",
    values.commit && "commit",
    values.range && "range",
  ].filter(Boolean);
  if (views.length > 1)
    throw new Error("Use only one of --working, --commit or --range.");
  if (values.working) return "?mode=working";
  if (values.commit)
    return `?mode=commit&to=${encodeURIComponent(values.commit)}`;
  if (values.range) {
    const [from, to] = values.range.split("..");
    if (!from || !to || to.includes(".."))
      throw new Error("Use --range <from>..<to>, e.g. --range main..HEAD.");
    return `?mode=range&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  }
  return "";
}

async function worktreeRoot(directory) {
  const { stdout } = await promisify(execFile)("git", [
    "-C", directory, "rev-parse", "--show-toplevel",
  ], { encoding: "utf8" });
  return realpath(stdout.trim());
}

function openBrowser(url) {
  const [command, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(command, args, { stdio: "ignore" });
  child.on("error", () =>
    console.log("  Open the URL above in your browser."),
  );
}

function notify(message) {
  if (!process.connected) return;
  // A caller exiting early must not kill a server that is already running.
  process.send(message, () => {
    if (process.connected) process.disconnect();
  });
}

main().catch((error) => {
  const message = error.code === "EADDRINUSE"
    ? "Port is busy. Use --port <number>." : error.message;
  console.error(`rv: ${message}`);
  notify({ error: message });
  process.exitCode = 1;
});
