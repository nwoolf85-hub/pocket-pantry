# Diet Dash (private, local-first PWA)

Personal nutrition tracker built for Neal. Logs food + drinks by serving and
timestamp, sums the full panel, shows the day and the week against your targets,
and tracks your 8-hour eating window. All data lives on your device
(localStorage). The only network calls are the food-search lookups you trigger.

## What it tracks
Calories, **sodium** (▼ cap), **protein** (▲ floor), added sugar (▼), fiber (▲),
total fat, saturated fat (▼), cholesterol (▼), potassium (monitored).

Defaults: sodium 1,500 mg (AHA ideal on BP meds), potassium set to "monitor"
not a floor (lisinopril can raise potassium). Confirm targets with Dr. Lee —
there's a note in Settings. Everything is editable.

## Use
- **Today** — running totals vs targets, your eating-window strip, the day's log.
  Tap the day label to jump back to today; ‹ › to review past days.
- **Add food** — search the Open Food Facts database (branded/packaged goods),
  pick from your pantry, or enter manually. First time you add a database food,
  **check the numbers against the physical label**, then it saves "verified".
- **Log** — pick servings (0.5×–3× or type any) and set the time. Timestamp
  defaults to now.
- **Week** — 7-day table (calories/sodium/protein) + daily averages vs target.
- **Pantry** — your ~40–60 HEB/Costco staples. Build once, tap to log forever.
- **Settings** — targets, eating window, export/import your data as JSON.

## Run locally
```
./run.sh          # http://localhost:8788, opens browser
./run.sh --lan    # also prints a URL to open on your phone (same Wi-Fi)
```

## Put it on your phone (full PWA)
iOS "Add to Home Screen" as a real installable app needs HTTPS. Easiest path,
matching your other PWAs, is a free static deploy:

```
npm i -g vercel        # once
vercel                 # from this folder; accept defaults -> gives an https URL
vercel --prod          # promote
```
Then open the URL in Safari → Share → **Add to Home Screen**. It launches
full-screen, works offline (app shell is cached), and stores your data on the
phone.

> Data is per-device. Use Settings → Export JSON to back up or move to another
> device (Import JSON there).

## Files
- `index.html`  app shell (Today / Week / Pantry / Settings + add sheet)
- `app.js`      all logic — state, aggregation, Open Food Facts lookup, editors
- `styles.css`  premium dark theme (navy/copper/gold/cream)
- `manifest.json`, `sw.js`  PWA install + offline shell
- `icons/`      app icons

## Match estimates to real products ("Did you mean?")
Settings → **Match to real products**, or the banner on the Pantry tab. Goes
item-by-item through anything still on an estimate, pulls real branded SKUs from
the USDA database (H-E-B is listed as "H E Butt Grocery Company"; Costco as
Kirkland / "Costco Companies Inc."), sorts the actual store brand to the top, and
lets you tap the right one — which adopts its label serving + nutrition and marks
the item verified. "Keep estimate" / "Skip" advance without changing anything.

> This needs your own USDA key (Settings) — the shared demo key is rate-limited to
> ~30 lookups/hour, not enough for the whole pantry. Free key, 1 minute:
> fdc.nal.usda.gov/api-key-signup

## Scan a barcode
Add food → **Scan a barcode**. Opens the camera, you line the UPC up in the box, and
it looks the product up on Open Food Facts and drops you into the confirm screen. Uses
the phone's native `BarcodeDetector` on Android/desktop Chrome and falls back to a
locally-vendored ZXing decoder on iOS Safari (`vendor/zxing.min.js` — no CDN, works
offline once cached). Reads UPC-A / UPC-E / EAN-13 / EAN-8 (grocery formats). Camera
access needs HTTPS, so it works on the deployed PWA and on localhost, but not over a
plain `--lan` IP. If a scan finds no match, it opens a manual entry prefilled with the
barcode.

## Roadmap (next)
1. Meal presets ("my usual breakfast" = one tap).
2. Optional: torch/flashlight toggle for dark aisles.
