# QueueIt design

Visual language for the campus queue product. Tokens live in `client/src/index.css`. This document records the intended values — do not invent fonts or palette hues when adding UI.

## Palette

| Token | Hex | Use |
|-------|-----|-----|
| Forest (`--primary`) | `#1b4332` | Brand, primary actions, focus ring |
| Forest hover | `#14532d` | Hover on primary |
| On primary | `#f0fdf4` | Text on Forest buttons |
| Primary mist | `#d8f3dc` | Soft success / called wash — use sparingly, not as a hero fill |
| Canvas (`--background`) | `#f4f1ea` | Page background (warm stone) |
| Card (`--card`) | `#fffcf7` | Surfaces, dialogs, popovers |
| Surface muted (`--secondary`) | `#efece4` | Recessed tiles, chips |
| Text | `#1a1a18` | Body and headings |
| Text secondary / muted | `#57534e` | Helper, labels, captions |
| Border | `#e7e5e4` | Hairlines |
| Border strong | `#d6d3d1` | Stronger edges, inputs |
| Danger | `#9b2226` | Destructive actions |
| Success | `#2d6a4f` | Positive status |
| Warning (terracotta) | `#bc6c25` | Caution, near-front |

Teal “Operate” palettes are an anti-reference. The product is light-only; the dark theme in CSS is dormant.

### Contrast

`--text-secondary` and `--text-muted` are both `#57534e`. A lighter stone (`#78716c`) failed WCAG AA on canvas (4.25:1) and secondary (4.06:1). `#57534e` is 6.76:1 on canvas `#f4f1ea`, 6.46:1 on secondary `#efece4`, and 7.45:1 on card `#fffcf7`. Normal text needs 4.5:1.

## Type

Two faces only:

- **Display** — Fraunces (Soft axis; WONK off). Heroes and page titles only.
- **Sans / heading / metric** — Source Sans 3. UI, labels, and token numbers.

Do not add a third family.

| Step | Size | Role |
|------|------|------|
| Display | 1.75 rem | Page heroes (`font-display`) |
| Headline | 1.375 rem | Section titles |
| Title | 1.125 rem | Card titles |
| Label | 0.875 rem | Captions, chip text, field labels |
| Metric | 2.0 rem | Token and counter figures (`font-metric`, tabular nums) |

The status token hero may go larger than the metric step so the number leads the card.

## Radius

| Token | Size | Use |
|-------|------|-----|
| `--radius-md` | 10px | List, catalog, history, and join rows |
| `--radius-lg` / `--radius-xl` | 14px | Token hero, auth card, featured panels |
| `--radius-2xl` | 18px | Reserved for large featured surfaces |

## Elevation

Warm stone tints, quiet and structural — no glass or backdrop blur.

- `--shadow-card`: `0 1px 2px rgb(26 26 24 / 5%)`
- `--shadow-lift`: `0 4px 12px rgb(26 26 24 / 8%)`
- `--shadow-dialog`: `0 8px 24px rgb(26 26 24 / 12%)`

Sticky chrome and dialog dimmers use solid surfaces (`bg-card`, `bg-foreground/40`).
