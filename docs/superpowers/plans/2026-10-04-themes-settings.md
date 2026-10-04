# Themes and /omp Settings Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Deviation note:** per the user's global CLAUDE.md, tasks state files, interfaces, test
> behaviour (prose) and verification commands — not written-out code. Execution: native.

**Goal:** Theme the status line with omp's 102 themes plus custom layered themes, give it omp-parity layout config, and add an omp-style `/omp` settings pane that edits the layered `.agents` config.

**Architecture:** Pure modules (`settings-schema`, `config-patch`, `themes`, `statusline-config`) under `plugins/omp-port/hooks/` are shared by the Bun status line and the plugin. The plugin's `register.tsx` hosts the `/omp` pane and all `$` calls. A one-off generator vendors omp's themes into `plugins/omp-port/themes/builtin.json`.

**Tech Stack:** TypeScript, Claude Code function hooks 2.1.289 (Pane, Select, Input, Button), Bun 1.3.14.

**Spec:** `docs/superpowers/specs/2026-10-04-themes-settings-design.md`

## Global Constraints

- All rules in `AGENTS.md` apply: `$` only in top-level functions of `register.tsx`; hook modules have no Node/npm/`import()`; one hook per (event, matcher); `$.state` keys declared in `types/index.d.ts`; fail open; cross-platform paths via `paths.ts`.
- Status line code may use `node:*`; it imports pure modules from `plugins/omp-port/hooks/`, never `register.tsx`.
- Theme table lives once: `plugins/omp-port/themes/builtin.json`.
- Settings stay in layered `.agents/mods/config.json`; advisor `enabled/model/budgetUsd` stay in `$.store`.
- An existing `config.json` that is not valid JSON is never overwritten.
- Status line never throws; fallback is default layout + `dark` theme.
- Bump plugin version to `0.2.0`.

## Verified facts

| Fact | Value |
|---|---|
| omp themes | 102 (`dark`, `light`, 100 in `defaults/`), commit `6d8552d`; all carry `statusLineBg, statusLineSep, statusLineModel, statusLinePath, statusLineGitClean, statusLineGitDirty, statusLineContext, statusLineSpend, statusLineOutput, statusLineCost, accent, success, warning, error, dim`; values are hex / var name / 0–255 |
| omp checkout | scratchpad `omp-src/` (re-clone `can1357/oh-my-pi` if gone) |
| Pane elements | `Box`, `Text` (`color?: string`, `backgroundColor?`, `bold`, `dimColor`), `Button` (`key`, `label`, `hotkey`, `variant`, `onPress`), `Select` (`key`, `label?`, `options`, `value?`, `onSelect(value, e)`), `Input` (terminal/desktop) |
| Pane open | `$.ui.open({ id, title, … })` + `ui.render` hook on `{ component: 'Pane', requestId: id }`; example `plugin-authoring/examples/pane.tsx` |
| Status JSON | `workspace.project_dir`, `workspace.current_dir`, `cwd` |
| Unverified | `Text.color` accepting `#rrggbb`; `Input` props/event names — Task 1 verifies |

## Review Focus

1. **Hand-edited `config.json` with comments or trailing commas** — pane must not overwrite it; toast says why; status line still renders with defaults. Test in Task 7.
2. **Project scope with no project** (cwd is home, or outside any repo) — `This project` disabled with a reason; a write can never land in `~/.agents` through project scope. Test in Task 7.
3. **Custom theme with an `extends` cycle or unknown parent** — resolves with fallback to `dark`, one warning, no crash. Test in Task 2.
4. **Terminal without truecolor** (Windows conhost, tmux without `COLORTERM`) — 256-colour output, no raw `38;2`. Test in Task 5.
5. **Config with wrong types or unknown/duplicate segment ids** (`left: "model"`, `["model","model","bogus"]`) — sanitised layout, one warning. Test in Task 5.

---

### Task 1: Probe pane capabilities (facts, no product code)

**Files:** throwaway `plugins/omp-port/tests/zz-probe.test.tsx` (deleted at end of task).

**Interfaces:** none produced; results recorded as rows in this plan's Verified facts table via a ledger note.

