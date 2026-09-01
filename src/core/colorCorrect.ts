/**
 * Camera colour correction.
 *
 * A phone camera does not measure colour, it interprets it. Auto white balance,
 * auto exposure and the vendor's own rendering all move underneath you, so the
 * same test pad photographed under tungsten, daylight and an LED gives three
 * different RGB triples. That is why "eyeball it against the chart" is the
 * industry standard and why it is unreliable.
 *
 * The fix is to photograph the reference card in the same frame as the strip.
 * Whatever the camera did to the strip, it did to the card as well, so fitting
 * the card's measured patches back onto their known values undoes it.
 *
 * Fitting happens in LINEAR light. A correction matrix models illuminant and
 * sensor crosstalk, both of which are linear in radiance; applying one to
 * gamma-encoded values is simply wrong and shows up as hue shifts in shadows.
 *
 * ── Why printer error does not matter ─────────────────────────────────────
 * The nominal patch values below are what we send to the printer, not what the
 * printer actually lays down, so there is a systematic bias between them. It
 * cancels: an analyte's reference ramp is captured through this same card and
 * this same pipeline during brand calibration, so both sides of every later
 * comparison carry the identical bias. Absolute accuracy is not required —
 * only that calibration and measurement agree.
 */

import type { Rgb255 } from "./types.ts";
import { linearToRgb255, rgb255ToLinear } from "./colorimetry.ts";

/** A fitted correction, applied to linear-light RGB. */
export interface Correction {
  /** Row-major 3x3 applied to [r, g, b] linear. */
  matrix: readonly [
    number, number, number,
    number, number, number,
    number, number, number,
  ];
  /** Mean residual across the fit patches, in linear units. Lower is better. */
  residual: number;
  /** Which fit produced this. */
  kind: "diagonal" | "matrix";
}

export const IDENTITY: Correction = {
  matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  residual: 0,
  kind: "diagonal",
};

/**
 * Least squares for A x = b, solved through the normal equations.
 * A is n x m with n >= m; returns the m coefficients, or null if singular.
 */
