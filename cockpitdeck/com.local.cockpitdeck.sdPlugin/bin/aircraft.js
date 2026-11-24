'use strict';
// Pages that fit the loaded aircraft. classify() sorts it into a kind (piston, turboprop, jet, helicopter, glider)
// from its SimVars; pagesFor() builds that kind's five pages, using the aircraft's own cockpit input events where
// it has them (MSFS 2024 aircraft often ignore the classic key events for switches) and classic events otherwise.
// The Cessna 172 keeps its hand-made pages, and anything else (balloons, airships, eVTOLs) gets the standard pages.
const { COLORS: C } = require('./render.js');
const L = require('./layouts.js');
const {
  n, bool, hdg, tog, readout, gearKey, pauseKey, magnetoFor, stickEcho, stickKey,
  knobKeyFor, knobTurnFor, apMode, apMaster, autoStartKey,
} = L.parts;

const KINDS = ['skyhawk', 'piston', 'turboprop', 'jet', 'heli', 'glider', 'generic'];
const KIND_NAMES = { skyhawk: 'Cessna 172', piston: 'piston', turboprop: 'turboprop', jet: 'jet', heli: 'helicopter', glider: 'glider', generic: 'standard' };

/** ENGINE TYPE SimVar: 0 piston, 1 jet, 2 none, 3 helicopter turbine, 4 unsupported, 5 turboprop. */
function classify({ title, model, category, engineType }) {
  if (L.isSkyhawk(title, model)) return 'skyhawk';
  const cat = String(category || '').toLowerCase();
  if (cat.includes('helicopter') || engineType === 3) return 'heli';
  if (cat.includes('glider')) return 'glider';
  if (engineType === 0) return 'piston';
  if (engineType === 5) return 'turboprop';
  if (engineType === 1) return 'jet';
  return 'generic';
}

// ---------------------------------------------------------------- building blocks

const byIndex = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const matching = (ac, re) => ac.inputs.filter((x) => re.test(x)).sort(byIndex);
const has = (ac, name) => ac.inputs.includes(name);

/** A key for something this aircraft doesn't have. */
const none = (caption, label) => ({ draw: () => ({ style: 'toggle', caption, label, state: null }) });

/**
 * A switch backed by one or more of the aircraft's input events (all of them move together, e.g. both alternators),
 * or `fallback` (a classic event + SimVar switch) when the aircraft has none of them.
 */
function group(caption, label, names, fallback, opts = {}) {
  if (!names.length) return fallback || none(caption, label);
  const onV = opts.on == null ? 1 : opts.on, offV = opts.off == null ? 0 : opts.off;
  const isOn = (x) => Math.abs(x - onV) < Math.abs(x - offV);
  const cap = names.length > 1 ? `${caption} ×${names.length}` : caption;
  return {
    draw: (s) => {
      const v = names.map((x) => s.input(x));
      if (v.some((x) => x == null)) return { style: 'toggle', caption: cap, label, state: null, color: opts.color };
      const on = v.filter(isOn).length;
      return { style: 'toggle', caption: cap, label, state: on === v.length, color: opts.color, onText: opts.onText,
        offText: on > 0 ? `${on} OF ${v.length} ON` : opts.offText };
    },
    press: (s) => {
      const v = names.map((x) => s.input(x));
      if (v.some((x) => x == null)) throw new Error(names[0] + ' unavailable');
      const target = v.every(isOn) ? offV : onV;
      for (const x of names) s.setInput(x, target);
    },
  };
}

