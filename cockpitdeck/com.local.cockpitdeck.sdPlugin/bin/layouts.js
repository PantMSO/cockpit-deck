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

function msfsSlot(slot, page) {
  if (slot >= 10 && slot < 15) {
    const i = slot - 10;
    return {
      draw: (s) => ({ style: 'tab', ...MSFS_TABS[i], active: page === i, link: s.connected() }),
      press: (s) => s.setPage(i),
    };
  }
  return MSFS_PAGES[page][slot] || null;
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

module.exports = { msfsSlot, forzaSlot, MSFS_PAGES, MSFS_TABS, FORZA };
