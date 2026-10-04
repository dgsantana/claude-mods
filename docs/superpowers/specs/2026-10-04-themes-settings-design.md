# Status line themes and the /omp settings pane — design

Date: 2026-10-04 · Status: approved in chat, pending spec review · Builds on
`2026-10-04-omp-port-design.md`.

## Goals

1. **Themes for the status line**: omp's 102 built-in themes (MIT), plus user themes, layered.
2. **omp-parity status line config**: theme, separator style, icon set, left/right segment lists
   in any order, per-segment options.
3. **`/omp` settings pane**: an omp-style tabbed settings screen for everything omp-port
   configures, writing the layered `.agents/mods/config.json`, global by default with a switch
   to the project layer.

## Non-goals

- Theming Claude Code's own UI (only the status line and the pane's preview).
- Hot-watching theme files from the pane (the status line re-reads by mtime anyway).
- Native `/config` rows (`userConfig`); settings stay in the layered `.agents` files.

## Architecture

```
plugins/omp-port/hooks/settings-schema.ts   pure: the catalogue of every setting
plugins/omp-port/hooks/config-patch.ts      pure: set/unset one key path in a config JSON text
plugins/omp-port/hooks/themes.ts            pure: theme resolution (vars, extends, colours)
plugins/omp-port/hooks/statusline-config.ts pure: statusline section types + defaults
plugins/omp-port/hooks/register.tsx         /omp command, Pane render, writes via $.fs
plugins/omp-port/themes/builtin.json        generated: 102 themes, status-line tokens only
statusline/segments.ts                      renders from layout + resolved theme
statusline/config.ts                        node Io + discover() + mtime cache
scripts/vendor-themes.ts                    one-off generator from an omp checkout
```

The status line (Bun) imports the pure modules from `plugins/omp-port/hooks/`; it never imports
`register.tsx`. The generated theme table lives once, in the plugin
(`plugins/omp-port/themes/builtin.json`), because the plugin cannot read outside its own folder
at run time; the status line reads it by relative path from the repo checkout.

## Settings schema

One pure catalogue drives defaults, validation, the pane's rows and the README table.

Entry fields: `key` (dot path in config.json, e.g. `statusline.separator`), `tab`
(`statusline | ttsr | rules | advisor | context`), `label`, `description`, `kind` and its data:

| kind | data | pane control |
|---|---|---|
| `bool` | — | toggle Button |
| `enum` | `options: string[]` | Select |
| `number` | `min?`, `max?`, `step?` | Input, validated |
| `string` | `placeholder?` | Input |
| `theme` | options from resolved themes | Select (searchable by typing) |
| `segments` | allowed segment ids | list editor: ↑ ↓ ✕ per item, + add |
| `stringList` | — | list editor without reorder (e.g. `rules.disabled`) |

`validate(entry, value)` returns the normalised value or an error string. `defaults()` builds
the default config from the catalogue; `DEFAULT_CONFIG` in `layers.ts` is derived from it so the
two cannot drift. Advisor rows that live in `$.store` (`enabled`, `model`, `budgetUsd`) are
catalogue entries with `storage: 'store'` and are written through the store as today.

## Status line config

`statusline` section, layered like the rest:

| key | default | values |
|---|---|---|
| `theme` | `dark` | any built-in or custom theme name |
| `separator` | `powerline-thin` | `powerline`, `powerline-thin`, `slash`, `pipe`, `block`, `none`, `ascii` |
| `icons` | `nerd` | `nerd`, `ascii`, `none` |
| `left` | `[model, caveman, mode, path, git, pr]` | segment ids |
| `right` | `[session, tokens, cost, fiveHour, ctx]` | segment ids |
| `path.style` | `basename` | `basename`, `full`, `home` (`~`-relative) |
| `git.aheadBehind` | `true` | bool |
| `fiveHour.showReset` | `true` | bool |
| `ctx.warnAt` / `ctx.errorAt` | `50` / `80` | percent |

Segment ids: `model, caveman, mode, path, git, pr, session, tokens, cost, fiveHour, ctx`.
Unknown ids are dropped with one warning; a segment may appear once.

Separators: `powerline` draws filled segments on `statusLineBg` with `` / ``;
`powerline-thin` uses `` between plain segments; `slash` ` / `, `pipe` ` │ `, `block`
` ▌ `, `none` two spaces, `ascii` ` > `. Left and right are joined by the right-pointing
variant of the chosen separator.

Icons: `nerd` (current glyphs), `ascii` (short labels: `M`, `git`, `$`, `ctx` …), `none`.

## Themes

- Generator reads omp `packages/tui/src/theme/{dark,light}.json` and `defaults/*.json`,
  resolves `vars` references (recursively, cycle-safe), keeps the tokens below and writes
  `plugins/omp-port/themes/builtin.json`: `{ "<name>": { tokens… } }`, sorted by name.
  NOTICE is extended to cover it.
