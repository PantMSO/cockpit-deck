'use strict';
// Cockpit Deck: live-feedback Stream Deck keys for MSFS 2024 and Forza Horizon 6.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const WebSocket = require('ws');
const { renderKey } = require('./render.js');
const { msfsSlot, forzaSlot } = require('./layouts.js');
const { Msfs } = require('./msfs.js');
const { Forza } = require('./forza.js');
const keys = require('./keys.js');

const ACTION = 'com.local.cockpitdeck.slot';
// COCKPITDECK_DATA lets tests run against their own folder instead of the real one.
const DATA_DIR = process.env.COCKPITDECK_DATA || path.join(process.env.APPDATA || '.', 'CockpitDeck');
const LOG_FILE = path.join(DATA_DIR, 'plugin.log');
const CFG_FILE = path.join(DATA_DIR, 'config.json');
// Must equal the "Name" entries in manifest.json "Profiles" (checked at startup and by tools/test.js).
const PROFILES = { msfs: 'CockpitDeck-MSFS2024', forza: 'CockpitDeck-Forza' };
const GAME_EXE = { msfs: 'flightsimulator2024.exe', forza: 'forzahorizon6.exe' };
const FRAME_MS = 66;          // ~15 fps redraw ceiling
const REPEAT_DELAY = 400, REPEAT_EVERY = 110;

fs.mkdirSync(DATA_DIR, { recursive: true });
// A debug.flag file next to manifest.json makes the plugin save every key image it sends.
const DEBUG_DUMP = fs.existsSync(path.join(__dirname, '..', 'debug.flag'));
const DEBUG_DIR = path.join(DATA_DIR, 'debug');
if (DEBUG_DUMP) fs.mkdirSync(DEBUG_DIR, { recursive: true });
try { if (fs.statSync(LOG_FILE).size > 1e6) fs.renameSync(LOG_FILE, LOG_FILE + '.old'); } catch (_) {}
function log(...a) { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + a.join(' ') + '\n'); } catch (_) {} }
process.on('uncaughtException', (e) => log('uncaught', e && e.stack));
try {
  const declared = (JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8')).Profiles || []).map((p) => p.Name);
  for (const name of Object.values(PROFILES)) if (!declared.includes(name)) log('ERROR profile name not in manifest:', name);
} catch (e) { log('manifest check failed', e.message); }
process.on('unhandledRejection', (e) => log('unhandled', e && (e.stack || e)));

// ---------------------------------------------------------------- config

const DEFAULT_CFG = {
  autoSwitch: true,
  forza: { port: 5300, listen: '0.0.0.0', units: 'mph', keys: { rewind: 'BACKSPACE', horn: 'H', pause: 'ESC' } },
};
function merge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k of Object.keys(over || {})) {
    out[k] = base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) ? merge(base[k], over[k]) : over[k];
  }
  return out;
}
let cfg = merge(DEFAULT_CFG, {});
function loadCfg() {
  try { cfg = merge(DEFAULT_CFG, JSON.parse(fs.readFileSync(CFG_FILE, 'utf8'))); } catch (e) {
    if (e.code !== 'ENOENT') log('config unreadable, using defaults:', e.message);
    cfg = merge(DEFAULT_CFG, {}); // a copy, so later edits never change the defaults
  }
  if (!fs.existsSync(CFG_FILE)) saveCfg();
}
function saveCfg() {
  try { fs.writeFileSync(CFG_FILE + '.tmp', JSON.stringify(cfg, null, 2)); fs.renameSync(CFG_FILE + '.tmp', CFG_FILE); } catch (e) { log('save cfg', e.message); }
}
loadCfg();
fs.watchFile(CFG_FILE, { interval: 2000 }, () => { loadCfg(); forza.start(cfg.forza.port, cfg.forza.listen); dirtyAll(); log('config reloaded'); });

// ---------------------------------------------------------------- game links

const msfs = new Msfs(log);
const forza = new Forza(log);
const pages = { msfs: 0 };

// ---------------------------------------------------------------- Stream Deck socket

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^-/, '')] = process.argv[i + 1];
const PLUGIN_UUID = args.pluginUUID;
const ws = new WebSocket('ws://127.0.0.1:' + args.port);
const send = (o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };

const keysOn = new Map();   // context -> { device, slot, game, lastImage, pressed, repeat }
const devices = new Map();  // device id -> { type, cols }
let dirty = new Set();

