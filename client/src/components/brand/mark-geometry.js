/**
 * QueueIt mark geometry, the single source for the React mark, favicon.svg and
 * the raster icon set (scripts/build-icons.mjs).
 *
 * The mark is a Q: an open ring (the line) with the tail drawn as a dot (the
 * next person stepping in). Drawn on a 32-unit grid so that at 16px every ring
 * edge lands on a whole pixel: ring centre 15,15, outer radius 9, inner 5
 * (stroke 4 = 2px at 16px). The gap is 56° wide, centred on the 45° diagonal,
 * with radial cuts; the dot sits on that diagonal.
 *
 * If you change these numbers, update client/public/favicon.svg to match and
 * re-run `node client/scripts/build-icons.mjs`.
 */

/** Ring as a filled path (no stroke, so it scales and masks cleanly). */
export const MARK_RING = "M17.63 23.61A9 9 0 1 1 23.61 17.63L19.78 16.46A5 5 0 1 0 16.46 19.78Z";

/** The tail dot. Slightly wider than the ring stroke so it reads at 16px. */
export const MARK_DOT = { cx: 23, cy: 23, r: 3.25 };

/** Tight box around the glyph (ring + dot) for plate-less use. */
export const GLYPH_VIEWBOX = "6 6 20.25 20.25";

/** Plate radius on the 32 grid (about 23%, close to the iOS icon curve). */
export const PLATE_RADIUS = 7.5;

export const MARK_COLORS = {
  forest: "#1B4332",
  onForest: "#F0FDF4",
  mist: "#D8F3DC",
};
