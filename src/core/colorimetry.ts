/**
 * Colour space conversions and perceptual distance.
 *
 * ── The D50 trap ──────────────────────────────────────────────────────────
 * culori's "lab" mode is D50-referenced, following CSS Color Level 4. sRGB is
 * D65-native. Handing raw sRGB-derived Lab values to a "lab" converter or
 * difference function silently chromatic-adapts them and skews every ΔE by up
 * to ~10% — which, on a colour ramp, is the difference between 8 mg/L and
 * 15 mg/L of nitrate.
 *
 * This module uses "lab65" everywhere and is the ONLY place allowed to touch
 * culori directly. tests/deps.test.ts pins the behaviour against the
 * Sharma, Wu & Dalal (2005) CIEDE2000 conformance set.
 */

import { converter, differenceCiede2000 } from "culori";
import type { Lab, Rgb255 } from "./types.ts";

const toLab65 = converter("lab65");
const toRgb = converter("rgb");
const ciede2000 = differenceCiede2000();

/**
 * Piecewise breakpoint of the sRGB transfer function.
 *
 * The spec rounds these to 0.04045 and 0.0031308, but rounding both
 * independently makes the two functions stop being exact inverses right at the
 * breakpoint. Deriving one from the other keeps the round trip exact.
 */
const SRGB_BREAK = 0.04045;
const LINEAR_BREAK = SRGB_BREAK / 12.92;

/** sRGB electro-optical transfer function: encoded 0-1 to linear 0-1. */
export function srgbToLinear(channel: number): number {
  return channel <= SRGB_BREAK
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** Inverse of srgbToLinear. */
export function linearToSrgb(channel: number): number {
  return channel <= LINEAR_BREAK
    ? channel * 12.92
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** 0-255 encoded sRGB to linear-light 0-1 RGB. */
export function rgb255ToLinear(rgb: Rgb255): [number, number, number] {
  return [
    srgbToLinear(clamp01(rgb.r / 255)),
    srgbToLinear(clamp01(rgb.g / 255)),
    srgbToLinear(clamp01(rgb.b / 255)),
  ];
}

/** Linear-light 0-1 RGB back to 0-255 encoded sRGB. */
export function linearToRgb255(linear: readonly [number, number, number]): Rgb255 {
  return {
    r: linearToSrgb(clamp01(linear[0])) * 255,
    g: linearToSrgb(clamp01(linear[1])) * 255,
    b: linearToSrgb(clamp01(linear[2])) * 255,
  };
}

/** Encoded sRGB (0-255) to D65 CIELAB. */
export function rgb255ToLab(rgb: Rgb255): Lab {
  const c = toLab65({
    mode: "rgb",
    r: clamp01(rgb.r / 255),
    g: clamp01(rgb.g / 255),
    b: clamp01(rgb.b / 255),
  });
  return { l: c.l, a: c.a ?? 0, b: c.b ?? 0 };
}

/** Linear-light RGB straight to D65 CIELAB, skipping a needless re-encode. */
export function linearToLab(linear: readonly [number, number, number]): Lab {
  return rgb255ToLab(linearToRgb255(linear));
}

/** D65 CIELAB back to encoded sRGB, clamped into gamut. For UI swatches. */
export function labToRgb255(lab: Lab): Rgb255 {
  const c = toRgb({ mode: "lab65", l: lab.l, a: lab.a, b: lab.b });
  return {
    r: clamp01(c.r) * 255,
    g: clamp01(c.g) * 255,
    b: clamp01(c.b) * 255,
  };
}

/** CIEDE2000 perceptual distance. Roughly: <1 imperceptible, >5 obvious. */
export function deltaE2000(a: Lab, b: Lab): number {
  return ciede2000(
    { mode: "lab65", l: a.l, a: a.a, b: a.b },
    { mode: "lab65", l: b.l, a: b.a, b: b.b },
  );
}

/** CSS colour string for a Lab value. */
export function labToCss(lab: Lab): string {
  const { r, g, b } = labToRgb255(lab);
  return `rgb(${Math.round(r)} ${Math.round(g)} ${Math.round(b)})`;
}