- [ ] Read `plugin-authoring/examples/pane.tsx` and `PaneProps`, `InputProps`, `UiOpenArgs` in `claude-code.d.ts`; note open options (`focus`, `closeOnEscape`), Input's value/change/submit props.
- [ ] Probe: mount a Pane on `terminal` that renders `<Text color="#ff0000">` and another with `color="red"`; record whether the hex tree validates (a refused tree surfaces as an engine-drawn fallback / error).
- [ ] Probe: `$.ui.input` on an `Input` → which handler fires.
- [ ] Delete probe; ledger the facts. No commit needed beyond the ledger.
- Verify: `claude plugin test plugins/omp-port` → existing 34 pass after probe removal.

### Task 2: Theme vendoring and resolution

**Files:**
- Create: `scripts/vendor-themes.ts` (Bun; args: path to omp `packages/tui/src/theme`)
- Create: `plugins/omp-port/themes/builtin.json` (generated, committed)
- Create: `plugins/omp-port/hooks/themes.ts` (pure)
- Modify: `NOTICE` (add themes provenance)
- Test: `plugins/omp-port/unit/themes.spec.ts`

**Interfaces:**
- `THEME_TOKENS: readonly ThemeToken[]` (the 15 tokens + `statusLineCaveman`)
- `type ThemeToken`, `type Colour = string | number`
- `type ThemeSpec = { extends?: string; vars?: Record<string, Colour>; colors: Partial<Record<ThemeToken, Colour>> }`
- `type ResolvedTheme = Record<ThemeToken, Rgb>`, `type Rgb = { r: number; g: number; b: number }`
- `resolveTheme(name: string, builtins: Record<string, Record<string, Colour>>, custom: Record<string, ThemeSpec>): { theme: ResolvedTheme; warnings: string[] }`
- `parseColour(c: Colour, vars: Record<string, Colour>): Rgb | undefined` (hex, 0–255 via xterm table, var chain)
- `listThemes(builtins, custom): string[]` (sorted, custom overriding by name)

Tests pin:
- Generator output: 102 names, each with all 15 tokens as hex strings (vars resolved at generation time).
- Hex and 256-index parse; var chain resolves; var cycle → undefined, no hang.
- `extends` chain resolves through custom → builtin; cycle or unknown parent → falls back to `dark` with one warning (Review Focus 3).
- Missing tokens inherit from parent; `statusLineCaveman` defaults to `#d7875f`.
- Unknown theme name → `dark` + warning.

- [ ] Write failing spec → run `bun test plugins/omp-port/unit/themes.spec.ts` → FAIL (module missing).
- [ ] Implement generator, run `bun scripts/vendor-themes.ts <omp>/packages/tui/src/theme` → writes 102 themes.
- [ ] Implement `themes.ts` → spec passes.
- [ ] Commit `feat(omp-port): vendored omp themes and theme resolution`.
- Verify: `bun test plugins/omp-port/unit` → all pass.

### Task 3: Settings schema and status line config

**Files:**
- Create: `plugins/omp-port/hooks/settings-schema.ts`, `plugins/omp-port/hooks/statusline-config.ts`
- Modify: `plugins/omp-port/hooks/layers.ts` (`Config` gains `statusline`; `DEFAULT_CONFIG` built from schema defaults)
- Test: `plugins/omp-port/unit/settings-schema.spec.ts`, `unit/statusline-config.spec.ts`

**Interfaces:**
- `type Tab = 'statusline' | 'ttsr' | 'rules' | 'advisor' | 'context'`
- `type SettingKind = { kind: 'bool' } | { kind: 'enum'; options: string[] } | { kind: 'number'; min?: number; max?: number } | { kind: 'string' } | { kind: 'theme' } | { kind: 'segments' } | { kind: 'stringList' }`
- `type Setting = { key: string; tab: Tab; label: string; description: string; default: unknown; storage?: 'config' | 'store' } & SettingKind`
- `SETTINGS: readonly Setting[]`; `settingsFor(tab): Setting[]`
- `validate(setting, value): { value: unknown } | { error: string }`
- `schemaDefaults(): Config` (nested object from dot keys, store-backed entries excluded)
- `SEGMENT_IDS`, `type SegmentId`, `SEPARATORS`, `ICON_SETS`
- `type StatuslineConfig` (spec table) and `sanitizeStatusline(raw: unknown): { config: StatuslineConfig; warnings: string[] }`

Tests pin:
- Every spec setting present with the spec default; `DEFAULT_CONFIG` deep-equals `schemaDefaults()` plus existing advisor `prices: {}`.
- validate: enum outside options → error; number bounds; bool from non-bool → error; segments list rejects unknown ids.
- sanitize: wrong types fall back per key; unknown and duplicate segment ids dropped with one warning each (Review Focus 5).
- Existing unit + engine suites still pass (Config shape change is additive).

