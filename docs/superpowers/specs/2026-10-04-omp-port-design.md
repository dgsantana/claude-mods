# omp-port — design

Date: 2026-10-04 · Status: approved in chat, pending spec review

Port a handful of oh-my-pi (omp, MIT, github.com/can1357/oh-my-pi) features to Claude Code as
function-hook mods, shared between workstations (CachyOS Linux personal, Windows company) via a
public GitHub repo used as a plugin marketplace.

## Goals

1. **APPEND_SYSTEM.md** — user text appended to the system prompt, layered global → project.
2. **Rules discovery** — omp-format rule files (`alwaysApply`, rulebook-by-description), plus
   `AGENTS.md` loaded as instruction files the way `CLAUDE.md` is.
3. **TTSR** (Time Traveling Stream Rules), tool scope only — regex and ast-grep conditions checked
   against Edit/Write/MultiEdit payloads; reminder after the result or a deny before it.
4. **Nerd status line** — omp's `nerd` preset look as a Claude Code `statusLine` command.
5. **Advisor** (last) — reviews turns that edited files, notes the person can accept or ignore,
   on/off, spend tracking and a budget.

## Non-goals

- Multi-provider models (advisor may gain an external provider later; not in v1).
- TTSR prose/thinking scope and judged `question` rules.
- Cursor / Windsurf / Cline / Copilot rule formats.
- Reading any omp-owned location (`~/.omp/...`). The mods work with omp absent.

## Repository

Name `claude-mods`, public, `github.com/dgsantana/claude-mods`. Marketplace name `dgsantana`.

```
.claude-plugin/marketplace.json
plugins/omp-port/
  .claude-plugin/plugin.json
  hooks/hooks.json, register.ts      entry: wires the features
  hooks/layers.ts                    layered discovery + merge
  hooks/frontmatter.ts               rule-file parsing
  hooks/append.ts agentsmd.ts rules.ts ttsr.ts advisor.ts
  builtin-rules/*.md                 27 rules vendored from omp
  types/index.d.ts                   $.state contract
  tests/*.test.ts
statusline/                          Bun/TS status line + install helper + bun tests
NOTICE                               omp MIT attribution for vendored rules
docs/superpowers/specs/, plans/
```

One plugin rather than four: a hooks module cannot import files outside its own plugin, so
splitting would duplicate the layer loader. Each feature has an `enabled` switch in config.

Install per machine: `claude plugin marketplace add dgsantana/claude-mods`, then
`claude plugin install omp-port@dgsantana`; status line via its install helper.

## Layers

Order, lowest to highest: built-ins (plugin) → global `~/.agents/` → each `.agents/` found from
the repo root down to the session cwd (nearest wins). Home resolves from `USERPROFILE` on Windows,
`HOME` otherwise.

```
.agents/
  AGENTS.md            (global only; project AGENTS.md lives in the project dirs as usual)
  rules/*.md           omp rule format — omp also reads this path natively, so one rule set
                       serves both tools
  mods/APPEND_SYSTEM.md
  mods/config.json
```

Merge semantics:

| Item | Rule |
|---|---|
| `rules/*.md` | keyed by file name (sans extension); higher layer shadows lower |
| `config.json` | deep merge, higher wins; arrays replace |
| `APPEND_SYSTEM.md` | concatenated low → high; a layer with frontmatter `replace: true` discards all lower layers |
| disabling | `config.rules.disabled: [names]`, `config.rules.builtin: false` |

`.claude/rules/` is deliberately avoided: Claude Code loads it natively and in full, which would
put every trigger rule into context.

## Feature design

### APPEND_SYSTEM

`prompt.compose` hook adds section `omp-port:append`, `scope: 'session'`, after `next(e)`. Empty
merged text → no section.

### AGENTS.md

`prompt.context` hook: collect `$.fs.ancestors({ names: ['AGENTS.md'] })` plus global
`~/.agents/AGENTS.md`, append them to `instructionFiles`. Skip a file already present (same
path) or already `@`-imported by a loaded `CLAUDE.md`. If `instructionFiles` is undefined (a hook
above rewrote the text), do nothing.

### Rules

Parsed fields (omp `Rule` shape): `name`, `path`, `content`, `description`, `globs`,
`alwaysApply`, `condition`, `astCondition`, `scope`, `interruptMode`. `ttsr_trigger` accepted as
legacy alias for `condition`; hyphenated keys camel-cased; YAML-parse failure falls back to
`key: value` lines as omp does. `enabled: false` excludes the file. `agents` and `question` are
parsed and ignored in v1.

Bucketing, in order (as omp): has trigger → TTSR only; `alwaysApply` → full body into a
`omp-port:rules` compose section; has `description` → listed in that section as
`- <name> (<globs>): <description> → <path>` with an instruction to Read the file when relevant;
else dropped.

### TTSR

- Hook: `tool.call` for `Edit`, `Write`, `MultiEdit`.
- Candidate text: `new_string` (Edit), `content` (Write), each `edits[].new_string` (MultiEdit).
  Candidate path: `file_path`.
