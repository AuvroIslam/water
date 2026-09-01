import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  deltaE2000,
  labToRgb255,
  linearToRgb255,
  rgb255ToLab,
  rgb255ToLinear,
  srgbToLinear,
  linearToSrgb,
} from "../src/core/colorimetry.ts";
import {
  correct,
  fitCorrection,
  fitDiagonal,
  fitMatrix,
} from "../src/core/colorCorrect.ts";
import { confidenceFor, readRamp, toReading } from "../src/core/ramp.ts";
import { sampleDisc, clippedFraction } from "../src/core/sample.ts";
import { Raster } from "./helpers/raster.ts";
import type { Analyte, Rgb255, Swatch } from "../src/core/types.ts";

const near = (a: number, b: number, tol: number) => Math.abs(a - b) < tol;

describe("transfer function", () => {
  test("round-trips", () => {
    for (const v of [0, 0.02, 0.04045, 0.2, 0.5, 0.9, 1]) {
      assert.ok(near(linearToSrgb(srgbToLinear(v)), v, 1e-9), `failed at ${v}`);
    }
  });

  test("is not a plain gamma: 0.5 encoded is ~0.214 linear", () => {
    assert.ok(near(srgbToLinear(0.5), 0.2140, 0.001));
  });

  test("rgb255 round-trips through linear", () => {
    const c: Rgb255 = { r: 37, g: 180, b: 222 };
    const back = linearToRgb255(rgb255ToLinear(c));
    assert.ok(near(back.r, c.r, 0.01));
    assert.ok(near(back.g, c.g, 0.01));
    assert.ok(near(back.b, c.b, 0.01));
  });
});

describe("Lab round-trip", () => {
  test("survives rgb -> lab -> rgb", () => {
    const samples: Rgb255[] = [
      { r: 255, g: 255, b: 255 },
      { r: 0, g: 0, b: 0 },
      { r: 128, g: 128, b: 128 },
      { r: 210, g: 90, b: 40 },
      { r: 20, g: 140, b: 200 },
    ];
    for (const c of samples) {
      const back = labToRgb255(rgb255ToLab(c));
      assert.ok(near(back.r, c.r, 0.5), `r ${back.r} vs ${c.r}`);
      assert.ok(near(back.g, c.g, 0.5), `g ${back.g} vs ${c.g}`);
      assert.ok(near(back.b, c.b, 0.5), `b ${back.b} vs ${c.b}`);
    }
  });

  test("identical colours have zero distance", () => {
    const lab = rgb255ToLab({ r: 100, g: 150, b: 60 });
    assert.equal(deltaE2000(lab, lab), 0);
  });
});

