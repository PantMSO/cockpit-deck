'use strict';
// What every key shows and does, per game and page. Slots run left-to-right, top-to-bottom (0..14) on a 5x3 deck.
const { COLORS: C } = require('./render.js');

// ---------------------------------------------------------------- helpers

const n = (x, d = 0) => (x == null ? null : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const bool = (x) => (x == null ? null : x !== 0);
const hdg = (x) => (x == null ? null : String(((Math.round(x) % 360) + 360) % 360 || 360).padStart(3, '0') + '°');

/** Switch that toggles a sim event and lights from a SimVar. */
function tog(caption, label, event, simvar, opts = {}) {
  return {
    draw: (s) => ({ style: 'toggle', caption, label, state: bool(s.v(simvar, 'Bool')), color: opts.color, onText: opts.onText, offText: opts.offText }),
    press: (s) => s.send(event),
  };
}

/** Readout of a SimVar; pressing fires `event` if given. */
function readout(caption, simvar, unit, fmt, unitLabel, opts = {}) {
  return {
    draw: (s) => ({
      style: 'value', caption, unit: unitLabel, color: opts.color,
      value: fmt(s.v(simvar, unit)),
      active: opts.modeVar ? bool(s.v(opts.modeVar, 'Bool')) : undefined,
    }),
    press: opts.event ? (s) => s.send(opts.event) : null,
  };
}

/** Momentary button that fires a sim event; repeats while held if `repeat`. */
function btn(caption, glyph, label, event, repeat = false) {
  return { draw: () => ({ style: 'button', caption, glyph, label }), press: (s) => s.send(event), repeat };
}

const flapsKey = (dir, event) => ({
  draw: (s) => ({ style: 'flaps', dir, index: s.v('FLAPS HANDLE INDEX', 'Number'), count: s.v('FLAPS NUM HANDLE POSITIONS', 'Number') }),
  press: (s) => s.send(event),
  repeat: false,
});

const gearKey = {
  draw: (s) => ({
    style: 'gear',
    down: bool(s.v('GEAR HANDLE POSITION', 'Bool')),
    retractable: bool(s.v('IS GEAR RETRACTABLE', 'Bool')),
    positions: [s.v('GEAR CENTER POSITION', 'Percent Over 100'), s.v('GEAR LEFT POSITION', 'Percent Over 100'), s.v('GEAR RIGHT POSITION', 'Percent Over 100')],
  }),
  press: (s) => s.send('GEAR_TOGGLE'),
};

const pauseKey = {
  draw: (s) => ({ style: 'toggle', caption: 'SIM', label: 'PAUSE', state: s.paused(), color: C.amber, onText: 'PAUSED', offText: 'RUNNING' }),
  press: (s) => s.send('PAUSE_TOGGLE'),
};

function radioKey(caption, activeVar, stbyVar, digits, swapEvent) {
  return {
    draw: (s) => {
      const a = s.v(activeVar, 'MHz'), b = s.v(stbyVar, 'MHz');
      return { style: 'radio', caption, active: a == null ? null : a.toFixed(digits), standby: b == null ? null : b.toFixed(digits) };
    },
    press: (s) => s.send(swapEvent),
  };
}

// ---------------------------------------------------------------- MSFS 2024

const MSFS_TABS = [
  { label: 'FLIGHT', icon: 'flight' },
  { label: 'AUTOPILOT', icon: 'ap' },
  { label: 'LIGHTS', icon: 'lights' },
  { label: 'RADIO', icon: 'radio' },
  { label: 'SYSTEMS', icon: 'systems' },
];

const MSFS_PAGES = [
  // FLIGHT
  [
    readout('IAS', 'AIRSPEED INDICATED', 'Knots', (x) => n(x), 'KT'),
    readout('ALTITUDE', 'INDICATED ALTITUDE', 'Feet', (x) => n(x == null ? null : Math.round(x / 10) * 10), 'FT'),
    readout('V/S', 'VERTICAL SPEED', 'Feet per minute', (x) => (x == null ? null : (x > 0 ? '+' : '') + n(Math.round(x / 10) * 10)), 'FPM'),
    readout('HEADING', 'PLANE HEADING DEGREES MAGNETIC', 'Degrees', hdg, 'MAG'),
    pauseKey,
    gearKey,
    flapsKey('up', 'FLAPS_DECR'),
    flapsKey('down', 'FLAPS_INCR'),
    tog('SPOILERS', 'ARM', 'SPOILERS_ARM_TOGGLE', 'SPOILERS ARMED', { color: C.amber, onText: 'ARMED' }),
    tog('BRAKE', 'PARK', 'PARKING_BRAKES', 'BRAKE PARKING POSITION', { color: C.red, onText: 'SET', offText: 'RELEASED' }),
  ],
  // AUTOPILOT
  [
    tog('AUTOPILOT', 'AP', 'AP_MASTER', 'AUTOPILOT MASTER', { onText: 'ENGAGED' }),
    readout('HDG', 'AUTOPILOT HEADING LOCK DIR', 'Degrees', hdg, 'BUG', { event: 'AP_PANEL_HEADING_HOLD', modeVar: 'AUTOPILOT HEADING LOCK', color: C.magenta }),
    tog('LATERAL', 'NAV', 'AP_NAV1_HOLD', 'AUTOPILOT NAV1 LOCK'),
    tog('APPROACH', 'APR', 'AP_APR_HOLD', 'AUTOPILOT APPROACH HOLD'),
    readout('V/S', 'AUTOPILOT VERTICAL HOLD VAR', 'Feet per minute', (x) => (x == null ? null : (x > 0 ? '+' : '') + n(x)), 'FPM', { event: 'AP_PANEL_VS_HOLD', modeVar: 'AUTOPILOT VERTICAL HOLD', color: C.magenta }),
    btn('HDG BUG', 'minus', 'HOLD TO SLEW', 'HEADING_BUG_DEC', true),
    btn('HDG BUG', 'plus', 'HOLD TO SLEW', 'HEADING_BUG_INC', true),
    readout('ALT', 'AUTOPILOT ALTITUDE LOCK VAR', 'Feet', (x) => n(x), 'FT', { event: 'AP_PANEL_ALTITUDE_HOLD', modeVar: 'AUTOPILOT ALTITUDE LOCK', color: C.magenta }),
    btn('ALT SEL', 'minus', 'HOLD TO SLEW', 'AP_ALT_VAR_DEC', true),
    btn('ALT SEL', 'plus', 'HOLD TO SLEW', 'AP_ALT_VAR_INC', true),
  ],
  // LIGHTS
  [
    tog('LIGHTS', 'NAV', 'TOGGLE_NAV_LIGHTS', 'LIGHT NAV', { color: C.amber }),
    tog('LIGHTS', 'BEACON', 'TOGGLE_BEACON_LIGHTS', 'LIGHT BEACON', { color: C.amber }),
    tog('LIGHTS', 'STROBE', 'STROBES_TOGGLE', 'LIGHT STROBE', { color: C.amber }),
    tog('LIGHTS', 'LANDING', 'LANDING_LIGHTS_TOGGLE', 'LIGHT LANDING', { color: C.amber }),
    tog('LIGHTS', 'TAXI', 'TOGGLE_TAXI_LIGHTS', 'LIGHT TAXI', { color: C.amber }),
    tog('LIGHTS', 'LOGO', 'TOGGLE_LOGO_LIGHTS', 'LIGHT LOGO', { color: C.amber }),
    tog('LIGHTS', 'WING', 'TOGGLE_WING_LIGHTS', 'LIGHT WING', { color: C.amber }),
    tog('LIGHTS', 'PANEL', 'PANEL_LIGHTS_TOGGLE', 'LIGHT PANEL', { color: C.amber }),
    tog('LIGHTS', 'CABIN', 'TOGGLE_CABIN_LIGHTS', 'LIGHT CABIN', { color: C.amber }),
    tog('LIGHTS', 'RECOG', 'TOGGLE_RECOGNITION_LIGHTS', 'LIGHT RECOGNITION', { color: C.amber }),
  ],
  // RADIO
  [
    radioKey('COM 1 · SWAP', 'COM ACTIVE FREQUENCY:1', 'COM STANDBY FREQUENCY:1', 3, 'COM_STBY_RADIO_SWAP'),
    btn('COM MHz', 'minus', 'HOLD TO SPIN', 'COM_RADIO_WHOLE_DEC', true),
    btn('COM MHz', 'plus', 'HOLD TO SPIN', 'COM_RADIO_WHOLE_INC', true),
    btn('COM kHz', 'minus', 'HOLD TO SPIN', 'COM_RADIO_FRACT_DEC', true),
    btn('COM kHz', 'plus', 'HOLD TO SPIN', 'COM_RADIO_FRACT_INC', true),
    radioKey('NAV 1 · SWAP', 'NAV ACTIVE FREQUENCY:1', 'NAV STANDBY FREQUENCY:1', 2, 'NAV1_RADIO_SWAP'),
    btn('NAV MHz', 'minus', 'HOLD TO SPIN', 'NAV1_RADIO_WHOLE_DEC', true),
    btn('NAV MHz', 'plus', 'HOLD TO SPIN', 'NAV1_RADIO_WHOLE_INC', true),
    btn('NAV kHz', 'minus', 'HOLD TO SPIN', 'NAV1_RADIO_FRACT_DEC', true),
    btn('NAV kHz', 'plus', 'HOLD TO SPIN', 'NAV1_RADIO_FRACT_INC', true),
  ],
  // SYSTEMS
  [
    tog('ELECTRICAL', 'BATTERY', 'TOGGLE_MASTER_BATTERY', 'ELECTRICAL MASTER BATTERY'),
    tog('ELECTRICAL', 'ALTNR', 'TOGGLE_MASTER_ALTERNATOR', 'GENERAL ENG MASTER ALTERNATOR:1'),
    tog('ELECTRICAL', 'AVIONICS', 'TOGGLE_AVIONICS_MASTER', 'AVIONICS MASTER SWITCH'),
    tog('FUEL', 'PUMP', 'TOGGLE_ELECT_FUEL_PUMP1', 'GENERAL ENG FUEL PUMP SWITCH:1'),
    tog('ANTI-ICE', 'PITOT', 'PITOT_HEAT_TOGGLE', 'PITOT HEAT', { color: C.cyan }),
    {
      draw: (s) => ({ style: 'toggle', caption: 'ENGINE', label: 'START', state: bool(s.v('ENG COMBUSTION:1', 'Bool')), onText: 'RUNNING', offText: 'AUTO-START' }),
      press: (s) => s.send('ENGINE_AUTO_START'),
    },
    {
      draw: (s) => ({ style: 'toggle', caption: 'ENGINE', label: 'STOP', state: s.connected() ? false : null, offText: 'AUTO-STOP' }),
      press: (s) => s.send('ENGINE_AUTO_SHUTDOWN'),
    },
    readout('FUEL', 'FUEL TOTAL QUANTITY', 'Gallons', (x) => n(x, x != null && x < 100 ? 1 : 0), 'GAL'),
    readout('ENGINE 1', 'GENERAL ENG RPM:1', 'Rpm', (x) => n(x == null ? null : Math.round(x / 10) * 10), 'RPM'),
    tog('ANTI-ICE', 'DE-ICE', 'TOGGLE_STRUCTURAL_DEICE', 'STRUCTURAL DEICE SWITCH', { color: C.cyan }),
  ],
];

// ---------------------------------------------------------------- Cessna 172 Skyhawk (MSFS 2024, Asobo C172SP G1000)
// Rule: flying (axes, trim, flaps, brakes) stays on the stick; anything with a position you need to see lives here.
// Cockpit switches use the aircraft's own input events (checked live in the 2024 C172SP): the old key events for
// magnetos, fuel selector and fuel pump do nothing in this aircraft, and the matching SimVars don't follow the switch.

const ON = (x) => (x == null ? null : x > 0.5);
const stickEcho = (s, key) => {
  const st = s.stick();
  return st && st.connected && (s.cfg.stick.echo[key] || []).some((b) => st.held(b)) ? C.cyan : undefined;
};
const stickLabel = (s, key) => (s.cfg.stick.echo[key] || []).join('/');

/** Cockpit switch backed by an input event: shows its position, tap flips it. */
function sw(caption, label, input, opts = {}) {
  const on = opts.on == null ? 1 : opts.on;
  return {
    draw: (s) => { const x = s.input(input); return { style: 'toggle', caption, label, state: x == null ? null : ON(x / on), color: opts.color, onText: opts.onText, offText: opts.offText }; },
    press: (s) => { const cur = s.input(input); if (cur == null) throw new Error(input + ' unavailable'); s.setInput(input, cur / on > 0.5 ? 0 : on); },
  };
}

const MAG = 'ENGINE_MAGNETO_1'; // 0 OFF, 1 R, 2 L, 3 BOTH, 4 START
/** Magneto key for one engine's ignition input: tap steps OFF -> R -> L -> BOTH and stops; OFF needs a 1 s hold. */
const magnetoFor = (name, title) => ({
  draw: (s) => ({ style: 'magnetos', title, pos: s.input(name) == null ? null : Math.round(s.input(name)), note: 'TAP: NEXT · HOLD: OFF' }),
  tap: (s) => { const p = s.input(name); if (p == null) throw new Error('magnetos unavailable'); if (Math.round(p) < 3) s.setInput(name, Math.round(p) + 1); },
  hold: { ms: 1000, fn: (s) => s.setInput(name, 0) },
});
const magnetoKey = magnetoFor(MAG);
const starterKey = {
  draw: (s) => {
    const running = bool(s.v('ENG COMBUSTION:1', 'Bool'));
    const cranking = s.input(MAG) != null && Math.round(s.input(MAG)) === 4;
    return { style: 'toggle', caption: 'STARTER', label: 'START', state: s.input(MAG) == null ? null : cranking, color: C.amber,
      onText: 'CRANKING', offText: running ? 'RUNNING' : 'HOLD' };
  },
  // spring-loaded like the real key: START while held, back to BOTH on release
  press: (s) => {
    if (bool(s.v('ENG COMBUSTION:1', 'Bool'))) throw new Error('engine already running');
    if (s.input(MAG) == null) throw new Error('magnetos unavailable');
    s.setInput(MAG, 4); s.k.cranking = true;
  },
  release: (s) => { if (s.k.cranking) { s.k.cranking = false; s.setInput(MAG, 3); } },
};

const FUEL_SEL = 'FUEL_SELECTOR_1'; // 0 LEFT, 1 BOTH, 2 RIGHT
const fuelSelKey = {
  draw: (s) => {
    const p = s.input(FUEL_SEL);
    const names = ['LEFT', 'BOTH', 'RIGHT'];
    const name = p == null ? null : names[Math.round(p)];
    return { style: 'toggle', caption: 'FUEL SELECTOR', label: name || '– –', state: p == null ? null : Math.round(p) === 1, color: C.green, onText: 'NORMAL', offText: 'ONE TANK' };
  },
  press: (s) => { const p = s.input(FUEL_SEL); if (p == null) throw new Error('fuel selector unavailable'); s.setInput(FUEL_SEL, (Math.round(p) + 1) % 3); },
};

/** Trim up / trim down key: shows the trim gauge, tap nudges, hold keeps trimming. ELEV_TRIM_UP raises ELEVATOR TRIM PCT (nose up), checked live. */
const trimFor = (dir) => {
  const echo = dir === 'up' ? 'trimUp' : 'trimDown';
  return {
    draw: (s) => { const b = stickLabel(s, echo); return { style: 'trim', dir, pct: s.v('ELEVATOR TRIM PCT', 'Percent Over 100'), note: b ? 'BTN ' + b : '', ring: stickEcho(s, echo) }; },
    press: (s) => s.send(dir === 'up' ? 'ELEV_TRIM_UP' : 'ELEV_TRIM_DN'),
    repeat: true,
  };
};
const skyFlaps = (dir, event, echo) => ({
  draw: (s) => ({ style: 'flaps', dir, index: s.v('FLAPS HANDLE INDEX', 'Number'), count: s.v('FLAPS NUM HANDLE POSITIONS', 'Number'), degrees: [0, 10, 20, 30], ring: stickEcho(s, echo) }),
  press: (s) => s.send(event),
});
const parkKey = {
  draw: (s) => ({ style: 'toggle', caption: 'PARK BRAKE', label: 'PARK', state: bool(s.v('BRAKE PARKING POSITION', 'Bool')), color: C.red, onText: 'SET', offText: 'RELEASED', ring: stickEcho(s, 'parkBrake') }),
  press: (s) => { const cur = s.input('LANDING_GEAR_PARKINGBRAKE'); if (cur == null) throw new Error('parking brake unavailable'); s.setInput('LANDING_GEAR_PARKINGBRAKE', cur > 50 ? 0 : 100); },
};
const stickKey = {
  draw: (s) => {
    const st = s.stick();
    return { style: 'stick', connected: !!(st && st.connected), x: st ? st.axes.x : 0, y: st ? st.axes.y : 0, twist: st ? st.axes.twist : 0, slider: st ? st.axes.slider : 0,
      throttle: s.v('GENERAL ENG THROTTLE LEVER POSITION:1', 'Percent'), footer: s.cfg.stick.enabled ? 'NOT FOUND' : 'OFF' };
  },
};
const rpmKey = {
  draw: (s) => {
    const r = s.v('GENERAL ENG RPM:1', 'Rpm'), t = s.v('GENERAL ENG THROTTLE LEVER POSITION:1', 'Percent');
    return { style: 'value', caption: 'ENGINE RPM', value: r == null ? null : n(Math.round(r / 10) * 10), unit: t == null ? 'RPM' : `THROTTLE ${Math.round(t)}%`,
      color: r == null ? undefined : r > 2700 ? C.red : r >= 2100 ? C.green : C.cyan };
  },
};
const tanksKey = {
  draw: (s) => ({ style: 'tanks', left: s.v('FUEL TANK LEFT MAIN QUANTITY', 'Gallons'), right: s.v('FUEL TANK RIGHT MAIN QUANTITY', 'Gallons'), cap: s.v('FUEL TANK LEFT MAIN CAPACITY', 'Gallons') }),
};
// C172SP limits (POH): oil temp max 245 °F, oil pressure 50-90 psi normal, 20 min, 115 max.
const oilKey = {
  draw: (s) => {
    const t = s.v('GENERAL ENG OIL TEMPERATURE:1', 'Fahrenheit'), p = s.v('GENERAL ENG OIL PRESSURE:1', 'Psi');
    return { style: 'dual', caption: 'OIL', rows: [
      { label: 'TEMP', unit: '°F', value: t == null ? null : Math.round(t), color: t > 245 ? C.red : t >= 100 ? C.green : C.cyan },
      { label: 'PRESS', unit: 'PSI', value: p == null ? null : Math.round(p), color: p < 20 || p > 115 ? C.red : p >= 50 && p <= 90 ? C.green : C.amber },
    ] };
  },
};
const flowKey = {
  draw: (s) => {
    const f = s.v('ENG FUEL FLOW GPH:1', 'Gallons per hour'), e = s.v('GENERAL ENG EXHAUST GAS TEMPERATURE:1', 'Fahrenheit');
    return { style: 'dual', caption: 'MIXTURE CHECK', rows: [
      { label: 'FUEL FLOW', unit: 'GPH', value: f == null ? null : f.toFixed(1), color: C.cyan },
      { label: 'EGT', unit: '°F', value: e == null ? null : Math.round(e), color: C.amber },
    ] };
  },
};
const voltsKey = {
  draw: (s) => {
    const b = s.v('ELECTRICAL BUS VOLTAGE:1', 'Volts'), a = s.v('ELECTRICAL BATTERY VOLTAGE', 'Volts');
    return { style: 'dual', caption: 'ELECTRICAL', rows: [
      { label: 'BUS', unit: 'V', value: b == null ? null : b.toFixed(1), color: b < 25 ? C.amber : C.green },
      { label: 'BATTERY', unit: 'V', value: a == null ? null : a.toFixed(1), color: a < 24 ? C.amber : C.green },
    ] };
  },
};
const chtKey = readout('CHT', 'ENG CYLINDER HEAD TEMPERATURE:1', 'Fahrenheit', (x) => (x == null ? null : String(Math.round(x))), '°F', { color: C.amber });
const mixtureKey = {
  draw: (s) => {
    const m = s.v('GENERAL ENG MIXTURE LEVER POSITION:1', 'Percent');
    return { style: 'value', caption: 'MIXTURE', value: m == null ? null : Math.round(m) + '%', unit: 'TAP: RICH', color: m == null ? undefined : m >= 99 ? C.cyan : C.amber };
  },
  press: (s) => s.send('MIXTURE1_SET', 16383),
};
const autoStartKey = {
  draw: (s) => {
    const running = bool(s.v('ENG COMBUSTION:1', 'Bool'));
    return { style: 'toggle', caption: 'HOLD 1 S', label: running ? 'AUTO STOP' : 'AUTO START', state: running == null ? null : running, onText: 'RUNNING', offText: 'ENGINE OFF' };
  },
  hold: { ms: 1000, fn: (s) => s.send(bool(s.v('ENG COMBUSTION:1', 'Bool')) ? 'ENGINE_AUTO_SHUTDOWN' : 'ENGINE_AUTO_START') },
};

// The AP knob: tap to choose what the − / + keys turn.
const KNOB = [
  { name: 'HDG', unit: 'BUG', dec: 'HEADING_BUG_DEC', inc: 'HEADING_BUG_INC', val: (s) => hdg(s.v('AUTOPILOT HEADING LOCK DIR', 'Degrees')), color: C.magenta },
  { name: 'ALT', unit: 'FT SEL', dec: 'AP_ALT_VAR_DEC', inc: 'AP_ALT_VAR_INC', val: (s) => n(s.v('AUTOPILOT ALTITUDE LOCK VAR', 'Feet')), color: C.magenta },
  { name: 'V/S', unit: 'FPM', dec: 'AP_VS_VAR_DEC', inc: 'AP_VS_VAR_INC', val: (s) => { const x = s.v('AUTOPILOT VERTICAL HOLD VAR', 'Feet per minute'); return x == null ? null : (x > 0 ? '+' : '') + n(x); }, color: C.magenta },
  { name: 'CRS', unit: 'NAV 1', dec: 'VOR1_OBI_DEC', inc: 'VOR1_OBI_INC', val: (s) => hdg(s.v('NAV OBS:1', 'Degrees')), color: C.cyan },
  { name: 'BARO', unit: 'IN HG', dec: 'KOHLSMAN_DEC', inc: 'KOHLSMAN_INC', val: (s) => { const x = s.v('KOHLSMAN SETTING HG:1', 'Inches of Mercury'); return x == null ? null : x.toFixed(2); }, color: C.cyan },
];
const knobOf = (list, s) => list[s.knob() % list.length];
const knobKeyFor = (list) => ({
  draw: (s) => { const f = knobOf(list, s); return { style: 'value', caption: `KNOB: ${f.name}`, value: f.val(s), unit: f.unit + ' · TAP', color: f.color, ring: C.cyan }; },
  press: (s) => s.setKnob((s.knob() % list.length + 1) % list.length),
});
const knobTurnFor = (list, dir) => ({
  draw: (s) => ({ style: 'button', caption: knobOf(list, s).name, glyph: dir < 0 ? 'minus' : 'plus', label: 'HOLD TO SPIN' }),
  press: (s) => s.send(dir < 0 ? knobOf(list, s).dec : knobOf(list, s).inc),
  repeat: true,
});
const knobKey = knobKeyFor(KNOB);
const knobTurn = (dir) => knobTurnFor(KNOB, dir);
/** AP mode key whose label is that mode's target. */
function apMode(caption, event, modeVar, label) {
  return {
    draw: (s) => ({ style: 'toggle', caption, label: label(s), state: bool(s.v(modeVar, 'Bool')), color: C.green }),
    press: (s) => s.send(event),
  };
}
const apMaster = {
  draw: (s) => {
    const disc = s.apDisc();
    return { style: 'toggle', caption: 'AUTOPILOT', label: 'AP', state: bool(s.v('AUTOPILOT MASTER', 'Bool')), onText: 'ENGAGED', offText: disc ? 'DISC' : 'OFF', ring: disc ? C.amber : undefined };
  },
  press: (s) => s.send('AP_MASTER'),
};

const SKYHAWK_TABS = [
  { label: 'FLY', icon: 'flight' },
  { label: 'ENGINE', icon: 'engine' },
  { label: 'AUTOPILOT', icon: 'ap' },
  { label: 'RADIO', icon: 'radio' },
  { label: 'LIGHTS', icon: 'lights' },
];

const SKYHAWK_PAGES = [
  // FLY: what the stick moves, shown back to you, plus the engine gauges you glance at
  // trim up above trim down in the left column
  [trimFor('up'), skyFlaps('up', 'FLAPS_DECR', 'flapsUp'), skyFlaps('down', 'FLAPS_INCR', 'flapsDown'), parkKey, stickKey,
    trimFor('down'), rpmKey, tanksKey, oilKey, flowKey],
  // ENGINE: start and run
  [sw('MASTER', 'BAT', 'ELECTRICAL_BATTERY_1'), sw('MASTER', 'ALT', 'ELECTRICAL_ALTERNATOR_1'),
    sw('AVIONICS', 'BUS 1', 'ELECTRICAL_LINE_BUS_1_TO_AVIONICS_BUS_1'), sw('AVIONICS', 'BUS 2', 'ELECTRICAL_LINE_BUS_2_TO_AVIONICS_BUS_2'),
    sw('FUEL', 'PUMP', 'FUEL_PUMP_1', { color: C.amber }),
    magnetoKey, starterKey, mixtureKey, btn('MIXTURE', 'minus', 'LEAN · HOLD', 'MIXTURE_DECR', true), btn('MIXTURE', 'plus', 'RICH · HOLD', 'MIXTURE_INCR', true)],
  // AUTOPILOT: GFC 700 modes, each showing its target; one knob for all targets
  [apMaster,
    { draw: (s) => ({ style: 'toggle', caption: 'FLIGHT DIR', label: 'FD', state: bool(s.v('AUTOPILOT FLIGHT DIRECTOR ACTIVE', 'Bool')), color: C.magenta }), press: (s) => s.send('TOGGLE_FLIGHT_DIRECTOR') },
    apMode('HDG', 'AP_PANEL_HEADING_HOLD', 'AUTOPILOT HEADING LOCK', (s) => hdg(s.v('AUTOPILOT HEADING LOCK DIR', 'Degrees')) || 'HDG'),
    apMode('NAV', 'AP_NAV1_HOLD', 'AUTOPILOT NAV1 LOCK', (s) => { const c = hdg(s.v('NAV OBS:1', 'Degrees')); return c ? 'CRS ' + c : 'NAV'; }),
    apMode('APPROACH', 'AP_APR_HOLD', 'AUTOPILOT APPROACH HOLD', () => 'APR'),
    apMode('ALT', 'AP_PANEL_ALTITUDE_HOLD', 'AUTOPILOT ALTITUDE LOCK', (s) => n(s.v('AUTOPILOT ALTITUDE LOCK VAR', 'Feet')) || 'ALT'),
    apMode('V/S', 'AP_PANEL_VS_HOLD', 'AUTOPILOT VERTICAL HOLD', (s) => { const x = s.v('AUTOPILOT VERTICAL HOLD VAR', 'Feet per minute'); return x == null ? 'V/S' : (x > 0 ? '+' : '') + n(x); }),
    knobKey, knobTurn(-1), knobTurn(1)],
  // RADIO: same as the generic page
  null,
  // LIGHTS + the switches you set once per flight
  [sw('LIGHTS', 'BEACON', 'LIGHTING_BEACON_1', { color: C.amber }), sw('LIGHTS', 'NAV', 'LIGHTING_NAV_0', { color: C.amber }),
    sw('LIGHTS', 'STROBE', 'LIGHTING_STROBE_0', { color: C.amber }), sw('LIGHTS', 'TAXI', 'LIGHTING_TAXI_1', { color: C.amber }),
    sw('LIGHTS', 'LANDING', 'LIGHTING_LANDING_1', { color: C.amber }),
    sw('ANTI-ICE', 'PITOT', 'DEICE_PITOT_1', { color: C.cyan }), fuelSelKey, chtKey, voltsKey, autoStartKey],
];
SKYHAWK_PAGES[3] = MSFS_PAGES[3];

/** True when the loaded aircraft is a Cessna 172 (title "C172SP G1000 ..." / ATC model "...C172..."). */
const isSkyhawk = (title, model) => /c172|skyhawk|\b172\b/i.test(String(title || '')) || /c172/i.test(String(model || ''));

/** `set` is 'generic', 'skyhawk', or a built page set {tabs, pages} (see aircraft.js). */
function msfsSlot(slot, page, set = 'generic') {
  const tabs = typeof set === 'object' ? set.tabs : set === 'skyhawk' ? SKYHAWK_TABS : MSFS_TABS;
  const pages = typeof set === 'object' ? set.pages : set === 'skyhawk' ? SKYHAWK_PAGES : MSFS_PAGES;
  if (slot >= 10 && slot < 15) {
    const i = slot - 10;
    return {
      draw: (s) => ({ style: 'tab', ...tabs[i], active: page === i, link: s.connected() }),
      press: (s) => s.setPage(i),
    };
  }
  return (pages[page] && pages[page][slot]) || null;
}

// ---------------------------------------------------------------- Forza Horizon 6

const time = (sec) => {
  if (sec == null || !(sec > 0)) return null;
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
};

function fz(caption, fn, unitFn, opts = {}) {
  return {
    draw: (s) => {
      const t = s.forza();
      return { style: 'value', caption, value: t ? fn(t, s) : null, unit: t ? (unitFn ? unitFn(t, s) : '') : 'NO DATA', color: opts.color };
    },
    press: opts.press || null,
  };
}

function fzKey(caption, glyph, keyName) {
  return {
    draw: (s) => ({ style: 'button', caption, glyph, label: s.cfg.forza.keys[keyName] }),
    press: (s) => s.key(s.cfg.forza.keys[keyName]),
  };
}

const FORZA = [
  fz('SPEED', (t, s) => n(s.cfg.forza.units === 'kmh' ? t.speed * 3.6 : t.speed * 2.236936), (t, s) => (s.cfg.forza.units === 'kmh' ? 'KM/H · TAP' : 'MPH · TAP'),
    { color: C.white, press: (s) => s.toggleUnits() }),
  { draw: (s) => ({ style: 'gearBig', gear: s.forza() ? s.forza().gear : null }) },
  { draw: (s) => { const t = s.forza(); return { style: 'rpm', rpm: t ? t.rpm : null, max: t ? t.maxRpm : 0 }; } },
  fz('BOOST', (t) => (t.boost > 0 ? t.boost.toFixed(1) : '0.0'), () => 'PSI'),
  fz('POSITION', (t) => (t.position > 0 ? 'P' + t.position : '—'), (t) => (t.position > 0 ? 'RACE' : 'FREE ROAM')),
  fz('LAP', (t) => (t.position > 0 ? String(t.lap + 1) : '—'), (t) => (t.position > 0 ? time(t.curLap) || '' : 'FREE ROAM')),
  fz('LAST LAP', (t) => time(t.lastLap) || '—', () => 'TIME', { color: C.amber }),
  fz('BEST LAP', (t) => time(t.bestLap) || '—', () => 'TIME', { color: C.magenta }),
  { draw: (s) => ({ style: 'tyres', temps: s.forza() ? s.forza().tyreC : null }) },
  fz('CAR', (t) => (t.pi > 0 ? String(t.pi) : '—'), () => 'PI'),
  fzKey('REWIND', 'rewind', 'rewind'),
  fzKey('HORN', 'horn', 'horn'),
  fz('POWER', (t) => n(Math.max(0, t.power) / 745.7), () => 'HP'),
  fz('TOP SPEED', (t, s) => n(s.cfg.forza.units === 'kmh' ? s.peak() * 3.6 : s.peak() * 2.236936), () => 'TAP TO RESET',
    { color: C.green, press: (s) => s.resetPeak() }),
  fzKey('MENU', 'pause', 'pause'),
];

function forzaSlot(slot) { return FORZA[slot] || null; }

module.exports = {
  msfsSlot, forzaSlot, isSkyhawk, MSFS_PAGES, MSFS_TABS, SKYHAWK_PAGES, SKYHAWK_TABS, KNOB, FORZA,
  // building blocks for the per-aircraft page sets in aircraft.js
  parts: {
    trimFor, n, bool, hdg, ON, tog, readout, btn, gearKey, pauseKey, sw, magnetoFor, stickEcho, stickLabel, stickKey, tanksKey,
    knobKeyFor, knobTurnFor, apMode, apMaster, autoStartKey, mixtureKey, flowKey, chtKey,
  },
};