function leastSquares(a: number[][], b: number[], m: number): number[] | null {
  // Normal equations: (AᵀA) x = Aᵀb
  const ata: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
  const atb: number[] = new Array(m).fill(0);

  for (let row = 0; row < a.length; row++) {
    const r = a[row]!;
    for (let i = 0; i < m; i++) {
      atb[i] = atb[i]! + r[i]! * b[row]!;
      for (let j = 0; j < m; j++) {
        ata[i]![j] = ata[i]![j]! + r[i]! * r[j]!;
      }
    }
  }

  // Gauss-Jordan with partial pivoting.
  const aug = ata.map((row, i) => [...row, atb[i]!]);
  for (let col = 0; col < m; col++) {
    let pivot = col;
    for (let row = col + 1; row < m; row++) {
      if (Math.abs(aug[row]![col]!) > Math.abs(aug[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(aug[pivot]![col]!) < 1e-12) return null;
    [aug[col], aug[pivot]] = [aug[pivot]!, aug[col]!];

    const pivotRow = aug[col]!;
    const pivotVal = pivotRow[col]!;
    for (let row = 0; row < m; row++) {
      if (row === col) continue;
      const factor = aug[row]![col]! / pivotVal;
      if (factor === 0) continue;
      for (let k = col; k <= m; k++) {
        aug[row]![k] = aug[row]![k]! - factor * pivotRow[k]!;
      }
    }
  }

  return Array.from({ length: m }, (_, i) => aug[i]![m]! / aug[i]![i]!);
}

function meanResidual(
  matrix: Correction["matrix"],
  measured: readonly Rgb255[],
  reference: readonly Rgb255[],
): number {
  let total = 0;
  for (let i = 0; i < measured.length; i++) {
    const got = applyToLinear(matrix, rgb255ToLinear(measured[i]!));
    const want = rgb255ToLinear(reference[i]!);
    total += Math.hypot(got[0] - want[0], got[1] - want[1], got[2] - want[2]);
  }
  return measured.length ? total / measured.length : Infinity;
}

function applyToLinear(
  m: Correction["matrix"],
  linear: readonly [number, number, number],
): [number, number, number] {
  const [r, g, b] = linear;
  return [
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ];
}

/**
 * Drop patches the camera could not actually measure.
 *
 * A channel pinned at 255 has been clipped: the sensor saturated and the true
 * radiance is gone, so the patch says only "at least this bright". A channel at
 * 0 is crushed the same way. Fitting through either drags the whole correction
 * toward a value no gain can reach, which is exactly how a bright card under a
 * warm light poisons an otherwise good fit.
 */
function usablePairs(
  measured: readonly Rgb255[],
  reference: readonly Rgb255[],
  ceiling = 250,
  floor = 3,
): { measured: Rgb255[]; reference: Rgb255[] } {
  const m: Rgb255[] = [];
  const r: Rgb255[] = [];
  for (let i = 0; i < measured.length; i++) {
    const c = measured[i]!;
    const hottest = Math.max(c.r, c.g, c.b);
    const coldest = Math.min(c.r, c.g, c.b);
    if (hottest >= ceiling || coldest <= floor) continue;
    m.push(c);
    r.push(reference[i]!);
  }
  return { measured: m, reference: r };
}

/**
 * Per-channel gain only. This is all that neutral patches can constrain: greys
 * carry no hue information, so a full 3x3 fitted from neutrals alone is
 * under-determined and will happily invent cross-channel terms that fit noise.
 *
 * Use this when the card carries only a grey ramp. It is a von Kries style
 * white balance and it is honest about what it knows.
 */
export function fitDiagonal(
  rawMeasured: readonly Rgb255[],
  rawReference: readonly Rgb255[],
): Correction | null {
  if (rawMeasured.length !== rawReference.length || rawMeasured.length < 2) {
    return null;
  }

  const { measured, reference } = usablePairs(rawMeasured, rawReference);
  if (measured.length < 2) return null;

  const gains: number[] = [];
  for (let channel = 0; channel < 3; channel++) {
    let numerator = 0;
    let denominator = 0;
    for (let i = 0; i < measured.length; i++) {
      const m = rgb255ToLinear(measured[i]!)[channel]!;
      const r = rgb255ToLinear(reference[i]!)[channel]!;
      numerator += m * r;
      denominator += m * m;
    }
    if (denominator < 1e-12) return null;
    gains.push(numerator / denominator);
  }

  const matrix = [
    gains[0]!, 0, 0,
    0, gains[1]!, 0,
    0, 0, gains[2]!,
  ] as const;

  return {
    matrix,
    residual: meanResidual(matrix, measured, reference),
    kind: "diagonal",
  };
}

/**
 * Full 3x3 correction. Needs chromatic patches — at least six, spread around
 * the hue circle — or it is no better conditioned than fitDiagonal.
 */
export function fitMatrix(
  rawMeasured: readonly Rgb255[],
  rawReference: readonly Rgb255[],
): Correction | null {
  if (rawMeasured.length !== rawReference.length || rawMeasured.length < 4) {
    return null;
  }

  const { measured, reference } = usablePairs(rawMeasured, rawReference);
  if (measured.length < 4) return null;

  const design = measured.map((m) => {
    const [r, g, b] = rgb255ToLinear(m);
    return [r, g, b];
  });

  const rows: number[] = [];
  for (let channel = 0; channel < 3; channel++) {
    const target = reference.map((r) => rgb255ToLinear(r)[channel]!);
    const solved = leastSquares(design, target, 3);
    if (!solved) return null;
    rows.push(...solved);
  }

  const matrix = rows as unknown as Correction["matrix"];
  return {
    matrix,
    residual: meanResidual(matrix, measured, reference),
    kind: "matrix",
  };
}

/**
 * Fit the best correction the card's patches can support.
 *
 * Tries the full matrix when there is enough chromatic variety, falls back to
 * the diagonal, and keeps whichever actually fits better — a matrix that
 * overfits noise loses to the honest diagonal on residual.
 */
export function fitCorrection(
  measured: readonly Rgb255[],
  reference: readonly Rgb255[],
): Correction {
  const diagonal = fitDiagonal(measured, reference);
  const matrix = hasChromaticVariety(reference)
    ? fitMatrix(measured, reference)
    : null;

  if (matrix && diagonal) return matrix.residual <= diagonal.residual ? matrix : diagonal;
  return matrix ?? diagonal ?? IDENTITY;
}

/** True when the patch set spans enough hue to condition a full 3x3. */
function hasChromaticVariety(patches: readonly Rgb255[]): boolean {
  let chromatic = 0;
  for (const p of patches) {
    const max = Math.max(p.r, p.g, p.b);
    const min = Math.min(p.r, p.g, p.b);
    if (max - min > 25) chromatic++;
  }
  return chromatic >= 4;
}

/** Apply a fitted correction to an encoded sRGB colour. */
export function correct(correction: Correction, rgb: Rgb255): Rgb255 {
  return linearToRgb255(applyToLinear(correction.matrix, rgb255ToLinear(rgb)));
}
