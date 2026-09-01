/**
 * Pixel sampling.
 *
 * We take the per-channel median over a small disc rather than the mean.
 * A mean is dragged badly by a single specular highlight on a wet test pad or
 * by a laminate reflection on the card, and both are common in real photos.
 * The median simply ignores them.
 */

import type { ImageLike, Point, Rgb255 } from "./types.ts";

function medianOf(values: number[]): number {
  values.sort((a, b) => a - b);
  const mid = values.length >> 1;
  return values.length % 2
    ? values[mid]!
    : ((values[mid - 1]! + values[mid]!) / 2);
}

export interface SampleResult {
  rgb: Rgb255;
  /** How many pixels were inside both the disc and the image. */
  count: number;
  /** Per-channel interquartile range — high values mean a non-uniform patch. */
  spread: number;
}

/**
 * Median-sample a disc of radius `radiusPx` centred on `centre`.
 *
 * Returns null when fewer than `minPixels` samples land inside the image,
 * which is how an off-frame or badly cropped card is caught.
 */
export function sampleDisc(
  image: ImageLike,
  centre: Point,
  radiusPx: number,
  minPixels = 9,
): SampleResult | null {
  if (!Number.isFinite(centre.x) || !Number.isFinite(centre.y)) return null;

  const r = Math.max(1, radiusPx);
  const rSquared = r * r;
  const x0 = Math.max(0, Math.floor(centre.x - r));
  const x1 = Math.min(image.width - 1, Math.ceil(centre.x + r));
  const y0 = Math.max(0, Math.floor(centre.y - r));
  const y1 = Math.min(image.height - 1, Math.ceil(centre.y + r));

  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];

  for (let y = y0; y <= y1; y++) {
    const dy = y - centre.y;
    for (let x = x0; x <= x1; x++) {
      const dx = x - centre.x;
      if (dx * dx + dy * dy > rSquared) continue;
      const i = (y * image.width + x) * 4;
      reds.push(image.data[i]!);
      greens.push(image.data[i + 1]!);
      blues.push(image.data[i + 2]!);
    }
  }

  if (reds.length < minPixels) return null;

  // Copy before median, which sorts in place, so spread sees sorted arrays too.
  const rgb: Rgb255 = {
    r: medianOf(reds),
    g: medianOf(greens),
    b: medianOf(blues),
  };

  const iqr = (sorted: number[]) => {
    const q1 = sorted[Math.floor(sorted.length * 0.25)]!;
    const q3 = sorted[Math.floor(sorted.length * 0.75)]!;
    return q3 - q1;
  };
  const spread = (iqr(reds) + iqr(greens) + iqr(blues)) / 3;

  return { rgb, count: reds.length, spread };
}

/**
 * Fraction of pixels in a disc with any channel at or above `threshold`.
 * Used to reject blown-out patches, where the true colour is unrecoverable.
 */
export function clippedFraction(
  image: ImageLike,
  centre: Point,
  radiusPx: number,
  threshold = 250,
): number {
  const r = Math.max(1, radiusPx);
  const rSquared = r * r;
  const x0 = Math.max(0, Math.floor(centre.x - r));
  const x1 = Math.min(image.width - 1, Math.ceil(centre.x + r));
  const y0 = Math.max(0, Math.floor(centre.y - r));
  const y1 = Math.min(image.height - 1, Math.ceil(centre.y + r));

  let total = 0;
  let clipped = 0;

  for (let y = y0; y <= y1; y++) {
    const dy = y - centre.y;
    for (let x = x0; x <= x1; x++) {
      const dx = x - centre.x;
      if (dx * dx + dy * dy > rSquared) continue;
      const i = (y * image.width + x) * 4;
      total++;
      if (
        image.data[i]! >= threshold ||
        image.data[i + 1]! >= threshold ||
        image.data[i + 2]! >= threshold
      ) {
        clipped++;
      }
    }
  }

  return total === 0 ? 1 : clipped / total;
}
