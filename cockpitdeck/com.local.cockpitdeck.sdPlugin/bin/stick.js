'use strict';
// Reads a joystick (default: Logitech Extreme 3D Pro, USB 046D:C215) through Windows winmm.
// Read-only: it never changes the stick or Windows settings. MSFS keeps reading the stick as usual.
const { EventEmitter } = require('events');

const POLL_MS = 25;
const RESCAN_MS = 1000;
const MAX_MISSES = 20; // ~0.5 s of failed reads before the stick counts as gone (Windows can drop a read or two)
const JOY_RETURNALL = 0xff;
const JOYINFOEX_SIZE = 52;
const JOYCAPS_SIZE = 728; // JOYCAPSW

let api = null;
function winmm() {
  if (api) return api;
  const koffi = require('koffi');
  const lib = koffi.load('winmm.dll');
  const JOYINFOEX = koffi.struct('CD_JOYINFOEX', {
    dwSize: 'uint32', dwFlags: 'uint32', dwXpos: 'uint32', dwYpos: 'uint32', dwZpos: 'uint32', dwRpos: 'uint32', dwUpos: 'uint32', dwVpos: 'uint32',
    dwButtons: 'uint32', dwButtonNumber: 'uint32', dwPOV: 'uint32', dwReserved1: 'uint32', dwReserved2: 'uint32',
  });
  if (koffi.sizeof(JOYINFOEX) !== JOYINFOEX_SIZE) throw new Error('JOYINFOEX size ' + koffi.sizeof(JOYINFOEX));
  api = {
    getPos: lib.func('uint32 __stdcall joyGetPosEx(uint32 uJoyID, _Inout_ CD_JOYINFOEX *pji)'),
    getCaps: lib.func('uint32 __stdcall joyGetDevCapsW(uintptr_t uJoyID, _Out_ uint8_t *pjc, uint32 cbjc)'),
  };
  return api;
}

/** "046d:c215" -> { vid: 0x046d, pid: 0xc215 } */
function parseDevice(s) {
  const m = /^([0-9a-f]{4}):([0-9a-f]{4})$/i.exec(String(s || '').trim());
  return m ? { vid: parseInt(m[1], 16), pid: parseInt(m[2], 16) } : null;
}

const norm = (v) => Math.max(-1, Math.min(1, (v - 32767.5) / 32767.5)); // 0..65535 -> -1..1

class Stick extends EventEmitter {
  constructor(log) {
    super();
    this.log = log;
    this.id = -1;
    this.connected = false;
    this.buttons = 0;
    this.axes = { x: 0, y: 0, twist: 0, slider: 0 };
    this.want = parseDevice('046d:c215');
    this.timer = null;
    this.lastScan = 0;
    this.failed = false;
    this.misses = 0;
  }

  start(device) {
    const want = parseDevice(device);
    if (!want) { this.log('stick: bad device id', device); return; }
    const changed = !this.want || want.vid !== this.want.vid || want.pid !== this.want.pid;
    this.want = want;
    if (changed) this._lost('device changed');
    if (this.timer) return;
    try { winmm(); } catch (e) { if (!this.failed) this.log('stick: winmm unavailable', e.message); this.failed = true; return; }
    this.timer = setInterval(() => this._tick(), POLL_MS);
  }

  stop() { clearInterval(this.timer); this.timer = null; this._lost('stopped'); }

  /** True while button n (1-based, as printed on the stick) is held. */
  held(n) { return this.connected && (this.buttons & (1 << (n - 1))) !== 0; }

  _scan() {
    this.lastScan = Date.now();
    const { getCaps, getPos } = winmm();
    const caps = Buffer.alloc(JOYCAPS_SIZE);
    for (let id = 0; id < 16; id++) {
      if (getCaps(id, caps, JOYCAPS_SIZE) !== 0) continue;
      if (caps.readUInt16LE(0) !== this.want.vid || caps.readUInt16LE(2) !== this.want.pid) continue;
      if (getPos(id, { dwSize: JOYINFOEX_SIZE, dwFlags: JOY_RETURNALL }) !== 0) continue;
      this.id = id;
      this.connected = true;
      this.log('stick connected: joystick id', id);
      this.emit('status', true);
      return;
    }
  }

  _lost(why) {
    if (!this.connected) return;
    const was = this.buttons;
    this.connected = false; this.id = -1; this.buttons = 0; this.misses = 0;
    this.lastScan = 0; // look for it again straight away (it may have moved to another joystick id)
    for (let n = 1; n <= 32; n++) if (was & (1 << (n - 1))) this.emit('button', n, false);
    this.log('stick disconnected:', why);
    this.emit('status', false);
  }

  _tick() {
    try {
      if (!this.connected) { if (Date.now() - this.lastScan >= RESCAN_MS) this._scan(); return; }
      const ji = { dwSize: JOYINFOEX_SIZE, dwFlags: JOY_RETURNALL };
      if (winmm().getPos(this.id, ji) !== 0) {
        if (++this.misses >= MAX_MISSES) this._lost('read failed');
        return; // keep the last known state through a brief hiccup
      }
      if (this.misses) { if (this.misses > 2) this.log('stick: recovered after', this.misses, 'failed reads'); this.misses = 0; }
      const b = ji.dwButtons >>> 0;
      if (b !== this.buttons) {
        const was = this.buttons;
        this.buttons = b;
        for (let n = 1; n <= 32; n++) {
          const m = 1 << (n - 1);
          if ((b & m) !== (was & m)) this.emit('button', n, (b & m) !== 0);
        }
      }
      // Slider: Extreme 3D Pro reports full-forward as 0, so flip it to 0 = idle .. 1 = full.
      const a = { x: norm(ji.dwXpos), y: norm(ji.dwYpos), twist: norm(ji.dwRpos), slider: 1 - ji.dwZpos / 65535 };
      const q = (v) => Math.round(v * 40);
      if (q(a.x) !== q(this.axes.x) || q(a.y) !== q(this.axes.y) || q(a.twist) !== q(this.axes.twist) || q(a.slider) !== q(this.axes.slider)) {
        this.axes = a;
        this.emit('axes', a);
      }
    } catch (e) {
      this.log('stick error', e.message);
      this._lost('error');
    }
  }
}

module.exports = { Stick, parseDevice };
