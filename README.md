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
| Status line | omp `nerd`-style powerline line: model, caveman badge, mode, path, git, PR · session, tokens, cost, context % |

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

## config.json

| Key | Default | Meaning |
|---|---|---|
| `rules.builtin` | `true` | Load the vendored omp built-in rules |
| `rules.disabled` | `[]` | Rule names to drop |
| `ttsr.enabled` | `true` | Check Edit/Write against trigger rules |
| `ttsr.interruptMode` | `"always"` | Default for rules without their own: `always`/`tool-only` deny, `never` reminds after |
| `ttsr.repeatMode` | `"once"` | `once` per session, or `after-gap` |
| `ttsr.repeatGap` | `10` | Completed turns before an `after-gap` rule may fire again |
| `append.enabled` | `true` | APPEND_SYSTEM section |
| `agentsMd.enabled` | `true` | AGENTS.md loading |
| `advisor.enabled` | `false` | Advisor default (the `/advisor` command overrides it) |
| `advisor.model` | session model | Reviewer model; unset uses a fork of the session (prompt-cache hit) |
| `advisor.budgetUsd` | none | Advisor switches itself off once total spend reaches this |
| `advisor.prices` | built-in table | `{ "<model>": { input, output, cacheRead, cacheWrite } }`, USD per MTok |

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