// Switches use the classic events and SimVars, which most aircraft follow. Input event numbering differs from one
// aircraft to the next (in the CJ4 the generator switch input reads 0 with the generators on), so an aircraft's own
// input events are only used where they have been checked on that aircraft: see OVERRIDES below.
const SWITCHES = {
  battery: { caption: 'MASTER', label: 'BAT', event: 'TOGGLE_MASTER_BATTERY', simvar: 'ELECTRICAL MASTER BATTERY' },
  generators: { caption: 'MASTER', label: 'ALT', event: 'TOGGLE_MASTER_ALTERNATOR', simvar: 'GENERAL ENG MASTER ALTERNATOR:1' },
  avionics: { caption: 'AVIONICS', label: 'MASTER', event: 'TOGGLE_AVIONICS_MASTER', simvar: 'AVIONICS MASTER SWITCH' },
  fuelPump: { caption: 'FUEL', label: 'PUMP', event: 'TOGGLE_ELECT_FUEL_PUMP', simvar: 'GENERAL ENG FUEL PUMP SWITCH:1', color: C.amber },
};
/**
 * Checked per aircraft with tools/switchcheck.js: where the classic event does nothing, the aircraft's own input
 * events (all set together) and their on/off values. {match: title regex, switches: {name: {inputs, on, off}}}
 */
const OVERRIDES = [];

function switchKey(ac, name, label) {
  const d = SWITCHES[name];
  const o = (OVERRIDES.find((x) => x.match.test(ac.title || '')) || { switches: {} }).switches[name];
  const lab = label || d.label;
  if (o && o.inputs.every((x) => has(ac, x))) return group(d.caption, lab, o.inputs, null, { color: d.color, on: o.on, off: o.off });
  return tog(d.caption, lab, d.event, d.simvar, { color: d.color });
}
const battery = (ac) => switchKey(ac, 'battery');
const generators = (ac, label = 'ALT') => switchKey(ac, 'generators', label);
const avionics = (ac) => switchKey(ac, 'avionics');
const fuelPumps = (ac) => switchKey(ac, 'fuelPump');

/** Readout for engine 1, or engines 1 and 2 stacked on a twin. */
function perEngine(caption, simvar, unit, fmt, unitLabel, ac, color = () => C.cyan) {
  if (ac.engines >= 2) {
    return {
      draw: (s) => ({ style: 'dual', caption, rows: [1, 2].map((i) => {
        const x = s.v(`${simvar}:${i}`, unit);
        return { label: `ENG ${i}`, unit: unitLabel, value: fmt(x), color: x == null ? undefined : color(x) };
      }) }),
    };
  }
  return { draw: (s) => { const x = s.v(`${simvar}:1`, unit); return { style: 'value', caption, value: fmt(x), unit: unitLabel, color: x == null ? undefined : color(x) }; } };
}
const whole = (x) => (x == null ? null : n(Math.round(x)));
const tens = (x) => (x == null ? null : n(Math.round(x / 10) * 10));
const pct = (x) => (x == null ? null : Math.round(x) + '%');
const oneDp = (x) => (x == null ? null : x.toFixed(1));

// trim up above trim down in the left column of each FLY page
const trimUp = L.parts.trimFor('up'), trimDn = L.parts.trimFor('down');
const flaps = (dir, event, echo) => ({
  draw: (s) => ({ style: 'flaps', dir, index: s.v('FLAPS HANDLE INDEX', 'Number'), count: s.v('FLAPS NUM HANDLE POSITIONS', 'Number'), ring: stickEcho(s, echo) }),
  press: (s) => s.send(event),
});
const park = {
  draw: (s) => ({ style: 'toggle', caption: 'PARK BRAKE', label: 'PARK', state: bool(s.v('BRAKE PARKING POSITION', 'Bool')), color: C.red, onText: 'SET', offText: 'RELEASED', ring: stickEcho(s, 'parkBrake') }),
  press: (s) => s.send('PARKING_BRAKES'),
};
const ias = readout('IAS', 'AIRSPEED INDICATED', 'Knots', (x) => n(x), 'KT');
const alt = readout('ALTITUDE', 'INDICATED ALTITUDE', 'Feet', (x) => n(x == null ? null : Math.round(x / 10) * 10), 'FT');
const vs = readout('V/S', 'VERTICAL SPEED', 'Feet per minute', (x) => (x == null ? null : (x > 0 ? '+' : '') + n(Math.round(x / 10) * 10)), 'FPM');
const heading = readout('HEADING', 'PLANE HEADING DEGREES MAGNETIC', 'Degrees', hdg, 'MAG');
const agl = readout('ABOVE GROUND', 'PLANE ALT ABOVE GROUND', 'Feet', (x) => (x == null ? null : n(Math.max(0, Math.round(x / 10) * 10))), 'FT AGL');
const gearOr = (ac, other) => (ac.retract ? gearKey : other);