function slotDef(k) {
  return k.game === 'forza' ? forzaSlot(k.slot) : msfsSlot(k.slot, pages.msfs);
}

// Everything a key definition may use.
function scope(k) {
  return {
    cfg,
    v: (name, unit) => msfs.get(msfs.watch(name, unit)),
    send: (ev) => { if (!msfs.send(ev)) throw new Error('sim not connected'); },
    paused: () => msfs.paused,
    connected: () => msfs.connected,
    setPage: (i) => { pages.msfs = i; dirtyGame('msfs'); },
    forza: () => (forza.live() ? forza.last : null),
    peak: () => forza.peakSpeed,
    resetPeak: () => { forza.resetPeak(); dirtyGame('forza'); },
    toggleUnits: () => { cfg.forza.units = cfg.forza.units === 'kmh' ? 'mph' : 'kmh'; saveCfg(); dirtyGame('forza'); },
    key: (combo) => keys.press(combo),
    k,
  };
}

function draw(ctx) {
  const k = keysOn.get(ctx);
  if (!k) return;
  const def = slotDef(k);
  let image;
  try {
    const spec = def ? def.draw(scope(k)) : { style: 'button', caption: '', glyph: '', label: '' };
    image = renderKey({ ...spec, pressed: k.pressed });
  } catch (e) {
    log('draw failed', k.game, k.slot, e.stack);
    return;
  }
  if (image !== k.lastImage) {
    k.lastImage = image;
    send({ event: 'setImage', context: ctx, payload: { image, target: 0 } });
    if (DEBUG_DUMP) {
      try { fs.writeFileSync(path.join(DEBUG_DIR, `${k.game}-${String(k.slot).padStart(2, '0')}.png`), Buffer.from(image.split(',')[1], 'base64')); } catch (_) {}
    }
  }
}

function dirtyAll() { for (const c of keysOn.keys()) dirty.add(c); }
function dirtyGame(g) { for (const [c, k] of keysOn) if (k.game === g) dirty.add(c); }
setInterval(() => {
  if (!dirty.size) return;
  const list = dirty; dirty = new Set();
  for (const c of list) draw(c);
}, FRAME_MS);

function fire(ctx) {
  const k = keysOn.get(ctx);
  const def = k && slotDef(k);
  if (!def || !def.press) return true;
  try {
    const r = def.press(scope(k));
    if (r && typeof r.then === 'function') r.catch((e) => { log('press failed', e.message); send({ event: 'showAlert', context: ctx }); });
    return true;
  } catch (e) {
    log('press failed', k.game, k.slot, e.message);
    send({ event: 'showAlert', context: ctx });
    return false;
  }
}

function keyDown(ctx) {
  const k = keysOn.get(ctx);
  if (!k) return;
  k.pressed = true; k.downAt = Date.now(); dirty.add(ctx);
  const ok = fire(ctx);
  const def = slotDef(k);
  if (ok && def && def.repeat) {
    k.repeat = setTimeout(function tick() { fire(ctx); k.repeat = setTimeout(tick, REPEAT_EVERY); }, REPEAT_DELAY);
  }
}

function keyUp(ctx) {
  const k = keysOn.get(ctx);
  if (!k) return;
  clearTimeout(k.repeat); k.repeat = null;
  const wait = Math.max(0, 120 - (Date.now() - (k.downAt || 0)));
  setTimeout(() => { k.pressed = false; dirty.add(ctx); }, wait);
}

function slotFor(device, coords) {
  const cols = (devices.get(device) || {}).cols || 5;
  return coords.row * cols + coords.column;
}

ws.on('open', () => {
  send({ event: args.registerEvent, uuid: PLUGIN_UUID });
  try {
    const info = JSON.parse(args.info || '{}');
    for (const d of info.devices || []) devices.set(d.id, { type: d.type, cols: (d.size && d.size.columns) || 5 });
  } catch (_) {}
  log('registered; devices', JSON.stringify([...devices]));
});

