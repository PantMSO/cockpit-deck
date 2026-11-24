'use strict';
// Sample data shared by tests and README screenshots: a C172-style cruise and a Forza race lap.
const path = require('path');
const PLUGIN = path.join(__dirname, '..', 'com.local.cockpitdeck.sdPlugin');
const { dashOffset } = require(path.join(PLUGIN, 'bin', 'forza.js'));

/** A Forza "Data Out" packet with known values (100 mph, 4th gear, P3, lap 3). */
function forzaPacket(len = 324) {
  const b = Buffer.alloc(len);
  const off = dashOffset(len);
  b.writeInt32LE(1, 0);            // race on
  b.writeFloatLE(8000, 8);         // max rpm
  b.writeFloatLE(900, 12);         // idle
  b.writeFloatLE(7400, 16);        // rpm
  b.writeInt32LE(812, 220);        // PI
  b.writeFloatLE(44.704, off + 12);   // 100 mph
  b.writeFloatLE(298280, off + 16);   // 400 hp
  [180, 190, 200, 260].forEach((f, i) => b.writeFloatLE(f, off + 24 + i * 4)); // tyres °F
  b.writeFloatLE(14.5, off + 40);     // boost
  b.writeFloatLE(83.25, off + 52);    // best lap
  b.writeFloatLE(84.5, off + 56);     // last lap
  b.writeFloatLE(12.3, off + 60);     // current lap
  b.writeUInt16LE(2, off + 68);       // lap index
  b.writeUInt8(3, off + 70);          // position
  b.writeUInt8(4, off + 75);          // gear
  return b;
}

const fakeVars = {
  'AIRSPEED INDICATED': 112.4, 'INDICATED ALTITUDE': 4512, 'VERTICAL SPEED': 640, 'PLANE HEADING DEGREES MAGNETIC': 274.2,
  'GEAR HANDLE POSITION': 1, 'IS GEAR RETRACTABLE': 1, 'GEAR CENTER POSITION': 1, 'GEAR LEFT POSITION': 1, 'GEAR RIGHT POSITION': 1,
  'FLAPS HANDLE INDEX': 1, 'FLAPS NUM HANDLE POSITIONS': 3, 'SPOILERS ARMED': 0, 'BRAKE PARKING POSITION': 0,
  'AUTOPILOT MASTER': 1, 'AUTOPILOT HEADING LOCK DIR': 270, 'AUTOPILOT HEADING LOCK': 1, 'AUTOPILOT NAV1 LOCK': 0, 'AUTOPILOT APPROACH HOLD': 0,
  'AUTOPILOT VERTICAL HOLD VAR': 500, 'AUTOPILOT VERTICAL HOLD': 1, 'AUTOPILOT ALTITUDE LOCK VAR': 6500, 'AUTOPILOT ALTITUDE LOCK': 0,
  'LIGHT NAV': 1, 'LIGHT BEACON': 1, 'LIGHT STROBE': 1, 'LIGHT LANDING': 0, 'LIGHT TAXI': 0, 'LIGHT LOGO': 0, 'LIGHT WING': 0, 'LIGHT PANEL': 1, 'LIGHT CABIN': 0, 'LIGHT RECOGNITION': 0,
  'COM ACTIVE FREQUENCY:1': 121.5, 'COM STANDBY FREQUENCY:1': 118.3, 'NAV ACTIVE FREQUENCY:1': 110.5, 'NAV STANDBY FREQUENCY:1': 113.9,
  'ELECTRICAL MASTER BATTERY': 1, 'GENERAL ENG MASTER ALTERNATOR:1': 1, 'AVIONICS MASTER SWITCH': 1, 'GENERAL ENG FUEL PUMP SWITCH:1': 0, 'PITOT HEAT': 0,
  'ENG COMBUSTION:1': 1, 'FUEL TOTAL QUANTITY': 41.6, 'GENERAL ENG RPM:1': 2384, 'STRUCTURAL DEICE SWITCH': 0,
};

const cfg = { forza: { units: 'mph', keys: { rewind: 'BACKSPACE', horn: 'H', pause: 'ESC' } } };

/** The object key definitions draw from; `vars` overrides individual SimVars. */
function scopeFor(connected, forzaData, vars = {}) {
  const all = { ...fakeVars, ...vars };
  return {
    cfg,
    v: (name) => {
      if (!connected) return null;
      if (!(name in all)) throw new Error('no fake for ' + name);
      return all[name];
    },
    paused: () => (connected ? false : null), connected: () => connected, send() {}, setPage() {},
    forza: () => forzaData, peak: () => 61.2, resetPeak() {}, toggleUnits() {}, key() {},
  };
}

module.exports = { forzaPacket, fakeVars, cfg, scopeFor, PLUGIN };
