/**
 * Synthetic card renderer.
 *
 * Renders a photograph of the reference card that never existed: known patch
 * colours, a known strip, an arbitrary viewing angle, and an arbitrary camera
 * colour cast. Because we choose the true concentrations going in, we can
 * assert on what comes out — which means the entire pipeline is validated
 * before a strip, a printer, or a phone is involved.
 *
 * It renders by inverse warping: for each destination pixel, project back into
 * card space and ask what colour lives there. That is the same homography the
 * pipeline solves forward, so a bug in one does not silently cancel in the other
 * (the renderer is given corners directly; it never calls homographyFromQuad).
 */

import {
  ALL_PATCHES,
  CARD_HEIGHT_MM,
  CARD_WIDTH_MM,
  CORNER_MARKER_IDS,
  MARKER_ORIGINS,
  MARKER_SIZE_MM,
  STRIP_CHANNEL,
  padCentre,
} from "../../src/card/card.ts";
import { homographyFromQuad, project } from "../../src/core/homography.ts";
import type { Point, Rgb255, StripSpec } from "../../src/core/types.ts";
import { labToRgb255 } from "../../src/core/colorimetry.ts";
import { getDictionary } from "../../src/core/markers.ts";
import { Raster } from "./raster.ts";

const WHITE: Rgb255 = { r: 252, g: 252, b: 252 };
const BLACK: Rgb255 = { r: 12, g: 12, b: 12 };
const STRIP_BACKING: Rgb255 = { r: 246, g: 245, b: 240 };
/** Outside the card: a neutral desk, so the detector has something to cut against. */
const SURROUND: Rgb255 = { r: 130, g: 128, b: 124 };

export interface SyntheticOptions {
  width: number;
  height: number;
  /** Where the card's four corners land in the image, clockwise from top-left. */
  cardCorners: readonly Point[];
  /** Per-pixel camera simulation, applied after the scene is composed. */
  cameraTransform?: (c: Rgb255) => Rgb255;
  /** True concentration per analyte id; pads are painted from the ramp. */
  trueValues: Record<string, number>;
  strip: StripSpec;
  /** Omit the strip entirely, to exercise the failure paths. */
  omitStrip?: boolean;
}

/** Exact ramp colour for a value, interpolating in Lab between swatches. */
export function colourForValue(
  ramp: StripSpec["analytes"][number]["ramp"],
  value: number,
): Rgb255 {
  const sorted = [...ramp].sort((a, b) => a.value - b.value);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (value <= first.value) return labToRgb255(first.lab);
  if (value >= last.value) return labToRgb255(last.lab);

  for (let i = 1; i < sorted.length; i++) {
    const hi = sorted[i]!;
    const lo = sorted[i - 1]!;
    if (value <= hi.value) {
      const t = (value - lo.value) / (hi.value - lo.value);
      return labToRgb255({
        l: lo.lab.l + t * (hi.lab.l - lo.lab.l),
        a: lo.lab.a + t * (hi.lab.a - lo.lab.a),
        b: lo.lab.b + t * (hi.lab.b - lo.lab.b),
      });
    }
  }
  return labToRgb255(last.lab);
}

/** Build a lookup of what the card looks like at a given millimetre position. */
function buildCardPainter(options: SyntheticOptions): (p: Point) => Rgb255 {
  const dictionary = getDictionary();

  // Precompute marker cell grids so the per-pixel path stays cheap.
  const markerGrids = CORNER_MARKER_IDS.map((id, index) => {
    const code = dictionary.codeList[id]!;
    const size = Math.round(Math.sqrt(code.length));
    return { origin: MARKER_ORIGINS[index]!, code, size };
  });

  const pads = options.omitStrip
    ? []
    : options.strip.analytes.map((analyte) => ({
        centre: padCentre(analyte.padPosition),
        colour: colourForValue(analyte.ramp, options.trueValues[analyte.id] ?? 0),
        halfSize: options.strip.padSizeMm / 2,
      }));

  return (p: Point): Rgb255 => {
    if (p.x < 0 || p.y < 0 || p.x > CARD_WIDTH_MM || p.y > CARD_HEIGHT_MM) {
      return SURROUND;
    }

    // Markers. generateSVG's layout: a (size+4) grid, 1 cell white margin,
    // 1 cell black ring, then size x size data cells.
    for (const grid of markerGrids) {
      const cell = MARKER_SIZE_MM / (grid.size + 4);
      const lx = (p.x - grid.origin.x) / cell;
      const ly = (p.y - grid.origin.y) / cell;
      if (lx < 0 || ly < 0 || lx >= grid.size + 4 || ly >= grid.size + 4) continue;

      const cx = Math.floor(lx);
      const cy = Math.floor(ly);
      const inRing =
        cx === 0 || cy === 0 || cx === grid.size + 3 || cy === grid.size + 3;
      if (inRing) return WHITE;

      const dx = cx - 2;
      const dy = cy - 2;
      if (dx < 0 || dy < 0 || dx >= grid.size || dy >= grid.size) return BLACK;
      return grid.code[dy * grid.size + dx] === "1" ? WHITE : BLACK;
    }

    // Reference patches.
    for (const patch of ALL_PATCHES) {
      const half = patch.sizeMm / 2;
      if (
        Math.abs(p.x - patch.centre.x) <= half &&
        Math.abs(p.y - patch.centre.y) <= half
      ) {
        return patch.nominal;
      }
    }

    // Strip pads, then the strip's own white backing around them.
    for (const pad of pads) {
      if (
        Math.abs(p.x - pad.centre.x) <= pad.halfSize &&
        Math.abs(p.y - pad.centre.y) <= pad.halfSize
      ) {
        return pad.colour;
      }
    }

    // The printed channel. When a strip is laid in it, its white backing hides
    // the slate; when it is empty, the slate shows through and the pipeline can
    // tell that no test was actually run.
    const inChannel =
      Math.abs(p.y - STRIP_CHANNEL.centreY) <= STRIP_CHANNEL.widthMm / 2 &&
      p.x >= STRIP_CHANNEL.startX &&
      p.x <= STRIP_CHANNEL.endX;

    if (inChannel) {
      return options.omitStrip ? STRIP_CHANNEL.nominal : STRIP_BACKING;
    }

    return WHITE;
  };
}

/** Render the scene. */
export function renderSyntheticCard(options: SyntheticOptions): Raster {
  const cardQuad: Point[] = [
    { x: 0, y: 0 },
    { x: CARD_WIDTH_MM, y: 0 },
    { x: CARD_WIDTH_MM, y: CARD_HEIGHT_MM },
    { x: 0, y: CARD_HEIGHT_MM },
  ];

  // Image -> card, so we can ask "what is under this pixel?".
  const inverse = homographyFromQuad(options.cardCorners, cardQuad);
  if (!inverse) throw new Error("degenerate cardCorners passed to renderer");

  const paint = buildCardPainter(options);
  const camera = options.cameraTransform ?? ((c: Rgb255) => c);
  const raster = new Raster(options.width, options.height, SURROUND);

  for (let y = 0; y < options.height; y++) {
    for (let x = 0; x < options.width; x++) {
      const cardPoint = project(inverse, { x: x + 0.5, y: y + 0.5 });
      const colour = camera(paint(cardPoint));
      const i = (y * raster.width + x) * 4;
      raster.data[i] = colour.r;
      raster.data[i + 1] = colour.g;
      raster.data[i + 2] = colour.b;
      raster.data[i + 3] = 255;
    }
  }

  return raster;
}
