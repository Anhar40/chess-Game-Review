const express = require('express');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve piece images locally (put PNG files like wP.png, bK.png etc in views/images)
app.use('/images', express.static(path.join(__dirname, 'views', 'images')));

// Serve sound effects
app.use('/sounds', express.static(path.join(__dirname, 'sounds')));

// ------------------------------------------------------------------
// CDN proxy: serve same-origin so browsers with Tracking Prevention
// (Edge/Safari/Brave) don't block third-party script domains.
// NOTE: stockfish.js internally calls importScripts() for its .wasm/
// worker parts on some builds; we proxy the base file only. If you
// see worker errors, switch to a self-hosted stockfish build instead
// of a CDN mirror (see comment near CDN_MAP).
// ------------------------------------------------------------------
const CDN_MAP = {
  'tailwind': 'https://cdn.tailwindcss.com',
  'jquery.min.js': 'https://code.jquery.com/jquery-3.7.1.min.js',
  'chessboard.css': 'https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.css',
  'chessboard.min.js': 'https://unpkg.com/@chrisoakman/chessboardjs@1.0.0/dist/chessboard-1.0.0.min.js',
  // chess.js 0.12.0 exposes global `Chess` — keep this version, newer
  // major versions changed the API (move() throws instead of returning null).
  'chess.min.js': 'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.12.0/chess.min.js',
  'chart.min.js': 'https://cdn.jsdelivr.net/npm/chart.js',
  // Single-file build (no separate .wasm fetch) so it works fully
  // through this proxy without extra worker-relative requests.
  'stockfish.js': 'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js',
};

const cdnCache = new Map(); // simple in-memory cache: name -> {contentType, buffer, ts}
const CDN_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ------------------------------------------------------------------
// Opening book: load and parse data/opening.json at startup
// PGNs are parsed to SAN move arrays once, not on every request.
// ------------------------------------------------------------------
function parseOpeningPgn(pgn) {
  let s = pgn.replace(/\s*(?:1-0|0-1|1\/2-1\/2|\*)\s*$/, '');
  s = s.replace(/\d+\s*\.{1,3}\s*/g, ' ');
  s = s.replace(/\{[^}]*\}/g, '');
  s = s.replace(/\$\d+/g, '');
  return s.trim().split(/\s+/).filter(Boolean);
}

let openingBook = [];
try {
  const raw = fs.readFileSync(path.join(__dirname, 'data', 'opening.json'), 'utf-8');
  const openings = JSON.parse(raw);
  openingBook = openings.map(o => ({
    eco: o.eco,
    name: o.name,
    moves: parseOpeningPgn(o.pgn)
  }));
  console.log(`Loaded ${openingBook.length} openings from data/opening.json`);
} catch (err) {
  console.error('Failed to load opening book:', err.message);
  openingBook = [];
}

app.get('/cdn/:name', async (req, res) => {
  const name = req.params.name;
  const target = CDN_MAP[name];
  if (!target) return res.status(404).send('// Not found');

  const cached = cdnCache.get(name);
  if (cached && Date.now() - cached.ts < CDN_CACHE_TTL_MS) {
    res.set('Content-Type', cached.contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(cached.buffer);
  }

  try {
    const response = await axios.get(target, {
      responseType: 'arraybuffer',
      timeout: 20000,
      maxRedirects: 5,
      headers: { 'User-Agent': 'chess-analyzer-lite/1.0' },
    });
    const contentType = response.headers['content-type'] || guessContentType(name);
    const buffer = Buffer.from(response.data);
    cdnCache.set(name, { contentType, buffer, ts: Date.now() });

    res.set('Content-Type', contentType);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buffer);
  } catch (err) {
    console.error(`CDN proxy error for ${name}:`, err.message);
    if (err.response) {
      return res.status(err.response.status).send(`// CDN upstream error: ${err.response.status}`);
    }
    res.status(502).send('// CDN proxy error: ' + err.message);
  }
});

function guessContentType(name) {
  if (name.endsWith('.css')) return 'text/css';
  if (name.endsWith('.js')) return 'application/javascript';
  return 'application/octet-stream';
}

