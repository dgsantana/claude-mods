# Status line as an AbovePrompt band

Date: 2026-10-06. Supersedes the "Nerd status line" section of `specs/2026-10-04-omp-port-design.md`.

## Decision

The themed status line moves from the standalone Bun `statusLine` command (`statusline/`) into
omp-port, drawn in the `AbovePrompt` band. `statusline/` is deleted.

Why: the mod system has no render site for Claude Code's own status line (`RenderComponent` in the
2.1.291 API), so the old line needed a per-machine clone, Bun, and a `settings.json` patch that
competes with other plugins for the single `statusLine` slot. A band ships with the plugin, follows
the same layered config and themes the `/omp` pane already edits, and hot-reloads.

Choices made with the owner:

| Option | Chosen | Rejected because |
|---|---|---|
| `AbovePrompt` band (full colour tree) | yes | |
| `PromptHint` own tree (below the prompt) | no | replaces the engine's live hint pills |
| `PromptHint` tail | no | dim text only; themes become pointless |
| Keep Bun script beside the band | no | two renderers to maintain |

## Data sources (mod API)

| Segment | Source | Note |
|---|---|---|
| model | `$.session.model()` | the `/model` string, shortened by `modelLabel` |
| caveman | `$.fs.read` of `.caveman-active` / `.caveman-statusline-suffix` in `CLAUDE_CONFIG_DIR` or `~/.claude` | same whitelist and 64-char cap as before |
| path | `$.session.cwd()` | |
| git | `$.process.run(['git','status','--porcelain=v2','--branch'], { cwd, timeoutMs: 1000 })` | |
| tokens | `usage.context.tokens` | input tokens of the last response (was input+output totals) |
| cost | `usage.cost.usd` | |
| fiveHour | `usage.rateLimits` kind `five_hour` | `resetsAt` is ISO |
| ctx | `usage.context.percent` | |

Dropped (no API): `mode` (vim), `session` (name), `pr`. Configs naming them are cleaned silently
(`RETIRED_SEGMENTS`), not warned about.

## Fill

`statusline.fill` (`gauge` default, `space`, `none`) uses the room between the sides, measured
from `e.props.bodyColumns` with `cellWidth` (emoji and East Asian wide = 2 cells, Nerd Font glyphs
= 1). `gauge` is omp's context rule: filled to the context share in the ctx colour, the percent
at the fill's end, the window size last. Under 12 free cells it falls back to a two-space gap.
`ctx` leaves the default right side since the gauge carries it.

## Refresh

`refreshStatus($)` gathers the data and writes it to `$.state` key `statusData`; the band reads it.
Triggers: `session.start`, main-thread `turn.complete`, and a `$.clock.every(5000)` tick started in
`session.start` (git changes from Bash, caveman mode, reset countdown). One refresh in flight at a
time. Every failure inside leaves that field out (fail open).

## Files

- `plugins/omp-port/hooks/status.ts` (new, pure): `StatusData`, `GitInfo`, `Caveman`,
  `parsePorcelain(out)`, `parseCaveman(flag, suffix, showSavings)`, `modelLabel(id)`,
  `formatTokens`, `formatDuration`, `showPath`, and `statusSpans(data, config, theme)` returning
  `{ left; middle; right }` of `Span` (`{ text; color: hex; backgroundColor?: hex }`) with
  separators and the fill already placed. `StatusData`, `GitInfo` and `Caveman` live in
  `types/index.d.ts` (the contract must be self-contained) and `status.ts` re-exports them.
- `plugins/omp-port/hooks/settings-schema.ts`: segment ids lose `mode`, `session`, `pr`; new
  `statusline.enabled` (bool, default true); defaults left `model caveman path git`, right
  `tokens cost fiveHour ctx`.
- `plugins/omp-port/hooks/statusline-config.ts`: `enabled` field; retired ids dropped silently.
- `plugins/omp-port/hooks/pane-model.ts`: sample and token tables follow the new ids.
- `plugins/omp-port/hooks/register.tsx`: `refreshStatus`, `readCavemanFiles`, the timer, and the
  one `AbovePrompt` hook drawing the status row first, the advisor note under it.
- `plugins/omp-port/types/index.d.ts`: `statusData: StatusData | null`.
- Delete `statusline/`. Update README (install section, settings table via
  `bun scripts/settings-table.ts --write`), AGENTS.md layout and commands.

## Tests

- `unit/status.spec.ts`: porcelain parsing (branch, detached, ahead/behind, dirty); caveman
  whitelist, `off`, `full` shown as no label, control bytes stripped, savings switch; model label;
  spans for each separator style (powerline carries `backgroundColor`), missing data drops a
  segment, ctx and fiveHour colour thresholds, reset countdown only when in the future.
- `unit/statusline-config.spec.ts`: retired ids dropped without a warning; `enabled` default.
- `tests/statusline.test.ts`: after `session.start` with mocked `session.usage`, `session.model`,
  `process.run` and caveman files, the mounted band shows model, branch and ctx; `enabled: false`
  draws nothing; a failing `process.run` still draws the rest; the advisor note still shows with
  its buttons.

## Verification

```sh
bun test plugins/omp-port/unit
claude plugin test plugins/omp-port
claude plugin validate . && claude plugin validate plugins/omp-port
cd plugins/omp-port && bunx -p typescript@5.9 tsc -p . --noEmit
```

Then a real session (`claude --plugin-dir plugins/omp-port --debug-file <f>`), grep the log for
`does not validate`, and check the timer does not double after a hot reload.