- Tokens kept: `statusLineBg, statusLineSep, statusLineModel, statusLinePath,
  statusLineGitClean, statusLineGitDirty, statusLineContext, statusLineSpend, statusLineOutput,
  statusLineCost, accent, success, warning, error, dim`, plus optional `statusLineCaveman`.
- Custom themes: `.agents/mods/themes/<name>.json` in any layer (global, project). Shape
  `{ "extends"?: "<name>", "vars"?: {...}, "colors": { token: colour } }`. Higher layers win by
  name; `extends` chains resolve against everything below; missing tokens inherit from
  `extends` or `dark`.
- Colours: `#rrggbb`, `0–255`, or a `vars`/token name. Rendered as truecolor (`38;2;r;g;b`)
  when `COLORTERM` is `truecolor`/`24bit`, else nearest 256-colour index.
- Unknown theme name → `dark` plus one warning.

Segment → token: model→`statusLineModel`, caveman→`statusLineCaveman` (default `#d7875f`),
mode→`accent`, path→`statusLinePath`, git→`statusLineGitClean`/`statusLineGitDirty`,
pr→`accent`, session→`dim`, tokens→`statusLineOutput`, cost→`statusLineCost`,
fiveHour→`success`/`warning`/`error` by thresholds (icon in `statusLineSpend`),
ctx→`statusLineContext` below `warnAt`, then `warning`, then `error`; separators→`statusLineSep`.

## Status line loading

`statusline/config.ts` builds a Node `Io` and calls the existing pure `discover()` with
`root = workspace.project_dir ?? cwd`, `cwd = workspace.current_dir ?? cwd`. Result cached in the
OS temp dir keyed by project dir, invalidated when any layer's `config.json` or themes dir mtime
changes. Bad config → defaults, never a crash; the status line prints what it can.

## The /omp pane

- `/omp` (registered in `session.start`) opens Pane `omp-port:settings` with `focus` and
  `closeOnEscape`. `/omp <tab>` opens on that tab.
- Header: tab Buttons (hotkeys `1`–`5`), scope switch Buttons `Global` / `This project`
  (project disabled outside a project with an explanation).
- Rows from the catalogue for the active tab: label, control, value origin
  (`builtin` / `global` / `project` / `store`) dimmed at the right, description below when
  focused.
- Writes: read the chosen layer's `config.json` text (may not exist), `config-patch.setPath`,
  `$.fs.write` it back; create `.agents/mods/` when missing. Patching keeps every other key
  and formatting of untouched JSON as best effort (re-serialised with 2-space indent). After a
  write the snapshot cache is invalidated and the pane redraws from fresh layers.
- `Reset` per row removes the key from the chosen layer (`unsetPath`), falling back to the layer
  below.
- Status line tab: a preview row drawn with `Text color` per segment from the resolved theme
  (hex if the surface accepts it, else the nearest named colour), using a sample input.
- Rules tab: discovered rules with source and kind (always / rulebook / TTSR); toggle writes
  `rules.disabled` on the chosen layer; `builtin rules` toggle.
- Advisor tab: on/off, model, budget (store), spend session/total, `Reset spend` Button, last
  failure.
- Pane state (tab, scope, focused row) in `$.state`.

## Error handling

Writes that fail (permission, invalid existing JSON) toast the reason and leave the file
untouched; an invalid existing `config.json` is never overwritten. Validation errors show
inline on the row. The status line never throws: any failure falls back to the default layout
and `dark` theme.

## Testing

- Specs: schema validate/defaults; `DEFAULT_CONFIG` equals schema defaults; config-patch
  set/unset keeps siblings, creates objects, refuses invalid JSON; theme resolution (vars chain,
  cycle, extends chain, layer override, unknown → dark, colour formats, truecolor vs 256);
  every vendored theme resolves all tokens; layout (order, duplicates, unknown ids);
  each separator style; icons sets; path styles.
- Engine tests: `/omp` opens the pane; tab Buttons switch rows; a Select change writes the
  global file; scope switch writes the project file; origin labels; reset removes the key;
  invalid existing JSON is not overwritten and toasts; rules toggle writes `rules.disabled`.
- Status line: fixtures render with two themes and two separator styles; truecolor vs 256.

## Verified facts

| Fact | Source |
|---|---|
| 102 omp themes, all carry the 15 tokens above; colours are str (hex or var name) or int | scan of omp `6d8552d` |
| Pane elements: `Box`, `Text` (`color?: string`), `Button` (`hotkey`, `variant`), `Select` (`options`, `value`, `onSelect`), `Input` (terminal/desktop) | `claude-code.d.ts` 2.1.289 |
| `/config` rows only expose `userConfig` (global, in Claude settings) | `reference.md` |
| Status line JSON carries `workspace.project_dir`, `workspace.current_dir` | statusline docs |
| Whether `Text.color` accepts hex is **unverified** — first plan task checks it | — |
