/**
 * End-to-end validation on synthetic photographs.
 *
 * The claim this project makes is that a corrected reading is stable across
 * lighting while a raw one is not. These tests assert exactly that, using
 * images where we chose the true concentrations, so there is a right answer to
 * check against. This is the same experiment as the real-world validation
 * planned for build days 5-6, run against simulated illuminants instead of a
 * kitchen, a window and a desk lamp.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readStrip } from "../src/core/pipeline.ts";
import { DEMO_STRIP } from "../src/strips/demo.ts";
import { linearToRgb255, rgb255ToLinear } from "../src/core/colorimetry.ts";
import { renderSyntheticCard } from "./helpers/syntheticCard.ts";
import type { Point, Rgb255 } from "../src/core/types.ts";

/** A camera under a coloured illuminant, applied in linear light. */
function illuminant(gains: [number, number, number], exposure = 1) {
  return (c: Rgb255): Rgb255 => {
    const [r, g, b] = rgb255ToLinear(c);
    return linearToRgb255([
      r * gains[0] * exposure,
      g * gains[1] * exposure,
      b * gains[2] * exposure,
    ]);
  };
}

const ILLUMINANTS = {
  daylight: illuminant([1.0, 1.0, 1.0]),
  tungsten: illuminant([1.1, 0.92, 0.62]),
  led: illuminant([0.96, 1.0, 1.08], 0.94),
  shade: illuminant([0.86, 0.95, 1.12], 1.02),
} as const;

/** Card filling most of the frame, shot square on. */
const FLAT_CORNERS: Point[] = [
  { x: 60, y: 60 },
  { x: 1020, y: 60 },
  { x: 1020, y: 740 },
  { x: 60, y: 740 },
];

/** Card tilted away at the top, as when held in one hand over a sink. */
const TILTED_CORNERS: Point[] = [
  { x: 150, y: 90 },
  { x: 950, y: 130 },
  { x: 1010, y: 720 },
  { x: 90, y: 690 },
];

const TRUE_VALUES = {
  nitrate_n: 17,
  nitrite_n: 0.5,
  ph: 7.5,
  total_hardness: 120,
  free_chlorine: 1,
};

function shoot(
  corners: Point[],
  camera?: (c: Rgb255) => Rgb255,
  values: Record<string, number> = TRUE_VALUES,
) {
  const raster = renderSyntheticCard({
    width: 1080,
    height: 800,
    cardCorners: corners,
    cameraTransform: camera,
    trueValues: values,
    strip: DEMO_STRIP,
  });
  return readStrip(raster.toImageData(), DEMO_STRIP);
}

function readingFor(result: ReturnType<typeof shoot>, id: string) {
  assert.ok(result.ok, `pipeline failed: ${result.ok ? "" : result.reason}`);
  const reading = result.readings.find((r) => r.analyteId === id);
  assert.ok(reading, `no reading for ${id}`);
  return reading;
}

describe("pipeline, ideal capture", () => {
  test("finds the card and reads every pad", () => {
    const result = shoot(FLAT_CORNERS);
    assert.ok(result.ok, result.ok ? "" : `${result.reason}: ${result.message}`);
    assert.equal(result.readings.length, DEMO_STRIP.analytes.length);
    assert.ok(result.diagnostics.pixelsPerMm > 5);
  });

  test("recovers the true concentrations", () => {
    const result = shoot(FLAT_CORNERS);
    assert.ok(result.ok);

    for (const [id, expected] of Object.entries(TRUE_VALUES)) {
      const reading = readingFor(result, id);
      assert.notEqual(reading.value, null, `${id} refused to report`);
      const error = Math.abs(reading.value! - expected) / Math.max(expected, 1);
      assert.ok(
        error < 0.2,
        `${id}: expected ~${expected}, got ${reading.value} (${(error * 100).toFixed(1)}% off)`,
      );
    }
  });

  test("interpolates between swatches rather than snapping to one", () => {
    // 17 mg/L sits between the 10 and 25 nitrate swatches. A tool that snapped
    // to the nearest swatch could only ever answer 10 or 25.
    const reading = readingFor(shoot(FLAT_CORNERS), "nitrate_n");
    assert.ok(
      reading.value! > 11 && reading.value! < 24,
      `expected an interpolated value, got ${reading.value}`,
    );
  });

  test("flags nitrate above the EPA limit", () => {
    const reading = readingFor(shoot(FLAT_CORNERS), "nitrate_n");
    assert.equal(reading.exceedsLimit, true);
  });

  test("does not flag nitrate below the limit", () => {
    const safe = { ...TRUE_VALUES, nitrate_n: 2 };
    const reading = readingFor(shoot(FLAT_CORNERS, undefined, safe), "nitrate_n");
    assert.equal(reading.exceedsLimit, false);
  });
});

describe("pipeline, perspective", () => {
  test("reads a tilted card as accurately as a flat one", () => {
    const flat = readingFor(shoot(FLAT_CORNERS), "nitrate_n");
    const tilted = readingFor(shoot(TILTED_CORNERS), "nitrate_n");

    assert.notEqual(tilted.value, null);
    assert.ok(
      Math.abs(tilted.value! - flat.value!) < 2,
      `tilt shifted the reading from ${flat.value} to ${tilted.value}`,
    );
  });
});