/** Left/right tanks where the aircraft has them, else the total. */
const fuelKey = {
  draw: (s) => {
    const cap = s.v('FUEL TANK LEFT MAIN CAPACITY', 'Gallons');
    if (cap > 0) return { style: 'tanks', left: s.v('FUEL TANK LEFT MAIN QUANTITY', 'Gallons'), right: s.v('FUEL TANK RIGHT MAIN QUANTITY', 'Gallons'), cap };
    const t = s.v('FUEL TOTAL QUANTITY', 'Gallons');
    return { style: 'value', caption: 'FUEL', value: t == null ? null : n(t, t < 100 ? 1 : 0), unit: 'GAL' };
  },
};
const fuelLbs = readout('FUEL', 'FUEL TOTAL QUANTITY WEIGHT', 'Pounds', (x) => (x == null ? null : n(Math.round(x / 10) * 10)), 'LB');

const voltsKey = {
  draw: (s) => {
    const b = s.v('ELECTRICAL MAIN BUS VOLTAGE', 'Volts'), a = s.v('ELECTRICAL BATTERY VOLTAGE', 'Volts');
    return { style: 'dual', caption: 'ELECTRICAL', rows: [
      { label: 'MAIN BUS', unit: 'V', value: oneDp(b), color: C.cyan },
      { label: 'BATTERY', unit: 'V', value: oneDp(a), color: C.cyan },
    ] };
  },
};
const oilKey = {
  draw: (s) => {
    const t = s.v('GENERAL ENG OIL TEMPERATURE:1', 'Fahrenheit'), p = s.v('GENERAL ENG OIL PRESSURE:1', 'Psi');
    return { style: 'dual', caption: 'OIL · ENG 1', rows: [
      { label: 'TEMP', unit: '°F', value: whole(t), color: C.cyan },
      { label: 'PRESS', unit: 'PSI', value: whole(p), color: C.cyan },
    ] };
  },
};
const chtEgt = {
  draw: (s) => {
    const c = s.v('ENG CYLINDER HEAD TEMPERATURE:1', 'Fahrenheit'), e = s.v('GENERAL ENG EXHAUST GAS TEMPERATURE:1', 'Fahrenheit');
    return { style: 'dual', caption: 'ENGINE TEMPS', rows: [
      { label: 'CHT', unit: '°F', value: whole(c), color: C.amber },
      { label: 'EGT', unit: '°F', value: whole(e), color: C.amber },
    ] };
  },
};
const mixture = {
  draw: (s) => {
    const m = s.v('GENERAL ENG MIXTURE LEVER POSITION:1', 'Percent');
    return { style: 'value', caption: 'MIXTURE', value: pct(m), unit: 'TAP: RICH', color: m == null ? undefined : m >= 99 ? C.cyan : C.amber };
  },
  press: (s) => s.send('MIXTURE_SET', 16383), // all engines full rich
};
const mixStep = (dir) => ({
  draw: () => ({ style: 'button', caption: 'MIXTURE', glyph: dir < 0 ? 'minus' : 'plus', label: dir < 0 ? 'LEAN · HOLD' : 'RICH · HOLD' }),
  press: (s) => s.send(dir < 0 ? 'MIXTURE_DECR' : 'MIXTURE_INCR'),
  repeat: true,
});
const rpmKey = (ac) => (ac.engines >= 2 ? perEngine('ENGINE RPM', 'GENERAL ENG RPM', 'Rpm', tens, 'RPM', ac) : {
  draw: (s) => {
    const r = s.v('GENERAL ENG RPM:1', 'Rpm'), t = s.v('GENERAL ENG THROTTLE LEVER POSITION:1', 'Percent');
    return { style: 'value', caption: 'ENGINE RPM', value: tens(r), unit: t == null ? 'RPM' : `THROTTLE ${Math.round(t)}%` };
  },
});

