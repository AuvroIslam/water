/**
 * Four-point homography.
 *
 * This is the piece that lets us skip OpenCV.js entirely. We never warp the
 * image — we only need to know where ~20 known card locations landed in the
 * photo, so we solve the card-space to image-space projection once and map
 * points through it on demand.
 */

import type { Point } from "./types.ts";

/** Row-major 3x3 projective transform. */
export type Matrix3 = readonly [
  number, number, number,
  number, number, number,
  number, number, number,
];

/**
 * Solve a dense linear system by Gaussian elimination with partial pivoting.
 * Small and self-contained — an 8x8 solve does not justify a dependency.
 */
function solveLinearSystem(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  // Work on copies; callers reuse their inputs.
  const m = a.map((row, i) => [...row, b[i] as number]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row]![col]!) > Math.abs(m[pivot]![col]!)) pivot = row;
    }
    if (Math.abs(m[pivot]![col]!) < 1e-12) return null; // singular

    [m[col], m[pivot]] = [m[pivot]!, m[col]!];

    const pivotRow = m[col]!;
    const pivotVal = pivotRow[col]!;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row]![col]! / pivotVal;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) {
        m[row]![k] = m[row]![k]! - factor * pivotRow[k]!;
      }
    }
  }

  return Array.from({ length: n }, (_, i) => m[i]![n]! / m[i]![i]!);
}

/**
 * Build the transform taking `from` (card space) to `to` (image space).
 *
 * Both arrays must hold exactly four points in the same order. Returns null if
 * the correspondence is degenerate (collinear or coincident points), which in
 * practice means marker detection returned nonsense.
 */
export function homographyFromQuad(
  from: readonly Point[],
  to: readonly Point[],
): Matrix3 | null {
  if (from.length !== 4 || to.length !== 4) return null;

  // Fix h33 = 1, leaving eight unknowns and eight equations.
  const a: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const s = from[i]!;
    const d = to[i]!;
    a.push([s.x, s.y, 1, 0, 0, 0, -d.x * s.x, -d.x * s.y]);
    b.push(d.x);
    a.push([0, 0, 0, s.x, s.y, 1, -d.y * s.x, -d.y * s.y]);
    b.push(d.y);
  }

  const h = solveLinearSystem(a, b);
  if (!h || h.some((v) => !Number.isFinite(v))) return null;

  return [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!, 1];
}

/** Project a point through a homography. */
export function project(h: Matrix3, p: Point): Point {
  const w = h[6] * p.x + h[7] * p.y + h[8];
  if (Math.abs(w) < 1e-12) return { x: NaN, y: NaN };
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / w,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / w,
  };
}

/**
 * Approximate how many image pixels one card-space unit covers near `p`.
 *
 * Used to size the sampling disc: a card photographed from further away needs
 * a smaller disc in pixels to cover the same physical pad.
 */
export function scaleAt(h: Matrix3, p: Point, epsilon = 0.5): number {
  const centre = project(h, p);
  const shiftedX = project(h, { x: p.x + epsilon, y: p.y });
  const shiftedY = project(h, { x: p.x, y: p.y + epsilon });

  const dx = Math.hypot(shiftedX.x - centre.x, shiftedX.y - centre.y) / epsilon;
  const dy = Math.hypot(shiftedY.x - centre.x, shiftedY.y - centre.y) / epsilon;

  return (dx + dy) / 2;
}
