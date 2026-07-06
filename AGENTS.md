# Chess.com Analyzer Lite

## Stack

- Node.js + Express + EJS (server-rendered)
- jQuery, chessboard.js, chess.js **0.12.0**, Chart.js, Stockfish 10.0.2 — all served through a built-in CDN proxy to avoid tracking-prevention blocking
- chess.com public API for game data (proxied server-side to avoid CORS)
- UI language is **Indonesian** (`lang="id"`)
- Midtrans Snap API for QRIS donations (currently `isProduction: true` in `server.js:178`; set to `false` for sandbox)

## Commands

| Command | Description |
|---------|-------------|
| `npm start` or `node server.js` | Start dev server on `http://localhost:3000` |
| `$env:PORT=8080; node server.js` | Custom port |
| _No tests, linter, typechecker, or CI configured_ | No verification commands exist |

## Environment Variables (`.env`)

| Variable | Description |
|----------|-------------|
| `MIDTRANS_SERVER_KEY` | Midtrans server key (sandbox/production) |
| `MIDTRANS_CLIENT_KEY` | Midtrans client key (snap token) |
| `MIDTRANS_MERCHANT_ID` | Midtrans merchant ID |
| `PORT` | Server port (default 3000) |

## Architecture

- **`server.js`** — Express entrypoint. Routes:
  - `/` — renders `views/index.ejs` (landing page with search form)
  - `/support` — renders `views/support.ejs` (Midtrans QRIS donation page)
  - `/faq` — renders `views/faq.ejs` (FAQ accordion page)
  - `/about` — renders `views/about.ejs` (about page with timeline & stats)
  - `/game?pgn=...` — renders `views/game.ejs` (board + Stockfish analysis)
  - `/cdn/:name` — proxies CDN assets (1-hour in-memory cache)
  - `/api/proxy/games/:username/:yyyy/:mm` — proxies chess.com API (sets `User-Agent` header)
  - `/api/proxy/player/:username` — proxies chess.com player profile (avatar, name, etc.)
  - `/api/openings` — serves pre-parsed opening book (loaded from `data/opening.json` at startup)
  - `POST /api/midtrans/transaction` — creates Midtrans Snap transaction for QRIS donation
  - `GET /api/midtrans/status/:orderId` — checks Midtrans transaction status
- Static files: `views/images/` (12 piece PNGs: `wP.png`, `bK.png`, etc.) at `/images/`; `sounds/sound.wav` at `/sounds/`
- Analysis is 100% in-browser via Stockfish Web Worker — no server-side engine, no `.wasm` fetch

## Critical constraints

- **chess.js 0.12.0 is pinned.** PGN parsing uses `sloppy: true`. Do not upgrade — newer versions changed `move()` to throw instead of returning null.
- **stockfish.js (10.0.2)** is a single-file build with no separate `.wasm` fetch; works through the CDN proxy.
- PGN is passed as `/game?pgn=...`, embedded via `JSON.stringify(pgn).replace(/</g, '\\u003c')` — safe interpolation, not raw.
- Opening book loaded from `data/opening.json` (NOT `views/data/openings.json` — that is a stale/unused copy). PGNs are parsed to SAN arrays once at startup.
- Book positions skip Stockfish evaluation (eval bar shows `📖`); detection is prefix-based (longest match wins).
- Analysis auto-starts on page load (600ms delay). Keyboard nav: `ArrowLeft`/`ArrowRight`/`Home`/`End`.
- Month/year selects are populated client-side (avoids server-timezone mismatch).
- Chess.com API rejects requests without a `User-Agent` header. The proxy sets `ChessAnalyzerLite/1.0`.
- Midtrans integration is in production mode (`isProduction: true` in `server.js:178`). Set to `false` for sandbox testing.