/** Magnetos through the classic events, shown from the left/right magneto SimVars. */
function magnetoClassic(i, title) {
  const pos = (s) => {
    const l = s.v(`RECIP ENG LEFT MAGNETO:${i}`, 'Bool'), r = s.v(`RECIP ENG RIGHT MAGNETO:${i}`, 'Bool');
    if (l == null || r == null) return null;
    return l && r ? 3 : l ? 2 : r ? 1 : 0;
  };
  return {
    draw: (s) => ({ style: 'magnetos', title, pos: pos(s), note: 'TAP: NEXT · HOLD: OFF' }),
    tap: (s) => { const p = pos(s); if (p == null) throw new Error('magnetos unavailable'); const next = ['RIGHT', 'LEFT', 'BOTH'][p]; if (next) s.send(`MAGNETO${i}_${next}`); },
    hold: { ms: 1000, fn: (s) => s.send(`MAGNETO${i}_OFF`) },
  };
}

/** Ignition for piston engine i: the aircraft's magneto key input (0 OFF, 1 R, 2 L, 3 BOTH, as in the C172), else classic. */
function ignition(ac, i) {
  const title = ac.engines >= 2 ? `MAGS ENG ${i}` : 'MAGNETOS';
  const mag = `ENGINE_MAGNETO_${i}`;
  return has(ac, mag) ? magnetoFor(mag, title) : magnetoClassic(i, title);
}

// ---------------------------------------------------------------- lights (same on every kind)

const light = (label, event, simvar) => tog('LIGHTS', label, event, simvar, { color: C.amber });
const lightsPage = (ac) => [
  light('BEACON', 'TOGGLE_BEACON_LIGHTS', 'LIGHT BEACON'), light('NAV', 'TOGGLE_NAV_LIGHTS', 'LIGHT NAV'),
  light('STROBE', 'STROBES_TOGGLE', 'LIGHT STROBE'), light('TAXI', 'TOGGLE_TAXI_LIGHTS', 'LIGHT TAXI'),
  light('LANDING', 'LANDING_LIGHTS_TOGGLE', 'LIGHT LANDING'),
  light('PANEL', 'PANEL_LIGHTS_TOGGLE', 'LIGHT PANEL'),
  ac.cls === 'jet' ? light('LOGO', 'TOGGLE_LOGO_LIGHTS', 'LIGHT LOGO') : light('CABIN', 'TOGGLE_CABIN_LIGHTS', 'LIGHT CABIN'),
  tog('ANTI-ICE', 'PITOT', 'PITOT_HEAT_TOGGLE', 'PITOT HEAT', { color: C.cyan }),
  tog('ANTI-ICE', 'DE-ICE', 'TOGGLE_STRUCTURAL_DEICE', 'STRUCTURAL DEICE SWITCH', { color: C.cyan }),
  voltsKey,
];

// ---------------------------------------------------------------- autopilot

