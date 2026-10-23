# Flexion

Your hand therapist's eyes at home. Alexa leads a two-minute hand check by voice while a plain webcam measures how far each finger curls. A reading only counts as real change when it leaves the noise band (MDC95), and the routine only moves inside the limits the therapist wrote. Each week the therapist gets a one-page PDF.

A measurement aid, not a diagnosis.

Built for the Build, Ship, Shape: Amazon Developer Hackathon (Alexa+ track).

- Site: https://main.d171bf7qqki4nj.amplifyapp.com/
- MCP endpoint (Streamable HTTP): https://ajsz3ao7tetyacjcyputpsz2mm0edogp.lambda-url.us-east-1.on.aws/mcp
- Echo Show host simulator: https://ajsz3ao7tetyacjcyputpsz2mm0edogp.lambda-url.us-east-1.on.aws/host/index.html

## What's here

| Folder | What it is |
|---|---|
| `server/` | The MCP server (Node ≥ 22.18, MCP SDK v2, Streamable HTTP). Tools `start_hand_check`, `get_progress`, `weekly_report`, the app-only `save_session`, and the coach view as an MCP App (`ui://flexion/coach.html`). |
| `server/app/` | The coach view: MediaPipe hand tracking in the browser, a voice-led session, the results card. Nothing from the camera leaves the device. |
| `server/host/` | An Echo Show host simulator: voice or text in, MCP calls, the MCP App in a sandboxed frame, a log of every message. |
| `server/src/store.js` | Sessions, routines and reports on DynamoDB + S3 when `FLEXION_TABLE` and `FLEXION_BUCKET` are set, local JSON files otherwise. |
| `site/` | The public site (Vite, three.js, GSAP, Lenis), including a live in-browser demo of the same camera engine. |
| `spike/day1/` | The day-one measurement spike and its raw validation runs (`data/*.csv`, numbers only). |

## Run it locally

```bash
cd server && npm install && npm test && npm start
```

Then open http://127.0.0.1:3001/ for the Echo Show simulator (tick "Scripted hand" to run without a camera), or http://127.0.0.1:3001/app/index.html for the coach on its own (real camera, Chrome).

```bash
cd site && npm install && npm test && npm run dev
```

## Deploy (AWS)

`server/scripts/deploy.mjs` creates or updates everything with the AWS CLI: a DynamoDB table and an S3 bucket for the store, the server on Lambda behind a public Function URL (AWS Lambda Web Adapter; an EventBridge ping every 4 minutes keeps it warm, since a cold start takes ~2 s of Alexa's 3 s budget), the site on AWS Amplify Hosting, and a $10/month budget alarm. Run without `--yes` it only prints the plan.

```bash
cd server && node scripts/deploy.mjs --yes
```

## How the numbers are measured

See the site's method page (`site/method.html`): the fist reading, the form guards, the noise band and its limits, with the validation run they come from.

## Licence

Apache-2.0 (see `LICENSE`). The bundled fonts (Anybody, Atkinson Hyperlegible Next and Mono) are under the SIL Open Font License; their licence texts sit next to the font files.
