'use strict';
// Presses each on/off key of the loaded aircraft's pages exactly as the deck would, checks the key shows the change,
// then presses it again and checks it's back where it started. Only runs on the ground with every engine stopped,
// and skips keys that could start, move or arm anything (starter, autopilot, autothrottle, gear, ballast, tow).
// usage: node switchcheck.js [outFile.json]
const fs = require('fs');
const path = require('path');
const PLUGIN = path.join(__dirname, '..', 'com.local.cockpitdeck.sdPlugin');
const { Msfs } = require(path.join(PLUGIN, 'bin', 'msfs.js'));
const { msfsSlot } = require(path.join(PLUGIN, 'bin', 'layouts.js'));
const { classify, pagesFor, KIND_NAMES } = require(path.join(PLUGIN, 'bin', 'aircraft.js'));
const { cfg } = require('./fixtures.js');

const SAFE_CAPTION = /^(MASTER|AVIONICS|FUEL|LIGHTS|ANTI-ICE|PARK BRAKE|FLIGHT DIR)( ×\d+)?$/;
const WAIT = 1500;
// Input events that may be the same switch as a key, tried when the key's classic event does nothing.
const CANDIDATES = {
  'MASTER BAT': /^ELECTRICAL_(BATTERY_\d+|SWITCH_BATTERY_MASTER|MASTER_BATTERY)$/,
  'MASTER ALT': /^ELECTRICAL_(ALTERNATOR|GENERATOR)_\d+$/,
  'MASTER GEN': /^ELECTRICAL_(ALTERNATOR|GENERATOR)_\d+$/,
  'AVIONICS MASTER': /^ELECTRICAL_.*AVIONICS/,
  'FUEL PUMP': /^FUEL_PUMP_\d+$/,
};
const msfs = new Msfs(() => {});
const scope = {
  cfg, k: {},
  v: (n, u) => msfs.get(msfs.watch(n, u)),
  input: (n) => msfs.input(n),
  send: (ev, d = 0) => { if (!msfs.send(ev, d)) throw new Error('send failed'); },
  setInput: (n, v) => { if (!msfs.setInput(n, v)) throw new Error('setInput failed ' + n); },
  paused: () => msfs.paused, connected: () => msfs.connected,
  stick: () => null, knob: () => 0, setKnob() {}, setPage() {}, apDisc: () => false,
};
const w = (n, u) => msfs.watch(n, u);
const W = {
  title: w('TITLE', null), model: w('ATC MODEL', null), category: w('CATEGORY', null), engineType: w('ENGINE TYPE', 'Enum'),
  engines: w('NUMBER OF ENGINES', 'Number'), retract: w('IS GEAR RETRACTABLE', 'Bool'), ground: w('SIM ON GROUND', 'Bool'),
  e1: w('ENG COMBUSTION:1', 'Bool'), e2: w('ENG COMBUSTION:2', 'Bool'),
};
const g = (k) => msfs.get(W[k]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  msfs.start();
  await sleep(3000);
  if (!msfs.connected) { console.log('sim not connected'); process.exit(1); }
  for (let i = 0; i < 20 && !msfs.inputsReady; i++) await sleep(250);
  const cls = classify({ title: g('title'), model: g('model'), category: g('category'), engineType: g('engineType') });
  const set = pagesFor({ cls, title: g('title'), engines: g('engines'), retract: g('retract') === 1, engineType: g('engineType'), inputs: msfs.inputNames() });
  console.log('aircraft', JSON.stringify(g('title')), '| pages', KIND_NAMES[cls], '| on ground', g('ground'), '| running', g('e1'), g('e2'));
  // With an engine running (or airborne) only lights, anti-ice and the flight director are tried.
  const cold = g('ground') === 1 && g('e1') !== 1 && g('e2') !== 1;
  const allowed = cold ? SAFE_CAPTION : /^(LIGHTS|ANTI-ICE|FLIGHT DIR)( ×\d+)?$/;
  if (!cold) console.log('engine running or airborne: testing lights, anti-ice and flight director only');
  const keys = [];
  for (let p = 0; p < 5; p++) {
    for (let i = 0; i < 10; i++) {
      const d = msfsSlot(i, p, set);
      if (!d || !d.press || d.hold || d.repeat) continue;
      d.draw(scope); // registers the SimVars / inputs it reads
      keys.push({ p, i, d });
    }
  }
  // Watch every cockpit switch a key could touch, to catch presses that change the aircraft but not the key.
  const watched = msfs.inputNames().filter((x) => /^(ELECTRICAL|FUEL_PUMP|LIGHTING|DEICE|LANDING_GEAR_PARKINGBRAKE|AUTOPILOT_FD)/.test(x));
  watched.forEach((x) => msfs.input(x));
  await sleep(1500);
  const snap = () => Object.fromEntries(watched.map((x) => [x, msfs.input(x)]));
  const diff = (a, b) => Object.keys(a).filter((x) => a[x] != null && b[x] != null && Math.abs(a[x] - b[x]) > 0.01).map((x) => `${x} ${a[x]}->${b[x]}`);
  const results = [];
  for (const { p, i, d } of keys) {
    const a = d.draw(scope);
    if (a.style !== 'toggle' || !allowed.test(a.caption || '')) continue;
    const name = `${a.caption} ${a.label}`;
    if (a.state == null) { results.push({ name, page: p, slot: i, result: 'NO VALUE' }); console.log('NO VALUE    ', `p${p}s${i}`, name); continue; }
    const s0 = snap();
    try { d.press(scope); } catch (e) { results.push({ name, page: p, slot: i, result: 'PRESS FAILED ' + e.message }); continue; }
    await sleep(WAIT);
    const b = d.draw(scope);
    const moved = diff(s0, snap());
    let result;
    if (b.state !== a.state) {
      d.press(scope); await sleep(WAIT);
      result = d.draw(scope).state === a.state ? 'WORKS' : 'NOT RESTORED';
    } else if (moved.length) {
      result = 'NO FEEDBACK'; // the aircraft changed but the key didn't show it: undo with a second press
      d.press(scope); await sleep(WAIT);
    } else result = 'NO EFFECT';
    const left = diff(s0, snap());
    if (left.length) {
      result += ' | PUT BACK: ' + left.join(', ');
      for (const x of Object.keys(s0)) if (s0[x] != null && msfs.input(x) != null && Math.abs(s0[x] - msfs.input(x)) > 0.01) msfs.setInput(x, s0[x]);
      await sleep(WAIT);
    }
    // Classic event did nothing visible: try the aircraft's own switch inputs that could be this switch.
    const tried = [];
    if (!result.startsWith('WORKS') && CANDIDATES[a.caption + ' ' + a.label]) {
      for (const x of watched.filter((y) => CANDIDATES[a.caption + ' ' + a.label].test(y))) {
        const v0 = msfs.input(x); if (v0 == null) continue;
        const v1 = v0 > 0.5 ? 0 : 1;
        msfs.setInput(x, v1); await sleep(WAIT);
        const shown = d.draw(scope).state;
        tried.push(`${x} ${v0}->${v1}: key ${shown !== a.state ? 'FOLLOWS' : 'unchanged'}`);
        msfs.setInput(x, v0); await sleep(WAIT);
      }
    }
    results.push({ name, page: p, slot: i, before: a.state, after: b.state, moved, tried, result });
    console.log(result.padEnd(12), `p${p}s${i}`, name, moved.length ? '(inputs: ' + moved.join(', ') + ')' : '', tried.length ? '\n     tried: ' + tried.join('; ') : '');
  }
  // Magnetos (cold only, and only from OFF): tap must step to R, a hold back to OFF.
  if (cold) {
    for (let i = 0; i < 10; i++) {
      const d = msfsSlot(i, 1, set);
      if (!d || !d.tap || !d.hold) continue;
      const a = d.draw(scope);
      if (a.style !== 'magnetos') continue;
      if (a.pos !== 0) { console.log('SKIPPED     ', `p1s${i}`, a.title || 'MAGNETOS', 'not at OFF (pos ' + a.pos + ')'); continue; }
      d.tap(scope); await sleep(WAIT);
      const b = d.draw(scope).pos;
      d.hold.fn(scope); await sleep(WAIT);
      const c = d.draw(scope).pos;
      const result = b === 1 && c === 0 ? 'WORKS' : `FAILED (tap -> ${b}, hold -> ${c})`;
      results.push({ name: a.title || 'MAGNETOS', page: 1, slot: i, result });
      console.log(result.padEnd(12), `p1s${i}`, a.title || 'MAGNETOS');
    }
  }
  const out = process.argv[2];
  if (out) fs.writeFileSync(out, JSON.stringify({ title: g('title'), kind: cls, results }, null, 1));
  msfs.stop(); process.exit(0);
}
main();