const GA_KNOB = L.KNOB;
const SPD_KNOB = { name: 'SPD', unit: 'KT', dec: 'AP_SPD_VAR_DEC', inc: 'AP_SPD_VAR_INC', val: (s) => n(s.v('AUTOPILOT AIRSPEED HOLD VAR', 'Knots')), color: C.magenta };
const JET_KNOB = [SPD_KNOB, ...L.KNOB];
const fdKey = { draw: (s) => ({ style: 'toggle', caption: 'FLIGHT DIR', label: 'FD', state: bool(s.v('AUTOPILOT FLIGHT DIRECTOR ACTIVE', 'Bool')), color: C.magenta }), press: (s) => s.send('TOGGLE_FLIGHT_DIRECTOR') };
const hdgMode = apMode('HDG', 'AP_PANEL_HEADING_HOLD', 'AUTOPILOT HEADING LOCK', (s) => hdg(s.v('AUTOPILOT HEADING LOCK DIR', 'Degrees')) || 'HDG');
const navMode = apMode('NAV', 'AP_NAV1_HOLD', 'AUTOPILOT NAV1 LOCK', (s) => { const c = hdg(s.v('NAV OBS:1', 'Degrees')); return c ? 'CRS ' + c : 'NAV'; });
const aprMode = apMode('APPROACH', 'AP_APR_HOLD', 'AUTOPILOT APPROACH HOLD', () => 'APR');
const altMode = apMode('ALT', 'AP_PANEL_ALTITUDE_HOLD', 'AUTOPILOT ALTITUDE LOCK', (s) => n(s.v('AUTOPILOT ALTITUDE LOCK VAR', 'Feet')) || 'ALT');
const vsMode = apMode('V/S', 'AP_PANEL_VS_HOLD', 'AUTOPILOT VERTICAL HOLD', (s) => { const x = s.v('AUTOPILOT VERTICAL HOLD VAR', 'Feet per minute'); return x == null ? 'V/S' : (x > 0 ? '+' : '') + n(x); });
const flcMode = apMode('FLC · SPEED', 'FLIGHT_LEVEL_CHANGE', 'AUTOPILOT FLIGHT LEVEL CHANGE', (s) => { const x = s.v('AUTOPILOT AIRSPEED HOLD VAR', 'Knots'); return x == null ? 'FLC' : n(x) + ' KT'; });

const gaAutopilot = [apMaster, fdKey, hdgMode, navMode, aprMode, altMode, vsMode, knobKeyFor(GA_KNOB), knobTurnFor(GA_KNOB, -1), knobTurnFor(GA_KNOB, 1)];
const jetAutopilot = [apMaster, flcMode, hdgMode, navMode, aprMode, altMode, vsMode, knobKeyFor(JET_KNOB), knobTurnFor(JET_KNOB, -1), knobTurnFor(JET_KNOB, 1)];

// ---------------------------------------------------------------- per kind

const TABS = {
  standard: [{ label: 'FLY', icon: 'flight' }, { label: 'ENGINE', icon: 'engine' }, { label: 'AUTOPILOT', icon: 'ap' }, { label: 'RADIO', icon: 'radio' }, { label: 'LIGHTS', icon: 'lights' }],
  glider: [{ label: 'FLY', icon: 'flight' }, { label: 'SOAR', icon: 'soar' }, { label: 'ENGINE', icon: 'engine' }, { label: 'RADIO', icon: 'radio' }, { label: 'LIGHTS', icon: 'lights' }],
};
const RADIO = L.MSFS_PAGES[3];

function pistonEngine(ac) {
  return [battery(ac), generators(ac, 'ALT'), avionics(ac), fuelPumps(ac),
    ignition(ac, 1), ac.engines >= 2 ? ignition(ac, 2) : chtEgt,
    mixture, mixStep(-1), mixStep(1), autoStartKey];
}

function piston(ac) {
  return [
    [trimUp, flaps('up', 'FLAPS_DECR', 'flapsUp'), flaps('down', 'FLAPS_INCR', 'flapsDown'), gearOr(ac, ias), park,
      trimDn, rpmKey(ac), fuelKey, ac.engines >= 2 ? perEngine('OIL TEMP', 'GENERAL ENG OIL TEMPERATURE', 'Fahrenheit', whole, '°F', ac) : oilKey, stickKey],
    pistonEngine(ac), gaAutopilot, RADIO, lightsPage(ac),
  ];
}

