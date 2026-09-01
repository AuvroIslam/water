/**
 * The reference card.
 *
 * Everything is in millimetres from the top-left corner, so the same numbers
 * drive the printed artwork, the synthetic test renderer, and the sampling
 * geometry. Print at 100% scale on matte paper — glossy paper and lamination
 * both throw specular highlights across the patches.
 *
 * Layout (148 x 105 mm, A6 landscape):
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ [M0]   ▢ ▢ ▢ ▢ ▢ ▢  neutral ramp       [M1] │
 *   │                                              │
 *   │        ╞════ strip channel ═════╡            │
 *   │                                              │
 *   │ [M3]   ▢ ▢ ▢ ▢ ▢ ▢  chromatic patches  [M2] │
 *   └──────────────────────────────────────────────┘
 */

import type { Point, Rgb255 } from "../core/types.ts";

export const CARD_WIDTH_MM = 148;
export const CARD_HEIGHT_MM = 105;

/** ArUco ids used for the four corners, in clockwise order from top-left. */
export const CORNER_MARKER_IDS = [0, 1, 2, 3] as const;

export const MARKER_SIZE_MM = 18;
const MARKER_MARGIN_MM = 5;

/** Top-left corner of each marker, clockwise from top-left. */
export const MARKER_ORIGINS: readonly Point[] = [
  { x: MARKER_MARGIN_MM, y: MARKER_MARGIN_MM },
  { x: CARD_WIDTH_MM - MARKER_MARGIN_MM - MARKER_SIZE_MM, y: MARKER_MARGIN_MM },
  {
    x: CARD_WIDTH_MM - MARKER_MARGIN_MM - MARKER_SIZE_MM,
    y: CARD_HEIGHT_MM - MARKER_MARGIN_MM - MARKER_SIZE_MM,
  },
  { x: MARKER_MARGIN_MM, y: CARD_HEIGHT_MM - MARKER_MARGIN_MM - MARKER_SIZE_MM },
];

/**
 * Marker centres, which are what the homography is fitted to.
 * A centre is the mean of four detected corners, so it averages away most of
 * the per-corner detection jitter.
 */
export const MARKER_CENTRES: readonly Point[] = MARKER_ORIGINS.map((o) => ({
  x: o.x + MARKER_SIZE_MM / 2,
  y: o.y + MARKER_SIZE_MM / 2,
}));

export interface Patch {
  id: string;
  centre: Point;
  sizeMm: number;
  /** Nominal sRGB sent to the printer. See the bias note in colorCorrect.ts. */
  nominal: Rgb255;
}

const PATCH_SIZE_MM = 13;
const PATCH_GAP_MM = 2;
const PATCH_ROW_START_X = 29;

function patchRow(
  prefix: string,
  y: number,
  colours: readonly Rgb255[],
): Patch[] {
  return colours.map((nominal, i) => ({
    id: `${prefix}${i}`,
    centre: {
      x: PATCH_ROW_START_X + i * (PATCH_SIZE_MM + PATCH_GAP_MM) + PATCH_SIZE_MM / 2,
      y: y + PATCH_SIZE_MM / 2,
    },
    sizeMm: PATCH_SIZE_MM,
    nominal,
  }));
}

/**
 * Neutral ramp. These constrain exposure and white balance — the part of the
 * correction that matters most, since an illuminant cast is overwhelmingly the
 * dominant error in a phone photo.
 */
export const NEUTRAL_PATCHES: readonly Patch[] = patchRow("n", 8, [
  { r: 243, g: 243, b: 243 },
  { r: 200, g: 200, b: 200 },
  { r: 160, g: 160, b: 160 },
  { r: 120, g: 120, b: 120 },
  { r: 75, g: 75, b: 75 },
  { r: 40, g: 40, b: 40 },
]);

/**
 * Chromatic patches, spread around the hue circle at printable saturations.
 * Without these a full 3x3 correction is under-determined; with them we can
 * also undo sensor crosstalk, not just a global cast.
 */
export const CHROMATIC_PATCHES: readonly Patch[] = patchRow("c", 84, [
  { r: 190, g: 60, b: 55 },
  { r: 215, g: 165, b: 45 },
  { r: 70, g: 155, b: 85 },
  { r: 60, g: 160, b: 180 },
  { r: 55, g: 85, b: 165 },
  { r: 165, g: 65, b: 140 },
]);

export const ALL_PATCHES: readonly Patch[] = [
  ...NEUTRAL_PATCHES,
  ...CHROMATIC_PATCHES,
];

/**
 * The channel the strip is laid into. Pad positions are expressed as a
 * fraction along this line so one card serves every strip brand.
 *
 * ── Why the channel is printed slate, not white ───────────────────────────
 * Most reagent ramps start at near-white, because zero concentration means the
 * pad barely develops. If the channel were white, a photo taken with no strip
 * in it would look exactly like a strip reading zero, and the app would return
 * a confident "nitrate 0.2 mg/L — safe" for a test nobody performed. On a water
 * safety tool a false all-clear is the worst possible failure.
 *
 * Printing the channel a saturated mid-slate — far from white and far from
 * every reagent hue we know of — makes "no strip" directly detectable: bare
 * channel reads slate, a laid strip reads its own white backing.
 */
export const STRIP_CHANNEL = {
  startX: 30,
  endX: 118,
  centreY: 49,
  widthMm: 6,
  nominal: { r: 78, g: 104, b: 122 } as Rgb255,
} as const;

/** Where a pad at fractional position `t` sits on the card. */
export function padCentre(t: number): Point {
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  return {
    x: STRIP_CHANNEL.startX + clamped * (STRIP_CHANNEL.endX - STRIP_CHANNEL.startX),
    y: STRIP_CHANNEL.centreY,
  };
}

/**
 * Points along the channel used to decide whether a strip is present at all.
 *
 * They must fall between pads. Given pad positions, the caller picks gaps; this
 * default set spans the channel and is checked against occupancy in the
 * pipeline, so a probe that happens to land under a pad is simply outvoted.
 */
export function stripPresenceProbes(
  padPositions: readonly number[],
  padSizeMm: number,
): Point[] {
  const channelLength = STRIP_CHANNEL.endX - STRIP_CHANNEL.startX;
  const padHalfT = padSizeMm / 2 / channelLength;
  const clearOfPads = (t: number) =>
    padPositions.every((p) => Math.abs(p - t) > padHalfT * 2.2);

  const probes: Point[] = [];
  for (let t = 0.05; t <= 0.95; t += 0.05) {
    if (clearOfPads(t)) probes.push(padCentre(t));
  }
  return probes;
}
