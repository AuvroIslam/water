# Test-Strip Water Lab — build plan

**A $10 drugstore test strip + a phone camera = a calibrated water quality reading, mapped.**

NextStep Hacks 2026 · Earth Forward
Deadline: 13 Sept 2026, 21:00 UTC · 11 days from 2 Sept

> **Build philosophy: assemble, don't invent.** Every hard part of this project has been solved by someone and published. Your 11 days go into the *integration*, the *validation*, and the *interface* — not into reimplementing CIEDE2000. §3 is the parts list. Read it before you write a line of code.

---

## 1. The pitch, in the form judges will hear it

> 1 in 4 people worldwide drink water that isn't safely managed, and in the US alone millions of private wells are never tested because a lab panel costs $150 and takes two weeks. A test strip costs 40 cents and gives an answer in 60 seconds — but you have to squint at a colour chart under your kitchen light and guess, and that guess is wrong often enough that nobody trusts it.
>
> We turned the guess into a measurement. Dip the strip, photograph it next to the chart it came with, and our colour-science pipeline returns calibrated concentrations with an honest confidence score — then pins them to a public map of your watershed. No hardware. No lab. Forty cents.

Fifteen seconds, and every judge understands it immediately.

---

## 2. Why this wins — mapped to the rubric

| Criterion | How this scores |
|---|---|
| **Originality** | The prior art (Saaf Water, Call for Code 2021 global winner, $200k) built **custom IoT hardware** — Arduino, sensors, NeoPixel. You delete the hardware and move the difficulty into colour science. Different project, not a reskin — and you can say so out loud, which is what the criterion rewards. |
| **Adherence to Track** | Water conservation and pollution are named domains. A public watershed map is *community* environmental data — the second half of what the theme asks for. |
| **Completion** | Every hard component already exists as a library (§3). Nothing depends on hardware arriving or a model training. |
| **Learning** | Almost nobody on a student team has done camera colour calibration, CIE Lab, or ΔE2000. Say that on the Devpost page — free points, and true. |
| **Design** | Camera app with a live guide overlay, a result card with real units, a map. The lab / field-notebook visual language writes itself. |
| **Technology** | Colour correction + ΔE2000 interpolation is a non-trivial claim with a **verifiable right answer**. You can prove accuracy on camera. That is the "clever technique" wording, literally. |

**The proof point that makes the demo work:** you can verify your own accuracy live. Dip strips in solutions you mix to known concentrations, and plot predicted vs. actual. A scatter plot with an R² on it, on screen, beats any amount of UI polish.

---

## 3. What already exists — the parts list

This is the most important section in the document. **Read every repo before you build.**

### 3.1 Projects that solved exactly this problem

