# StripLab

**Calibrated water quality readings from a $0.40 test strip and a phone camera.**

A test strip costs 40 cents and gives an answer in 60 seconds — but you have to
squint at a colour chart under your kitchen light and guess, and that guess is
wrong often enough that nobody trusts it. StripLab replaces the guess with a
measurement: photograph the strip on a printed reference card, and the app
corrects for whatever your camera and your lighting did before reading the pads
against a calibrated ramp.

No hardware. No lab. Runs entirely in the browser.

---

## Quick start

```bash
npm install
npm run card     # writes out/card.html — print it at 100% scale
npm run dev      # http://localhost:5173
npm test         # 64 tests, no browser needed
```

`getUserMedia` needs a secure context. `localhost` counts; a LAN IP does not, so
to test on a phone use a tunnel (`npx localtunnel --port 5173` or similar)
rather than `http://192.168.x.x`.

---

## How it works

```
photo ─▶ ArUco corners ─▶ homography ─▶ patch sampling ─▶ 3×3 correction
                                                              │
        readings ◀── ΔE2000 interpolation ◀── CIELAB ◀────────┘
```

1. **Find the card.** Four ArUco markers give four point correspondences.
2. **Solve the projection.** A 4-point homography maps card millimetres to image
   pixels. We never warp the image — we only need ~20 known locations, so we
   project points on demand. That is what lets this ship without OpenCV.js
   (85 KB of JS instead of ~8 MB).
3. **Correct the camera.** The card's 12 reference patches are photographed
   under the same light as the strip, so fitting them back onto their known
   values undoes the illuminant. Fitting happens in **linear light**, because a
   correction matrix models illuminant and sensor crosstalk and both are linear
   in radiance.
4. **Read the pads.** Median-sample each pad, convert to CIELAB, and interpolate
   concentration between the two nearest ramp swatches by inverse ΔE2000.

That last step is what beats a person. A human snaps to the nearest printed
swatch — "somewhere between 20 and 50, call it 20". StripLab returns 31.4 mg/L.

### Honest limits

This is a **screening tool, not a laboratory**. It tells you whether to worry and
whether to pay for a real test. The ramp values currently in
[`src/strips/demo.ts`](src/strips/demo.ts) are **placeholders** — plausible, not
measured — and are clearly marked as such. Real ramps come from the calibration
flow described below.

---

## Two design decisions worth reading

### The channel is printed slate, not white

Reagent pads start out near-white at zero concentration. With a white channel, a
photo taken with **no strip in it** looked identical to a strip reading zero, and
the pipeline reported a confident `nitrate 0.24 mg/L` for a test nobody
performed. On a water safety tool, a false all-clear is the worst possible
failure.

Printing the channel a saturated mid-slate — far from white and far from every
reagent hue — makes an empty channel directly detectable, and the app refuses
instead. See `tests/pipeline.test.ts`, "refuses outright when no strip is in the
channel".

### Printer error cancels, so it does not matter

The card's patch values are what we *send* to the printer, not what the printer
lays down. That bias cancels: an analyte's reference ramp is captured through
the same card and the same pipeline during brand calibration, so both sides of
every later comparison carry the identical bias. Absolute colour accuracy is not
required — only that calibration and measurement agree.

---

## The D50 trap

culori's `lab` mode is **D50**-referenced, per CSS Color Level 4. sRGB is
D65-native. Passing raw sRGB-derived Lab values to a `lab` converter silently
chromatic-adapts them and skews every ΔE by up to ~10% — on a colour ramp, the
difference between 8 mg/L and 15 mg/L of nitrate.

Everything here uses `lab65`. `src/core/colorimetry.ts` is the only module
allowed to touch culori directly, and `tests/deps.test.ts` pins the behaviour
against the Sharma, Wu & Dalal (2005) CIEDE2000 conformance set — including a
test that fails loudly if anyone "simplifies" it back to `lab`.

---

## Testing without a strip, a printer, or a phone

`tests/helpers/syntheticCard.ts` renders photographs of a card that never
existed: known patch colours, a known strip, an arbitrary viewing angle and an
arbitrary camera colour cast. Because the true concentrations are chosen going
in, there is a right answer to check against.

That makes the headline claim testable in CI:

> **corrected readings agree across four illuminants; raw pad colours do not.**

Same experiment as the real-world validation planned for build days 5–6, run
against simulated daylight, tungsten, LED and shade instead of a kitchen, a
window and a desk lamp.

---

## Layout

```
src/
  core/         colour engine — no DOM, fully unit tested
    homography.ts    4-point DLT, projection, scale estimation
    sample.ts        median disc sampling, clipping detection
    colorimetry.ts   sRGB ↔ linear ↔ CIELAB(D65), ΔE2000
    colorCorrect.ts  diagonal and full 3×3 fits in linear light
    ramp.ts          swatch interpolation, confidence bands
    markers.ts       ArUco detection
    pipeline.ts      the full read, and every refusal path
  card/card.ts   card geometry in mm — one source for artwork and sampling
  strips/        strip specifications (ramps, pad positions, limits)
  ui/            camera, overlay, results
tools/
  generate-card.ts   writes the printable card
tests/           64 tests, all headless
```

---

## Credits

Built on prior work, deliberately:

- **[js-aruco2](https://github.com/damianofalcioni/js-aruco2)** (MIT) — marker
  detection and marker SVG generation
- **[culori](https://culorijs.org/)** — CIELAB and CIEDE2000
- **[Huntler/AquariumTestStripAnalyzer](https://github.com/Huntler/AquariumTestStripAnalyzer)**
  — read for architecture, in particular the JSON reference-table pattern.
  ⚠️ That repo ships no licence, so no code was copied from it.
- **[zyfccc, IEEE Sensors 2019](https://github.com/zyfccc/Smartphone-Modulated-Colorimetric-Reader-with-Color-Subtraction-IEEE-Sensors-2019)**
  — colour-subtraction reader, plus test image datasets
- **[PyImageSearch, automatic colour correction](https://pyimagesearch.com/2021/02/15/automatic-color-correction-with-opencv-and-python/)**
  — the colour-card correction walkthrough
- **[Saaf Water](https://developer.ibm.com/callforcode/solutions/saaf-water/)**,
  Call for Code 2021 global winner — the prior art this project deliberately
  diverges from, by deleting the hardware
- Method papers:
  [ACS Omega, single-image-referenced colorimetry](https://pubs.acs.org/doi/10.1021/acsomega.8b00625) ·
  [PLOS One, device-independent smartphone colorimetry](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0230561)

Thresholds are US EPA MCLs and secondary standards. Verify at epa.gov before
quoting any of them.
