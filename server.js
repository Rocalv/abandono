'use strict';

/*
 * Votación en vivo para la presentación final OULAD
 * Node.js + Express + Socket.io
 *
 * Cada persona escanea el QR y responde Sí / No (de forma anónima).
 * Internamente cada participante tiene un id: así se guarda qué respondió
 * y qué le predijo cada modelo.
 *
 * Al cerrar la votación, dos modelos "predicen" sin mirar ningún dato:
 *   - Azar:        dice "abandona" con probabilidad BASE_RATE (31,2 %, la tasa de OULAD).
 *   - Siempre no:  dice "no abandona" a todos (el Dummy de la presentación).
 * Después se comparan con las respuestas reales: matriz de confusión y métricas.
 *
 * Eventos de Socket.io
 *   participante → servidor : join, answer
 *   docente      → servidor : admin_hello, close_and_predict, reroll, reset
 *   servidor → docente      : state (estado completo)
 *   servidor → participante : results (resultado general + el suyo), reset
 */

const path = require('path');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');

// ---------------------------------------------------------------------------
// Configuración (variables de entorno, todas opcionales)
// ---------------------------------------------------------------------------
const PORT = Number(process.env.PORT) || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || crypto.randomBytes(3).toString('hex');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
// Tasa de abandono de OULAD (diapositiva 5): 10.156 de 32.593 inscripciones.
const BASE_RATE = Number(process.env.BASE_RATE) || 0.312;
const QUESTION = process.env.QUESTION || '¿Abandonaste alguna materia en 2025?';

const MAX_PARTICIPANTS = 300;
const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

// ---------------------------------------------------------------------------
// Servidor HTTP
// ---------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

const INDEX_HTML = path.join(__dirname, 'public', 'index.html');
app.get('/', (req, res) => res.sendFile(INDEX_HTML));
app.get('/admin', (req, res) => res.sendFile(INDEX_HTML));
app.get('/health', (req, res) => res.json({ ok: true, phase: game.phase, participants: game.participants.size }));

const server = http.createServer(app);
const io = new Server(server, { pingInterval: 10000, pingTimeout: 20000, maxHttpBufferSize: 1e4 });

// ---------------------------------------------------------------------------
// Estado (en memoria)
// ---------------------------------------------------------------------------
const game = {
  phase: 'open',          // 'open' (votación abierta) | 'results'
  round: 1,               // cambia en cada nueva votación
  draw: 0,                // cuántas veces se tiró el azar en esta ronda
  nextNumber: 1,          // número anónimo que se muestra en el detalle (#1, #2…)
  participants: new Map(), // id → { id, number, socketId, connected, answer, predRandom, predDummy }
  results: null
};

// Número al azar en [0, 1) con la fuente criptográfica del sistema.
function rand() {
  return crypto.randomInt(0, 1e9) / 1e9;
}

// Matriz de confusión y métricas. Clase positiva: "abandona".
// y y yhat son listas de booleanos (true = abandona).
function evaluate(y, yhat) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  for (let i = 0; i < y.length; i++) {
    if (y[i] && yhat[i]) tp++;
    else if (!y[i] && yhat[i]) fp++;
    else if (y[i] && !yhat[i]) fn++;
    else tn++;
  }
  const n = y.length;
  return {
    tp, fp, fn, tn,
    accuracy: n ? (tp + tn) / n : null,
    recall: tp + fn ? tp / (tp + fn) : null,        // de los que abandonaron, cuántos detectó
    precision: tp + fp ? tp / (tp + fp) : null       // de los que alertó, cuántos abandonaron
  };
}

function answered() {
  return [...game.participants.values()].filter((p) => p.answer != null);
}

function counts() {
  const list = answered();
  const yes = list.filter((p) => p.answer === 'si').length;
  // Conectados que todavía no respondieron (para el "están respondiendo…" del panel).
  let pending = 0;
  for (const p of game.participants.values()) if (p.connected && p.answer == null) pending++;
  return { answered: list.length, pending, yes, no: list.length - yes };
}