function turboprop(ac) {
  return [
    [trimUp, flaps('up', 'FLAPS_DECR', 'flapsUp'), flaps('down', 'FLAPS_INCR', 'flapsDown'), gearOr(ac, ias), park,
      trimDn, perEngine('TORQUE', 'ENG TORQUE PERCENT', 'Percent', pct, 'TRQ', ac), perEngine('ITT', 'TURB ENG ITT', 'Celsius', whole, '°C', ac, () => C.amber),
      fuelKey, stickKey],
    [battery(ac), generators(ac, 'GEN'), avionics(ac), fuelPumps(ac), readout('PROP LEVER', 'GENERAL ENG PROPELLER LEVER POSITION:1', 'Percent', pct, 'ENG 1'),
      perEngine('GAS GEN Ng', 'TURB ENG N1', 'Percent', oneDp, '%', ac), perEngine('PROP RPM', 'PROP RPM', 'Rpm', tens, 'RPM', ac),
      oilKey, perEngine('FUEL FLOW', 'ENG FUEL FLOW GPH', 'Gallons per hour', oneDp, 'GPH', ac), autoStartKey],
    gaAutopilot, RADIO, lightsPage(ac),
  ];
}

const speedbrake = {
  draw: (s) => {
    const p = s.v('SPOILERS HANDLE POSITION', 'Percent'), armed = bool(s.v('SPOILERS ARMED', 'Bool'));
    return { style: 'value', caption: 'SPEEDBRAKE', value: pct(p), unit: armed ? 'ARMED · HOLD' : 'HOLD: ARM', color: p > 1 ? C.amber : C.cyan };
  },
  tap: (s) => s.send('SPOILERS_TOGGLE'),
  hold: { ms: 1000, fn: (s) => s.send('SPOILERS_ARM_TOGGLE') },
};
const athr = tog('AUTOTHROTTLE', 'A/THR', 'AUTO_THROTTLE_ARM', 'AUTOPILOT THROTTLE ARM', { onText: 'ARMED' });
const apuKey = {
  draw: (s) => { const r = s.v('APU PCT RPM', 'Percent'); return { style: 'value', caption: 'APU · HOLD 1 S', value: pct(r), unit: r > 1 ? 'HOLD: STOP' : 'HOLD: START', color: r > 95 ? C.green : C.cyan }; },
  hold: { ms: 1000, fn: (s) => s.send((s.v('APU PCT RPM', 'Percent') || 0) > 1 ? 'APU_OFF_SWITCH' : 'APU_STARTER') },
};

function jet(ac) {
  const n1 = perEngine('N1', 'TURB ENG N1', 'Percent', oneDp, '%', ac);
  return [
    [trimUp, ias, n1, athr, speedbrake, trimDn, gearOr(ac, vs), flaps('up', 'FLAPS_DECR', 'flapsUp'), flaps('down', 'FLAPS_INCR', 'flapsDown'), park],
    [battery(ac), generators(ac, 'GEN'), apuKey, fuelPumps(ac), avionics(ac),
      n1, perEngine('N2', 'TURB ENG N2', 'Percent', oneDp, '%', ac), perEngine('EGT', 'ENG EXHAUST GAS TEMPERATURE', 'Celsius', whole, '°C', ac, () => C.amber),
      fuelLbs, autoStartKey],
    jetAutopilot, RADIO, lightsPage(ac),
  ];
}

const rotorBrake = tog('ROTOR', 'BRAKE', 'ROTOR_BRAKE', 'ROTOR BRAKE ACTIVE', { color: C.red, onText: 'ON' });
function heli(ac) {
  const turbine = ac.engineType !== 0;
  const power = turbine
    ? readout('TORQUE', 'ENG TORQUE PERCENT:1', 'Percent', pct, 'TRQ')
    : readout('ENGINE RPM', 'GENERAL ENG RPM:1', 'Rpm', tens, 'RPM');
  return [
    [readout('ROTOR', 'ROTOR RPM PCT:1', 'Percent', pct, 'NR'), power, ias, agl, vs, stickKey, fuelKey, rotorBrake, heading, pauseKey],
    [battery(ac), generators(ac, 'GEN'), avionics(ac), fuelPumps(ac),
      turbine ? readout('POWER TURBINE N2', 'TURB ENG N2:1', 'Percent', oneDp, '%') : ignition(ac, 1),
      turbine ? readout('GAS GEN N1', 'TURB ENG N1:1', 'Percent', oneDp, '%') : chtEgt,
      turbine ? readout('TOT', 'TURB ENG ITT:1', 'Celsius', whole, '°C', { color: C.amber }) : mixture,
      oilKey, readout('FUEL FLOW', 'ENG FUEL FLOW GPH:1', 'Gallons per hour', oneDp, 'GPH'), autoStartKey],
    gaAutopilot, RADIO, lightsPage(ac),
  ];
}

