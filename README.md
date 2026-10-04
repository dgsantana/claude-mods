# claude-mods

Claude Code mods, shared between workstations. Currently one plugin, **omp-port**, which brings
a handful of [oh-my-pi](https://github.com/can1357/oh-my-pi) (omp) features to Claude Code,
plus a nerd-font **status line**.

| Feature | What it does |
|---|---|
| APPEND_SYSTEM | Appends your own text to the system prompt, global and per project |
| AGENTS.md | Loads `AGENTS.md` files (project ancestors + `~/.agents/AGENTS.md`) beside `CLAUDE.md` |
| Rules | omp-format rule files: `alwaysApply` rules go into the system prompt, described rules form a rulebook index |
| TTSR | Time Traveling Stream Rules, tool scope: rules checked against every `Edit`/`Write`; a reminder after the result, or a deny before it |
| Advisor | Optional reviewer of turns that edited files; you accept or ignore its note; spend tracking and a budget |
| Status line | omp-style themed line (102 omp themes + custom), configurable segments, separators and icons |
| `/omp` | omp-style settings pane for all of the above |

Works on Linux and Windows. Nothing reads omp's own `~/.omp` files; omp is not required.

## Install

```sh
claude plugin marketplace add dgsantana/claude-mods
claude plugin install omp-port@dgsantana
```

Status line (needs [Bun](https://bun.sh)): clone the repo, then

```sh
bun statusline/install.ts           # prints the settings.json snippet
bun statusline/install.ts --write   # writes it into ~/.claude/settings.json (keeps a .bak)
```

If the [caveman](https://github.com/JuliusBrussee/caveman) plugin is active, the status line shows its
mode badge and savings (read from `~/.claude/.caveman-active`, same checks as caveman's own script),
so you can replace caveman's status line with this one without losing it.

Optional, for AST-based TTSR rules: [ast-grep](https://ast-grep.github.io/) on `PATH`
(`mise use -g ast-grep`, `scoop install ast-grep`, or `cargo install ast-grep`). Without it
those rules are skipped and you get one toast per session saying so.

## Layers

Everything is read from `.agents/` folders, lowest to highest:

1. built-in rules shipped with the plugin (`plugins/omp-port/builtin-rules/`, vendored from omp)
2. global: `~/.agents/` (`%USERPROFILE%\.agents\` on Windows)
3. project: every `.agents/` from the repository root down to the working directory; the nearest wins

```
.agents/
  AGENTS.md              global only (project AGENTS.md files live in the project as usual)
  rules/*.md             omp rule format; omp itself also reads this folder
  mods/APPEND_SYSTEM.md
  mods/config.json
```

- **Rules** merge by file name: a project `rules/foo.md` replaces a global or built-in `foo`.
- **config.json** deep-merges, higher layers win, arrays replace.
- **APPEND_SYSTEM.md** concatenates low to high; frontmatter `replace: true` in a layer drops
  everything below it.

`.claude/rules/` is deliberately not used: Claude Code loads that folder in full on its own,
which would put every trigger rule into context.

See [`examples/.agents/`](examples/.agents) for a sample config, append file and rules.

## Settings

Run `/omp` in a session for the settings pane (tabs: Status line, TTSR, Rules, Advisor, Context).
It writes `~/.agents/mods/config.json` by default; switch to **This project** to write the
repository's `.agents/mods/config.json`. Each row shows where its value comes from
(`default`, `global`, `project`, `store`) and has a reset. A config.json that isn't valid JSON is
never overwritten. Everything can also be edited by hand:

<!-- settings:start -->
| Key | Tab | Default | Values | Meaning |
|---|---|---|---|---|
| `statusline.theme` | Status line | `"dark"` | theme name | Colour theme: one of the 102 omp themes or a custom one from .agents/mods/themes/. |
| `statusline.separator` | Status line | `"powerline-thin"` | `powerline` `powerline-thin` `slash` `pipe` `block` `none` `ascii` | How segments are separated; powerline draws filled segments on the theme background. |
| `statusline.icons` | Status line | `"nerd"` | `nerd` `ascii` `none` | Nerd Font glyphs, short ASCII labels, or no icons. |
| `statusline.left` | Status line | `["model","caveman","mode","path","git","pr"]` | segment ids | Segments on the left, in order. |
| `statusline.right` | Status line | `["session","tokens","cost","fiveHour","ctx"]` | segment ids | Segments on the right, in order. |
| `statusline.path.style` | Status line | `"basename"` | `basename` `full` `home` | Folder name only, the full path, or the path relative to home (~). |
| `statusline.git.aheadBehind` | Status line | `true` | bool | Show ↑/↓ commit counts against the upstream branch. |
| `statusline.fiveHour.showReset` | Status line | `true` | bool | Show the time until the 5-hour usage window resets. |
| `statusline.ctx.warnAt` | Status line | `50` | ≥ 0, ≤ 100 | Context use at which the segment turns to the warning colour. |
| `statusline.ctx.errorAt` | Status line | `80` | ≥ 0, ≤ 100 | Context use at which the segment turns to the error colour. |
| `ttsr.enabled` | TTSR | `true` | bool | Check every Edit/Write against trigger rules. |
| `ttsr.interruptMode` | TTSR | `"always"` | `always` `tool-only` `never` `prose-only` | Default for rules without their own: always/tool-only deny the edit, never reminds after it. |
| `ttsr.repeatMode` | TTSR | `"once"` | `once` `after-gap` | A rule fires once per session, or again after a gap of completed turns. |
| `ttsr.repeatGap` | TTSR | `10` | ≥ 1, ≤ 1000 | Completed turns before an after-gap rule may fire again. |
| `rules.builtin` | Rules | `true` | bool | Load the rules vendored from oh-my-pi. |
| `rules.disabled` | Rules | `[]` | names | Rule names to drop. |
| `advisor.enabled` | Advisor | `false` | bool | Review turns that edited files. (stored by `/advisor`, not config.json) |
| `advisor.model` | Advisor | none | string | Reviewer model id; empty reuses the session through a cached fork. (stored by `/advisor`, not config.json) |
| `advisor.budgetUsd` | Advisor | none | ≥ 0 | The advisor turns itself off once total spend reaches this; empty for none. (stored by `/advisor`, not config.json) |
| `append.enabled` | Context | `true` | bool | Append .agents/mods/APPEND_SYSTEM.md to the system prompt. |
| `agentsMd.enabled` | Context | `true` | bool | Load AGENTS.md files beside CLAUDE.md. |
<!-- settings:end -->

`advisor.prices` (`{ "<model>": { input, output, cacheRead, cacheWrite } }`, USD per MTok)
overrides the built-in price table.

## Status line themes

`statusline.theme` takes any of the 102 themes vendored from oh-my-pi (`dark`, `light`,
`dark-tokyo-night`, `dark-catppuccin`, `light-solarized`, …; the `/omp` pane lists them all) or a
custom theme file `.agents/mods/themes/<name>.json` in any layer:

```json
{ "extends": "dark-nord", "vars": { "hot": "#ff5f87" }, "colors": { "statusLineModel": "hot" } }
```

Colours are `#rrggbb`, an xterm index `0`–`255`, or a name from `vars`. Tokens:
`statusLineBg, statusLineSep, statusLineModel, statusLinePath, statusLineGitClean,
statusLineGitDirty, statusLineContext, statusLineSpend, statusLineOutput, statusLineCost,
statusLineCaveman, accent, success, warning, error, dim`. Missing tokens come from `extends`
(or `dark`). Output is truecolor when `COLORTERM` is `truecolor`/`24bit`, otherwise the nearest
256-colour.

Segments: `model, caveman, mode, path, git, pr, session, tokens, cost, fiveHour, ctx`.
Separators: `powerline` (filled, on `statusLineBg`), `powerline-thin`, `slash`, `pipe`,
`block`, `none`, `ascii`. Icons: `nerd`, `ascii`, `none`.

## Rule format

omp's frontmatter, unchanged:

```markdown
---
description: Never use Box::leak
condition: "Box::leak"                  # regex; (?i) (?m) (?s) prefixes work
astCondition: "for $I := 0; $I < $N; $I++ { $$$BODY }"   # ast-grep pattern
scope: "tool:edit(*.rs), tool:write(*.rs)"
globs: "src/**"
interruptMode: never                    # never | tool-only | always
alwaysApply: true                       # rules without triggers: put the body in the prompt
---
Body: what the model reads.
```

A rule with `condition` or `astCondition` is a TTSR rule. Otherwise `alwaysApply: true` puts its
body in the system prompt, and a `description` lists it in the rulebook. Prose/thinking scopes
and judged `question` rules are not supported (Claude Code exposes no stream to watch them).

## Advisor

```
/advisor on | off | status | reset
/advisor model <id> | default
/advisor budget <usd> | none
```

`/advisor` settings live in the plugin's store, so they apply to every project and outlive the session;
once set they take precedence over `advisor.*` in config.json. When the budget trips the advisor turns
itself off: raise the budget (or `/advisor reset`) and `/advisor on` again.

After a turn that edited files, the advisor asks a reviewer for `OK` or one short note. A note
shows as a toast and a band above the prompt with **Send with next prompt** (default) and
**Ignore**. Accepted notes ride along with your next prompt as context for the model.

## Development

```sh
bun test plugins/omp-port/unit statusline   # pure logic
claude plugin test plugins/omp-port         # hooks against the engine
claude plugin validate . && claude plugin validate plugins/omp-port
claude --plugin-dir plugins/omp-port        # try it in a session
```

All engine calls (`$`) live in `plugins/omp-port/hooks/register.tsx`: the engine only follows
`$` into functions declared in the hooks module itself. Everything else is pure and imported.

## Licence

MIT. `plugins/omp-port/builtin-rules/` comes from oh-my-pi (MIT); see [NOTICE](NOTICE).
