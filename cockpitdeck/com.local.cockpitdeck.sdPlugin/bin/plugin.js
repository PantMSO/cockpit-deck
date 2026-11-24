'use strict';
// Cockpit Deck: live-feedback Stream Deck keys for MSFS 2024 and Forza Horizon 6.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const WebSocket = require('ws');
const { renderKey } = require('./render.js');
const { msfsSlot, forzaSlot } = require('./layouts.js');
const { classify, pagesFor, KINDS, KIND_NAMES } = require('./aircraft.js');
const { Msfs } = require('./msfs.js');
const { Forza } = require('./forza.js');
const { Stick } = require('./stick.js');
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
  // aircraft: "auto" picks pages for the loaded aircraft (Cessna 172, piston, turboprop, jet, helicopter, glider, or
  // the standard pages); "skyhawk", "piston", "turboprop", "jet", "heli", "glider" or "generic" forces one set.
  msfs: { aircraft: 'auto' },
  // Stick buttons Cockpit Deck acts on itself (only ones MSFS leaves unbound), and which held buttons light which keys.
  stick: {
    enabled: true,
    device: '046d:c215', // Logitech Extreme 3D Pro
    buttons: { 11: 'AP_DISC' },
    echo: { trimUp: [4], trimDown: [6], flapsUp: [7], flapsDown: [9], parkBrake: [10] },
  },
  forza: { port: 5300, listen: '0.0.0.0', units: 'mph', keys: { rewind: 'BACKSPACE', horn: 'H', pause: 'ESC' } },
};
const AP_DISC_SHOW_MS = 3000;
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
fs.watchFile(CFG_FILE, { interval: 2000 }, () => { loadCfg(); forza.start(cfg.forza.port, cfg.forza.listen); if (!OFFLINE) startStick(); updateMode(); dirtyAll(); log('config reloaded'); });

// ---------------------------------------------------------------- game links

const msfs = new Msfs(log);
const forza = new Forza(log);
const stick = new Stick(log);
const pages = { msfs: 0 };
const knob = { focus: 0 };
let apDiscAt = 0;
// MSFS pages follow the loaded aircraft: its kind (piston, jet, ...) picks the page set, and its input events fill it in.
let kind = 'generic';
let pageSet = 'generic'; // 'generic' | 'skyhawk' | {tabs, pages} from aircraft.js
let pageSetKey = '';
const TITLE = msfs.watch('TITLE', null);
const ATC_MODEL = msfs.watch('ATC MODEL', null);
const CATEGORY = msfs.watch('CATEGORY', null);
const ENGINE_TYPE = msfs.watch('ENGINE TYPE', 'Enum');
const ENGINES = msfs.watch('NUMBER OF ENGINES', 'Number');
const RETRACT = msfs.watch('IS GEAR RETRACTABLE', 'Bool');

function updateMode() {
  const forced = String(cfg.msfs.aircraft || 'auto').toLowerCase();
  const want = KINDS.includes(forced) ? forced
    : classify({ title: msfs.get(TITLE), model: msfs.get(ATC_MODEL), category: msfs.get(CATEGORY), engineType: msfs.get(ENGINE_TYPE) });
  const ac = { cls: want, title: msfs.get(TITLE), engines: msfs.get(ENGINES), retract: msfs.get(RETRACT) === 1, engineType: msfs.get(ENGINE_TYPE) };
  const key = JSON.stringify([ac.cls, ac.title, ac.engines, ac.retract, ac.engineType, msfs.inputsVersion]);
  if (key === pageSetKey) return;
  pageSetKey = key;
  pageSet = pagesFor({ ...ac, inputs: msfs.inputNames() });
  if (want !== kind) {
    kind = want; pages.msfs = 0; knob.focus = 0;
    log('msfs pages:', KIND_NAMES[kind], '(title', JSON.stringify(msfs.get(TITLE)), 'category', JSON.stringify(msfs.get(CATEGORY)),
      'engine type', msfs.get(ENGINE_TYPE), 'engines', msfs.get(ENGINES) + ', setting ' + forced + ')');
  }
  dirtyGame('msfs');
}

function startStick() {
  if (cfg.stick.enabled) stick.start(cfg.stick.device); else stick.stop();
}

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
  return k.game === 'forza' ? forzaSlot(k.slot) : msfsSlot(k.slot, pages.msfs, pageSet);
}

