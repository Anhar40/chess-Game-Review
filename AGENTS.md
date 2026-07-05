# Chess.com Analyzer Lite

## Stack

- Node.js + Express + EJS (server-rendered, no SPA framework)
- jQuery, chessboard.js, chess.js 0.12.0, Chart.js, Stockfish 10.0.2 (all served via built-in CDN proxy)
- chess.com public API for game data

## Commands

| Command | Description |
|---------|-------------|
| `npm start` or `node server.js` | Start dev server on `http://localhost:3000` |
| `$env:PORT=8080; node server.js` | Custom port |

## Architecture

- **`server.js`** — Express entrypoint with 5 routes:
  - `/` — renders `views/index.ejs` (username search form)
  - `/game?pgn=...` — renders `views/game.ejs` (board + Stockfish analysis)
  - `/cdn/:name` — proxies CDN assets (avoids browser tracking prevention blocking third-party scripts)
  - `/api/proxy/games/:username/:yyyy/:mm` — proxies chess.com API (avoids CORS)
  - `/api/openings` — serves pre-parsed opening book (loaded from `data/opening.json`)
- Static files: `views/images/` (piece PNGs) served at `/images/`, `sounds/` served at `/sounds/`
- Analysis is 100% in-browser via Stockfish Web Worker (no server-side engine)

## Critical constraints

- **chess.js 0.12.0 is pinned.** Newer major versions changed the API (`move()` throws instead of returning null). Do not upgrade.
- **stockfish.js single-file build** — uses no separate `.wasm` fetch, works fully through the CDN proxy.
- PGN is passed as a query param (`/game?pgn=...`) and embedded via `JSON.stringify(pgn).replace(/</g, '\\u003c')` — safe interpolation, not raw.
- Chess.com API rejects requests without a `User-Agent` header. The proxy sets one.
- CDN proxy caches fetched assets for 1 hour in memory (no external cache).
- Month/year selects are populated client-side (avoids server-timezone mismatch).
- Opening book is loaded from `data/opening.json` (NOT `views/data/openings.json` — that is a stale/unused copy). PGNs are parsed to SAN arrays once at startup and served via `/api/openings`.
- The opening book client-side logic (`findOpening`, `computeBookPlies`) is in `views/game.ejs`. Detection is prefix-based; the most specific match (longest move sequence) wins.
- Book positions skip Stockfish evaluation — eval bar shows `📖`, move list shows `📖` icon, and a dedicated "Opening Book" card displays the opening name + ECO code.
- Analysis auto-starts on page load (600ms delay). Can be stopped with "Hentikan" button.
- Stockfish worker is terminated after analysis completes or is cancelled.
- No tests, no linter, no typechecker configured.
