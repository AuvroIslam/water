import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { homographyFromQuad, project, scaleAt } from "../src/core/homography.ts";
import type { Point } from "../src/core/types.ts";

const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) < tol;
const nearPoint = (a: Point, b: Point, tol = 1e-6) =>
  near(a.x, b.x, tol) && near(a.y, b.y, tol);

describe("homographyFromQuad", () => {
  const unitSquare: Point[] = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 80 },
    { x: 0, y: 80 },
  ];

  test("recovers an identity mapping", () => {
    const h = homographyFromQuad(unitSquare, unitSquare);
    assert.ok(h);
    for (const p of unitSquare) {
      assert.ok(nearPoint(project(h, p), p), `${JSON.stringify(project(h, p))}`);
    }
  });

  test("recovers a pure translation and scale", () => {
    const dest = unitSquare.map((p) => ({ x: p.x * 3 + 50, y: p.y * 3 + 20 }));
    const h = homographyFromQuad(unitSquare, dest);
    assert.ok(h);

    // Interior points must map correctly, not just the four corners.
    const interior = { x: 37.5, y: 61.25 };
    const expected = { x: 37.5 * 3 + 50, y: 61.25 * 3 + 20 };
    assert.ok(nearPoint(project(h, interior), expected, 1e-6));
  });

  test("maps corners exactly under a strong perspective", () => {
    // A trapezoid: the far edge is compressed, as when a card is tilted away.
    const dest: Point[] = [
      { x: 120, y: 240 },
      { x: 880, y: 190 },
      { x: 760, y: 610 },
      { x: 250, y: 660 },
    ];
    const h = homographyFromQuad(unitSquare, dest);
    assert.ok(h);

    for (let i = 0; i < 4; i++) {
      assert.ok(
        nearPoint(project(h, unitSquare[i]!), dest[i]!, 1e-6),
        `corner ${i}: got ${JSON.stringify(project(h, unitSquare[i]!))}`,
      );
    }
  });

  test("is invertible: card to image to card round-trips", () => {
    const dest: Point[] = [
      { x: 120, y: 240 },
      { x: 880, y: 190 },
      { x: 760, y: 610 },
      { x: 250, y: 660 },
    ];
    const forward = homographyFromQuad(unitSquare, dest);
    const inverse = homographyFromQuad(dest, unitSquare);
    assert.ok(forward && inverse);

    const probe = { x: 42, y: 17 };
    const roundTripped = project(inverse, project(forward, probe));
    assert.ok(nearPoint(roundTripped, probe, 1e-6));
  });

  test("preserves straight lines, as a projective transform must", () => {
    const dest: Point[] = [
      { x: 10, y: 30 },
      { x: 400, y: 12 },
      { x: 380, y: 300 },
      { x: 40, y: 330 },
    ];
    const h = homographyFromQuad(unitSquare, dest);
    assert.ok(h);

    // Three collinear points in card space must stay collinear in image space.
    const a = project(h, { x: 0, y: 40 });
    const b = project(h, { x: 50, y: 40 });
    const c = project(h, { x: 100, y: 40 });
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    assert.ok(Math.abs(cross) < 1e-6, `collinearity broke, cross = ${cross}`);
  });

  test("rejects degenerate correspondences", () => {
    const collinear: Point[] = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ];
    assert.equal(homographyFromQuad(collinear, collinear), null);
  });

  test("rejects wrong-length input", () => {
    assert.equal(homographyFromQuad(unitSquare.slice(0, 3), unitSquare), null);
  });
});

describe("scaleAt", () => {
  test("reports the pixels-per-card-unit factor", () => {
    const card: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const dest = card.map((p) => ({ x: p.x * 4, y: p.y * 4 }));
    const h = homographyFromQuad(card, dest);
    assert.ok(h);
    assert.ok(near(scaleAt(h, { x: 50, y: 50 }), 4, 1e-6));
  });

  test("is larger on the near edge of a tilted card", () => {
    const card: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    // Top edge far (compressed), bottom edge near (expanded).
    const dest: Point[] = [
      { x: 300, y: 100 },
      { x: 700, y: 100 },
      { x: 900, y: 600 },
      { x: 100, y: 600 },
    ];
    const h = homographyFromQuad(card, dest);
    assert.ok(h);

    const far = scaleAt(h, { x: 50, y: 5 });
    const near_ = scaleAt(h, { x: 50, y: 95 });
    assert.ok(near_ > far, `expected near ${near_} > far ${far}`);
  });
});
