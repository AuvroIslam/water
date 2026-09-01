/**
 * Reading a concentration off a colour ramp.
 *
 * This is the part that beats a person squinting at the bottle. A human snaps
 * to the nearest printed swatch — "somewhere between 20 and 50, call it 20".
 * We find the two swatches that bracket the pad perceptually and interpolate
 * between them by inverse ΔE2000, returning a continuous value.
 *
 * We also return the distance to the closest swatch, because a reading the
 * pipeline cannot justify should be shown as a refusal rather than a number.
 */

import type { Analyte, Confidence, Lab, Reading, Swatch } from "./types.ts";
import { deltaE2000 } from "./colorimetry.ts";

/**
 * ΔE2000 thresholds for reporting.
 *
 * Roughly: 1 is the just-noticeable difference, 2-3 reads as a close match,
 * and past ~12 the pad simply is not on this ramp — wrong strip, bad light, or
 * a finger in the frame. Tune these against real validation data (day 5-6 in
 * the build plan); they are deliberately conservative until then.
 */
export const CONFIDENCE_THRESHOLDS = {
  high: 5,
  medium: 12,
} as const;

export function confidenceFor(deltaE: number): Confidence {
  if (deltaE <= CONFIDENCE_THRESHOLDS.high) return "high";
  if (deltaE <= CONFIDENCE_THRESHOLDS.medium) return "medium";
  return "low";
}

interface RankedSwatch {
  swatch: Swatch;
  deltaE: number;
}

/**
 * Interpolate a concentration from a pad colour.
 *
 * Returns null only when the ramp itself is unusable (fewer than two swatches).
 * A poor colour match still returns a value, flagged with a low confidence —
 * the UI decides whether to show it.
 */
export function readRamp(
  lab: Lab,
  ramp: readonly Swatch[],
): { value: number; range: [number, number]; deltaE: number } | null {
  if (ramp.length < 2) return null;

  const ranked: RankedSwatch[] = ramp
    .map((swatch) => ({ swatch, deltaE: deltaE2000(lab, swatch.lab) }))
    .sort((a, b) => a.deltaE - b.deltaE);

  const nearest = ranked[0]!;
  const second = ranked[1]!;

  // An exact hit on a swatch: no interpolation to do, and guards a divide by
  // zero below.
  if (nearest.deltaE < 1e-9) {
    return {
      value: nearest.swatch.value,
      range: [nearest.swatch.value, nearest.swatch.value],
      deltaE: nearest.deltaE,
    };
  }

  // Inverse-distance weighting between the two closest swatches. A pad sitting
  // halfway between the 10 and 25 swatches reports ~17.5, not 10.
  const w1 = 1 / nearest.deltaE;
  const w2 = 1 / second.deltaE;
  const value = (nearest.swatch.value * w1 + second.swatch.value * w2) / (w1 + w2);

  const lo = Math.min(nearest.swatch.value, second.swatch.value);
  const hi = Math.max(nearest.swatch.value, second.swatch.value);

  return { value, range: [lo, hi], deltaE: nearest.deltaE };
}

/** True when a value breaches the analyte's regulatory limit. */
export function exceedsLimit(analyte: Analyte, value: number): boolean | null {
  const limit = analyte.limit;
  if (!limit) return null;
  if (limit.kind === "max") return value > limit.value;
  return value > limit.value || (limit.min !== undefined && value < limit.min);
}

/** Turn one measured pad colour into a reportable reading. */
export function toReading(analyte: Analyte, lab: Lab): Reading {
  const result = readRamp(lab, analyte.ramp);

  if (!result) {
    return {
      analyteId: analyte.id,
      label: analyte.label,
      unit: analyte.unit,
      value: null,
      range: null,
      deltaE: Infinity,
      confidence: "low",
      lab,
      exceedsLimit: null,
    };
  }

  const confidence = confidenceFor(result.deltaE);
  // Below the reporting bar we surface the colour distance, not a number that
  // would imply precision the match does not support.
  const reportable = confidence !== "low";

  return {
    analyteId: analyte.id,
    label: analyte.label,
    unit: analyte.unit,
    value: reportable ? result.value : null,
    range: reportable ? result.range : null,
    deltaE: result.deltaE,
    confidence,
    lab,
    exceedsLimit: reportable ? exceedsLimit(analyte, result.value) : null,
  };
}
