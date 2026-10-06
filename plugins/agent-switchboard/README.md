# Agent Switchboard for Claude Code

Puts Claude Code sessions on [Agent Switchboard](https://github.com/dgsantana/agent-switchboard), the
local board for working across many agent sessions at once. omp sessions publish to the board through
the board's own omp extension; this mod plays the same part inside Claude Code.

It writes one small JSON file per session, `~/.agent-switchboard/sessions/<sessionId>.json`, in the
board's snapshot format v1 with `tool: "claude-code"`. It reads nothing, sends nothing off the machine and calls
no model. The board's hub reads the files.

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
| `lastSaid` | The end (400 characters) of the main loop's final answer of the latest turn that said something, from `turn.complete`; no model call |
| `cost` | `$.session.usage().cost.usd`, after each turn and on each heartbeat |
| `heartbeatAt` | Every 15 seconds; the board shows a session as stalled after 60 seconds without one |
| `endedAt`, `endReason` | `session.end` and its reason (`prompt_input_exit`, `clear`, `resume`, `logout`, `other`) |
| `agentDir` | Claude Code's configuration folder (`CLAUDE_CONFIG_DIR` or `~/.claude`); the hub never reads it |
| `pid` | Always 0: the mods API offers no process id, and the hub does not use it |

Subagents publish nothing: every event carrying an `agentId` is ignored. After `/clear` or `/resume` the
old session's file is marked ended and the new session id gets its own file on its next event or
heartbeat.

## Answering from the board

Each open permission prompt and AskUserQuestion is also offered to the board's hub on `127.0.0.1`
(`SWITCHBOARD_PORT`, default 4777), which can answer it while the terminal still shows it: allow once,
deny, deny with a note, or the question's answers. Whichever answers first gives the call its result; the
terminal dialog closes by itself. "Allow once" runs the call again as this plugin's own, and its
permission check allows that one call unless a rule denies it outright. With no hub, nothing changes.

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
| `hooks/snapshot.ts` | Snapshot format v1, its limits, and where the file goes |
| `unit/*.spec.ts` | Unit tests for the pure modules (`bun test plugins/agent-switchboard/unit`) |
| `tests/*.test.ts` | Hooks against the engine (`claude plugin test plugins/agent-switchboard`) |
