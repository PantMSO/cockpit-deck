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
  // Skyhawk extras (values like the live C172SP G1000 reads in cruise)
  'ELEVATOR TRIM PCT': 0.07, 'GENERAL ENG THROTTLE LEVER POSITION:1': 72.7, 'GENERAL ENG MIXTURE LEVER POSITION:1': 65.1,
  'FUEL TANK LEFT MAIN QUANTITY': 18.4, 'FUEL TANK RIGHT MAIN QUANTITY': 7.1, 'FUEL TANK LEFT MAIN CAPACITY': 28,
  'GENERAL ENG OIL TEMPERATURE:1': 200.5, 'GENERAL ENG OIL PRESSURE:1': 77.2, 'ENG FUEL FLOW GPH:1': 9.1,
  'GENERAL ENG EXHAUST GAS TEMPERATURE:1': 1334, 'ENG CYLINDER HEAD TEMPERATURE:1': 372.5,
  'ELECTRICAL BUS VOLTAGE:1': 28, 'ELECTRICAL BATTERY VOLTAGE': 25.1,
  'AUTOPILOT FLIGHT DIRECTOR ACTIVE': 1, 'NAV OBS:1': 123, 'KOHLSMAN SETTING HG:1': 29.92,
};

/** Aircraft input events as the C172SP G1000 reports them. */
const fakeInputs = {
  ENGINE_MAGNETO_1: 3, ELECTRICAL_BATTERY_1: 1, ELECTRICAL_ALTERNATOR_1: 1,
  ELECTRICAL_LINE_BUS_1_TO_AVIONICS_BUS_1: 1, ELECTRICAL_LINE_BUS_2_TO_AVIONICS_BUS_2: 1, FUEL_PUMP_1: 0,
  LIGHTING_BEACON_1: 1, LIGHTING_NAV_0: 1, LIGHTING_STROBE_0: 1, LIGHTING_TAXI_1: 0, LIGHTING_LANDING_1: 0,
  DEICE_PITOT_1: 0, FUEL_SELECTOR_1: 1, LANDING_GEAR_PARKINGBRAKE: 0,
};

const cfg = {
  forza: { units: 'mph', keys: { rewind: 'BACKSPACE', horn: 'H', pause: 'ESC' } },
  stick: { enabled: true, device: '046d:c215', buttons: { 11: 'AP_DISC' }, echo: { trim: [4, 6], flapsUp: [7], flapsDown: [9], parkBrake: [10] } },
};

/** A stick at rest-ish with optional held buttons. */
function fakeStick(connected = true, held = []) {
  return { connected, axes: { x: 0.25, y: -0.3, twist: -0.2, slider: 0.73 }, held: (b) => connected && held.includes(b) };
}

/**
 * The object key definitions draw from; `vars` overrides SimVars, `opts.inputs` overrides input events.
 * Calls to send/setInput/setKnob are recorded in `.calls`.
 */
function scopeFor(connected, forzaData, vars = {}, opts = {}) {
  const all = { ...fakeVars, ...vars };
  const inputs = { ...fakeInputs, ...(opts.inputs || {}) };
  const calls = [];
  let focus = opts.knob || 0;
  return {
    cfg, calls, k: {},
    v: (name) => {
      if (!connected) return null;
      if (!(name in all)) throw new Error('no fake for ' + name);
      return all[name];
    },
    input: (name) => {
      if (!connected) return null;
      if (!(name in inputs)) throw new Error('no fake input for ' + name);
      return inputs[name];
    },
    setInput: (name, value) => { if (!connected) throw new Error('sim not connected'); calls.push(['input', name, value]); inputs[name] = value; },
    send: (ev, data) => { if (!connected) throw new Error('sim not connected'); calls.push(['send', ev, data]); },
    paused: () => (connected ? false : null), connected: () => connected, setPage() {},
    stick: () => (opts.stick === undefined ? fakeStick() : opts.stick),
    knob: () => focus, setKnob: (i) => { focus = i; calls.push(['knob', i]); },
    apDisc: () => !!opts.apDisc,
    forza: () => forzaData, peak: () => 61.2, resetPeak() {}, toggleUnits() {}, key() {},
  };
}

module.exports = { forzaPacket, fakeVars, fakeInputs, fakeStick, cfg, scopeFor, PLUGIN };