// ------------------------------------------------------------------
// Proxy endpoint for chess.com API (avoids CORS + adds required
// User-Agent — Chess.com's API rejects requests without one)
// ------------------------------------------------------------------
app.get('/api/proxy/games/:username/:yyyy/:mm', async (req, res) => {
  const { username, yyyy, mm } = req.params;

  if (!/^\d{4}$/.test(yyyy) || !/^\d{2}$/.test(mm)) {
    return res.status(400).json({ error: 'Format tahun/bulan tidak valid' });
  }

  try {
    const response = await axios.get(
      `https://api.chess.com/pub/player/${encodeURIComponent(username)}/games/${yyyy}/${mm}`,
      {
        timeout: 15000,
        headers: { 'User-Agent': 'ChessAnalyzerLite/1.0 (contact: example@example.com)' },
      }
    );
    res.json(response.data);
  } catch (err) {
    if (err.response) {
      const status = err.response.status;
      const msg = status === 404
        ? 'Username tidak ditemukan atau tidak ada game di bulan ini'
        : `Chess.com API error: ${status}`;
      return res.status(status).json({ error: msg });
    }
    if (err.code === 'ECONNABORTED') {
      return res.status(504).json({ error: 'Request timeout, coba lagi' });
    }
    console.error('Proxy error:', err.message);
    res.status(500).json({ error: 'Terjadi kesalahan server' });
  }
});

// Proxy endpoint for chess.com player profile (avatar, name, etc.)
app.get('/api/proxy/player/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const response = await axios.get(
      `https://api.chess.com/pub/player/${encodeURIComponent(username)}`,
      {
        timeout: 10000,
        headers: { 'User-Agent': 'ChessAnalyzerLite/1.0' },
      }
    );
    res.json(response.data);
  } catch (err) {
    if (err.response) {
      return res.status(err.response.status).json({ error: `Chess.com API error: ${err.response.status}` });
    }
    res.status(502).json({ error: 'Gagal mengambil data player' });
  }
});

// Serve pre-parsed opening book to the client
app.get('/api/openings', (req, res) => {
  res.json(openingBook);
});

// ------------------------------------------------------------------
// Midtrans Snap client (for QRIS donations on the Support page)
// ------------------------------------------------------------------
const midtransClient = require('midtrans-client');
const snap = new midtransClient.Snap({
  isProduction: true,
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
});
const coreApi = new midtransClient.CoreApi({
  isProduction: true,
  serverKey: process.env.MIDTRANS_SERVER_KEY || '',
});

app.get('/', (req, res) => res.render('index'));
app.get('/support', (req, res) => res.render('support', { midtransClientKey: process.env.MIDTRANS_CLIENT_KEY || '' }));
app.get('/faq', (req, res) => res.render('faq'));
app.get('/about', (req, res) => res.render('about'));

// Midtrans Snap — popup payment (bisa pilih metode: QRIS, GoPay, VA, dll)
app.post('/api/midtrans/transaction', express.json(), async (req, res) => {
  const { amount, donorName, donorEmail } = req.body;
  if (!amount || amount < 1000) {
    return res.status(400).json({ error: 'Minimal donasi Rp1.000' });
  }
  const orderId = 'CR-DONATION-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  try {
    const transaction = await snap.createTransaction({
      transaction_details: {
        order_id: orderId,
        gross_amount: amount,
      },
      customer_details: {
        first_name: donorName || 'Donatur',
        email: donorEmail || 'donatur@chessreview.app',
      },
    });
    res.json({
      token: transaction.token,
      order_id: orderId,
    });
  } catch (err) {
    console.error('Midtrans error:', err.message);
    res.status(500).json({ error: 'Gagal membuat transaksi: ' + err.message });
  }
});

// Midtrans transaction status API
app.get('/api/midtrans/status/:orderId', async (req, res) => {
  try {
    const status = await coreApi.transaction.status(req.params.orderId);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/game', (req, res) => {
  const pgn = req.query.pgn;
  if (!pgn || typeof pgn !== 'string' || !pgn.trim()) {
    return res.redirect('/');
  }
  // JSON.stringify safely escapes quotes/backslashes/newlines/</script>
  // so it can be embedded directly inside a <script> tag as a JS string literal.
  const pgnJson = JSON.stringify(pgn).replace(/</g, '\\u003c');
  res.render('game', { pgnJson });
});

// 404 fallback
app.use((req, res) => {
  res.status(404).send('Halaman tidak ditemukan');
});

app.listen(PORT, () => {
  console.log(`Chess.com Analyzer Lite running at http://localhost:${PORT}`);
});