// Everything a key definition may use.
function scope(k) {
  return {
    cfg,
    v: (name, unit) => msfs.get(msfs.watch(name, unit)),
    send: (ev, data = 0) => { if (!msfs.send(ev, data)) throw new Error('sim not connected'); },
    input: (name) => msfs.input(name),
    setInput: (name, value) => { if (!msfs.setInput(name, value)) throw new Error('cannot set ' + name); },
    paused: () => msfs.paused,
    connected: () => msfs.connected,
    stick: () => stick,
    knob: () => knob.focus,
    setKnob: (i) => { knob.focus = i; dirtyGame('msfs'); },
    apDisc: () => Date.now() - apDiscAt < AP_DISC_SHOW_MS,
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
    const holdMs = def && def.hold ? def.hold.ms : 0;
    const progress = holdMs && k.holdStart && !k.holdDone ? (Date.now() - k.holdStart) / holdMs : 0;
    const hint = k.hintUntil > Date.now() ? 'HOLD ' + (holdMs / 1000) + ' S' : undefined;
    image = renderKey({ ...spec, pressed: k.pressed, progress, hint });
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

function fire(ctx, which = 'press') {
  const k = keysOn.get(ctx);
  const def = k && (k.def || slotDef(k));
  const fn = def && (which === 'hold' ? def.hold && def.hold.fn : def[which]);
  if (!fn) return true;
  try {
    const r = fn(scope(k));
    if (r && typeof r.then === 'function') r.catch((e) => { log('press failed', e.message); send({ event: 'showAlert', context: ctx }); });
    return true;
  } catch (e) {
    log('press failed', k.game, k.slot, e.message);
    send({ event: 'showAlert', context: ctx });
    return false;
  }
}

// Keys may define: press (on down), repeat (press again while held), release (on up),
// hold {ms, fn} (fires once held that long, with a progress ring), tap (on up if the hold didn't fire).
function keyDown(ctx) {
  const k = keysOn.get(ctx);
  if (!k) return;
  k.pressed = true; k.downAt = Date.now(); k.hintUntil = 0; dirty.add(ctx);
  k.def = slotDef(k); // the page may change while held; finish with the key that was pressed
  const def = k.def;
  const ok = fire(ctx);
  if (ok && def && def.repeat) {
    k.repeat = setTimeout(function tick() { fire(ctx); k.repeat = setTimeout(tick, REPEAT_EVERY); }, REPEAT_DELAY);
  }
  if (def && def.hold) {
    k.holdStart = Date.now(); k.holdDone = false;
    k.holdAnim = setInterval(() => dirty.add(ctx), FRAME_MS);
    k.holdTimer = setTimeout(() => {
      clearInterval(k.holdAnim);
      k.holdDone = true; dirty.add(ctx);
      fire(ctx, 'hold');
    }, def.hold.ms);
  }
}

function endHold(k) {
  clearTimeout(k.holdTimer); clearInterval(k.holdAnim);
  k.holdTimer = k.holdAnim = null; k.holdStart = 0;
}

function keyUp(ctx) {
  const k = keysOn.get(ctx);
  if (!k) return;
  clearTimeout(k.repeat); k.repeat = null;
  const def = k.def;
  if (def && def.hold) {
    const held = k.holdDone;
    endHold(k);
    if (!held) {
      if (def.tap) fire(ctx, 'tap');
      else { k.hintUntil = Date.now() + 1200; setTimeout(() => dirty.add(ctx), 1250); }
    }
  }
  if (def && def.release) fire(ctx, 'release');
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
      if (k) {
        clearTimeout(k.repeat); endHold(k);
        if (k.cranking) { k.cranking = false; msfs.setInput('ENGINE_MAGNETO_1', 3); } // never leave the starter engaged
      }
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

msfs.on('change', () => {
  const t = msfs.get(TITLE);
  if (msfs.noteTitle(t)) log('aircraft changed:', t);
  updateMode();
  dirtyGame('msfs');
});
msfs.on('pause', () => dirtyGame('msfs'));
msfs.on('status', () => { updateMode(); dirtyGame('msfs'); });
forza.on('data', () => dirtyGame('forza'));
forza.on('status', () => dirtyGame('forza'));

// Stick: echo held buttons on the deck, and handle the few buttons MSFS leaves unbound.
stick.on('status', () => dirtyGame('msfs'));
stick.on('axes', () => dirtyGame('msfs'));
stick.on('button', (n, down) => {
  dirtyGame('msfs');
  if (!down || !cfg.stick.enabled || !msfs.connected) return;
  const action = cfg.stick.buttons[n];
  if (!action) return;
  if (action === 'AP_DISC') {
    const wasOn = msfs.get(msfs.watch('AUTOPILOT MASTER', 'Bool'));
    msfs.send('AUTOPILOT_OFF');
    if (wasOn) { apDiscAt = Date.now(); setTimeout(() => dirtyGame('msfs'), AP_DISC_SHOW_MS + 50); }
    log('stick button', n, 'AP disconnect', wasOn ? '(was engaged)' : '(was off)');
  } else {
    msfs.send(String(action));
    log('stick button', n, '->', action);
  }
});

// COCKPITDECK_OFFLINE=1 (tests): never touch a running sim or the real stick.
const OFFLINE = process.env.COCKPITDECK_OFFLINE === '1';
updateMode(); // apply a forced "skyhawk"/"generic" setting before any sim data arrives
if (OFFLINE) log('offline mode: no sim, no stick');
else { msfs.start(); startStick(); }
forza.start(cfg.forza.port, cfg.forza.listen);

// ---------------------------------------------------------------- auto profile switching

const running = { msfs: false, forza: false };
const switchedIn = new Set(); // device ids we moved onto a game profile; only those get switched back
let lastTasklistLog = 0;
function pollGames() {
  execFile('tasklist.exe', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
    if (err) {
      // tasklist fails now and then while the PC is busy (e.g. MSFS loading); that poll is simply skipped.
      if (Date.now() - lastTasklistLog > 60000) { lastTasklistLog = Date.now(); log('tasklist failed (skipping this check):', err.message.split('\n')[0]); }
      return;
    }
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