// Asigna las predicciones de los dos modelos y calcula los resultados.
// El modelo de la mayoría le dice a todos lo que respondió la mayoría de la sala
// (si hay empate, "no abandona").
function predict() {
  const list = answered().sort((a, b) => a.number - b.number);
  for (const p of game.participants.values()) {
    p.predRandom = null;
    p.predDummy = null;
  }
  const y = list.map((p) => p.answer === 'si');
  const yes = y.filter(Boolean).length;
  const dummyValue = yes > y.length - yes;   // true = "abandona"
  for (const p of list) {
    p.predRandom = rand() < BASE_RATE;  // true = predice "abandona"
    p.predDummy = dummyValue;
  }
  game.draw += 1;
  game.results = {
    round: game.round,
    draw: game.draw,
    baseRate: BASE_RATE,
    question: QUESTION,
    counts: counts(),
    dummyValue,
    random: evaluate(y, list.map((p) => p.predRandom)),
    dummy: evaluate(y, list.map((p) => p.predDummy))
  };
}

function mine(p) {
  if (!game.results || p.answer == null) return null;
  return { answer: p.answer, predRandom: p.predRandom, predDummy: p.predDummy, number: p.number };
}

function participantState(p) {
  return {
    ok: true,
    playerId: p.id,
    question: QUESTION,
    phase: game.phase,
    round: game.round,
    answer: p.answer,
    results: game.phase === 'results' ? game.results : null,
    mine: game.phase === 'results' ? mine(p) : null
  };
}

function adminSnapshot() {
  return {
    phase: game.phase,
    question: QUESTION,
    baseRate: BASE_RATE,
    counts: counts(),
    results: game.phase === 'results' ? game.results : null,
    // Detalle anónimo: número, respuesta y lo que predijo cada modelo.
    detail: [...game.participants.values()]
      .filter((p) => p.answer != null)
      .sort((a, b) => a.number - b.number)
      .map((p) => ({ number: p.number, answer: p.answer, predRandom: p.predRandom, predDummy: p.predDummy }))
  };
}

// Agrupa las actualizaciones al panel para no mandar una por cada voto.
let stateTimer = null;
function pushAdmin(immediate) {
  const send = () => { stateTimer = null; io.to('admins').emit('state', adminSnapshot()); };
  if (immediate) { clearTimeout(stateTimer); send(); return; }
  if (!stateTimer) stateTimer = setTimeout(send, 250);
}

// Envía a cada participante el resultado general y el suyo.
function pushResults() {
  for (const p of game.participants.values()) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('results', { results: game.results, mine: mine(p) });
  }
}

function getParticipant(socket, payload) {
  let id = socket.data.playerId;
  if (!id && payload && typeof payload.playerId === 'string' && ID_PATTERN.test(payload.playerId)) id = payload.playerId;
  return id ? game.participants.get(id) : undefined;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) out.push(a.address);
    }
  }
  return out;
}

function pickJoinUrl(origin) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const valid = typeof origin === 'string' && /^https?:\/\/[^\s/]{1,200}$/.test(origin);
  const isLocal = valid && /\/\/(localhost|127\.|\[::1\])/.test(origin);
  if (valid && !isLocal) return origin;
  const ip = lanAddresses()[0];
  return ip ? `http://${ip}:${PORT}` : `http://localhost:${PORT}`;
}

// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  const replyFn = (ack) => (typeof ack === 'function' ? ack : () => {});

  // ----- Participante -----
  socket.on('join', (payload, ack) => {
    const reply = replyFn(ack);
    payload = payload && typeof payload === 'object' ? payload : {};
    const requestedId = typeof payload.playerId === 'string' && ID_PATTERN.test(payload.playerId) ? payload.playerId : null;

    let p = requestedId ? game.participants.get(requestedId) : undefined;
    if (!p) {
      if (game.participants.size >= MAX_PARTICIPANTS) return reply({ ok: false, error: 'La sala está llena.' });
      const id = crypto.randomUUID();
      p = { id, number: game.nextNumber++, socketId: null, connected: false, answer: null, predRandom: null, predDummy: null };
      game.participants.set(id, p);
    }
    // Si la misma persona tenía otra pestaña abierta, esa deja de representarla.
    if (p.socketId && p.socketId !== socket.id) {
      const old = io.sockets.sockets.get(p.socketId);
      if (old) old.data.playerId = null;
    }
    p.socketId = socket.id;
    p.connected = true;
    socket.data.playerId = p.id;
    socket.join('players');
    reply(participantState(p));
    pushAdmin();
  });

  socket.on('answer', (payload, ack) => {
    const reply = replyFn(ack);
    const p = getParticipant(socket, payload);
    if (!p) return reply({ ok: false, error: 'No encontramos tu respuesta. Recargá la página.' });
    if (game.phase !== 'open') return reply({ ok: false, error: 'La votación ya cerró.' });
    const value = payload && payload.value;
    if (value !== 'si' && value !== 'no') return reply({ ok: false, error: 'Respuesta no válida.' });
    p.answer = value;
    reply({ ok: true, answer: p.answer });
    pushAdmin();
  });

  // ----- Docente -----
  socket.on('admin_hello', async (payload, ack) => {
    const reply = replyFn(ack);
    const key = payload && typeof payload.key === 'string' ? payload.key : '';
    if (!safeEqual(key, ADMIN_KEY)) return reply({ ok: false, error: 'Clave incorrecta.' });
    socket.data.isAdmin = true;
    socket.join('admins');
    const joinUrl = pickJoinUrl(payload.origin);
    let qrSvg = '';
    try {
      qrSvg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#15202E', light: '#FFFFFF' } });
    } catch (err) {
      console.error('No se pudo generar el QR:', err.message);
    }
    reply({ ok: true, joinUrl, qrSvg });
    socket.emit('state', adminSnapshot());
  });

  socket.on('close_and_predict', (payload, ack) => {
    const reply = replyFn(ack);
    if (!socket.data.isAdmin) return reply({ ok: false });
    if (game.phase !== 'open') return reply({ ok: false, error: 'La votación ya está cerrada.' });
    if (!answered().length) return reply({ ok: false, error: 'Todavía nadie respondió.' });
    game.phase = 'results';
    predict();
    pushResults();
    pushAdmin(true);
    reply({ ok: true });
    const r = game.results;
    console.log(`[juego] Cierre: ${r.counts.answered} respuestas (${r.counts.yes} sí). Azar: TP ${r.random.tp} FP ${r.random.fp} FN ${r.random.fn} TN ${r.random.tn}`);
  });

  // Vuelve a tirar el modelo al azar con las mismas respuestas.
  socket.on('reroll', () => {
    if (!socket.data.isAdmin || game.phase !== 'results') return;
    predict();
    pushResults();
    pushAdmin(true);
  });

  socket.on('reset', () => {
    if (!socket.data.isAdmin) return;
    game.phase = 'open';
    game.round += 1;
    game.draw = 0;
    game.results = null;
    for (const [id, p] of game.participants) {
      if (!p.connected) { game.participants.delete(id); continue; }
      p.answer = null;
      p.predRandom = null;
      p.predDummy = null;
    }
    io.to('players').emit('reset', { round: game.round });
    pushAdmin(true);
    console.log('[juego] Nueva votación');
  });

  socket.on('disconnect', () => {
    const p = socket.data.playerId && game.participants.get(socket.data.playerId);
    if (p && p.socketId === socket.id) {
      p.connected = false;
      pushAdmin();
    }
  });
});

// Exporta las funciones de cálculo para poder probarlas sin levantar el servidor.
module.exports = { evaluate };

if (require.main === module) {
  server.listen(PORT, () => {
    const ips = lanAddresses();
    console.log('\n  Votación lista\n');
    console.log(`  Participantes: http://localhost:${PORT}`);
    ips.forEach((ip) => console.log(`                 http://${ip}:${PORT}`));
    if (PUBLIC_URL) console.log(`                 ${PUBLIC_URL}`);
    console.log(`  Panel:         http://localhost:${PORT}/admin?key=${ADMIN_KEY}`);
    if (!process.env.ADMIN_KEY) console.log('                 (clave generada al azar; fijala con la variable ADMIN_KEY)');
    console.log(`  Pregunta:      ${QUESTION}`);
    console.log(`  Tasa del azar: ${(BASE_RATE * 100).toFixed(1).replace('.', ',')} %\n`);
  });
}