describe("colour correction", () => {
  /**
   * Simulate a camera under a warm illuminant with a per-channel gain.
   * Gains are chosen to stay inside the sensor's range: a cast strong enough to
   * clip the white patch is a different failure, covered separately below.
   */
  const warmCast = (c: Rgb255): Rgb255 => {
    const [r, g, b] = rgb255ToLinear(c);
    return linearToRgb255([r * 1.1, g * 0.97, b * 0.62]);
  };

  const neutrals: Rgb255[] = [
    { r: 243, g: 243, b: 243 },
    { r: 200, g: 200, b: 200 },
    { r: 160, g: 160, b: 160 },
    { r: 120, g: 120, b: 120 },
    { r: 75, g: 75, b: 75 },
    { r: 40, g: 40, b: 40 },
  ];

  test("diagonal fit undoes a per-channel illuminant cast", () => {
    const measured = neutrals.map(warmCast);
    const fit = fitDiagonal(measured, neutrals);
    assert.ok(fit);
    assert.equal(fit.kind, "diagonal");

    for (let i = 0; i < neutrals.length; i++) {
      const recovered = correct(fit, measured[i]!);
      const dE = deltaE2000(rgb255ToLab(recovered), rgb255ToLab(neutrals[i]!));
      assert.ok(dE < 1, `patch ${i} residual ΔE ${dE}`);
    }
  });

  test("correction generalises to colours it was not fitted on", () => {
    const fit = fitDiagonal(neutrals.map(warmCast), neutrals);
    assert.ok(fit);

    // A colour the fit never saw must still come back close to truth.
    const unseen: Rgb255 = { r: 190, g: 120, b: 60 };
    const recovered = correct(fit, warmCast(unseen));
    const dE = deltaE2000(rgb255ToLab(recovered), rgb255ToLab(unseen));
    assert.ok(dE < 2, `unseen colour residual ΔE ${dE}`);
  });

  test("full matrix fit handles channel crosstalk a diagonal cannot", () => {
    // A sensor that bleeds green into red — no diagonal can undo this.
    const crosstalk = (c: Rgb255): Rgb255 => {
      const [r, g, b] = rgb255ToLinear(c);
      return linearToRgb255([r * 1.1 + g * 0.18, g * 0.95, b * 0.8 + g * 0.05]);
    };

    const chromatic: Rgb255[] = [
      ...neutrals,
      { r: 200, g: 60, b: 60 },
      { r: 60, g: 190, b: 80 },
      { r: 50, g: 80, b: 200 },
      { r: 220, g: 200, b: 40 },
      { r: 190, g: 70, b: 180 },
      { r: 40, g: 190, b: 200 },
    ];
    const measured = chromatic.map(crosstalk);

    const diagonal = fitDiagonal(measured, chromatic);
    const matrix = fitMatrix(measured, chromatic);
    assert.ok(diagonal && matrix);
    assert.ok(
      matrix.residual < diagonal.residual,
      `matrix ${matrix.residual} should beat diagonal ${diagonal.residual}`,
    );
  });

  test("fitCorrection prefers the diagonal when patches are all neutral", () => {
    const fit = fitCorrection(neutrals.map(warmCast), neutrals);
    assert.equal(fit.kind, "diagonal");
  });

  test("rejects mismatched input lengths", () => {
    assert.equal(fitDiagonal(neutrals, neutrals.slice(0, 3)), null);
  });

  test("excludes clipped patches instead of fitting through them", () => {
    // An overexposed shot: the two brightest patches have saturated. Their true
    // radiance is gone, so including them would drag the whole fit.
    const overexposed = neutrals.map((c, i) =>
      i < 2 ? { r: 255, g: 255, b: 255 } : warmCast(c),
    );

    const fit = fitDiagonal(overexposed, neutrals);
    assert.ok(fit, "should still fit from the surviving patches");

    // The unsaturated patches must still come back accurately.
    for (let i = 2; i < neutrals.length; i++) {
      const recovered = correct(fit, overexposed[i]!);
      const dE = deltaE2000(rgb255ToLab(recovered), rgb255ToLab(neutrals[i]!));
      assert.ok(dE < 1.5, `patch ${i} residual ΔE ${dE}`);
    }
  });

  test("gives up when too few patches survive clipping", () => {
    const allBlown = neutrals.map(() => ({ r: 255, g: 255, b: 255 }));
    assert.equal(fitDiagonal(allBlown, neutrals), null);
  });
});

describe("disc sampling", () => {
  test("median ignores a specular highlight", () => {
    const raster = new Raster(60, 60, { r: 90, g: 140, b: 70 });
    // A blown-out spot, as a wet pad reflecting a ceiling light.
    raster.fillRect(28, 28, 5, 5, { r: 255, g: 255, b: 255 });

    const result = sampleDisc(raster.toImageData(), { x: 30, y: 30 }, 14);
    assert.ok(result);
    assert.ok(near(result.rgb.r, 90, 1), `r ${result.rgb.r}`);
    assert.ok(near(result.rgb.g, 140, 1), `g ${result.rgb.g}`);
    assert.ok(near(result.rgb.b, 70, 1), `b ${result.rgb.b}`);
  });

  test("reports zero spread on a uniform patch", () => {
    const raster = new Raster(40, 40, { r: 120, g: 120, b: 120 });
    const result = sampleDisc(raster.toImageData(), { x: 20, y: 20 }, 8);
    assert.ok(result);
    assert.equal(result.spread, 0);
  });

  test("returns null when the disc falls outside the image", () => {
    const raster = new Raster(40, 40);
    assert.equal(sampleDisc(raster.toImageData(), { x: -50, y: -50 }, 4), null);
    assert.equal(sampleDisc(raster.toImageData(), { x: NaN, y: 5 }, 4), null);
  });

  test("clippedFraction catches a blown-out patch", () => {
    const dark = new Raster(40, 40, { r: 100, g: 100, b: 100 });
    assert.equal(clippedFraction(dark.toImageData(), { x: 20, y: 20 }, 10), 0);

    const blown = new Raster(40, 40, { r: 254, g: 254, b: 254 });
    assert.equal(clippedFraction(blown.toImageData(), { x: 20, y: 20 }, 10), 1);
  });
});

