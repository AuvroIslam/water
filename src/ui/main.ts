/**
 * StripLab shell.
 *
 * Deliberately thin: the camera feeds frames in, the pipeline does the work,
 * and this file only decides what to show. Everything worth testing lives in
 * src/core, which is why it can be tested without a browser.
 */

import { readStrip, type PipelineResult } from "../core/pipeline.ts";
import { detectMarkers } from "../core/markers.ts";
import { CORNER_MARKER_IDS } from "../card/card.ts";
import { labToCss } from "../core/colorimetry.ts";
import { DEMO_STRIP } from "../strips/demo.ts";
import type { Reading } from "../core/types.ts";

type ScreenName = "intro" | "capture" | "result" | "failure";

const screens = new Map<ScreenName, HTMLElement>();
for (const el of document.querySelectorAll<HTMLElement>("[data-screen]")) {
  screens.set(el.dataset.screen as ScreenName, el);
}

const el = <T extends HTMLElement>(name: string): T => {
  const found = document.querySelector<T>(`[data-el="${name}"]`);
  if (!found) throw new Error(`missing element: ${name}`);
  return found;
};

const video = el<HTMLVideoElement>("video");
const overlay = el<HTMLCanvasElement>("overlay");
const hint = el<HTMLDivElement>("hint");
const markerCount = el<HTMLSpanElement>("markerCount");

const shutter = document.querySelector<HTMLButtonElement>('[data-action="shoot"]')!;

/** Offscreen buffer the pipeline actually reads from. */
const frame = document.createElement("canvas");
const frameCtx = frame.getContext("2d", { willReadFrequently: true })!;

let stream: MediaStream | null = null;
let previewTimer: number | null = null;

function show(name: ScreenName): void {
  for (const [key, node] of screens) node.hidden = key !== name;
}

/* ── Camera ──────────────────────────────────────────────────────────────── */

async function startCamera(): Promise<void> {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    });
  } catch (error) {
    showFailure(
      "Camera unavailable",
      "StripLab needs camera access to read a strip. You can also open a photo instead.",
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  video.srcObject = stream;
  await video.play();
  show("capture");
  startPreview();
}

function stopCamera(): void {
  if (previewTimer !== null) {
    clearInterval(previewTimer);
    previewTimer = null;
  }
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  video.srcObject = null;
}

/** Draw the current video frame into the offscreen buffer at native size. */
function grabFrame(): ImageData | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  frame.width = width;
  frame.height = height;
  frameCtx.drawImage(video, 0, 0, width, height);
  return frameCtx.getImageData(0, 0, width, height);
}

/**
 * Live alignment feedback.
 *
 * Only marker detection runs here, not the full read — it is cheap enough for
 * a few frames a second and it is the only thing the person needs to know
 * before they press the shutter: is the whole card in frame?
 */
