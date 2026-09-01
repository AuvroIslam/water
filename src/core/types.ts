/** Shared types for the colour pipeline. */

/** A point in either card space (mm) or image space (px). */
export interface Point {
  x: number;
  y: number;
}

/** Non-linear, display-referred sRGB, 0-255 per channel. */
export interface Rgb255 {
  r: number;
  g: number;
  b: number;
}

/** CIELAB with a D65 white point — see the D50 warning in colorimetry.ts. */
export interface Lab {
  l: number;
  a: number;
  b: number;
}

/** Anything shaped like a canvas ImageData, so tests can run headless. */
export interface ImageLike {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** One reference swatch on an analyte's colour ramp. */
export interface Swatch {
  /** Concentration this swatch represents, in the analyte's unit. */
  value: number;
  /** Colour-corrected reference colour, D65 Lab. */
  lab: Lab;
}

/** A measurable parameter and the ramp used to read it. */
export interface Analyte {
  id: string;
  label: string;
  unit: string;
  /** Where this pad sits along the strip, 0 = tip, 1 = handle end. */
  padPosition: number;
  /** Ascending by value. At least two entries. */
  ramp: Swatch[];
  /** Regulatory limit, if one exists. */
  limit?: {
    value: number;
    /** "max" = concern above; "range" = concern outside [min, value]. */
    kind: "max" | "range";
    min?: number;
    source: string;
  };
}

/** A strip product: its geometry and the analytes it carries. */
export interface StripSpec {
  id: string;
  brand: string;
  /** Physical pad size in mm, used to size the sampling disc. */
  padSizeMm: number;
  analytes: Analyte[];
}

/** How much to trust one reading, derived from its colour distance. */
export type Confidence = "high" | "medium" | "low";

/** One analyte's result. */
export interface Reading {
  analyteId: string;
  label: string;
  unit: string;
  /** Interpolated concentration, or null when the match is too poor to report. */
  value: number | null;
  /** Plausible range implied by the two bracketing swatches. */
  range: [number, number] | null;
  /** ΔE2000 to the closest reference swatch. Lower is better. */
  deltaE: number;
  confidence: Confidence;
  /** The measured, colour-corrected pad colour. Useful for debugging and UI. */
  lab: Lab;
  /** True when the reading crosses its regulatory limit. */
  exceedsLimit: boolean | null;
}
