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
| Border | `#e5dfd3` | Hairlines (warm stone; the old cool grey `#e7e5e4` read muddy on canvas) |
| Border strong | `#d3cbbb` | Stronger edges, inputs |
| Danger | `#9b2226` | Destructive actions |
| Success | `#2d6a4f` | Positive status |
| Warning (terracotta) | `#bc6c25` | Caution, near-front |

Teal “Operate” palettes are an anti-reference. The product is light-only; the dark theme in CSS is dormant.

### Contrast

`--text-secondary` and `--text-muted` are both `#57534e`. A lighter stone (`#78716c`) failed WCAG AA on canvas (4.25:1) and secondary (4.06:1). `#57534e` is 6.76:1 on canvas `#f4f1ea`, 6.46:1 on secondary `#efece4`, and 7.45:1 on card `#fffcf7`. Normal text needs 4.5:1.

## Type

Two faces only:

- **Display** — Fraunces (Soft axis; WONK off). Heroes, page titles and the "QueueIt" logotype only.
- **Sans / heading / metric** — Source Sans 3. UI, labels, and token numbers.

Do not add a third family.

| Step | Size | Role |
|------|------|------|
| Page title | 1.875 → 2.125 rem (sm) | Every screen's `<h1>`: `.page-title` (Fraunces) |
| Display | 1.75 rem | Empty-state and recover heroes (`font-display`) |
| Headline | 1.375 rem | Section titles |
| Title | 1.125 rem | Card titles |
| Label | 0.875 rem | Captions, chip text, field labels |
| Metric | 2.0 rem | Token and counter figures (`font-metric`, tabular nums) |

The status token hero may go larger than the metric step so the number leads the card.

## Wait cues

Queue and status-board cards carry a 4px inset rail (`.wait-rail` + `data-wait-level` from `waitLevel()`): success green = little or no wait, Forest = short (≤ 10 min), terracotta = medium (≤ 25), danger = long, strong border = closed. The rail is a cue, never the only signal; the wait sentence sits beside it. A card never shows a bare "Now serving —": `catalogServingNote()` says "Counter free — walk right up" or "Serving starts soon".

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

## Brand mark

A Q drawn as an open ring with the tail as a dot: the line, and the next person stepping into it. Geometry lives in `client/src/components/brand/mark-geometry.js` (32-unit grid: ring centre 15,15, radii 9/5, 56° gap on the 45° diagonal with radial cuts, dot r 3.25 at 23,23). At 16px every ring edge lands on a whole pixel. Do not redraw it by hand elsewhere; use `QueueItMark`.

- **Glyph** (`QueueItMark variant="glyph"`) — fills `currentColor`. Forest on stone/card, `#f0fdf4` on Forest. Use in the lockup and at hero scale.
- **Plate** (`variant="plate"`, `favicon.svg`, app icons) — Forest rounded square (radius 7.5/32), `#f0fdf4` glyph. In a dark browser chrome the favicon flips to a mist `#d8f3dc` plate with a Forest glyph.
- **Lockup** (`Wordmark`) — glyph + "QueueIt" in Fraunces semibold. The serif keeps the capital I from reading as a lowercase l.
- Terracotta never appears in the mark. Keep clear space of at least the dot's diameter around it.
- Raster set (`favicon.ico`, `apple-touch-icon.png`, `icons/*`, `og-image.png`) is generated: `node client/scripts/build-icons.mjs`.

## Landing page (`/`, signed out)

The public landing (`client/src/pages/landing-page.jsx`) keeps this palette and the two faces, and bends two rules on purpose:

- **Type scale.** Hero headline steps 2.625 → 3.5 → 4.25 rem (phone → sm → lg), section titles 2 → 2.5 rem, all Fraunces. These sizes are for the landing only; app screens stay on the scale above.
- **Radius.** Hero art and the final CTA band use 24px (`rounded-[1.5rem]`); landing cards use `rounded-2xl`; the phone mock uses 32px outside / ~26px screen so it reads as a handset.

Still no blur or glass. Forest bands reuse `.auth-brand` (the sign-in panel gradient). The phone shell is the gradient's deep stop `#133227`; mist accents on Forest reuse the sign-in panel's `#b7e4c7` / `#95d5b2`.

- **Fixed colours.** The staff console mock and the forest bands use literal palette hex values (cream card, Forest, mist text) instead of theme tokens, so they look the same in both themes, like the sign-in panel and the poster.

**Imagery.** Four Gemini-generated `.webp` files in `client/public/landing/` (hero 1600 + 800, three 800×600 step scenes), each ≤ 200 KB, with `width`/`height` set. Regenerate with `node client/scripts/build-landing-images.mjs` (needs `GEMINI_API_KEY`; `--export` re-encodes cached PNGs only). The hero is preloaded from `index.html` only when the path is `/`.

**Motion.** Hero text rises in a stagger; the hero art settles (transform only, so the LCP paints at once) and drifts with scroll; ticket stubs drift behind the hero; sections reveal on scroll; live wait numbers tick up; the phone mock counts a token down to "your turn". All of it is transform/opacity (no layout shift) and is off under `prefers-reduced-motion`.
