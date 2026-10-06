# AGENTS.md

Claude Code mods shared between workstations (Linux and Windows), published as the `dgsantana`
plugin marketplace (`github.com/dgsantana/claude-mods`). See README.md for what each mod does.

## Layout

| Path | What |
|---|---|
| `.claude-plugin/marketplace.json` | Marketplace manifest; one entry per plugin under `plugins/` |
| `plugins/omp-port/` | The omp-port plugin (function-hook mod) |
| `plugins/omp-port/hooks/register.tsx` | The one hooks module; every `$` call lives here |
| `plugins/omp-port/hooks/*.ts` | Pure logic: frontmatter, paths, glob, layers, load, rule, rules, ttsr-match, advisor, agentsmd, settings-schema, statusline-config, status, config-patch, themes, pane-model |
| `plugins/omp-port/hooks/settings-schema.ts` | The settings catalogue: defaults, validation, `/omp` pane rows and the README table all come from it |
| `plugins/omp-port/themes/builtin.json` | 102 status-line palettes generated from oh-my-pi by `scripts/vendor-themes.ts`. Don't edit; regenerate |
| `plugins/omp-port/types/index.d.ts` | `$.state` contract (`PluginState['omp-port']`) |
| `plugins/omp-port/builtin-rules/` | Rules vendored from oh-my-pi (MIT, see NOTICE). Don't edit; re-vendor |
| `plugins/omp-port/unit/*.spec.ts` | Unit tests for pure modules (`bun test`) |
| `plugins/omp-port/tests/*.test.ts` | Engine tests (`claude plugin test`); `tests/world.ts` fakes fs/session/env |
| `scripts/` | `vendor-themes.ts` (regenerate themes from an omp checkout), `settings-table.ts --write` (README table) |
| `examples/.agents/` | Sample layered config, APPEND_SYSTEM, rules and a custom theme |
| `docs/superpowers/` | Specs and implementation plans |

## Commands

```sh
bun test plugins/omp-port/unit              # pure logic
claude plugin test plugins/omp-port         # hooks against the engine
claude plugin validate . && claude plugin validate plugins/omp-port
cd plugins/omp-port && bunx -p typescript@5.9 tsc -p . --noEmit   # type-check (after the engine has loaded the mod once)
claude --plugin-dir plugins/omp-port        # try it in a session
```

All four must pass before a commit that touches `plugins/`.

## Hard constraints (enforced by the engine, not style)

- **`$` never crosses an import.** The engine follows `$` only into functions declared at the top
  level of the hooks module file. Anything that calls `$` goes in `register.tsx` as a top-level
  function; logic it needs is a pure, `$`-free module that `register.tsx` imports. Inner
  functions taking `$` (declared inside `register`) are refused too.
- **Hook modules have no Node and no DOM.** No `node:*`, no npm packages, no `import()`. Files,
  env, processes, network and time go through `$.fs`, `$.env.get('<literal>')`,
  `$.process.run`, `$.http.fetch`, `$.clock`. YAML is parsed by our own subset parser
  (`frontmatter.ts`).
- **`$.env.get` and `$.state` refs take string literals** (`{ plugin: 'omp-port', key: '...' } as const`),
  and every state key must be declared in `types/index.d.ts`.
- **One hook per (event, matcher)** in the module. Add behaviour to the existing hook rather
  than registering the same event twice.
- **JSX compiles against the global `h`**; elements come from `$.ui.resolve(e)`, never globals.
  State a drawing reads belongs in `$.state`; module variables reset on hot reload.
- `ui.render` props arrive under `e.props` (`e.props.bodyColumns`, `e.props.hasSurvey`), not on `e`.
- There is no render site for Claude Code's own `statusLine`; the status line is the
  `AbovePrompt` band (`status.ts` lays it out, `register.tsx` gathers its data into `$.state`).
- Hook modules can't import `.json`; the plugin reads `themes/builtin.json` at run time through
  `$.fs` from `$.plugin.root`.
- Pane ids are 1–64 of `[A-Za-z0-9_-]`. `Text` has no `key` prop; key `Box`/`Button`/`Select`/`Input`.
  The mobile surface has no `Input`/`Select`: narrow on `e.surface` before resolving them.
- Inline test plugins (`test(name, { plugins }, …)`) can't close over test-file variables.
- `$.command.register` throws for a name a built-in owns (e.g. `/advisor`), and the test kit does
  not reproduce that. Register each command in its own try/catch, and never hook `command.run`
  for a built-in's name. omp-port's commands live under `/omp`.
- `Select` takes 1–64 options. The test kit does not check this (or other paint-time limits):
  after changing a pane, open it in a real session (`tmux` + `claude --plugin-dir plugins/omp-port
  --debug-file <f>`) and grep the log for `does not validate`.

## Engine test conventions

- Op events (`fs.*`, `session.*`, `ui.toast`, `ui.log`, `model.fork`, `model.complete`,
  `process.run`, `store.*`, …) are answered by test hooks with `{ value }` or `{ deny }`.
- Event stand-ins answer their result shape: `prompt.submit` → `{ text, context? }`,
  `turn.complete` → `{ text }`, `tool.call` → `{ result }`.
- `$.prompt.context` only carries `instructionFiles` when the input has it.
- A plugin's `{ deny }` reaches the test's `$.tool.call` as `{ deny }`.
- Windows paths can't be exercised at engine level on Linux (the engine resolves `C:\…` as
  relative). Cover Windows in unit specs through the `Io` interface in `load.ts`. On Windows the
  engine resolves `/home/u` as `D:/home/u`; `tests/world.ts` drops the drive when matching.
- Use `mock.env`, `mock.store`, `mock.clock` from `claude-code/testing`; `clock.settle()` runs
  work scheduled with `$.clock.after`.

## Conventions

- **Cross-platform paths.** Use `paths.ts` (`join`, `dirname`, `basename`, `samePath`,
  `chainBetween`); never hard-code `/`. Home is `USERPROFILE` ?? `HOME`.
- **Fail open.** Every hook falls through to `next(e)` on its own error and logs once through
  `warnOnce`. A broken rule file or failed model call must never block a tool call or prompt.
- **TDD.** Failing test first, watch it fail, then implement. Pure logic gets a `*.spec.ts`;
  hook wiring gets a `*.test.ts`.
- **Adding a setting:** add it to `SETTINGS` in `settings-schema.ts` (and to `StatuslineConfig` if
  it is a status line key), then `bun scripts/settings-table.ts --write`. A spec fails while the
  README table is stale.
- **Layering.** Config, rules and APPEND_SYSTEM come from `.agents/` layers: builtin →
  `~/.agents/` → project `.agents/` from repo root down to cwd. Never read `~/.omp`.
  Don't use `.claude/rules/` (Claude Code loads it in full on its own).
- **Plans** list files, interfaces, test behaviour in prose and verification commands, not
  finished code.
- Code, comments, commits and docs are written in plain English (no caveman style in files).

## Releasing

1. Bump `version` in `plugins/<name>/.claude-plugin/plugin.json`.
2. Run the commands above; all green.
3. Commit (Conventional Commits) and push to `main`.
4. On each workstation: `claude plugin marketplace update dgsantana` then
   `claude plugin update omp-port@dgsantana`.