const airbrakes = {
  draw: (s) => { const p = s.v('SPOILERS HANDLE POSITION', 'Percent'); return { style: 'value', caption: 'AIRBRAKES', value: pct(p), unit: 'TAP: TOGGLE', color: p > 1 ? C.amber : C.cyan }; },
  press: (s) => s.send('SPOILERS_TOGGLE'),
};
const vario = {
  draw: (s) => {
    const x = s.v('VARIOMETER RATE', 'Knots');
    return { style: 'value', caption: 'VARIO', value: x == null ? null : (x > 0.05 ? '+' : '') + x.toFixed(1), unit: 'KT', color: x == null ? undefined : x > 0.2 ? C.green : x < -2 ? C.red : C.cyan };
  },
};
const wind = {
  draw: (s) => {
    const d = s.v('AMBIENT WIND DIRECTION', 'Degrees'), v = s.v('AMBIENT WIND VELOCITY', 'Knots');
    return { style: 'dual', caption: 'WIND', rows: [
      { label: 'FROM', unit: 'TRUE', value: hdg(d), color: C.cyan },
      { label: 'SPEED', unit: 'KT', value: whole(v), color: C.cyan },
    ] };
  },
};
function glider(ac) {
  return [
    [trimUp, flaps('up', 'FLAPS_DECR', 'flapsUp'), flaps('down', 'FLAPS_INCR', 'flapsDown'), gearOr(ac, agl), airbrakes,
      trimDn, ias, vario, alt, stickKey],
    [vario, wind, agl, readout('GROUND SPEED', 'GROUND VELOCITY', 'Knots', whole, 'KT'), readout('LOAD', 'G FORCE', 'GForce', oneDp, 'G'),
      tog('WATER', 'BALLAST', 'TOGGLE_WATER_BALLAST_VALVE', 'WATER BALLAST VALVE', { color: C.cyan, onText: 'DUMPING', offText: 'CLOSED' }),
      { draw: () => ({ style: 'button', caption: 'TOW', glyph: 'up', label: 'REQUEST' }), press: (s) => s.send('TOW_PLANE_REQUEST') },
      { draw: () => ({ style: 'button', caption: 'TOW', glyph: 'swap', label: 'RELEASE' }), press: (s) => s.send('TOW_PLANE_RELEASE') },
      heading, readout('WEIGHT', 'TOTAL WEIGHT', 'Pounds', whole, 'LB')],
    pistonEngine(ac), RADIO, lightsPage(ac),
  ];
}

const BUILD = { piston, turboprop, jet, heli, glider };
const cache = new Map();

/**
 * Page set for an aircraft: ac = {cls, engines, retract, engineType, inputs: [input event names]}.
 * Returns 'skyhawk' / 'generic' for those kinds, else {tabs, pages}.
 */
function pagesFor(ac) {
  if (!BUILD[ac.cls]) return ac.cls === 'skyhawk' ? 'skyhawk' : 'generic';
  const norm = { cls: ac.cls, title: ac.title || '', engines: Math.max(1, Math.round(ac.engines || 1)), retract: !!ac.retract, engineType: ac.engineType, inputs: ac.inputs || [] };
  const key = JSON.stringify([norm.cls, norm.title, norm.engines, norm.retract, norm.engineType, norm.inputs.slice().sort()]);
  let set = cache.get(key);
  if (!set) {
    set = { kind: norm.cls, tabs: norm.cls === 'glider' ? TABS.glider : TABS.standard, pages: BUILD[norm.cls](norm) };
    if (cache.size > 20) cache.clear();
    cache.set(key, set);
  }
  return set;
}

module.exports = { classify, pagesFor, KINDS, KIND_NAMES, JET_KNOB, GA_KNOB, OVERRIDES, _test: { group } };
