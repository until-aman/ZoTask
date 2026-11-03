# ZoTask design theme

One look for every screen. It is modelled on a clean finance dashboard: a white page, big bold section titles over a thin rule, plain metric blocks instead of boxed cards, one purple accent, soft status badges, and charts that compare the current period (purple) with the previous one (gray).

All values live as CSS custom properties at the top of `app/globals.css`. Components use the tokens, never raw colors. If a value you need is missing, add a token here and in the CSS rather than writing a one-off.

## Principles

1. **Quiet surfaces, loud data.** The page is white. Structure comes from whitespace and thin rules, not from boxes and shadows. Numbers are the biggest thing on a metric.
2. **One accent.** Purple marks what you can act on: links, the primary button, the selected tab, focus, and the current period in charts. Nothing decorative is purple.
3. **Status is a soft badge.** Green, red, amber and gray badges have a tinted background and a dark text color from the same family. Color is never the only signal; the badge always has a word.
4. **Same thing, same look.** A filter is always a white bordered button with a chevron. A list is always rows with thin dividers. A section always starts with a title and a rule.
5. **Calm motion.** 120–200 ms ease-out for hover, open and close. Nothing moves when the user has asked for reduced motion.

## Color

| Token | Value | Use |
|---|---|---|
| `--bg` | `#ffffff` | Page background |
| `--card` | `#ffffff` | Surfaces: panels, menus, drawers |
| `--sunken` | `#f6f8fa` | Table headers, insight panels, inputs on hover, code |
| `--line` | `#e3e8ee` | Borders on controls and panels |
| `--line2` | `#ebeef1` | Row dividers and the rule under titles |
| `--fg` | `#1a1f36` | Titles and figures |
| `--text` | `#414552` | Body text |
| `--muted` | `#687385` | Subtitles, labels, captions (4.8:1 on white) |
| `--faint` | `#6c7688` | Least important text that still must be read (4.6:1) |
| `--accent` | `#635bff` | Primary buttons, selected states, focus ring, current-period chart line |
| `--accent-text` | `#5851ea` | Links and accent text (5.6:1 on white) |
| `--accent-soft` | `#efeeff` | Selected row, selected tab, hover on accent items |

Status (text on its soft background is at least 5.8:1):

| Meaning | Text / dot | Soft background |
|---|---|---|
| Success, on time, approved | `--green #05690d` (dot `#1f9e3a`) | `--green-soft #d7f7c2` |
| Failed, missed, overdue | `--red #b3093c` (dot `#df1b41`) | `--red-soft #ffe7f2` |
| Warning, late, waiting | `--amber #a82c00` (dot `#d97917`) | `--amber-soft #fcedb9` |
| In audit (a second workflow stage) | `--navy #0a47b0` | `--navy-soft #e4ecfb` |
| Neutral, closed, waived | `--muted` | `--neutral-soft #ebeef1` |

Chart series, in this order: `--c1 #7a5af8` purple, `--c2 #0a47b0` deep blue, `--c3 #12a3b4` teal, `--c4 #e0571e` orange, `--c5 #a3123a` wine. The previous period is always `--c-prev #a3acb9` gray, drawn thinner.

## Type

Inter for everything, with tabular figures (`font-variant-numeric: tabular-nums`) wherever numbers sit in columns. No monospace in the interface.

| Role | Size / line | Weight | Color |
|---|---|---|---|
| Page title (`h1`) | 28 / 36 | 700 | `--fg` |
| Section title (`h2`, `.band`) | 20 / 28 | 700 | `--fg` |
| Block title (`h3`) | 16 / 24 | 600 | `--fg` |
| Big figure (`.kpi .v`) | 24 / 32 | 600 | `--fg` |
| Body | 14 / 20 | 400 | `--text` |
| Label, button | 14 / 20 | 500–600 | `--fg` |
| Caption, subtitle | 13 / 18 | 400 | `--muted` |
| Small meta, table header | 12 / 16 | 500–600 | `--muted` |

