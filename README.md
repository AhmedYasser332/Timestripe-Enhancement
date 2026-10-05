# Timestripe Enhancement (MV3)

Browser extension enhancing timestripe.com with Projects, unlimited colors, multi-select
bulk actions, smart duplicate and templates. Full spec: `timestripe_extension_mvp_prd.md`.

## Stack

- Manifest V3, TypeScript + React
- Vite + [@crxjs/vite-plugin](https://crxjs.dev) (HMR for popup and content scripts)
- All writes go through the official Timestripe API (`https://timestripe.com/api/v3/`) from
  the service worker — the content script only reads the DOM and injects UI.

## Development

```bash
npm install
npm run build   # type-check + production build → dist/
npm run dev     # live-reload dev server — use this while iterating
```

### Live-reload workflow (no more delete/re-add)

Run `npm run dev` and keep it running, then load `dist/` as unpacked **once**. From then on:

- popup edits apply instantly (HMR),
- content-script edits auto-reload the page,
- service-worker edits auto-reload the extension.

If you ever switch back to a production check: `npm run build`, then hit the circular
reload arrow on the extension card in `edge://extensions` (never delete/re-add) and
refresh the timestripe tab once so the content script re-injects.

## Load unpacked (Edge)

1. Build (`npm run build`).
2. Open `edge://extensions` → enable **Developer mode**.
3. **Load unpacked** → select the `dist/` folder.
4. Open [timestripe.com](https://timestripe.com), then click the extension icon:
   - **DOM Probe → Run probe**: scans the page for goal rows / goal-ID exposure and shows
     the findings (this decides the DOM↔API correlation strategy, PRD Phase 0).
   - **API Test**: paste your Timestripe API key (Settings → API keys) and verify the API
     is reachable from the service worker context (CORS/host_permissions check). The key
     is stored in `chrome.storage.local` only — never in the bundle.

## Structure

```
src/
  background/service-worker.ts   API calls, storage orchestration (PRD §45)
  content/dom-probe.ts           temporary Phase-0 DOM discovery probe (deleted later, §47)
  popup/                         React popup (Projects/Templates/Settings eventually, §37)
  shared/                        message contracts + types
```

Test data discipline: never mutate the user's real space — write tests go to the
`EXT-TEST` space only (PRD §41.5).