// Debug builds only: a localhost endpoint to send raw commands to Stream Deck and read what it sends back.
const debugEvents = [];
if (DEBUG_DUMP) {
  const http = require('http');
  http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/send') {
        try {
          const o = JSON.parse(body);
          if (o.context === '$PLUGIN') o.context = PLUGIN_UUID;
          send(o); log('debug sent', JSON.stringify(o));
          res.end(JSON.stringify({ ok: true, sent: o }));
        } catch (e) { res.statusCode = 400; res.end(JSON.stringify({ error: e.message })); }
      } else if (req.url === '/state') {
        res.end(JSON.stringify({ pluginUUID: PLUGIN_UUID, devices: [...devices], keys: [...keysOn].map(([c, k]) => ({ c, device: k.device, slot: k.slot, game: k.game })), events: debugEvents.slice(-40) }));
      } else { res.statusCode = 404; res.end('{}'); }
    });
  }).listen(28650, '127.0.0.1', () => log('debug endpoint on 127.0.0.1:28650'));
}

ws.on('message', (raw) => {
  let m; try { m = JSON.parse(raw); } catch (_) { return; }
  if (DEBUG_DUMP) {
    debugEvents.push({ t: new Date().toISOString(), event: m.event, device: m.device, action: m.action, payload: m.event === 'keyDown' || m.event === 'keyUp' ? undefined : m.payload });
    if (debugEvents.length > 200) debugEvents.shift();
  }
  const ctx = m.context;
  switch (m.event) {
    case 'deviceDidConnect':
      devices.set(m.device, { type: m.deviceInfo.type, cols: (m.deviceInfo.size && m.deviceInfo.size.columns) || 5 });
      break;
    case 'deviceDidDisconnect':
      devices.delete(m.device);
      break;
    case 'willAppear': {
      if (m.action !== ACTION || !m.payload.coordinates) break; // not placeable in multi-actions
      const game = (m.payload.settings && m.payload.settings.game) || 'msfs';
      keysOn.set(ctx, { device: m.device, slot: slotFor(m.device, m.payload.coordinates), game, lastImage: null, pressed: false });
      dirty.add(ctx);
      break;
    }
    case 'willDisappear': {
      const k = keysOn.get(ctx);
      if (k) clearTimeout(k.repeat);
      keysOn.delete(ctx);
      break;
    }
    case 'didReceiveSettings': {
      const k = keysOn.get(ctx);
      if (k) { k.game = (m.payload.settings && m.payload.settings.game) || 'msfs'; k.lastImage = null; dirty.add(ctx); }
      break;
    }
    case 'keyDown': keyDown(ctx); break;
    case 'keyUp': keyUp(ctx); break;
  }
});
ws.on('close', () => { log('stream deck socket closed'); process.exit(0); });
ws.on('error', (e) => log('ws error', e.message));

// ---------------------------------------------------------------- live data -> redraw

msfs.on('change', () => dirtyGame('msfs'));
msfs.on('pause', () => dirtyGame('msfs'));
msfs.on('status', () => dirtyGame('msfs'));
forza.on('data', () => dirtyGame('forza'));
forza.on('status', () => dirtyGame('forza'));
msfs.start();
forza.start(cfg.forza.port, cfg.forza.listen);

// ---------------------------------------------------------------- auto profile switching

const running = { msfs: false, forza: false };
const switchedIn = new Set(); // device ids we moved onto a game profile; only those get switched back
function pollGames() {
  execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
    if (err) { log('tasklist', err.message); return; }
    const names = new Set(out.split(/\r?\n/).map((l) => (l.match(/^"([^"]+)"/) || [])[1]).filter(Boolean).map((s) => s.toLowerCase()));
    for (const g of Object.keys(GAME_EXE)) {
      const now = names.has(GAME_EXE[g]);
      if (now === running[g]) continue;
      running[g] = now;
      log(g, now ? 'started' : 'stopped');
      if (!cfg.autoSwitch) continue;
      for (const [id, d] of devices) {
        if (d.type !== 0) continue; // profiles are built for the 15-key Stream Deck
        if (now) {
          send({ event: 'switchToProfile', context: PLUGIN_UUID, device: id, payload: { profile: PROFILES[g] } });
          switchedIn.add(id);
          log('switch', id, '->', PROFILES[g]);
        } else if (switchedIn.has(id) && !Object.values(running).some(Boolean)) {
          send({ event: 'switchToProfile', context: PLUGIN_UUID, device: id, payload: {} });
          switchedIn.delete(id);
          log('switch', id, '-> previous profile');
        }
      }
    }
  });
}
setInterval(pollGames, 3000);
setTimeout(pollGames, 1500);