Titles never use uppercase. Table headers use sentence case.

## Space, radius, elevation

- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48. Tokens `--s1`…`--s7`. Gaps between sections are 32; inside a block 12–16.
- Radius: `--r-sm 4px` badges, `--r 6px` buttons and inputs, `--r-md 8px` panels and menus, `--r-lg 12px` drawers, modals, insight panels.
- Elevation:
  - `--e-btn`: `0 1px 1px rgba(0,0,0,.08), 0 2px 5px rgba(60,66,87,.08)` on white buttons and filters.
  - `--e-pop`: `0 7px 14px rgba(60,66,87,.08), 0 3px 6px rgba(0,0,0,.12)` on menus and tooltips.
  - `--shadow`: `0 15px 35px rgba(60,66,87,.2), 0 5px 15px rgba(0,0,0,.12)` on drawers and modals.

## Layout

- Left menu 248 px (64 px when collapsed; hovering the rail opens it over the page), on `--sunken` grey with a hairline on its right. Brand row with a divider, a "Search menu…" box, then 15 px items with 20 px icons. Groups (Analytics, Admin) fold open to sub-items on an indented guide line.
- Content max width 1600 px, 32 px side padding on desktop, 16 px on phones.
- A 12-column grid; dashboard blocks take 4 columns (three across), wide charts take 8, tables take 12.
- Every page starts with a **page header**: title on the left, primary actions on the right, an optional gray subtitle, and a 1 px rule underneath (`.phead`).

## Components

- **Page header** `.phead`: `h1` + `.phead-sub` + actions; rule underneath.
- **Section** `.band`: 20 px bold title with a rule underneath, then the content. Replaces uppercase labels.
- **Block** (dashboard metric): title (16/600) with an info `i`, gray subtitle, rule, then the figure or list; a footer with a purple link on the left and gray "Updated at 12:00" meta with a clock on the right.
- **Buttons**: `.btn` white, 1 px `--line` border, `--e-btn`, 6 px radius, 32 px tall (28 px for `.sm`). `.btn.primary` is purple with white text. `.btn.danger` is red. `.link` is purple text with no box.
- **Filters**: white bordered button with a chevron; when a value is set the text turns purple. Segmented ranges (`.seg`) are a row of white buttons; the selected one has purple text on `--accent-soft`.
- **Badges** `.pill`: 4 px radius, 12 px / 600, tinted background with matching text. Deltas use the same badge (`+12.4%` green, `−3 pts` red).
- **Tables and lists**: no outer box; sentence-case gray header on `--sunken`; rows separated by `--line2`; hover `--sunken`; selected `--accent-soft`; numbers right aligned in tabular figures.
- **Table tools** (`components/ui/TableKit.tsx`): every table and list has the same toolbar on the right: **Columns** (tick columns on or off, remembered per table in this browser) and **Export ▾** (Excel or CSV, for every matching row or this page only, using the columns on screen). Rows per page: 10, 20, 50, 100 or 200. People show as an initials avatar (same name, same colour) with the name and a gray second line. Row actions live in a `⋯` menu at the end of the row; destructive ones are red and ask Yes/No inside the menu.
- **Legend rows**: color square (12 px, 3 px radius), label, right-aligned bold value, divider.
- **Inputs**: white, 1 px `--line`, 6 px radius, 32 px tall, purple focus ring.
- **Insight panel** `.insight`: `--sunken` background, 12 px radius, centered text, dismiss `×`.
- **Drawers and modals**: white, 12 px radius on the open edge, `--shadow`, 24 px padding, title 20/700.
- **Focus**: 2 px `--accent` outline, 2 px offset, on every interactive element.

## Motion

`--ease: cubic-bezier(.2,.8,.2,1)`; hover 120 ms, menus and drawers 180 ms. Wrapped in `@media (prefers-reduced-motion: no-preference)`; with reduced motion, nothing animates.
