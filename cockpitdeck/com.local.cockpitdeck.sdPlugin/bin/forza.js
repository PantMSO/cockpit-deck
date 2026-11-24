'use strict';
// Listens for Forza "Data Out" UDP telemetry (Settings > HUD and Gameplay > Data Out).
const dgram = require('dgram');
const { EventEmitter } = require('events');

const SLED_SIZE = 232;   // shared "sled" block
const DASH_SIZE = 79;    // "dash" block
const STALE_MS = 1500;

/**
 * Where the dash block starts for a given packet length.
 * Motorsport 7 = 311 bytes and Motorsport (2023) = 331 bytes put it right after the sled (232).
 * Horizon 4/5 = 324 bytes insert 12 extra bytes first (244). Anything else Horizon-sized uses 244.
 */
function dashOffset(len) {
  if (len === 311 || len === 331) return SLED_SIZE;
  if (len >= 244 + DASH_SIZE) return 244;
  return -1;
}

function parse(buf) {
  const off = dashOffset(buf.length);
  if (off < 0) return null;
  const f = (o) => buf.readFloatLE(o);
  const d = (o) => off + o;
  const t = {
    raceOn: buf.readInt32LE(0) !== 0,
    maxRpm: f(8), idleRpm: f(12), rpm: f(16),
    carClass: buf.readInt32LE(216), pi: buf.readInt32LE(220),
    speed: f(d(12)),          // m/s
    power: f(d(16)),          // W
    torque: f(d(20)),         // Nm
    tyreF: [f(d(24)), f(d(28)), f(d(32)), f(d(36))], // °F FL FR RL RR
    boost: f(d(40)),          // psi
    fuel: f(d(44)),           // 0..1
    bestLap: f(d(52)), lastLap: f(d(56)), curLap: f(d(60)), raceTime: f(d(64)),
    lap: buf.readUInt16LE(d(68)),
    position: buf.readUInt8(d(70)),
    gearRaw: buf.readUInt8(d(75)),
  };
  // Sanity checks so a mis-sized packet never shows garbage.
  if (!(t.maxRpm >= 0 && t.maxRpm < 30000) || !(t.speed >= 0 && t.speed < 250)) return null;
  t.gear = t.gearRaw === 0 ? 'R' : t.gearRaw >= 11 ? 'N' : String(t.gearRaw);
  t.tyreC = t.tyreF.map((x) => (x - 32) * 5 / 9);
  return t;
}

class Forza extends EventEmitter {
  constructor(log) {
    super();
    this.log = log;
    this.last = null;
    this.lastAt = 0;
    this.peakSpeed = 0;
    this.sock = null;
    this.port = 0;
  }

  // Binds to all interfaces by default: Xbox-app games sometimes can't send to 127.0.0.1,
  // so Data Out may need the PC's own LAN address instead.
  start(port, host = '0.0.0.0') {
    if (this.sock && this.port === port && this.host === host) return;
    this.stop();
    this.port = port;
    this.host = host;
    // No reuseAddr: if another app already owns the port, bind fails loudly instead of losing packets.
    const sock = dgram.createSocket({ type: 'udp4' });
    sock.on('message', (msg) => {
      const t = parse(msg);
      if (!t) return;
      const wasLive = this.live();
      this.last = t;
      this.lastAt = Date.now();
      if (t.raceOn && t.speed > this.peakSpeed) this.peakSpeed = t.speed;
      this.emit('data', t);
      if (!wasLive) this.emit('status', true);
    });
    sock.on('error', (e) => { this.log('forza udp error', e.message); this.emit('error', e); });
    sock.bind(port, host, () => this.log(`forza listening on ${host}:${port}`));
    this.sock = sock;
    this.watchdog = setInterval(() => {
      if (this.lastAt && Date.now() - this.lastAt > STALE_MS && this.last) { this.last = null; this.emit('status', false); }
    }, 500);
  }

  stop() {
    clearInterval(this.watchdog);
    if (this.sock) { try { this.sock.close(); } catch (_) {} this.sock = null; }
  }

  live() { return !!this.last && Date.now() - this.lastAt <= STALE_MS; }
  resetPeak() { this.peakSpeed = 0; }
}

module.exports = { Forza, parse, dashOffset };
