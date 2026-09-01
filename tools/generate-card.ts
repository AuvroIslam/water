/**
 * Generates the printable reference card as a standalone HTML file.
 *
 *   npm run card      then open out/card.html and print at 100% scale
 *
 * Everything is laid out in millimetres from the same constants the pipeline
 * samples against, so the printed artwork and the sampling geometry can never
 * drift apart.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  ALL_PATCHES,
  CARD_HEIGHT_MM,
  CARD_WIDTH_MM,
  CORNER_MARKER_IDS,
  MARKER_ORIGINS,
  MARKER_SIZE_MM,
  STRIP_CHANNEL,
} from "../src/card/card.ts";
import { getDictionary } from "../src/core/markers.ts";
import type { Rgb255 } from "../src/core/types.ts";

const css = (rgb: Rgb255) =>
  `rgb(${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)})`;

function markerSvg(id: number): string {
  // generateSVG returns a viewBox-sized SVG we can scale to the printed size.
  return getDictionary()
    .generateSVG(id)
    .replace("<svg ", '<svg preserveAspectRatio="none" width="100%" height="100%" ');
}

function buildHtml(): string {
  const markers = CORNER_MARKER_IDS.map((id, i) => {
    const origin = MARKER_ORIGINS[i]!;
    return `      <div class="marker" style="left:${origin.x}mm; top:${origin.y}mm; width:${MARKER_SIZE_MM}mm; height:${MARKER_SIZE_MM}mm;">${markerSvg(id)}</div>`;
  }).join("\n");

  const patches = ALL_PATCHES.map((p) => {
    const left = p.centre.x - p.sizeMm / 2;
    const top = p.centre.y - p.sizeMm / 2;
    return `      <div class="patch" style="left:${left}mm; top:${top}mm; width:${p.sizeMm}mm; height:${p.sizeMm}mm; background:${css(p.nominal)};"></div>`;
  }).join("\n");

  const channelTop = STRIP_CHANNEL.centreY - STRIP_CHANNEL.widthMm / 2;
  const channelWidth = STRIP_CHANNEL.endX - STRIP_CHANNEL.startX;

  return `<!doctype html>
<meta charset="utf-8">
<title>StripLab reference card</title>
<style>
  @page { size: A4; margin: 12mm; }

  html { background: #eceeef; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, "Segoe UI", Helvetica, Arial, sans-serif;
    color: #14201a;
  }

  .sheet { padding: 10mm; }

  .card {
    position: relative;
    width: ${CARD_WIDTH_MM}mm;
    height: ${CARD_HEIGHT_MM}mm;
    background: #fff;
    outline: 0.2mm solid #c8ccce;
    /* Colour management off: we want the literal values, not a "nicer" render. */
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }

  .marker, .patch, .channel, .label { position: absolute; }
  .marker svg { display: block; }
  .patch { outline: 0.15mm solid rgb(0 0 0 / 0.18); }

  .channel {
    background: ${css(STRIP_CHANNEL.nominal)};
    border-radius: 0.6mm;
  }
  .channel-caption {
    position: absolute;
    left: ${STRIP_CHANNEL.startX}mm;
    top: ${channelTop + STRIP_CHANNEL.widthMm + 1.5}mm;
    font-size: 3mm;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #6b776e;
  }

  .title {
    position: absolute;
    left: ${STRIP_CHANNEL.startX}mm;
    top: 27mm;
    font-size: 4.4mm;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .subtitle {
    position: absolute;
    left: ${STRIP_CHANNEL.startX}mm;
    top: 33mm;
    font-size: 3mm;
    color: #6b776e;
    max-width: 84mm;
    line-height: 1.5;
  }

  .notes {
    margin-top: 8mm;
    max-width: ${CARD_WIDTH_MM}mm;
    font-size: 3.4mm;
    line-height: 1.6;
    color: #3d4a41;
  }
  .notes h2 {
    font-size: 3.6mm;
    margin: 0 0 2mm;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #6b776e;
  }
  .notes ol { margin: 0; padding-left: 5mm; }
  .notes li { margin-bottom: 1.5mm; }

  @media print {
    html { background: #fff; }
    .sheet { padding: 0; }
    .notes { page-break-inside: avoid; }
  }
</style>

<div class="sheet">
  <div class="card">
${markers}
${patches}
      <div class="channel" style="left:${STRIP_CHANNEL.startX}mm; top:${channelTop}mm; width:${channelWidth}mm; height:${STRIP_CHANNEL.widthMm}mm;"></div>
      <div class="channel-caption">Lay the dipped strip here</div>
      <div class="title">StripLab reference card</div>
      <div class="subtitle">
        Print at 100% scale on matte paper. Do not resize, and do not laminate
        with a gloss finish &mdash; both throw highlights across the patches.
      </div>
  </div>

  <div class="notes">
    <h2>How to use</h2>
    <ol>
      <li>Print this page at <strong>100% scale</strong>. Check the card measures
          ${CARD_WIDTH_MM}&nbsp;&times;&nbsp;${CARD_HEIGHT_MM}&nbsp;mm with a ruler before you rely on it.</li>
      <li>Dip a test strip per its instructions and shake off the excess.</li>
      <li>Lay the strip flat in the slate channel, pads facing up.</li>
      <li>Photograph the whole card straight on, in even light. Avoid direct
          sun and turn the flash off &mdash; a blown-out patch is unrecoverable.</li>
    </ol>
    <h2>Why the channel is slate, not white</h2>
    <p style="margin:0;">
      Reagent pads start out near-white at zero concentration. If the channel
      were white too, a photo with no strip in it would look identical to a
      strip reading zero, and the app would report a clean result for a test
      that never happened. The slate lets it tell the difference and refuse.
    </p>
  </div>
</div>
`;
}

const outDir = join(process.cwd(), "out");
await mkdir(outDir, { recursive: true });
const target = join(outDir, "card.html");
await writeFile(target, buildHtml(), "utf8");
console.log(`Reference card written to ${target}`);
console.log("Open it in a browser and print at 100% scale.");
