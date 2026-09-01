/**
 * Dependency validation.
 *
 * These two libraries carry the entire technical claim of the project, so we
 * assert their behaviour rather than trusting the docs. If either of these
 * fails, the architecture changes — do not build on top of a red test here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { differenceCiede2000, converter } from "culori";
import { Raster, drawMarker } from "./helpers/raster.ts";

const require = createRequire(import.meta.url);

describe("js-aruco2", () => {
  test("loads in node and exposes the documented API", () => {
    const { AR } = require("js-aruco2/src/aruco.js");
    assert.ok(AR, "AR namespace missing");
    assert.equal(typeof AR.Detector, "function");
    assert.equal(typeof AR.Dictionary, "function");
  });

  test("generates and re-detects its own markers", () => {
    const { AR } = require("js-aruco2/src/aruco.js");

    // ARUCO: 5x5 data bits, more forgiving at low resolution than 36h12.
    const dict = new AR.Dictionary("ARUCO");
    const detector = new AR.Detector({ dictionaryName: "ARUCO" });

    // A single marker, generously sized, on a white field with a quiet zone.
    const cell = 12;
    const grid = dict.markSize + 2; // markSize is size+2; generateSVG pads to size+4
    const pad = 40;
    const raster = new Raster(grid * cell + pad * 2, grid * cell + pad * 2);

    const targetId = 7;
    drawMarker(raster, dict.codeList[targetId], pad, pad, cell);

    const markers = detector.detect(raster.toImageData());

    assert.ok(markers.length > 0, "detector found no markers in a synthetic image");
    assert.equal(markers[0].id, targetId);
    assert.equal(markers[0].corners.length, 4);
  });

  test("returns corners as {x, y} in image pixel space", () => {
    const { AR } = require("js-aruco2/src/aruco.js");
    const dict = new AR.Dictionary("ARUCO");
    const detector = new AR.Detector({ dictionaryName: "ARUCO" });

    const cell = 12;
    const grid = dict.markSize + 2;
    const pad = 40;
    const raster = new Raster(grid * cell + pad * 2, grid * cell + pad * 2);
    drawMarker(raster, dict.codeList[3], pad, pad, cell);

    const [marker] = detector.detect(raster.toImageData());
    assert.ok(marker);
    for (const c of marker.corners) {
      assert.equal(typeof c.x, "number");
      assert.equal(typeof c.y, "number");
      assert.ok(c.x >= 0 && c.x <= raster.width);
      assert.ok(c.y >= 0 && c.y <= raster.height);
    }
  });
});

describe("culori CIEDE2000", () => {
  const dE = differenceCiede2000();
  const lab = (l: number, a: number, b: number) => ({ mode: "lab65" as const, l, a, b });

  /**
   * Reference pairs from Sharma, Wu & Dalal (2005), the standard CIEDE2000
   * conformance set. If culori ever regresses, this catches it.
   */
  const cases: Array<[[number, number, number], [number, number, number], number]> = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.02], [50, 0, -82.7485], 3.4412],
    [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0],
    [[50, -1.1848, -84.8006], [50, 0, -82.7485], 1.0],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ];

  for (const [a, b, expected] of cases) {
    test(`ΔE00(${a.join(",")} | ${b.join(",")}) ≈ ${expected}`, () => {
      const got = dE(lab(a[0], a[1], a[2]), lab(b[0], b[1], b[2]));
      assert.ok(
        Math.abs(got - expected) < 0.0001,
        `expected ${expected}, got ${got}`,
      );
    });
  }

  test("is symmetric", () => {
    const x = lab(60, 12, -30);
    const y = lab(58, 9, -26);
    assert.ok(Math.abs(dE(x, y) - dE(y, x)) < 1e-9);
  });

  /**
   * THE TRAP. culori's "lab" is D50-referenced per CSS Color Level 4, so
   * handing it raw D65 Lab values silently chromatically adapts them and
   * skews every ΔE by up to ~10%. sRGB is D65-native, so this project uses
   * "lab65" everywhere. This test exists to make that a loud failure if
   * anyone "simplifies" it back to "lab".
   */
  test("lab (D50) and lab65 (D65) are NOT interchangeable", () => {
    const d50 = dE(
      { mode: "lab", l: 50, a: 2.6772, b: -79.7751 },
      { mode: "lab", l: 50, a: 0, b: -82.7485 },
    );
    const d65 = dE(lab(50, 2.6772, -79.7751), lab(50, 0, -82.7485));

    assert.ok(Math.abs(d65 - 2.0425) < 0.0001, "lab65 must match Sharma");
    assert.ok(
      Math.abs(d50 - 2.0425) > 0.1,
      "if this passes, culori changed and the D50/D65 note can be revisited",
    );
  });
});

describe("culori sRGB to Lab", () => {
  const toLab = converter("lab65");

  test("maps sRGB white to L*=100 with near-zero chroma", () => {
    const c = toLab({ mode: "rgb", r: 1, g: 1, b: 1 });
    assert.ok(Math.abs(c.l - 100) < 0.01, `L* was ${c.l}`);
    assert.ok(Math.abs(c.a ?? 0) < 0.01);
    assert.ok(Math.abs(c.b ?? 0) < 0.01);
  });

  test("maps sRGB black to L*=0", () => {
    const c = toLab({ mode: "rgb", r: 0, g: 0, b: 0 });
    assert.ok(Math.abs(c.l) < 0.01, `L* was ${c.l}`);
  });

  test("mid grey is perceptually mid, not numerically mid", () => {
    // sRGB 128 is ~53.6 L*, not 50 — proof the transfer function is applied.
    const c = toLab({ mode: "rgb", r: 128 / 255, g: 128 / 255, b: 128 / 255 });
    assert.ok(c.l > 53 && c.l < 54, `L* was ${c.l}`);
  });
});