function startPreview(): void {
  const ctx = overlay.getContext("2d")!;

  previewTimer = window.setInterval(() => {
    const image = grabFrame();
    if (!image) return;

    overlay.width = image.width;
    overlay.height = image.height;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    let found: ReturnType<typeof detectMarkers> = [];
    try {
      found = detectMarkers(image);
    } catch {
      // A detector hiccup on one frame is not worth interrupting preview for.
      return;
    }

    const wanted = new Set<number>(CORNER_MARKER_IDS);
    const seen = found.filter((m) => wanted.has(m.id));
    const ready = seen.length === CORNER_MARKER_IDS.length;

    ctx.lineWidth = Math.max(2, image.width / 320);
    ctx.strokeStyle = ready ? "#6fbb8b" : "#e6b25c";
    for (const marker of seen) {
      ctx.beginPath();
      marker.corners.forEach((c, i) =>
        i === 0 ? ctx.moveTo(c.x, c.y) : ctx.lineTo(c.x, c.y),
      );
      ctx.closePath();
      ctx.stroke();
    }

    // Join the corners so a partly-visible card reads as a partly-drawn box.
    if (ready) {
      const byId = new Map(seen.map((m) => [m.id, m.centre]));
      ctx.beginPath();
      CORNER_MARKER_IDS.forEach((id, i) => {
        const p = byId.get(id)!;
        i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
      ctx.stroke();
    }

    hint.textContent = ready
      ? "Card found — hold steady and shoot"
      : `Fit the whole card in frame (${seen.length} of 4 corners)`;
    hint.dataset.ready = String(ready);
    markerCount.textContent = `${seen.length}/4`;
    shutter.disabled = !ready;
  }, 350);
}

/* ── Reading ─────────────────────────────────────────────────────────────── */

function runRead(image: ImageData): void {
  let result: PipelineResult;
  try {
    result = readStrip(image, DEMO_STRIP);
  } catch (error) {
    showFailure(
      "Something went wrong",
      "The reader crashed on that image. Please try another photo.",
      error instanceof Error ? error.message : String(error),
    );
    return;
  }

  if (!result.ok) {
    showFailure(
      titleForFailure(result.reason),
      result.message,
      `${result.reason} · markers seen: ${result.markersFound.join(", ") || "none"}`,
    );
    return;
  }

  renderReadings(result);
}

function titleForFailure(reason: string): string {
  switch (reason) {
    case "card-not-found":
      return "Card not in frame";
    case "card-too-small":
      return "Too far away";
    case "card-geometry-degenerate":
      return "Card looks distorted";
    case "patches-unreadable":
      return "Lighting is too harsh";
    case "strip-missing":
      return "No strip in the channel";
    default:
      return "Could not read that";
  }
}

function formatValue(reading: Reading): string {
  if (reading.value === null) return "not readable";
  const decimals = reading.value >= 10 ? 0 : reading.value >= 1 ? 1 : 2;
  return `${reading.value.toFixed(decimals)}${reading.unit ? ` ${reading.unit}` : ""}`;
}

function renderReadings(result: Extract<PipelineResult, { ok: true }>): void {
  const list = el<HTMLDivElement>("readings");
  list.replaceChildren();

  for (const reading of result.readings) {
    const row = document.createElement("div");
    row.className = "reading";
    row.dataset.state =
      reading.value === null ? "unknown" : reading.exceedsLimit ? "over" : "ok";

    const label = document.createElement("div");
    label.className = "reading-label";
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = labToCss(reading.lab);
    label.append(swatch, document.createTextNode(reading.label));

    const value = document.createElement("div");
    value.className = "reading-value";
    value.textContent = formatValue(reading);

    const note = document.createElement("div");
    note.className = "reading-note";
    if (reading.value === null) {
      note.textContent = "Colour did not match this ramp — retake in even light.";
    } else if (reading.exceedsLimit) {
      note.textContent = "Above the regulatory limit. Confirm with a certified lab.";
    } else if (reading.range) {
      note.textContent = `Between the ${reading.range[0]} and ${reading.range[1]} reference swatches.`;
    }

    const confidence = document.createElement("div");
    confidence.className = "reading-conf";
    confidence.dataset.level = reading.confidence;
    confidence.textContent = `${reading.confidence} · ΔE ${reading.deltaE.toFixed(1)}`;

    row.append(label, value, note, confidence);
    list.append(row);
  }

  el<HTMLParagraphElement>("resultMeta").textContent =
    `${result.diagnostics.pixelsPerMm.toFixed(1)} px/mm · ` +
    `${result.correction.kind} correction · ` +
    `residual ${result.correction.residual.toFixed(4)}`;

  el<HTMLSpanElement>("resultEyebrow").textContent = DEMO_STRIP.brand;
  show("result");
}

function showFailure(title: string, message: string, detail = ""): void {
  el<HTMLHeadingElement>("failureTitle").textContent = title;
  el<HTMLParagraphElement>("failureMessage").textContent = message;
  el<HTMLParagraphElement>("failureDetail").textContent = detail;
  show("failure");
}

/* ── Wiring ──────────────────────────────────────────────────────────────── */

document.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target) return;

  switch (target.dataset.action) {
    case "start-camera":
      void startCamera();
      break;

    case "shoot": {
      const image = grabFrame();
      stopCamera();
      if (image) runRead(image);
      else showFailure("No frame", "The camera did not produce an image. Try again.");
      break;
    }

    case "back":
      stopCamera();
      show("intro");
      break;

    case "again":
      show("intro");
      break;
  }
});

document
  .querySelector<HTMLInputElement>('[data-action="pick-file"]')!
  .addEventListener("change", async (event) => {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    const bitmap = await createImageBitmap(file);
    frame.width = bitmap.width;
    frame.height = bitmap.height;
    frameCtx.drawImage(bitmap, 0, 0);
    bitmap.close();

    runRead(frameCtx.getImageData(0, 0, frame.width, frame.height));
    (event.target as HTMLInputElement).value = "";
  });

show("intro");