- [ ] Failing specs → implement → `bun test plugins/omp-port/unit` pass; `claude plugin test plugins/omp-port` pass.
- [ ] Commit `feat(omp-port): settings schema and status line config`.

### Task 4: Config patching

**Files:** Create `plugins/omp-port/hooks/config-patch.ts`; Test `unit/config-patch.spec.ts`.

**Interfaces:**
- `setPath(text: string | undefined, key: string, value: unknown): { text: string } | { error: string }`
- `unsetPath(text: string | undefined, key: string): { text: string } | { error: string }`
- `getPath(obj: unknown, key: string): unknown`

Tests pin:
- Missing/empty file → new object; nested objects created; siblings kept; arrays replaced whole.
- Invalid JSON (comments, trailing comma) → `{ error }`, never text (Review Focus 1).
- unset removes the key and prunes empty parents; unset of a missing key is a no-op text.
- Output is 2-space JSON with trailing newline; CRLF input handled.

- [ ] Failing spec → implement → pass. Commit `feat(omp-port): config patching`.
- Verify: `bun test plugins/omp-port/unit`.

### Task 5: Themed, configurable status line rendering

**Files:**
- Modify: `statusline/segments.ts` (render from `StatuslineConfig` + `ResolvedTheme`)
- Create: `statusline/ansi.ts` (truecolor vs 256 output, nearest-256)
- Test: `statusline/statusline.spec.ts` (update), `statusline/layout.spec.ts`, `statusline/ansi.spec.ts`

**Interfaces:**
- `render(input: StatusInput, opts: { git?: GitInfo; caveman?: Caveman; now?: number; config: StatuslineConfig; theme: ResolvedTheme; truecolor: boolean }): string`
- `fg(rgb, truecolor): string`, `bg(rgb, truecolor): string`, `nearest256(rgb): number`
- Segment functions take `(input, ctx)` and return `{ text, colour: ThemeToken | Rgb } | undefined`.

Tests pin:
- Order follows `left`/`right`; segments absent from both are not drawn.
- Each separator style renders its glyphs; `powerline` uses `statusLineBg` background and arrow transitions.
- Icons `nerd` / `ascii` / `none`.
- `path.style` basename / full / home (both separators); `git.aheadBehind`, `fiveHour.showReset`, `ctx.warnAt`/`errorAt` thresholds.
- `truecolor:false` emits only `38;5;n` (Review Focus 4); `true` emits `38;2;r;g;b`.
- Two themes produce different colour codes for the model segment.
- Existing caveman, 5h and fixture expectations still hold with default config + `dark`.

- [ ] Failing specs → implement → `bun test statusline` pass. Commit `feat(statusline): themes, separators, icons and segment layout`.

### Task 6: Layered loading for the status line and custom themes

