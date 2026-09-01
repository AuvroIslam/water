/**
 * ArUco marker detection.
 *
 * js-aruco2 ships as CommonJS that assigns onto `this` at module scope, so a
 * named import fails under Node's ESM loader. A default import works in both
 * Node and Vite, which is what lets the same pipeline run in tests and in the
 * browser.
 */

import aruco from "js-aruco2/src/aruco.js";
import type { ImageLike, Point } from "./types.ts";

// Types live in src/types/js-aruco2.d.ts — the package ships none of its own.
const AR = aruco.AR;

type ArucoDetector = InstanceType<typeof AR.Detector>;

/**
 * ARUCO rather than the library default of ARUCO_MIP_36h12.
 *
 * 36h12 carries more error correction but needs an 8x8 grid, so at a given
 * printed size its cells are smaller and it degrades faster in a hand-held
 * phone photo of a whole card. The 5x5 ARUCO dictionary detects far more
 * reliably at the scale our markers actually occupy in frame.
 */
const DICTIONARY = "ARUCO";

let detector: ArucoDetector | null = null;

function getDetector(): ArucoDetector {
  detector ??= new AR.Detector({ dictionaryName: DICTIONARY });
  return detector;
}

export function getDictionary() {
  return new AR.Dictionary(DICTIONARY);
}

export interface DetectedMarker {
  id: number;
  corners: Point[];
  centre: Point;
}

function centroid(points: readonly Point[]): Point {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/** Detect every marker in an image, with centres precomputed. */
export function detectMarkers(image: ImageLike): DetectedMarker[] {
  return getDetector()
    .detect(image)
    .map((m) => ({ id: m.id, corners: m.corners, centre: centroid(m.corners) }));
}

/**
 * Pull out the four card corners in the order the card declares them.
 * Returns null when any is missing — three markers cannot pin a homography.
 */
export function findCardCorners(
  markers: readonly DetectedMarker[],
  expectedIds: readonly number[],
): Point[] | null {
  const byId = new Map(markers.map((m) => [m.id, m]));
  const corners: Point[] = [];
  for (const id of expectedIds) {
    const marker = byId.get(id);
    if (!marker) return null;
    corners.push(marker.centre);
  }
  return corners;
}