describe("pipeline, lighting invariance", () => {
  /**
   * The headline claim, and the chart that belongs in the demo video:
   * corrected readings cluster across illuminants; raw ones do not.
   */
  test("corrected readings agree across four illuminants", () => {
    const values: number[] = [];

    for (const [name, camera] of Object.entries(ILLUMINANTS)) {
      const result = shoot(TILTED_CORNERS, camera);
      assert.ok(result.ok, `${name} failed: ${result.ok ? "" : result.reason}`);
      const reading = readingFor(result, "nitrate_n");
      assert.notEqual(reading.value, null, `${name} refused to report`);
      values.push(reading.value!);
    }

    const spread = Math.max(...values) - Math.min(...values);
    assert.ok(
      spread < 3,
      `readings should cluster, got spread ${spread.toFixed(2)} from ${values.map((v) => v.toFixed(1)).join(", ")}`,
    );
  });

  test("every illuminant lands within tolerance of the truth", () => {
    for (const [name, camera] of Object.entries(ILLUMINANTS)) {
      const reading = readingFor(shoot(TILTED_CORNERS, camera), "nitrate_n");
      const error = Math.abs(reading.value! - TRUE_VALUES.nitrate_n);
      assert.ok(error < 4, `${name}: ${reading.value} vs ${TRUE_VALUES.nitrate_n}`);
    }
  });

  test("the correction is doing the work: raw pad colours do NOT agree", () => {
    // Without correction, the same pad under tungsten and shade differs by far
    // more than the just-noticeable difference. If this ever fails, the
    // illuminant simulation has gone weak and the test above proves nothing.
    const pad: Rgb255 = { r: 226, g: 122, b: 156 };
    const warm = ILLUMINANTS.tungsten(pad);
    const cool = ILLUMINANTS.shade(pad);
    const channelShift =
      Math.abs(warm.r - cool.r) + Math.abs(warm.g - cool.g) + Math.abs(warm.b - cool.b);
    assert.ok(channelShift > 40, `illuminants too similar: ${channelShift}`);
  });
});

describe("pipeline, refusals", () => {
  test("says so when the card is not in frame", () => {
    const raster = renderSyntheticCard({
      width: 400,
      height: 300,
      // Card pushed almost entirely off screen.
      cardCorners: [
        { x: -900, y: -700 },
        { x: -100, y: -700 },
        { x: -100, y: -120 },
        { x: -900, y: -120 },
      ],
      trueValues: TRUE_VALUES,
      strip: DEMO_STRIP,
    });
    const result = readStrip(raster.toImageData(), DEMO_STRIP);
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.reason, "card-not-found");
  });

  test("says so when the photo is taken from too far away", () => {
    const raster = renderSyntheticCard({
      width: 320,
      height: 240,
      cardCorners: [
        { x: 130, y: 100 },
        { x: 190, y: 100 },
        { x: 190, y: 143 },
        { x: 130, y: 143 },
      ],
      trueValues: TRUE_VALUES,
      strip: DEMO_STRIP,
    });
    const result = readStrip(raster.toImageData(), DEMO_STRIP);
    assert.equal(result.ok, false);
    assert.ok(
      result.ok === false &&
        (result.reason === "card-too-small" || result.reason === "card-not-found"),
      `unexpected reason ${result.ok === false ? result.reason : ""}`,
    );
  });

  /**
   * Regression test for the worst bug this app could ship.
   *
   * Reagent ramps start at near-white, so before the channel was printed slate
   * an empty channel read as a confident "nitrate 0.24 mg/L" — a false all-clear
   * for a test that was never performed.
   */
  test("refuses outright when no strip is in the channel", () => {
    const raster = renderSyntheticCard({
      width: 1080,
      height: 800,
      cardCorners: FLAT_CORNERS,
      trueValues: TRUE_VALUES,
      strip: DEMO_STRIP,
      omitStrip: true,
    });
    const result = readStrip(raster.toImageData(), DEMO_STRIP);

    assert.equal(result.ok, false, "an empty channel must not produce readings");
    assert.equal(result.ok === false && result.reason, "strip-missing");
  });

  test("an empty channel never yields a safe-looking number", () => {
    const raster = renderSyntheticCard({
      width: 1080,
      height: 800,
      cardCorners: TILTED_CORNERS,
      trueValues: TRUE_VALUES,
      strip: DEMO_STRIP,
      omitStrip: true,
    });
    const result = readStrip(raster.toImageData(), DEMO_STRIP);
    if (result.ok) {
      for (const reading of result.readings) {
        assert.equal(
          reading.value,
          null,
          `${reading.analyteId} reported ${reading.value} with no strip present`,
        );
      }
    }
  });

  test("every failure carries a message aimed at the person holding the phone", () => {
    const raster = renderSyntheticCard({
      width: 200,
      height: 150,
      cardCorners: [
        { x: -500, y: -400 },
        { x: -60, y: -400 },
        { x: -60, y: -90 },
        { x: -500, y: -90 },
      ],
      trueValues: TRUE_VALUES,
      strip: DEMO_STRIP,
    });
    const result = readStrip(raster.toImageData(), DEMO_STRIP);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(result.message.length > 20);
      assert.ok(/[.!]$/.test(result.message), "should read as a sentence");
    }
  });
});
