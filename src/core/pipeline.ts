/**
 * The full read: photograph in, readings out.
 *
 * Order matters. We locate the card before we trust any colour, correct colour
 * before we compare anything, and refuse early whenever the photo cannot
 * support a number. A tool that says "retake this" is more useful than one that
 * always answers.
 */

import {
  ALL_PATCHES,
  CORNER_MARKER_IDS,
  MARKER_CENTRES,
  STRIP_CHANNEL,
  padCentre,
  stripPresenceProbes,
} from "../card/card.ts";
import { fitCorrection, correct, type Correction } from "./colorCorrect.ts";
import { deltaE2000, rgb255ToLab } from "./colorimetry.ts";
import { homographyFromQuad, project, scaleAt, type Matrix3 } from "./homography.ts";
import { detectMarkers, findCardCorners } from "./markers.ts";
import { toReading } from "./ramp.ts";
import { clippedFraction, sampleDisc } from "./sample.ts";
import type { ImageLike, Reading, Rgb255, StripSpec } from "./types.ts";

export type FailureReason =
  | "card-not-found"
  | "card-geometry-degenerate"
  | "card-too-small"
  | "patches-unreadable"
  | "correction-failed"
  | "strip-missing"
  | "strip-unreadable";

export interface PipelineFailure {
  ok: false;
  reason: FailureReason;
  /** Text meant for a person holding a phone, not for a log. */
  message: string;
  /** Markers we did see, useful for an on-screen alignment hint. */
  markersFound: number[];
}

export interface PipelineSuccess {
  ok: true;
  readings: Reading[];
  correction: Correction;
  diagnostics: {
    /** Image pixels per card millimetre. Below ~3 the pads are mush. */
    pixelsPerMm: number;
    /** Fraction of reference patches that were clipped or off-frame. */
    patchesLost: number;
    homography: Matrix3;
  };
}

export type PipelineResult = PipelineFailure | PipelineSuccess;

/**
 * A pad is sampled well inside its own area. Test pads bleed at the edges and
 * the strip's white backing sits right beside them, so the middle 60% is the
 * only part that is reliably just the reagent.
 */
const PAD_SAMPLE_FRACTION = 0.3;

/** Minimum resolution before pad colours stop being trustworthy. */
const MIN_PIXELS_PER_MM = 2.5;

/** Reject a patch once this much of it has saturated. */
const MAX_CLIPPED_FRACTION = 0.2;

/** How close a channel probe must sit to the printed slate to count as bare. */
const BARE_CHANNEL_MAX_DELTA_E = 10;

/** Fraction of probes that must read bare before we call the channel empty. */
const BARE_CHANNEL_MAJORITY = 0.6;

function fail(
  reason: FailureReason,
  message: string,
  markersFound: number[] = [],
): PipelineFailure {
  return { ok: false, reason, message, markersFound };
}

export function readStrip(image: ImageLike, strip: StripSpec): PipelineResult {
  // 1. Locate the card.
  const markers = detectMarkers(image);
  const markerIds = markers.map((m) => m.id);
  const corners = findCardCorners(markers, CORNER_MARKER_IDS);

  if (!corners) {
    return fail(
      "card-not-found",
      markers.length === 0
        ? "No reference card in frame. Fit the whole card inside the guide."
        : "Only part of the card is visible. Move back until all four corner squares are in frame.",
      markerIds,
    );
  }

  // 2. Solve card millimetres to image pixels.
  const homography = homographyFromQuad(MARKER_CENTRES, corners);
  if (!homography) {
    return fail(
      "card-geometry-degenerate",
      "Could not read the card's shape. Photograph it flat, from above.",
      markerIds,
    );
  }

  const pixelsPerMm = scaleAt(homography, { x: 74, y: 52 });
  if (!Number.isFinite(pixelsPerMm) || pixelsPerMm < MIN_PIXELS_PER_MM) {
    return fail(
      "card-too-small",
      "Too far away. Move closer so the card fills the guide.",
      markerIds,
    );
  }

  // 3. Measure the reference patches and fit the camera correction.
  const measured: Rgb255[] = [];
  const nominal: Rgb255[] = [];
  let lost = 0;

  for (const patch of ALL_PATCHES) {
    const centre = project(homography, patch.centre);
    const radius = (patch.sizeMm / 2) * PAD_SAMPLE_FRACTION * 2 * pixelsPerMm;

    if (clippedFraction(image, centre, radius) > MAX_CLIPPED_FRACTION) {
      lost++;
      continue;
    }
    const sample = sampleDisc(image, centre, radius);
    if (!sample) {
      lost++;
      continue;
    }
    measured.push(sample.rgb);
    nominal.push(patch.nominal);
  }

  if (measured.length < 4) {
    return fail(
      "patches-unreadable",
      lost > 0
        ? "The card is blown out. Move out of direct sunlight or turn the flash off."
        : "Could not read the card's colour patches. Make sure none are covered.",
      markerIds,
    );
  }

  const correction = fitCorrection(measured, nominal);

  // 4. Confirm a strip is actually in the channel.
  //
  // Skipping this check is how a water safety tool ends up reporting a
  // confident "0.2 mg/L, safe" for a test that was never run: an empty channel
  // would otherwise match the near-white zero end of most reagent ramps.
  const channelNominalLab = rgb255ToLab(STRIP_CHANNEL.nominal);
  const probes = stripPresenceProbes(
    strip.analytes.map((a) => a.padPosition),
    strip.padSizeMm,
  );

  let bareChannel = 0;
  let probed = 0;
  for (const probe of probes) {
    const sample = sampleDisc(
      image,
      project(homography, probe),
      Math.max(2, (STRIP_CHANNEL.widthMm / 3) * pixelsPerMm),
    );
    if (!sample) continue;
    probed++;
    const lab = rgb255ToLab(correct(correction, sample.rgb));
    if (deltaE2000(lab, channelNominalLab) < BARE_CHANNEL_MAX_DELTA_E) bareChannel++;
  }

  if (probed > 0 && bareChannel / probed > BARE_CHANNEL_MAJORITY) {
    return fail(
      "strip-missing",
      "No strip in the channel. Dip a strip, then lay it flat inside the printed slot.",
      markerIds,
    );
  }

  // 5. Read the strip pads through the correction.
  const readings: Reading[] = [];
  for (const analyte of strip.analytes) {
    const centre = project(homography, padCentre(analyte.padPosition));
    const radius = (strip.padSizeMm / 2) * PAD_SAMPLE_FRACTION * 2 * pixelsPerMm;

    const sample = sampleDisc(image, centre, radius);
    if (!sample) continue;

    const corrected = correct(correction, sample.rgb);
    readings.push(toReading(analyte, rgb255ToLab(corrected)));
  }

  if (readings.length === 0) {
    return fail(
      "strip-unreadable",
      "No strip found in the channel. Lay the strip flat inside the printed slot.",
      markerIds,
    );
  }

  return {
    ok: true,
    readings,
    correction,
    diagnostics: {
      pixelsPerMm,
      patchesLost: lost / ALL_PATCHES.length,
      homography,
    },
  };
}
