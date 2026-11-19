# rv

A small, local code review tool for turning feedback into a prompt for a coding
agent, using [@pierre/diffs](https://diffs.com) and
[@pierre/trees](https://www.npmjs.com/package/@pierre/trees).

There are many tools like this, but this one is customized to my preferences.

![Reviewing uncommitted changes with inline comments](docs/screenshots/review.png)

## What it does

- Reviews repository files, uncommitted changes, a single commit, or a commit
  range.
- Attaches comments to lines or ranges, plus general comments, and gathers them
  in one place.
- Shows every changed file in one scroll and tracks which ones you have
  reviewed.
- Copies every comment as a concise prompt with exact file and line
  references, or hands it straight to a coding agent.
- Is fast and keyboard-driven: file finder, search across files, and a command
  launcher for everything else.
- Runs entirely on your machine: no account, database, telemetry, or
  source-code upload.

## Features

### Pick what to review

The **Review** menu switches between the File Browser (the repository at
HEAD), uncommitted changes, recent commits, and a range of commits. Type a
branch, tag, or hash to review any other revision. Ranges diff from the merge
base, like a GitHub pull request, and a commit's message shows up as a file you
can comment on.

![Switching from uncommitted changes to a commit, then to a range](docs/screenshots/scopes.gif)

### Every change in one scroll

**Diff** shows every changed file in one scroll. Marking a file reviewed
collapses its code in place and turns its header lavender. Use the caret to
collapse or reopen a file without changing its review status. The sidebar keeps
reviewed files in place with a purple check mark and follows the file at the top
as you scroll. Selecting a file scrolls to its header. Mark files reviewed from
their header, the file tree (also whole directories), or with <kbd>R</kbd>;
<kbd>U</kbd> undoes it.

### Comment on files, lines and ranges

Click **Comment** in a file header for feedback on the whole file. Hover a line
and click **+** for a line comment, or drag **+** to select a range. Line-number
clicks, Shift-click and <kbd>L</kbd> work too. Line comments work on either side
of a diff and appear inline and in the comments panel. Click a comment's text to
edit it. General comments cover feedback that isn't tied to a file.

![Commenting on a line and a range, then editing a comment](docs/screenshots/comment.gif)

### Turn comments into a prompt

**Submit to Agent** sends every saved comment to your coding agent. If handoff
isn't enabled yet, rv offers to connect it in place—no restart needed. The
comments panel shows whether your agent is waiting or feedback is queued.

**Copy Prompt** (<kbd>Y</kbd>) is always available for a manual handoff, with exact
file and line references. **Preview** (<kbd>P</kbd>) shows exactly what gets
sent or copied. After copying, rv offers to clear the review or keep the
comments for later.

![Previewing the prompt generated from review comments](docs/screenshots/prompt.png)

### Diff, Old, or New

Choose **Diff**, **Old**, or **New** to see the comparison or the complete file
before or after the change. Comments on Old and New use that revision's line
numbers. Diffs can be unified or split (<kbd>V</kbd>), long lines wrap by
default (<kbd>W</kbd>), and **Expand all** shows the unchanged lines between
hunks.

![A split diff with inline comments](docs/screenshots/split.png)

### Find anything

<kbd>F</kbd> opens a fuzzy file finder, and <kbd>/</kbd> filters the file
tree. <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>F</kbd> searches the viewed file, or
every file in the diff, and highlights each match;
<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>G</kbd> jumps to the next one. <kbd>J</kbd>
and <kbd>K</kbd> move between files.

![Finding a file, then searching across every file in the diff](docs/screenshots/search.gif)

### Keyboard first

Press <kbd>?</kbd> or <kbd>⌘</kbd>+<kbd>K</kbd> to search and run any command
and look up its shortcut.

![Running a command from the command launcher](docs/screenshots/commands.gif)

### Links, tabs, and saved state

Cmd-click (Ctrl-click on Windows/Linux) or middle-click a filename to open it
in a new tab. The URL records the selected file and review scope, including
the revisions for a commit or range, the Diff/Old/New choice (`view=diff`,
`view=old`, or `view=new`), split diffs, and expanded unchanged lines. Copy or
bookmark it to return to that view; browser Back/Forward also works. Each tab
navigates independently. Opening the bare URL starts in the File Browser;
unsubmitted range choices are temporary and do not survive reload.

Your review state (comments, reviewed marks, layout preferences) is cached on
local disk, outside the repository, in one readable directory per opened path —
`~/.cache/rv/--home-you-repo--/state.json` on Linux,
`~/Library/Caches/rv/--Users-you-repo--/state.json` on macOS. It survives
server restarts, page reloads and browser changes. Use **Clear** to remove
comments and reviewed marks while keeping your view settings.

Reviewed files are fingerprinted with MD5. After an automatic or manual
refresh, unchanged files stay reviewed. Changed files lose their check mark and
get a **New changes since review** pill (and a compact **NEW** badge in the file
tree). Reviewing the file again acknowledges its current contents and clears
the warning.

## Run it

Requires Node.js 22+ and Git.

```sh
npm ci
npm run build
npm link
```

Then run `rv` inside any repository:

```sh
rv
```

rv opens a browser and serves a read-only review UI on localhost. The current
scope updates automatically: while the tab is visible, rv checks a small change
fingerprint about every three seconds and reloads content only when it changes.
Working-tree checks use Git status and file metadata instead of loading full
diffs or file contents into the browser; commit/range checks only resolve their
refs. Polling pauses in hidden tabs,
and updates wait while you're composing comments. Saved comments, review marks,
selection and layout stay intact; changed reviewed files get the existing **New
changes since review** warning. You can still refresh manually with the toolbar
or <kbd>Shift</kbd>+<kbd>R</kbd>. Nothing is written back to the repository.

Open directly on uncommitted changes, a single commit, or a commit range:

```sh
rv --working              # uncommitted changes
rv --commit HEAD          # a single commit
rv --range main..HEAD     # a commit range
```

`--commit` and `--range` accept anything Git understands (branch, tag, short or
full hash). The three options are mutually exclusive.

Use `rv --help` for directory, port, host, and browser options.

### Background review servers

For agents and scripts, `ensure` reuses a healthy localhost server or starts a
new detached one, prints its URL, and exits without opening a browser:

```sh
rv ensure [directory]      # start or reuse and print the review URL
rv ensure --commit HEAD    # review committed changes
rv ensure --restart        # explicitly replace this repository's servers
rv list                   # PID, URL, and opened directory
rv stop /path/to/repo      # stop this directory's servers
rv stop                   # stop all registered local servers
```

Repeated `ensure` calls reuse the running server, including a foreground
instance, without interrupting pending waits or discarding queued feedback.
`--agent` enables handoff in place if needed; omitting it leaves an existing
agent session enabled. If several servers exist for the same root, rv prefers
the one with the active agent session. A conflicting `--port` requires
`--restart`; `--port 0` accepts any existing port.

`ensure --restart` gracefully replaces the directory's registered servers
using the current rv installation. It preserves the port unless `--port`
overrides it, keeps agent mode enabled if it was already on, and keeps comments
and reviewed marks. Queued feedback is lost and pending waits are interrupted.
Refresh existing tabs after a restart. New detached servers survive the calling
shell or agent, but do not automatically restart after a crash or reboot.

The directory defaults to the current directory and resolves to its Git
working-tree root. Subdirectories and symlinked paths share a server; separate
worktrees and submodules get their own. Concurrent `ensure` calls are serialized.
Plain `rv` still opens the exact requested directory in the foreground.
`list` and `stop` manage registered local servers, not remote ones or servers
started by versions of rv without this feature.

Runtime metadata and logs live outside the repository in rv's platform cache
directory (`RV_CACHE_DIR` overrides it). Abandoned locks are recovered
automatically and stale instance records are ignored. Stopping a server does
not clear review state.

After updating or rebuilding rv, `rv ensure /path/to/repo --restart` replaces
that repository's servers with the current installation. There is no version
comparison or background upgrade mechanism; without `--restart`, healthy
servers keep their loaded code. Use `rv stop` to shut down all registered local
servers.

### Agent integration

Start rv in agent mode to send review prompts directly to a coding agent:

```sh
rv --agent
```

Or start a detached agent session and share the printed URL with the user:

```sh
rv ensure --agent
```

Repeating `rv ensure --agent` is safe: it reuses the existing session, preserving
queued prompts and pending `rv --wait` calls. Plain `rv ensure` also leaves an
existing agent connection enabled. Use `--restart` only when replacement is
needed, such as after updating rv; consume queued feedback first because a
restart discards queued prompts and interrupts pending waits.

**Submit to Agent** is always visible. On a regular localhost server, click
**Connect agent** in the comments panel to enable handoff without restarting.
If you already have comments, **Submit to Agent** offers **Enable & submit**.
This connects rv's handoff channel; it does not launch a coding agent.
**Copy instructions** gives you a message to paste into your existing agent.

The flow is simple:

1. **Your agent** starts `rv ensure --agent`, shares the URL, and runs `rv --wait`.
2. **You** review in the browser, save comments, and click **Submit to Agent**.
3. **Your agent** receives the feedback, makes changes, and runs `rv --wait` again.
4. **You** review the next round as changes appear automatically. No server restart needed.

The handoff card shows **Agent is waiting** when an agent is actively waiting,
or the number of queued reviews when it isn't. Submission clears the saved
comments only after rv accepts the prompt, keeping reviewed marks and leaving
the server open for another round. **Copy Prompt** remains available in either
mode. The agent receives one submitted prompt by running:

```console
$ rv --wait
src/shipping.ts:6
Keep the threshold at 100 € for now.
```

`rv --wait` prints the prompt to stdout and exits. Run it again to wait for the
next submission. Prompts submitted between calls are queued by the running rv
process. Coding agents can run `rv --skill` for a short description of this
workflow. Use `rv stop .` when the session is finished.

## Development

```sh
npm run build
npm test
npm run test:browser
```