- Scope tokens: `tool`, `toolcall`, `tool:<name>(<glob>)`; omp tool names `edit`/`write` map to
  Claude `Edit`+`MultiEdit` / `Write`. Rules whose scope only names `text`/`thinking` are
  ignored. A `condition` entry that looks like a file glob becomes the omp shorthand (scope
  `tool:edit(glob), tool:write(glob)` + condition `.*`). `globs` gate on the candidate path.
- Regex: leading `(?i)`, `(?m)`, `(?s)` → JS flags; invalid regex skipped with one log line.
- AST: `ast-grep run --pattern <p> --lang <from extension> --stdin --json` via `$.process.run`
  with `stdin`. Missing binary → AST rules skipped; once per session a toast with the install
  command for the OS (`mise use -g ast-grep`, `scoop install ast-grep`, `cargo install ast-grep`).
- Delivery by effective `interruptMode` (rule overrides `config.ttsr.interruptMode`, default
  `always`): `always`/`tool-only` → `{ deny }` with rendered rule before the tool runs;
  `never` → `await next(e)` then return it with `context` holding the rendered reminder;
  `prose-only` → no-op in tool scope.
- Rendering mirrors omp's templates: `<system-reminder reason="rule_violation" rule=… path=…>`
  wrapping the rule body (deny text uses the same body).
- Repeat: `config.ttsr.repeatMode` `once` (default) | `after-gap` with `repeatGap` (default 10)
  completed turns; injected rules and turn counter in `$.state`.
- Toast names the rule on every trigger.

### Status line

Bun/TypeScript script reading Claude Code's status JSON on stdin. Segments — left: model, mode,
path, git (branch + dirty), pr; right: session name, token total, cost, context %. Separator
powerline-thin, Nerd Font glyphs. Git via subprocess with a short-lived cache file in the OS temp
dir. Missing JSON fields drop their segment (e.g. `mode` if the status JSON lacks permission mode). Install helper prints or patches the `statusLine`
entry of the user `settings.json` on Linux and Windows.

### Advisor

- Track: a `tool.call` hook marks the current turn as editing when Edit/Write/MultiEdit succeeds
  (main thread only, `agentId` absent). `turn.start` clears the mark.
- `turn.complete` (not aborted, marked): `$.model.fork` with a fixed reviewer prompt asking for
  `OK` or a short actionable note.
- Note → toast + an `AbovePrompt` band showing it with `Accept` (default) / `Ignore` buttons.
  On the next `prompt.submit`, an accepted note is prepended to the prompt as a clearly labelled
  advisor block; ignored → dropped. A note not acted on is replaced by the next one.
- `/advisor on|off|status|model <id>|budget <usd>`. Defaults from `config.advisor`
  (`enabled: false`, `model`, `budgetUsd`, `prices` per model per MTok for input, output,
  cache read, cache write).
- Spend from each result's `usage` × price table; per-session in `$.state`, cumulative in
  `$.store`. Reaching the budget switches the advisor off with a toast. `/advisor status` shows
  both totals.

## Error handling

Every hook falls through to `next(e)` on its own failure — a broken rule file or a failed fork
never blocks a tool call or a prompt. Parse errors and skipped rules log once via `$.ui.log`.

## Testing

`claude plugin test plugins/omp-port`: layer order and shadowing; `replace: true`; config deep
merge; frontmatter parse incl. fallback path; scope/glob matching and glob-shorthand; regex flag
mapping; `never` → result with context; `always` → deny; once / after-gap; AST skip + one toast
when binary missing; advisor gating (no edit → no fork), accept/ignore, budget cut-off.
Status line: `bun test` against JSON fixtures, with and without git.

## Verified API facts (this Claude Code build, 2.1.289)

| Fact | Source |
|---|---|
| `tool.call` result is `{ deny }` or `{ result, context?: string[] }`; `context` is read by the model after the result, unseen by the user | `ToolCallResult` |
| `prompt.compose` returns `{ sections: { id, text, scope: 'shared'\|'session' }[] }`, all shared first | `PromptComposeResult` |
| `prompt.context` input/result carry `blocks` and `instructionFiles?` | `PromptContextInput/Result` |
| `$.fs.ancestors({ names: ['AGENTS.md'] })` walks like CLAUDE.md, root first | `fs.ancestors` doc |
| `$.process.run(argv, { cwd, env, stdin, timeoutMs })` | `process.run` doc |
| `$.env.get` takes string literals only | `env` doc |
| `turn.complete` has `answer`, `isAborted`, `turnId`, `agentId?`, `usage?` — no tool list | `TurnCompleteFields` |
| `$.model.fork({ prompt })` reuses the transcript prefix cache; result has `usage` | reference.md |
| omp 18.4.9 TTSR defaults: interrupt `always`, repeat `once`, gap 10; builtin rules mostly `interruptMode: never` | omp docs + `omp config list` |
