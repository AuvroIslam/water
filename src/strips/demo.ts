/**
 * Demo strip specification.
 *
 * ⚠ THE RAMP COLOURS BELOW ARE PLACEHOLDERS.
 *
 * They are plausible, not measured. Real reference ramps are produced by the
 * calibration flow: photograph the manufacturer's bottle chart on the reference
 * card, run it through this same pipeline, and store the corrected Lab values.
 * Doing it that way is what makes printer and camera bias cancel — both sides
 * of every later comparison then carry the identical bias.
 *
 * Until a brand has been calibrated that way, this file exists so the pipeline
 * and the synthetic tests have something concrete to work against. Do not ship
 * a reading to a user from these numbers.
 */

import { rgb255ToLab } from "../core/colorimetry.ts";
import type { StripSpec, Swatch } from "../core/types.ts";

const swatch = (value: number, r: number, g: number, b: number): Swatch => ({
  value,
  lab: rgb255ToLab({ r, g, b }),
});

export const DEMO_STRIP: StripSpec = {
  id: "demo-5",
  brand: "Placeholder (uncalibrated)",
  padSizeMm: 5,
  analytes: [
    {
      id: "nitrate_n",
      label: "Nitrate (as N)",
      unit: "mg/L",
      padPosition: 0.1,
      // Pale pink through deep magenta, the usual nitrate reagent progression.
      ramp: [
        swatch(0, 252, 244, 240),
        swatch(1, 249, 219, 220),
        swatch(5, 240, 176, 190),
        swatch(10, 226, 122, 156),
        swatch(25, 205, 68, 122),
        swatch(50, 170, 24, 92),
      ],
      limit: { value: 10, kind: "max", source: "US EPA MCL" },
    },
    {
      id: "nitrite_n",
      label: "Nitrite (as N)",
      unit: "mg/L",
      padPosition: 0.25,
      ramp: [
        swatch(0, 250, 248, 238),
        swatch(0.5, 244, 214, 206),
        swatch(1, 236, 170, 168),
        swatch(3, 219, 112, 126),
        swatch(10, 188, 52, 92),
      ],
      limit: { value: 1, kind: "max", source: "US EPA MCL" },
    },
    {
      id: "ph",
      label: "pH",
      unit: "",
      padPosition: 0.4,
      // Yellow to green to blue-green, the standard bromothymol range.
      ramp: [
        swatch(6.0, 236, 206, 96),
        swatch(6.5, 216, 208, 110),
        swatch(7.0, 176, 202, 122),
        swatch(7.5, 130, 190, 140),
        swatch(8.0, 92, 176, 154),
        swatch(8.5, 62, 158, 162),
        swatch(9.0, 46, 136, 164),
      ],
      limit: { value: 8.5, kind: "range", min: 6.5, source: "US EPA secondary" },
    },
    {
      id: "total_hardness",
      label: "Total hardness",
      unit: "mg/L",
      padPosition: 0.55,
      ramp: [
        swatch(0, 106, 160, 186),
        swatch(50, 132, 156, 176),
        swatch(120, 168, 152, 162),
        swatch(250, 200, 136, 144),
        swatch(425, 220, 118, 126),
      ],
    },
    {
      id: "free_chlorine",
      label: "Free chlorine",
      unit: "mg/L",
      padPosition: 0.7,
      ramp: [
        swatch(0, 250, 250, 246),
        swatch(0.5, 242, 230, 236),
        swatch(1, 232, 202, 224),
        swatch(3, 208, 158, 202),
        swatch(5, 182, 116, 180),
      ],
      limit: { value: 4, kind: "max", source: "US EPA MRDL" },
    },
  ],
};