describe("ramp reading", () => {
  const swatch = (value: number, rgb: Rgb255): Swatch => ({
    value,
    lab: rgb255ToLab(rgb),
  });

  // A plausible nitrate ramp: pale pink through to deep magenta.
  const nitrateRamp: Swatch[] = [
    swatch(0, { r: 252, g: 244, b: 240 }),
    swatch(1, { r: 249, g: 219, b: 220 }),
    swatch(5, { r: 240, g: 176, b: 190 }),
    swatch(10, { r: 226, g: 122, b: 156 }),
    swatch(25, { r: 205, g: 68, b: 122 }),
    swatch(50, { r: 170, g: 24, b: 92 }),
  ];

  const nitrate: Analyte = {
    id: "nitrate_n",
    label: "Nitrate (as N)",
    unit: "mg/L",
    padPosition: 0.3,
    ramp: nitrateRamp,
    limit: { value: 10, kind: "max", source: "US EPA MCL" },
  };

  test("an exact swatch match returns that swatch's value", () => {
    const result = readRamp(nitrateRamp[3]!.lab, nitrateRamp);
    assert.ok(result);
    assert.equal(result.value, 10);
    assert.ok(result.deltaE < 1e-9);
  });

  test("interpolates between swatches instead of snapping", () => {
    // A colour midway between the 10 and 25 swatches in sRGB.
    const midway = rgb255ToLab({
      r: (226 + 205) / 2,
      g: (122 + 68) / 2,
      b: (156 + 122) / 2,
    });
    const result = readRamp(midway, nitrateRamp);
    assert.ok(result);
    assert.ok(
      result.value > 11 && result.value < 24,
      `expected a value strictly between swatches, got ${result.value}`,
    );
    assert.deepEqual(result.range, [10, 25]);
  });

  test("is monotonic along the ramp", () => {
    const values = nitrateRamp.map((s) => readRamp(s.lab, nitrateRamp)!.value);
    for (let i = 1; i < values.length; i++) {
      assert.ok(values[i]! > values[i - 1]!, `not monotonic at ${i}`);
    }
  });

  test("needs at least two swatches", () => {
    assert.equal(readRamp(nitrateRamp[0]!.lab, [nitrateRamp[0]!]), null);
  });

  test("flags a reading over the EPA limit", () => {
    const reading = toReading(nitrate, nitrateRamp[4]!.lab); // 25 mg/L
    assert.equal(reading.value, 25);
    assert.equal(reading.exceedsLimit, true);
    assert.equal(reading.confidence, "high");
  });

  test("does not flag a reading under the limit", () => {
    const reading = toReading(nitrate, nitrateRamp[2]!.lab); // 5 mg/L
    assert.equal(reading.exceedsLimit, false);
  });

  test("refuses to report a number for an off-ramp colour", () => {
    // Bright green is nowhere near a pink nitrate ramp.
    const reading = toReading(nitrate, rgb255ToLab({ r: 40, g: 220, b: 60 }));
    assert.equal(reading.confidence, "low");
    assert.equal(reading.value, null, "a low-confidence match must not report a value");
    assert.equal(reading.exceedsLimit, null);
    assert.ok(reading.deltaE > 12);
  });

  test("confidence bands follow ΔE", () => {
    assert.equal(confidenceFor(0.5), "high");
    assert.equal(confidenceFor(5), "high");
    assert.equal(confidenceFor(8), "medium");
    assert.equal(confidenceFor(30), "low");
  });
});