| Project | What it gives you | License note |
|---|---|---|
| **[Huntler/AquariumTestStripAnalyzer](https://github.com/Huntler/AquariumTestStripAnalyzer)** | The closest prior art. Python + Swift. Full pipeline: noise reduction → threshold → morphology → edge/contour detection → strip isolation → histogram equalisation → white balance → per-pad mean colour → lookup against a **JSON reference table**. Built for the 9-in-1 Amazon strips. | ⚠️ **No license file.** No licence = all rights reserved. **Read it, learn the architecture, do not copy the code.** Reimplement what you learn. |
| **[zyfccc/Smartphone-Modulated-Colorimetric-Reader](https://github.com/zyfccc/Smartphone-Modulated-Colorimetric-Reader-with-Color-Subtraction-IEEE-Sensors-2019)** | Peer-reviewed (IEEE Sensors 2019). Source, **image datasets**, and 3D models. Colour-subtraction algorithm that removes interference from coloured sample solutions. The datasets alone are worth the visit — free test images before your strips arrive. | Check repo |
| **[mad-lab-fau/SMARTurinalysis](https://github.com/mad-lab-fau/SMARTurinalysis)** | Same problem shape (urine strips, medical). Academic lab quality. Useful for how they handle pad segmentation and validation methodology. | Check repo |
| **[Open-Source Mobile Water Quality Testing Platform](https://www.hackster.io/MOST/open-source-mobile-water-quality-testing-platform-dafd26)** | Michigan Tech open-source colorimeter, 3D-printable. Not your approach (it's hardware), but their **reference tables and validation method** are directly reusable. | Open source |

**The single most useful thing in all of these is the JSON reference table format.** Huntler's `Data/reference/default.json` maps swatch colours → concentrations for a 9-in-1 strip. Copy that *pattern* (a JSON schema per strip brand), not the file. It makes your app strip-agnostic for free, which is a stretch goal you get almost by accident.

### 3.2 The colour science — do not write this yourself

| Library | Use it for | Why |
|---|---|---|
| **[colour-science/colour](https://github.com/colour-science/colour)** | Python: `colour_correction()`, Lab conversions, ΔE2000. | BSD-3. The reference implementation. Use for your Python prototype and validation notebook. |
| **[colour-science/colour-checker-detection](https://github.com/colour-science/colour-checker-detection)** | Automatic colour-checker detection if you use a real ColorChecker card | Saves a day if you have one |
| **[culori](https://culorijs.org/)** (JS) | **`differenceCiede2000()`**, sRGB→Lab, all of CSS Color Level 4. Tree-shakeable. | v4.0.2, mature, tiny. This is your entire colour maths layer in the browser. |
| **[js-aruco2](https://github.com/damianofalcioni/js-aruco2)** | Pure-JS ArUco marker detection, 100% client-side, **no OpenCV** | The build-time win of the whole project — see §3.3 |
| **[dazzafact/image_color_correction](https://github.com/dazzafact/image_color_correction)** | Working reference: ArUco colour card → white balance with cv2 | Read this to understand the flow |
| **[PyImageSearch — Automatic colour correction with OpenCV](https://pyimagesearch.com/2021/02/15/automatic-color-correction-with-opencv-and-python/)** | The tutorial. Colour card detection + histogram matching, step by step. | **Start here on day 1.** |

### 3.3 The engineering insight that saves you two days

The obvious plan is "load OpenCV.js in the browser." OpenCV.js is ~8 MB, has awkward manual memory management (`.delete()` on every `cv.Mat`), and will eat a full day.

**You don't need it.** Here's why:

You are not warping an image. You are sampling **about twenty small circles**. So:

1. **js-aruco2** finds the four card corners — pure JS, tiny, client-side.
2. Compute a **4-point homography** from those corners (a 40-line DLT, or the `perspective-transform` npm package).
3. For each swatch and each strip pad, you know its position *on the card*. Inverse-map that point through the homography to source-image pixel coordinates.
4. Sample a small disc around it from a `<canvas>` `getImageData()` and take the **median** (median, not mean — kills specular highlights and edge bleed).
5. **culori** converts to Lab and runs ΔE2000.

No OpenCV, no 8 MB download, no `Mat` leaks, works offline, and the whole colour engine is a few hundred lines. Keep the Python + `colour` notebook as your ground truth to check the JS against.

### 3.4 Data you can pull instead of collecting

| Source | What | Access |
|---|---|---|
| **[Water Quality Portal](https://www.waterqualitydata.us/)** (USGS + EPA) | **430M+ records from 1,000+ agencies.** Real lab measurements, by location. | Free [web services](https://www.waterqualitydata.us/webservices_documentation/), no key |
| **[USGS Water Data APIs](https://api.waterdata.usgs.gov/)** | Samples API, discrete water quality observations | Free, documented |
| **EPA SDWIS / Envirofacts** | Public water system violations by ZIP | Free |

**This kills your cold-start problem.** Your map is not empty on day one — it opens with real agency data, and *your* readings layer on top of it in the gaps where no agency samples (private wells, farm ponds, the creek behind the school). That gap **is your argument**: 430 million records exist, and none of them are from anyone's kitchen tap.

Even better: **use WQP as free validation.** Pull the official nitrate readings for a monitored stream near you, sample the same stream with your app, and compare. That's an external accuracy check you didn't have to run a lab for, and it is *very* convincing on camera.

### 3.5 Platforms that already exist — know them, and say what's missing

| Platform | What it does | The gap you fill |
|---|---|---|
| **[CrowdWater](https://www.spotteron.app/apps/crowdwater-app)** (Univ. Zurich / SPOTTERON) | Crowdsourced water level, streamflow, soil moisture. Live since 2017. | **Physical observations, not chemistry.** No contaminant measurement. |
| **EarthEcho Water Challenge** | Global student monitoring with simple kits; results submitted to a shared database | Users **read the strips by eye** and type in a number. That eyeballed number is exactly what you replace. |
| **FreshWater Watch, EyeOnWater, SmartPhones4Water** | Various citizen-science water apps | Same pattern: collection UI, human colour reading |
| **[Saaf Water](https://developer.ibm.com/callforcode/solutions/saaf-water/)** | Call for Code 2021 winner. IoT sensors + scikit-learn + Arduino. Open sourced with Linux Foundation support. | **Requires hardware.** Doesn't scale to someone who owns a phone and nothing else. |

State this in the video, in one sentence: *"Citizen water monitoring platforms exist and they work — but every one of them either needs hardware, or asks a human to eyeball a colour chart. We replaced the eyeball."*

That sentence answers the Originality criterion better than any feature list.

---

## 4. The actual technical problem

Phone cameras don't measure colour, they *interpret* it. The same pad under tungsten, overcast sky, and bathroom LED gives three completely different RGB triples, because auto white balance, auto exposure, and the vendor's colour pipeline all move underneath you. That's why "eyeball it against the chart" is the industry standard, and why it's unreliable.

**The insight that solves it:** don't measure absolute colour. Photograph the strip **and the reference chart in the same frame, under the same light**. Every error the camera introduces applies equally to both, so you only need *relative* matching. This is the "single-image-referenced" approach from the literature — it turns an impossible problem into a tractable one.

### The pipeline

**Step 1 — Capture.** Live camera view with a guide frame. Require strip + card in one shot. Reject the frame if:
- highlights clipped (any channel > 250 over >1% of the guide area)
- too dark (median luma < 40)
- motion blur (Laplacian variance below threshold)

Refusing a bad photo is a *feature*. Say so in the demo.

**Step 2 — Find the card.** Print your own card: four ArUco markers at the corners, neutral patches (white, three greys, black), and the swatch ramps inside. `js-aruco2` finds the markers, you get the homography. Matte paper, laminated or in a plastic sleeve.

**Step 3 — Colour-correct.** From the neutral patches, solve a 3×3 correction matrix by least squares:

```
minimize || M · RGB_measured − RGB_reference ||²
```

One line with `numpy.linalg.lstsq` in the notebook; a small hand-rolled solve in JS (3×3 — it's fine). Apply `M`, convert to **CIE Lab** — Lab is perceptually uniform, so distance in Lab actually means "these look different", which sRGB distance does not.

**Step 4 — Match and interpolate.** Per pad, take the median Lab over the central 60%. Then per analyte:

1. ΔE2000 from the pad to every swatch on that analyte's ramp (`culori`)
2. Find the two lowest-ΔE swatches
3. **Interpolate concentration between them, weighted by inverse ΔE**

Step 3 is the part that beats a human. A person snaps to the nearest swatch — "somewhere between 20 and 50, call it 20." You return 31.4 mg/L. **This is your headline technical claim.**

**Step 5 — Report confidence honestly.**

| min ΔE | Meaning | UI |
|---|---|---|
| < 5 | Confident | Green, show the number |
| 5–12 | Usable, wider band | Amber, show a range |
| > 12 | Don't trust it | Red, "retake in better light" |

An app that says "I'm not sure" impresses a judge more than one that always answers — and it protects you if a live demo goes sideways.

---

## 5. What to measure

Buy a 16-in-1 well/drinking-water strip (Varify, SJ Wave, JNW Direct — under $15, 2-day shipping). Build the UI around the four that carry a story:

| Analyte | Threshold | Why it matters |
|---|---|---|
| **Nitrate (as N)** | **10 mg/L** — EPA MCL | Agricultural runoff. Causes methemoglobinemia in infants. *The* private-well contaminant and the best story on the strip. |
| **pH** | 6.5–8.5 — EPA secondary | Low pH leaches lead and copper from old plumbing. So pH is indirectly a lead-risk signal — a non-obvious inference worth surfacing. |
| **Total hardness** | No health limit | Validates your pipeline against a value locals can independently check. |
| **Free / total chlorine** | 4 mg/L max residual | Zero chlorine in municipal tap = possible distribution problem. |
| **Nitrite** | 1 mg/L MCL | Pairs with nitrate; indicates *recent* contamination. |

Lead and arsenic strips exist (~$20 separately) but **be honest in the UI and the video**: consumer lead strips are screening-grade at best. "Our nitrate numbers are good, our lead numbers are a screen, here's why" marks a serious team.

### The honesty section — put this in the app *and* the video

> This is a screening tool, not a laboratory. It tells you whether to worry and whether to pay for a real test. It does not replace a certified lab panel.

Judges have seen a hundred teams overclaim. This paragraph will be remembered.

---

## 6. Architecture

```
┌──────────────────────────────────────────────────────────┐
│  PWA — mobile-first, installable, offline-capable        │
│  getUserMedia capture · guide overlay · quality gates    │
└───────────────────────┬──────────────────────────────────┘
                        │
        ┌───────────────┴───────────────┐
        │                               │
┌───────▼─────────────────┐   ┌─────────▼──────────────┐
│  Colour engine (client)  │   │  Supabase              │
│  js-aruco2  → corners    │   │  Postgres + PostGIS    │
│  homography → sample pts │   │  auth (anon ok)        │
│  3×3 CCM    → corrected  │   │  storage (opt-in pics) │
│  culori     → Lab, ΔE00  │   └─────────┬──────────────┘
│  interpolate→ mg/L + conf│             │
│  ~300 lines, no OpenCV   │   ┌─────────▼──────────────┐
└──────────────────────────┘   │  Map — MapLibre + H3   │
                               │  + Water Quality Portal│
                               │    layer (430M records)│
                               └────────────────────────┘
```

Running the vision **in the browser** means zero server cost, works offline in the field, and no privacy question about uploading photos of someone's kitchen. That last point is a real answer to a real judging question.

### Data model

```sql
create table readings (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  geom        geography(point, 4326) not null,  -- precise: stored
  h3_r8       text not null,                    -- coarse: displayed (~0.7 km)
  source_type text not null,        -- tap | private_well | stream | pond | spring
  analytes    jsonb not null,       -- {"nitrate_n":{"value":31.4,"unit":"mg/L","dE":3.1}}
  strip_brand text,
  photo_path  text,                 -- opt-in only
  device_hint text
);
```

**Privacy design worth calling out:** store the exact point (so a partner org can act), display only the H3 hex (so the public map never reveals "the well at 14 Elm Street is over the limit"). Put this in the video — it reads as *maturity*.

---

## 7. Eleven-day plan

Front-loaded risk, three full days for polish — which is where the rubric actually pays.

### Day 1 (Sept 2) — Order, read, spike

- [ ] **Order strips today.** 2-day shipping. 16-in-1 well kit + a nitrate-specific kit if budget allows. *Nothing else matters if these don't arrive.*
- [ ] **Read all four repos in §3.1.** Two hours, whole team. Write down what each does and what you'll take from it.
- [ ] Work through the [PyImageSearch colour correction tutorial](https://pyimagesearch.com/2021/02/15/automatic-color-correction-with-opencv-and-python/) end to end.
- [ ] Pull test images from the **zyfccc dataset** so you can develop before your strips arrive.
- [ ] Email your local partner (template §9). Send it today — replies take days.

### Day 2 (Sept 3) — Card + Python ground truth

- [ ] Design and print the ArUco reference card. `js-aruco2` can generate markers as SVG.
- [ ] Python notebook: photo → ArUco → homography → sample → CCM → Lab → ΔE2000 → number. Use `colour-science` for the maths.

**Gate:** end of day 2, a Python script reads one strip correctly. If not, simplify (§11).

### Days 3–4 (Sept 4–5) — Port to browser, build capture

- [ ] Port to JS with `js-aruco2` + `culori`. **Skip OpenCV.js entirely** (§3.3). Check every value against the Python notebook.
- [ ] Camera screen: guide overlay + the three quality gates.
- [ ] Result card: real units, thresholds, confidence band.

**Gate:** end of day 4 — phone → camera → number, on a real device.

### Days 5–6 (Sept 6–7) — Validation, the part that wins

- [ ] **Mix calibration standards.** Known masses of potassium nitrate in known volumes → ~1, 5, 10, 25, 50 mg/L nitrate-N. Kitchen scale, measuring jug, arithmetic.
- [ ] Plot predicted vs. actual. Compute R² and mean absolute error.
- [ ] **Photograph the same sample under 4 lighting conditions** (daylight, tungsten, LED, shade). Show corrected values cluster while raw RGB doesn't. **This chart is your single most valuable asset** — it proves the technical claim in three seconds.
- [ ] **Free external check:** pull WQP nitrate data for a monitored stream near you, sample the same stream, compare (§3.4).
- [ ] Tune the ΔE confidence thresholds against this data instead of guessing.

**Gate:** end of day 6 — two charts done: accuracy, and lighting-invariance.

### Days 7–8 (Sept 8–9) — Map, submit flow, real data

- [ ] Supabase schema, insert path, consent step.
- [ ] MapLibre with H3 hexes coloured by worst analyte vs. threshold. Click → summary, never an address.
- [ ] **Layer in Water Quality Portal data** so the map is populated from the first second.
- [ ] **Seed 20–40 of your own real readings** — your taps, neighbours', a creek, a pond, a school fountain. Judges can tell real data from fake instantly.

**Gate:** end of day 8 — feature-complete. **Stop adding things.**

### Days 9–10 (Sept 10–11) — Design pass and video

- [ ] **One full day on the interface.** Type pairing, real palette, empty/loading/error states, a landing page whose first sentence is the problem. Design is a sixth of the score and the cheapest sixth to buy.
- [ ] Script the video *before* filming (§8). Film in daylight. Record audio separately if you can — bad audio reads as "unfinished" more than bad video does.
- [ ] Deploy to Vercel or Netlify; use the XYZ domain if you get one.

### Day 11 (Sept 12) — Devpost, buffer, dry run

- [ ] Devpost page (§10). Two real hours. Most teams give it fifteen minutes and lose Learning and Originality there.
- [ ] README with the colour method written out, equations included, **and a credits section naming every repo and library you used.** Judges respect honest attribution; hiding it is the only way this becomes a problem.
- [ ] Full dry run: fresh browser, fresh phone, no cache.

**Sept 13 — submit by 15:00 UTC**, six hours early. Devpost gets slow and something always breaks.

---

## 8. Video beat sheet (5:00 max — aim for 3:30)

| Time | Beat |
|---|---|
| 0:00–0:20 | **Cold open, no logo.** Hands dip a strip into a glass. "This costs 40 cents and it's the only water test most people will ever run. Almost everyone reads it wrong." |
| 0:20–0:45 | The problem with a number: private wells are unregulated, lab panels cost $150, nitrate MCL is 10 mg/L, and you cannot tell 8 from 15 by eye. |
| 0:45–1:05 | **Name the prior art.** "Saaf Water won Call for Code with sensors. CrowdWater and EarthEcho have global citizen networks. Every one of them needs hardware, or asks a human to eyeball a colour chart. We replaced the eyeball." |
| 1:05–2:00 | **Live demo, one take.** Dip, photograph, result. Show the confidence band. Then deliberately shoot one in bad light and let the app refuse it. |
| 2:00–2:50 | **The technical claim.** 30 seconds on the colour problem, then the two charts — predicted vs. actual with R², and the four-lighting cluster. Don't rush; this is the Technology score. |
| 2:50–3:15 | The map: 430M agency records underneath, your readings in the gaps where nobody samples. The H3 privacy decision in one sentence. |
| 3:15–3:30 | Partner org's sentence if you got one. Then: "screening tool, not a lab." End. |

The money shot is the **four-lighting-conditions chart**. Decide that on day one and make that path bulletproof.

---

## 9. The local-org email — send it on day one

The theme statement explicitly asks you to collaborate with local organisations. Almost no team will. One reply turns "Adherence to Track" from a checkbox into a story.

**Who:** your state's volunteer water monitoring program, a Waterkeeper affiliate, a county extension office, a watershed council or land trust, a Trout Unlimited chapter, your district's facilities staff.

```
Subject: Student project — free smartphone water screening, would 10 minutes help us?

Hi [name],

I'm a student on a five-person team building a project for a hackathon
that ends 13 September. We've built a phone app that reads standard
water test strips using camera colour calibration, so you get a
calibrated nitrate/pH reading instead of eyeballing a colour chart.
It's free and needs no hardware.

Two questions, 10 minutes on a call or just by email:

1. Would something like this be useful to volunteers you already work
   with, or is strip accuracy too low to be worth it?
2. What contaminant do you most wish people around here would test for?

Happy to share what we build, and to credit you. If it's useful past
September we'll keep it running.

Thanks,
[name], [school]
```

Even a two-line "yes, nitrate, our volunteers hate the colour charts" is a quotable sentence for the video.

---

## 10. Devpost page checklist

Scored as much as the video. Most teams treat it as an afterthought.

- [ ] **Inspiration** — one specific, local, true fact. Not "water is important."
- [ ] **What it does** — three sentences, no jargon.
- [ ] **How we built it** — the colour pipeline with equations, charts as images, **and the credits list**.
- [ ] **Challenges** — the real ones. Auto white balance fighting you. Pad segmentation on a curled strip. What actually happened.
- [ ] **Accomplishments** — the R², stated plainly.
- [ ] **What we learned** — *scored criterion.* Name what was new: CIE Lab, ΔE2000, colour correction matrices, homographies, PostGIS, H3. "None of us had touched colour science before" earns points.
- [ ] **What's next** — strip-agnostic mode, partner pilot, lead validation.
- [ ] **Built with** — full tag list; Devpost surfaces projects by these.
- [ ] Repo public, README complete, live link working **from a phone on cell data**.
- [ ] The rules require stating what was built before vs. during the hackathon — **disclose every library and repo you drew on.** Using `culori` and `js-aruco2` is normal engineering; not saying so is the only thing that could hurt you.

---

## 11. Risks and what to cut

| Risk | Mitigation | If it happens |
|---|---|---|
| Strips don't arrive | Order **day one**, 2-day shipping | Develop on the zyfccc dataset; demo on printed swatches and say so |
| Browser port fights you | js-aruco2 + culori instead of OpenCV.js; keep Python as ground truth | Run the pipeline server-side in a Python endpoint. Costs the offline story, saves the project |
| Poor accuracy on some analyte | Test on **day 5**, not day 10 | Ship the two analytes that work, **say the others don't**. Honest scope beats broken breadth |
| Behind on day 8 | The gates exist to catch this | Cut in order: ① lead/arsenic, ② the map, ③ history/accounts. **Never cut the validation charts** — they're the score |

**Minimum version that still places:** one analyte (nitrate), one lighting-invariance chart, one clean result screen, no map. Complete, honest, technically real — and it beats an ambitious broken project on this rubric every time.

---

## 12. Team split for five

| Role | Owns |
|---|---|
| **Colour engine** | Day 1 repo reading, Python notebook, then the JS port. Hardest seat — strongest programmer, from day one. |
| **Frontend** | Capture UI, result card, quality gates, PWA shell |
| **Data + map** | Supabase, PostGIS, H3, MapLibre, WQP integration, seeding real readings |
| **Validation + design** | Mixes the standards, runs the lighting tests, produces the two charts, then owns the visual pass on days 9–10 |
| **Story** | Partner outreach day 1, Devpost copy, video script, filming, editing. **Full-time role, not a leftover.** |

---

## 13. Stretch ideas — only after day 8's gate

- **Strip-agnostic mode.** Photograph any brand's chart once; the app learns that brand's ramp into a JSON reference table (Huntler's pattern, §3.1). Turns a demo into a platform.
- **Trend over time.** The same tap sampled weekly is a stronger claim than one reading. Start sampling your own tap on day 2 so you have a real series by day 11.
- **WQP cross-validation as a live feature.** "There's an official monitoring station 2 km away — here's how your reading compares."
- **Offline queue.** Capture with no signal, sync later. Two hours with a service worker, and it answers "does this work where it's needed?"

---

## Sources and credits

**Reusable code and libraries**
- [Huntler/AquariumTestStripAnalyzer](https://github.com/Huntler/AquariumTestStripAnalyzer) — closest prior art (⚠️ unlicensed: read, don't copy)
- [zyfccc/Smartphone-Modulated-Colorimetric-Reader](https://github.com/zyfccc/Smartphone-Modulated-Colorimetric-Reader-with-Color-Subtraction-IEEE-Sensors-2019) — IEEE Sensors 2019, code + datasets
- [mad-lab-fau/SMARTurinalysis](https://github.com/mad-lab-fau/SMARTurinalysis) — academic colorimetric strip analysis
- [colour-science/colour](https://github.com/colour-science/colour) · [colour-checker-detection](https://github.com/colour-science/colour-checker-detection)
- [culori](https://culorijs.org/) — JS colour maths, `differenceCiede2000`
- [js-aruco2](https://github.com/damianofalcioni/js-aruco2) — pure-JS ArUco
- [dazzafact/image_color_correction](https://github.com/dazzafact/image_color_correction) — ArUco colour card reference
- [PyImageSearch — Automatic colour correction with OpenCV](https://pyimagesearch.com/2021/02/15/automatic-color-correction-with-opencv-and-python/)
- [Michigan Tech — Open-Source Mobile Water Quality Testing Platform](https://www.hackster.io/MOST/open-source-mobile-water-quality-testing-platform-dafd26)

**Data**
- [Water Quality Portal](https://www.waterqualitydata.us/) (USGS + EPA, 430M+ records) · [web services docs](https://www.waterqualitydata.us/webservices_documentation/)
- [USGS Water Data APIs](https://api.waterdata.usgs.gov/)

**Prior art and platforms**
- [Saaf Water](https://developer.ibm.com/callforcode/solutions/saaf-water/) — Call for Code 2021 global winner ([announcement](https://newsroom.ibm.com/2021-11-16-IBM-and-David-Clark-Cause-Crown-Saaf-Water-Winner-of-4th-Annual-Call-for-Code-Global-Challenge))
- [CrowdWater](https://www.spotteron.app/apps/crowdwater-app) — Univ. Zurich / SPOTTERON
- EarthEcho Water Challenge, FreshWater Watch, EyeOnWater, SmartPhones4Water

**Method papers**
- [ACS Omega — Single-Image-Referenced Colorimetric Water Quality Detection Using a Smartphone](https://pubs.acs.org/doi/10.1021/acsomega.8b00625)
- [PLOS One — Accurate device-independent colorimetric measurements using smartphones](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0230561)
- [Env. Monitoring & Assessment — Hybrid human–machine colorimetric methods](https://link.springer.com/article/10.1007/s10661-025-13983-x)

Thresholds cited are US EPA MCLs and secondary standards; verify at epa.gov before quoting on camera.
