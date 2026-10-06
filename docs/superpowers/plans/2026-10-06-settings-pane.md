# /dgs settings pane: easier to read and edit

Date: 2026-10-06. Owner feedback with a screenshot of the pane docked on the right.

## Problems seen

| # | Problem |
|---|---|
| 1 | Labels have no fixed width: controls start at different columns, long labels wrap |
| 2 | A description line under every setting doubles the height |
| 3 | `(default)` and `reset` on every row, even untouched ones |
| 4 | Segment editor: `model↑↓✕caveman↑↓✕` runs together; `add: none ▾`; moving left/right is remove then add |
| 5 | Theme picker reads `dark ▾ dark ▾` (family, theme) |
| 6 | Preview is sample words in colour, not the line as drawn |
| 7 | No grouping inside a tab |

## Design

- Rows: a label column as wide as the tab's longest label, the control, then the origin
  (`· global`, `· project`, `· store`) and `reset` only when the value is set in a layer.
- One hint line at the bottom of the pane: the description of the row holding the focus ring,
  tracked through `ui.focus` (`requestId` = the pane id) into state `paneFocus`.
- `Setting` gains an optional `group`; the pane draws a heading where the group changes.
  Status line groups: Look, Git, Limits, Thresholds. The README table ignores groups.
- Segments: one table replaces the `statusline.left` / `statusline.right` rows. A row per
  segment id, the enabled ones first (left side in order, then right), then the disabled ones:
  `[x]` toggles it (on appends to the right side), `L`/`R` moves it to the end of the other side,
  `↑`/`↓` reorder within its side. Every change writes both keys in one patch of the chosen layer;
  one `reset` removes both.
- Theme: `family ▾  theme ▾` with the two words drawn.
- Preview: `statusSpans` over fixed sample data with the current config and theme, at the pane's
  `bodyColumns`, so separators, icons, fill and dropping show as on the band.

## Files

- `hooks/settings-schema.ts`: `group?: string` on `Setting`; groups on the status line settings.
- `hooks/pane-model.ts`: `SegmentLists = { left; right }`; `segmentRows(lists)`,
  `segmentToggle(lists, id)`, `segmentSide(lists, id)`, `segmentMove(lists, id, dir)`;
  `paneGroups(rows)` (rows by group, segment-kind rows left out); `labelWidth(rows)`;
  `hintFor(elementKey, tab)`; `PREVIEW_DATA`. `previewSegments` and `SAMPLE` go.
- `hooks/register.tsx`: the pane body rewritten from these; `writeSegments`, `resetSegments`;
  a `ui.focus` hook for the pane.
- `types/index.d.ts`: `paneFocus: string | null`.

## Tests

- `unit/pane-model.spec.ts`: row order, toggle on/off, side switch, move at the ends, groups,
  label width, hints for `set-`, `reset-` and segment keys.
- `tests/pane.test.tsx`: segment toggle / side / move write both keys; reset only on overridden
  rows; the hint line follows `ui.focus`; group headings drawn; preview carries the separator.

## Verification

The four commands in AGENTS.md, then `/reload-plugins` and `/dgs` in a session for the look.