**Files:**
- Modify: `plugins/omp-port/hooks/load.ts` (Io gains `listFiles(dir, ext)`; Snapshot gains `configLayers: { source; dir; value }[]` and `themeSpecs: Record<string, ThemeSpec>` from each layer's `mods/themes/*.json`)
- Modify: `plugins/omp-port/hooks/register.tsx` (`ioFrom` implements `listFiles`)
- Create: `statusline/config.ts` (Node Io, `loadStatusline(input): { config; theme; warnings }`, mtime cache in OS temp dir)
- Modify: `statusline/statusline.ts` (wire config, theme, `COLORTERM` truecolor detection)
- Test: `unit/layers.spec.ts` (extend), `statusline/config.spec.ts`

**Interfaces:**
- `Io.listFiles(dir: string, ext: '.md' | '.json'): Promise<string[]>` (replaces `listMarkdown`)
- `Snapshot.configLayers`, `Snapshot.themeSpecs`
- `loadStatusline(input: StatusInput, env): { config: StatuslineConfig; theme: ResolvedTheme; warnings: string[] }`

Tests pin:
- Project custom theme overrides global by name; `configLayers` lists each layer's parsed object in order.
- Status line: temp dir with global + project config picks project theme; invalid JSON → defaults (Review Focus 1 for status line); cache invalidates when a config mtime changes.
- Existing engine tests pass with the Io rename.

- [ ] Failing specs → implement → `bun test plugins/omp-port/unit statusline` and `claude plugin test plugins/omp-port` pass. Commit `feat(statusline): layered config and custom themes`.

### Task 7: `/omp` pane — shell, tabs, scope, generic rows, writes

**Files:**
- Modify: `plugins/omp-port/hooks/register.tsx` (command `omp`, `ui.render` Pane hook, top-level helpers `writeSetting`, `resetSetting`, `paneModel`)
- Create: `plugins/omp-port/hooks/pane-model.ts` (pure: rows for a tab from schema + snapshot layers → `{ key, label, description, kind, value, origin, error? }[]`)
- Modify: `plugins/omp-port/types/index.d.ts` (pane state: `paneTab`, `paneScope`, `paneError`)
- Test: `unit/pane-model.spec.ts`, `tests/pane.test.tsx`

**Interfaces:**
- `paneRows(tab: Tab, snap: Snapshot, store: Record<string, unknown>): PaneRow[]`
- `type PaneRow = { setting: Setting; value: unknown; origin: 'default' | 'builtin' | 'global' | 'project' | 'store' }`
- `projectLayerDir(snap): string | undefined` (nearest project `.agents`, undefined when cwd is home or no project)
- Command `/omp [tab]`; Pane id `omp-port:settings`; Button keys `tab-<tab>`, `scope-global`, `scope-project`, `reset-<key>`; Select/Input keys `set-<key>`.

Tests pin:
- `/omp` opens the pane; `/omp ttsr` opens on TTSR.
- Tab Buttons switch rows (mount, press `tab-advisor`, find advisor rows).
- Select change on `statusline.theme` writes `~/.agents/mods/config.json` with only that key added, siblings kept.
- Scope `project` writes `<repo>/.agents/mods/config.json`; origin label of that row becomes `project`.
- Reset removes the key from the chosen layer.
- Existing invalid JSON at the target → file unchanged, toast mentions the path (Review Focus 1).
- cwd = home or no repo → `scope-project` disabled, write lands nowhere in project scope (Review Focus 2).
- Invalid value (number out of range) → row shows error, nothing written.

- [ ] Failing specs/tests → implement → `bun test plugins/omp-port/unit`, `claude plugin test plugins/omp-port`, tsc clean. Commit `feat(omp-port): /omp settings pane`.

### Task 8: Pane specifics — preview, segments editor, Rules and Advisor tabs

**Files:**
- Modify: `plugins/omp-port/hooks/register.tsx`, `hooks/pane-model.ts`
- Test: `tests/pane.test.tsx` (extend), `unit/pane-model.spec.ts` (extend)

**Interfaces:**
- `segmentsEdit(list: SegmentId[], op: { up | down | remove | add: SegmentId }): SegmentId[]` (pure)
- `rulesRows(snap): { name; source; kind: 'always' | 'rulebook' | 'ttsr'; disabled: boolean }[]`
- Preview: `previewSegments(config, theme): { text; colour: string }[]` (hex or named per Task 1 finding)

Tests pin:
- Segments editor ↑/↓/✕/+ produce the expected list and write it.
- Preview row text follows the configured order and the theme colour changes when the theme changes.
- Rules tab lists builtin/global/project rules with kind; toggling writes `rules.disabled` on the chosen layer; `builtin rules` toggle writes `rules.builtin`.
- Advisor tab shows on/off, model, budget (store), spend; `Reset spend` zeroes `advisor.totalUsd`; changing budget writes the store, not config.

- [ ] Failing tests → implement → all suites pass. Commit `feat(omp-port): pane preview, segment editor, rules and advisor tabs`.

### Task 9: Docs, version, publish

**Files:** Modify `README.md` (themes, status line config table generated from schema, `/omp`), `AGENTS.md` (new modules, theme generator), `plugins/omp-port/.claude-plugin/plugin.json` (version `0.2.0`), `examples/.agents/mods/config.json` (statusline section), add `examples/.agents/mods/themes/my-theme.json`.

- [ ] Full verify: `bun test plugins/omp-port/unit statusline`; `claude plugin test plugins/omp-port`; `claude plugin validate . && claude plugin validate plugins/omp-port`; tsc clean.
- [ ] Commit `docs: themes and settings pane`.
- [ ] Final whole-branch review (fresh reviewer), fix pass, then push `main`; `claude plugin marketplace update dgsantana && claude plugin update omp-port@dgsantana` → version 0.2.0 listed.
