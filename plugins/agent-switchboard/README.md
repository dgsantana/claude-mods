# Agent Switchboard for Claude Code

Puts Claude Code sessions on [Agent Switchboard](https://github.com/dgsantana/agent-switchboard), the
local board for working across many agent sessions at once. omp sessions publish to the board through
the board's own omp extension; this mod plays the same part inside Claude Code.

It writes one small JSON file per session, `~/.agent-switchboard/sessions/<sessionId>.json`, in the
board's snapshot format v1 with `tool: "claude-code"`, and the session's full last answer beside it. The
board's hub reads the files. When the hub is running, the mod also lets the board answer the session's
prompts and, if the board's settings allow it, send the session new prompts. It sends nothing off the
machine and calls no model.

| Path in the board folder | Access | What |
|---|---|---|
| `sessions/<sessionId>.json` | write | The snapshot (below) |
| `said/<sessionId>.md` | write | The session's full last answer (below) |
| `said/<sessionId>.turns.json` | read, write | The session's last 50 turns, each answer in full (below) |
| `said/<sessionId>.messages.json` | read, write | The session's last 200 messages with other sessions (below) |
| `said/<sessionId>.edits.json` | read, write | The files the session's tools edited, the last 500 (below) |
| `settings.json` | read | The board's settings: `board.promptDelaySeconds` and `board.allowPrompting` |
| hub on `127.0.0.1:<SWITCHBOARD_PORT>` | HTTP | Open prompts and their answers; prompts written on the board |

## Install

```sh
claude plugin marketplace add dgsantana/claude-mods
claude plugin install agent-switchboard@dgsantana
```

Needs Claude Code 2.1.287 or later. A session already running picks it up after `/reload-plugins` or a
restart. `SWITCHBOARD_HOME` moves the board's data folder, as it does for the hub.

## What it publishes

| Field | From |
|---|---|
| `state` | `running` from `turn.start` to the main loop's `turn.complete`; `waiting` while an `AskUserQuestion` call is open, or while a call whose permission check answered `ask` is still undecided after the board's prompt delay (`board.promptDelaySeconds` in its settings, default 10 s), until it is decided (the "run in background" line appears under a running Bash command) or resolves; `idle` otherwise. No hook tells a prompt on screen from auto mode's classifier, which took up to 10.6 s when measured, so a prompt reaches the board that much later, and a delay under about 10 s can show the classifier as a brief wait |
| `openAsk` | The oldest open wait: an AskUserQuestion's first question and question count, or `Allow <tool>: <what>?` for a permission prompt |
| `todo` | The task tools (`TaskCreate`, `TaskUpdate`) or a `TodoWrite` list |
| `startedAt` | When the session began, from `$.session.usage().startedAt` (a resumed session's first launch) |
| `lastSaid` | The end (400 characters) of the main loop's final answer of the latest turn that said something, from `turn.complete`; no model call |
| `cost` | `$.session.usage().cost.usd`, after each turn and on each heartbeat |
| `heartbeatAt` | Every 15 seconds; the board shows a session as stalled after 60 seconds without one |
| `endedAt`, `endReason` | `session.end` and its reason (`prompt_input_exit`, `clear`, `resume`, `logout`, `other`) |
| `agentDir` | Claude Code's configuration folder (`CLAUDE_CONFIG_DIR` or `~/.claude`); the hub never reads it |
| `pid` | Always 0: the mods API offers no process id, and the hub does not use it |

Subagents publish nothing: every event carrying an `agentId` is ignored. After `/clear` or `/resume` the
old session's file is marked ended and the new session id gets its own file on its next event or
heartbeat.

## The full last answer

After each main-loop turn that said something, the whole answer goes to `said/<sessionId>.md` in the
board folder, as the model wrote it (Markdown), for the board's project page. An answer over 64 KB keeps
its last 64 KB, marked with a leading `…`. The snapshot's `lastSaid` holds only the last 400 characters.

Each such turn also joins `said/<sessionId>.turns.json`, the session's turn history for the project
page's timeline: a JSON array of `{ at, text }`, oldest first, where `text` is the turn's whole answer,
capped at 16 KB with its end kept and marked with a leading `…` (since 0.6.0; before, the same
400-character end as `lastSaid`). It keeps the last 50 turns; a missing or unreadable file starts a new
history.

Since 0.7.0 the session's messages with other sessions on this machine (Claude Code's SendMessage between
sessions) go to `said/<sessionId>.messages.json`, for the board's conversations: a JSON array of
`{ at, direction, peer?, text }`, oldest first, the last 200 kept, each text at most 16 KB with its end
kept. `direction` is `out` for a delivered send, with `peer` the recipient as it was addressed, and `in`
for a message from another session, with `peer` the sender's `from-name` when the delivery carries the
engine's envelope; `text` is the body without it. A subagent's messages are left out. The hooks record
after the engine has handled each message and never change it.

Since 0.8.0 each successful Edit, Write or NotebookEdit call, a subagent's included, is appended to
`said/<sessionId>.edits.json` as `{ at, path }`, the path as the tool received it, the last 500 kept. The
board uses it to group a worktree's uncommitted changes under the turn that made them. Files changed
through Bash (sed, scripts, formatters) are not seen.

The mod never deletes these files; they stay after the session ends, four per session (`.md`, `.turns.json`,
`.messages.json`, `.edits.json`). The board's hub removes them with the session's snapshot when it prunes it.

## Answering from the board

Each open permission prompt and AskUserQuestion is also offered to the board's hub on `127.0.0.1`
(`SWITCHBOARD_PORT`, default 4777), which can answer it while the terminal still shows it: allow once,
deny, deny with a note, or the question's answers. Whichever answers first gives the call its result; the
terminal dialog closes by itself. "Allow once" runs the call again as this plugin's own, and its
permission check allows that one call unless a rule denies it outright. With no hub, nothing changes.

## Prompting from the board

With the board's setting "Allow prompting sessions from the board" on (off by default), a prompt written on
the board waits in the hub's queue; while its session is idle, the mod takes the oldest one and submits it
with `$.prompt.submit({ text, asUser: true })`, so the model reads it as the person's words and the terminal
labels it as sent from the plugin. The mod asks only while the session is idle, and not at all while the
setting is off.

## Failure

Every hook passes its event on whatever happens to the snapshot, and its `.catch` passes it on if the
hook itself fails. A failed write is logged to Claude Code's debug log at most once a minute. The file is
written in place, since the mods API has no rename; the hub skips a file it cannot parse and reads it
again on its next refresh.

## Layout

| Path | What |
|---|---|
| `hooks/register.ts` | The hooks module; every `$` call lives here |
| `hooks/state.ts` | The session state machine, pure |
| `hooks/snapshot.ts` | Snapshot format v1, its limits, and where the snapshot, the last answer and the settings live |
| `hooks/prompt.ts` | What the mod offers the hub about an open prompt, and what the hub's answer does to the call |
| `hooks/settings.ts` | The values read from the board's `settings.json`, validated as the hub does |
| `hooks/guards.ts` | Shared type guard |
| `unit/*.spec.ts` | Unit tests for the pure modules (`bun test plugins/agent-switchboard/unit`) |
| `tests/*.test.ts` | Hooks against the engine (`claude plugin test plugins/agent-switchboard`) |
