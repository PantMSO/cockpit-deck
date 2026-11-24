'use strict';
// Offline checks: Forza parser, page renders, and a fake Stream Deck driving the real plugin process.
// usage: node test.js <outDir> <streamDeckNodeExe>
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const dgram = require('dgram');
const { spawn } = require('child_process');
const PLUGIN = path.join(__dirname, '..', 'com.local.cockpitdeck.sdPlugin');
const { parse, dashOffset } = require(path.join(PLUGIN, 'bin', 'forza.js'));
const { msfsSlot, forzaSlot, isSkyhawk, KNOB } = require(path.join(PLUGIN, 'bin', 'layouts.js'));
const { svgFor } = require(path.join(PLUGIN, 'bin', 'render.js'));
const { parseDevice } = require(path.join(PLUGIN, 'bin', 'stick.js'));
const { sheet } = require('./preview.js');
const { forzaPacket, scopeFor, fakeStick, fakeInputs } = require('./fixtures.js');
const { classify, pagesFor } = require(path.join(PLUGIN, 'bin', 'aircraft.js'));
const WebSocket = require(path.join(PLUGIN, 'node_modules', 'ws'));

const [outDir, sdNode] = process.argv.slice(2);
const TEST_PORT = 5399;
fs.mkdirSync(outDir, { recursive: true });
let failures = 0;
const check = (name, fn) => { try { fn(); console.log('PASS', name); } catch (e) { failures++; console.log('FAIL', name, '-', e.message); } };

// ---------- 1. Forza packet parsing
check('forza offsets', () => { assert.strictEqual(dashOffset(324), 244); assert.strictEqual(dashOffset(311), 232); assert.strictEqual(dashOffset(331), 232); assert.strictEqual(dashOffset(100), -1); });
for (const len of [324, 311, 331]) {
  check(`forza parse ${len}B`, () => {
    const t = parse(forzaPacket(len));
    assert.ok(t, 'parsed');
    assert.strictEqual(t.gear, '4'); assert.strictEqual(t.position, 3); assert.strictEqual(t.lap, 2); assert.strictEqual(t.pi, 812);
    assert.ok(Math.abs(t.speed * 2.236936 - 100) < 0.01, 'speed ' + t.speed);
    assert.ok(Math.abs(t.power / 745.7 - 400) < 0.1, 'power');
    assert.ok(Math.abs(t.tyreC[0] - 82.22) < 0.01, 'tyre C');
    assert.strictEqual(Math.round(t.rpm), 7400);
  });
}
check('forza reverse/neutral', () => {
  const b = forzaPacket(); b.writeUInt8(0, 244 + 75); assert.strictEqual(parse(b).gear, 'R');
  b.writeUInt8(11, 244 + 75); assert.strictEqual(parse(b).gear, 'N');
});
check('stick device ids', () => {
  assert.deepStrictEqual(parseDevice('046d:c215'), { vid: 0x046d, pid: 0xc215 });
  assert.deepStrictEqual(parseDevice(' 046D:C215 '), { vid: 0x046d, pid: 0xc215 });
  assert.strictEqual(parseDevice('logitech'), null);
});
check('forza rejects junk', () => { const b = forzaPacket(); b.writeFloatLE(1e9, 244 + 12); assert.strictEqual(parse(b), null); });

// ---------- 1b. Profile names used for switching must exist in the manifest and as files
check('profile names match manifest + files', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN, 'manifest.json'), 'utf8'));
  const declared = manifest.Profiles.map((p) => p.Name);
  const src = fs.readFileSync(path.join(PLUGIN, 'bin', 'plugin.js'), 'utf8');
  const m = src.match(/const PROFILES = \{([^}]*)\}/);
  assert.ok(m, 'PROFILES constant found');
  const used = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  assert.strictEqual(used.length, 2, 'two profiles used');
  for (const name of used) assert.ok(declared.includes(name), `"${name}" not in manifest Profiles`);
  for (const name of declared) assert.ok(fs.existsSync(path.join(PLUGIN, name + '.streamDeckProfile')) || fs.existsSync(path.join(__dirname, '..', 'build', 'profiles', name)), `no profile file for "${name}"`);
});

// ---------- 2. Page renders with fake data
const names = ['flight', 'autopilot', 'lights', 'radio', 'systems'];
for (const connected of [true, false]) {
  for (let p = 0; p < 5; p++) {
    check(`render msfs ${names[p]} ${connected ? 'live' : 'no-sim'}`, () => {
      const s = scopeFor(connected);
      const specs = [...Array(15).keys()].map((i) => { const d = msfsSlot(i, p); assert.ok(d, 'slot ' + i); return d.draw(s); });
      fs.writeFileSync(path.join(outDir, `msfs-${p}-${names[p]}${connected ? '' : '-nosim'}.png`), sheet(specs));
    });
  }
}
// ---------- 2b. Skyhawk pages: renders and behaviour
const skyNames = ['fly', 'engine', 'autopilot', 'radio', 'lights'];
for (const connected of [true, false]) {
  for (let p = 0; p < 5; p++) {
    check(`render skyhawk ${skyNames[p]} ${connected ? 'live' : 'no-sim'}`, () => {
      const s = scopeFor(connected, null, {}, { stick: connected ? fakeStick(true, [4]) : fakeStick(false) });
      const specs = [...Array(15).keys()].map((i) => { const d = msfsSlot(i, p, 'skyhawk'); assert.ok(d, 'slot ' + i); return d.draw(s); });
      fs.writeFileSync(path.join(outDir, `skyhawk-${p}-${skyNames[p]}${connected ? '' : '-nosim'}.png`), sheet(specs));
    });
  }
}
check('skyhawk detection', () => {
  assert.ok(isSkyhawk('C172SP G1000 Passengers', 'ATCCOM.AC_MODEL C172.0.text'));
  assert.ok(isSkyhawk('Cessna Skyhawk Asobo', ''));
  assert.ok(isSkyhawk('', 'ATCCOM.AC_MODEL C172.0.text'));
  assert.ok(!isSkyhawk('Cessna 208 Grand Caravan', 'ATCCOM.AC_MODEL C208.0.text'));
  assert.ok(!isSkyhawk(null, null));
  assert.strictEqual(msfsSlot(10, 0, 'generic').draw(scopeFor(true)).label, 'FLIGHT');
  assert.strictEqual(msfsSlot(10, 0, 'skyhawk').draw(scopeFor(true)).label, 'FLY');
});
const sky = (page, slot) => msfsSlot(slot, page, 'skyhawk');
check('skyhawk magnetos: tap steps up and stops at BOTH, hold turns OFF', () => {
  const s = scopeFor(true, null, {}, { inputs: { ENGINE_MAGNETO_1: 0 } });
  const m = sky(1, 5);
  for (let i = 0; i < 5; i++) m.tap(s);
  assert.deepStrictEqual(s.calls.map((c) => c[2]), [1, 2, 3], 'OFF->R->L->BOTH then no more');
  m.hold.fn(s);
  assert.deepStrictEqual(s.calls.pop(), ['input', 'ENGINE_MAGNETO_1', 0]);
  assert.strictEqual(m.press, undefined, 'no instant action');
  assert.strictEqual(m.draw(s).pos, 0);
});
check('skyhawk starter: START while held, BOTH on release, refused when running', () => {
  const st = sky(1, 6);
  const s = scopeFor(true, null, { 'ENG COMBUSTION:1': 0 }, { inputs: { ENGINE_MAGNETO_1: 3 } });
  st.press(s); assert.strictEqual(st.draw(s).onText, 'CRANKING'); assert.strictEqual(st.draw(s).state, true);
  st.release(s);
  assert.deepStrictEqual(s.calls, [['input', 'ENGINE_MAGNETO_1', 4], ['input', 'ENGINE_MAGNETO_1', 3]]);
  const r = scopeFor(true);
  assert.throws(() => st.press(r), /running/); st.release(r);
  assert.strictEqual(r.calls.length, 0, 'nothing sent while running');
});
check('skyhawk switches flip input events', () => {
  const s = scopeFor(true);
  sky(1, 4).press(s); sky(1, 0).press(s); sky(0, 3).press(s); sky(4, 7 - 1).press(s);
  assert.deepStrictEqual(s.calls, [['input', 'FUEL_PUMP_1', 1], ['input', 'ELECTRICAL_BATTERY_1', 0], ['input', 'LANDING_GEAR_PARKINGBRAKE', 100], ['input', 'FUEL_SELECTOR_1', 2]]);
  assert.strictEqual(sky(1, 4).draw(s).state, true, 'pump now shows on');
  assert.strictEqual(sky(1, 4).draw(scopeFor(false)).state, null, 'no sim shows unknown, not off');
});
check('skyhawk fuel selector cycles LEFT/BOTH/RIGHT', () => {
  const s = scopeFor(true, null, {}, { inputs: { FUEL_SELECTOR_1: 0 } });
  const f = sky(4, 6);
  assert.strictEqual(f.draw(s).label, 'LEFT'); f.press(s);
  assert.strictEqual(f.draw(s).label, 'BOTH'); f.press(s);
  assert.strictEqual(f.draw(s).label, 'RIGHT'); f.press(s);
  assert.strictEqual(f.draw(s).label, 'LEFT');
});
check('skyhawk AP knob: tap cycles target, -/+ follow it', () => {
  const s = scopeFor(true);
  const knobKey = sky(2, 7), minus = sky(2, 8), plus = sky(2, 9);
  assert.strictEqual(knobKey.draw(s).caption, 'KNOB: HDG'); assert.strictEqual(knobKey.draw(s).value, '270°');
  plus.press(s); assert.deepStrictEqual(s.calls.pop(), ['send', 'HEADING_BUG_INC', undefined]);
  knobKey.press(s); assert.strictEqual(knobKey.draw(s).caption, 'KNOB: ALT'); assert.strictEqual(knobKey.draw(s).value, '6,500');
  minus.press(s); assert.deepStrictEqual(s.calls.pop(), ['send', 'AP_ALT_VAR_DEC', undefined]);
  for (let i = 0; i < KNOB.length - 1; i++) knobKey.press(s);
  assert.strictEqual(knobKey.draw(s).caption, 'KNOB: HDG', 'wraps around');
  assert.ok(minus.repeat && plus.repeat, 'hold to spin');
});
check('skyhawk stick echo + AP disconnect show on keys', () => {
  const held = scopeFor(true, null, {}, { stick: fakeStick(true, [6, 9, 10]) });
  assert.ok(sky(0, 5).draw(held).ring, 'trim down lit while stick 6 held');
  assert.ok(!sky(0, 0).draw(held).ring, 'trim up not lit');
  assert.ok(!sky(0, 1).draw(held).ring, 'flaps up not lit');
  assert.ok(sky(0, 2).draw(held).ring, 'flaps down lit while stick 9 held');
  assert.ok(sky(0, 3).draw(held).ring, 'park brake lit while stick 10 held');
  assert.ok(!sky(0, 0).draw(scopeFor(true)).ring, 'nothing lit at rest');
  const d = sky(2, 0).draw(scopeFor(true, null, { 'AUTOPILOT MASTER': 0 }, { apDisc: true }));
  assert.strictEqual(d.offText, 'DISC'); assert.ok(d.ring);
  assert.strictEqual(sky(0, 4).draw(scopeFor(true, null, {}, { stick: fakeStick(false) })).connected, false);
});
check('skyhawk hold-only keys have no instant action', () => {
  const a = sky(4, 9);
  assert.ok(a.hold && a.hold.ms >= 1000 && !a.press && !a.tap);
  const s = scopeFor(true); a.hold.fn(s); assert.deepStrictEqual(s.calls.pop(), ['send', 'ENGINE_AUTO_SHUTDOWN', undefined]);
  const o = scopeFor(true, null, { 'ENG COMBUSTION:1': 0 }); a.hold.fn(o); assert.deepStrictEqual(o.calls.pop(), ['send', 'ENGINE_AUTO_START', undefined]);
});
// ---------- 2c. Every aircraft kind: detection, pages, renders, behaviour
check('aircraft kind detection', () => {
  const c = (category, engineType, title = 'X') => classify({ title, model: '', category, engineType });
  assert.strictEqual(c('Airplane', 0, 'C172SP G1000 Passengers'), 'skyhawk');
  assert.strictEqual(c('Airplane', 0), 'piston');
  assert.strictEqual(c('Airplane', 5), 'turboprop');
  assert.strictEqual(c('Airplane', 1, 'Cessna Citation CJ4'), 'jet');
  assert.strictEqual(c('Airplane', 1, 'A10C Thunderbolt II'), 'jet');
  assert.strictEqual(c('Helicopter', 3), 'heli');
  assert.strictEqual(c('Helicopter', 0), 'heli', 'piston helicopter');
  assert.strictEqual(c('Glider', 2), 'glider');
  assert.strictEqual(c('Glider', 0), 'glider', 'motor glider');
  assert.strictEqual(c('Airplane', 2), 'generic', 'no engine (balloon/airship)');
  assert.strictEqual(c(null, null), 'generic', 'nothing known yet');
});
const KINDS_UNDER_TEST = [['piston', 0], ['turboprop', 5], ['jet', 1], ['heli', 3], ['glider', 2]];
for (const [cls, engineType] of KINDS_UNDER_TEST) {
  for (const engines of [1, 2]) {
    for (const retract of [false, true]) {
      check(`pages ${cls} ${engines} eng ${retract ? 'retractable' : 'fixed'} gear: 5 tabs x 10 keys, all draw`, () => {
        const set = pagesFor({ cls, engines, retract, engineType, inputs: Object.keys(fakeInputs) });
        assert.strictEqual(set.tabs.length, 5);
        for (let p = 0; p < 5; p++) {
          for (const connected of [true, false]) {
            const s = scopeFor(connected, null, {}, { stick: fakeStick(connected, [4]) });
            const specs = [...Array(15).keys()].map((i) => { const d = msfsSlot(i, p, set); assert.ok(d, `page ${p} slot ${i}`); return d.draw(s); });
            specs.forEach((sp) => svgFor(sp));
            if (engines === 2 && retract && connected) fs.writeFileSync(path.join(outDir, `kind-${cls}-${p}.png`), sheet(specs));
          }
        }
      });
    }
  }
}
check('pages: Cessna 172 and the rest keep their own sets', () => {
  assert.strictEqual(pagesFor({ cls: 'skyhawk' }), 'skyhawk');
  assert.strictEqual(pagesFor({ cls: 'generic' }), 'generic');
  assert.strictEqual(pagesFor({ cls: 'jet', engines: 2, inputs: [] }), pagesFor({ cls: 'jet', engines: 2, inputs: [] }), 'built once, then cached');
});
const kindSet = (cls, extra = {}) => pagesFor({ cls, engines: 1, retract: false, engineType: 0, inputs: Object.keys(fakeInputs), ...extra });
check('fixed gear shows a readout instead of the gear key', () => {
  assert.strictEqual(msfsSlot(3, 0, kindSet('piston')).draw(scopeFor(true)).caption, 'IAS');
  assert.strictEqual(msfsSlot(3, 0, kindSet('piston', { retract: true })).draw(scopeFor(true)).style, 'gear');
});
check('switches use classic events unless an aircraft override says otherwise', () => {
  const s = scopeFor(true);
  const set = kindSet('piston');
  for (let i = 0; i < 4; i++) msfsSlot(i, 1, set).press(s);
  assert.deepStrictEqual(s.calls.map((c) => c[1]), ['TOGGLE_MASTER_BATTERY', 'TOGGLE_MASTER_ALTERNATOR', 'TOGGLE_AVIONICS_MASTER', 'TOGGLE_ELECT_FUEL_PUMP']);
  const lights = kindSet('turboprop', { engineType: 5 }).pages[4];
  const l = scopeFor(true); lights.slice(0, 9).forEach((k) => k.press(l));
  assert.deepStrictEqual(l.calls.map((c) => c[1]), ['TOGGLE_BEACON_LIGHTS', 'TOGGLE_NAV_LIGHTS', 'STROBES_TOGGLE', 'TOGGLE_TAXI_LIGHTS', 'LANDING_LIGHTS_TOGGLE',
    'PANEL_LIGHTS_TOGGLE', 'TOGGLE_CABIN_LIGHTS', 'PITOT_HEAT_TOGGLE', 'TOGGLE_STRUCTURAL_DEICE']);
});
check('magnetos: the aircraft input when it has one, classic events otherwise', () => {
  const withInput = msfsSlot(4, 1, kindSet('piston'));
  const s = scopeFor(true, null, {}, { inputs: { ENGINE_MAGNETO_1: 0 } });
  withInput.tap(s); assert.deepStrictEqual(s.calls.pop(), ['input', 'ENGINE_MAGNETO_1', 1]);
  const classic = msfsSlot(4, 1, kindSet('piston', { inputs: [] }));
  const off = scopeFor(true, null, { 'RECIP ENG LEFT MAGNETO:1': 0, 'RECIP ENG RIGHT MAGNETO:1': 0 });
  assert.strictEqual(classic.draw(off).pos, 0);
  classic.tap(off); assert.deepStrictEqual(off.calls.pop(), ['send', 'MAGNETO1_RIGHT', undefined]);
  classic.hold.fn(off); assert.deepStrictEqual(off.calls.pop(), ['send', 'MAGNETO1_OFF', undefined]);
  const both = scopeFor(true);
  assert.strictEqual(classic.draw(both).pos, 3); classic.tap(both); assert.strictEqual(both.calls.length, 0, 'stops at BOTH');
  const twin = kindSet('piston', { engines: 2, inputs: [] });
  assert.strictEqual(msfsSlot(5, 1, twin).draw(scopeFor(true)).title, 'MAGS ENG 2');
  assert.strictEqual(msfsSlot(5, 1, twin).draw(scopeFor(true)).pos, 1, 'engine 2 on R only');
});
check('jet: knob starts on SPD, speedbrake taps and arms on hold, twin readouts', () => {
  const set = kindSet('jet', { engines: 2, retract: true, engineType: 1 });
  const s = scopeFor(true);
  assert.strictEqual(msfsSlot(7, 2, set).draw(s).caption, 'KNOB: SPD');
  msfsSlot(9, 2, set).press(s); assert.deepStrictEqual(s.calls.pop(), ['send', 'AP_SPD_VAR_INC', undefined]);
  const sb = msfsSlot(4, 0, set);
  sb.tap(s); assert.deepStrictEqual(s.calls.pop(), ['send', 'SPOILERS_TOGGLE', undefined]);
  sb.hold.fn(s); assert.deepStrictEqual(s.calls.pop(), ['send', 'SPOILERS_ARM_TOGGLE', undefined]);
  assert.strictEqual(msfsSlot(0, 0, set).draw(s).dir, 'up', 'jets: trim up'); assert.strictEqual(msfsSlot(5, 0, set).draw(s).dir, 'down', 'jets: trim down');
  const n1 = msfsSlot(2, 0, set).draw(s);
  assert.strictEqual(n1.style, 'dual'); assert.deepStrictEqual(n1.rows.map((r) => r.value), ['92.3', '92.1']);
  const apu = msfsSlot(2, 1, set);
  assert.ok(apu.hold && !apu.press && !apu.tap, 'APU only on a 1 s hold');
  apu.hold.fn(s); assert.deepStrictEqual(s.calls.pop(), ['send', 'APU_STARTER', undefined]);
});
check('glider: airbrakes, vario, tow keys', () => {
  const set = kindSet('glider', { engineType: 2 });
  const s = scopeFor(true);
  assert.strictEqual(set.tabs[1].label, 'SOAR');
  msfsSlot(4, 0, set).press(s); assert.deepStrictEqual(s.calls.pop(), ['send', 'SPOILERS_TOGGLE', undefined]);
  assert.strictEqual(msfsSlot(7, 0, set).draw(s).value, '+3.4');
  msfsSlot(7, 1, set).press(s); msfsSlot(6, 1, set).press(s);
  assert.deepStrictEqual(s.calls.splice(-2).map((c) => c[1]), ['TOW_PLANE_RELEASE', 'TOW_PLANE_REQUEST']);
});
check('aircraft override: input events with their own on/off values', () => {
  const { group } = require(path.join(PLUGIN, 'bin', 'aircraft.js'))._test;
  const k = group('MASTER', 'GEN', ['G1', 'G2'], null, { on: 0, off: 2 });
  const s = scopeFor(true, null, {}, { inputs: { G1: 0, G2: 0 } });
  assert.strictEqual(k.draw(s).state, true, '0 means on here');
  k.press(s); assert.deepStrictEqual(s.calls, [['input', 'G1', 2], ['input', 'G2', 2]]);
  assert.strictEqual(k.draw(s).state, false);
  const half = scopeFor(true, null, {}, { inputs: { G1: 0, G2: 2 } });
  assert.strictEqual(k.draw(half).offText, '1 OF 2 ON');
});

check('trim keys on every FLY page: up above down, nudge on tap, repeat while held, echo their stick button', () => {
  const sets = [['skyhawk', 'skyhawk'], ...['piston', 'turboprop', 'jet', 'glider'].map((k) => [k, kindSet(k)])];
  for (const [name, set] of sets) {
    const up = msfsSlot(0, 0, set), dn = msfsSlot(5, 0, set);
    const s = scopeFor(true);
    assert.strictEqual(up.draw(s).style, 'trim', name); assert.strictEqual(up.draw(s).dir, 'up', name); assert.strictEqual(dn.draw(s).dir, 'down', name);
    up.press(s); dn.press(s);
    assert.deepStrictEqual(s.calls.map((x) => x[1]), ['ELEV_TRIM_UP', 'ELEV_TRIM_DN'], name);
    assert.ok(up.repeat && dn.repeat, name + ' hold to keep trimming');
    const held4 = scopeFor(true, null, {}, { stick: fakeStick(true, [4]) });
    assert.ok(up.draw(held4).ring && !dn.draw(held4).ring, name + ' button 4 lights trim up only');
    assert.strictEqual(up.draw(s).note, 'BTN 4'); assert.strictEqual(dn.draw(s).note, 'BTN 6');
  }
  assert.ok(svgFor({ style: 'trim', dir: 'up', pct: 0.1, note: 'BTN 4' }).includes('TRIM'));
});

// Regression (1.2.0-1.2.2): switching aircraft re-listed input events from inside the 'change' listener, which
// fired 'change' again before the new title was recorded, looping thousands of times a second.
async function aircraftSwitchCheck() {
  const { Msfs } = require(path.join(PLUGIN, 'bin', 'msfs.js'));
  const m = new Msfs(() => {});
  let enumerations = 0;
  m.connected = true;
  m.handle = { enumerateInputEvents: () => { enumerations++; } };
  let title = 'Cessna Citation CJ4', changes = 0;
  // the same listener plugin.js uses
  m.on('change', () => { changes++; if (changes > 50) throw new Error('change storm'); m.noteTitle(title); });
  m.noteTitle(title);
  title = 'DG-1001-E Neo';
  m.emit('change');
  await new Promise((r) => setTimeout(r, 50));
  check('switching aircraft lists input events once, no loop', () => {
    assert.strictEqual(enumerations, 1, 'enumerations ' + enumerations);
    assert.ok(changes <= 3, 'change events ' + changes);
    assert.strictEqual(m.lastTitle, 'DG-1001-E Neo');
    assert.strictEqual(m.noteTitle('DG-1001-E Neo'), false, 'same aircraft again is not a change');
  });
}

check('hold ring + hint overlays render', () => {
  const svg = svgFor({ style: 'toggle', caption: 'X', label: 'Y', state: false, progress: 0.5, hint: 'HOLD 1 S' });
  assert.ok(svg.includes('stroke-dasharray') && svg.includes('HOLD 1 S') && svg.trim().endsWith('</svg>'));
});

for (const live of [true, false]) {
  check(`render forza ${live ? 'live' : 'no-data'}`, () => {
    const s = scopeFor(false, live ? parse(forzaPacket()) : null);
    const specs = [...Array(15).keys()].map((i) => { const d = forzaSlot(i); assert.ok(d, 'slot ' + i); return d.draw(s); });
    fs.writeFileSync(path.join(outDir, `forza${live ? '' : '-nodata'}.png`), sheet(specs));
  });
}

// ---------- 3. Fake Stream Deck <-> real plugin process
async function e2e() {
  const wss = new WebSocket.Server({ port: 0, host: '127.0.0.1' });
  await new Promise((r) => wss.on('listening', r));
  const port = wss.address().port;
  const seen = [];
  let sock;
  const connected = new Promise((res) => wss.on('connection', (s) => { sock = s; s.on('message', (m) => seen.push(JSON.parse(m))); res(); }));
  const info = JSON.stringify({ devices: [{ id: 'DEV1', type: 0, size: { columns: 5, rows: 3 } }] });
  // Own data folder + port, so the test never touches the installed plugin's config, log or port 5300.
  const dataDir = path.join(outDir, 'data');
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ autoSwitch: false, msfs: { aircraft: 'skyhawk' }, forza: { port: TEST_PORT, listen: '127.0.0.1' } }));
  const proc = spawn(sdNode, [path.join(PLUGIN, 'bin', 'plugin.js'), '-port', String(port), '-pluginUUID', 'PLUGINUUID', '-registerEvent', 'registerPlugin', '-info', info],
    { cwd: PLUGIN, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, COCKPITDECK_DATA: dataDir, COCKPITDECK_OFFLINE: '1' } });
  let stderr = ''; proc.stderr.on('data', (d) => { stderr += d; });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const sendSD = (o) => sock.send(JSON.stringify(o));
  try {
    await Promise.race([connected, wait(8000).then(() => { throw new Error('plugin never connected; stderr: ' + stderr); })]);
    await wait(300);
    check('e2e registers', () => assert.deepStrictEqual(seen[0], { event: 'registerPlugin', uuid: 'PLUGINUUID' }));
    // MSFS keys on row 0..2, Forza keys appear on a second "device"
    for (let i = 0; i < 15; i++) {
      sendSD({ event: 'willAppear', action: 'com.local.cockpitdeck.slot', context: 'm' + i, device: 'DEV1', payload: { settings: { game: 'msfs' }, coordinates: { column: i % 5, row: Math.floor(i / 5) } } });
      sendSD({ event: 'willAppear', action: 'com.local.cockpitdeck.slot', context: 'f' + i, device: 'DEV2', payload: { settings: { game: 'forza' }, coordinates: { column: i % 5, row: Math.floor(i / 5) } } });
    }
    await wait(500);
    const imgs = (ctx) => seen.filter((m) => m.event === 'setImage' && m.context === ctx);
    check('e2e every key drawn', () => { for (let i = 0; i < 15; i++) { assert.ok(imgs('m' + i).length >= 1, 'm' + i); assert.ok(imgs('f' + i).length >= 1, 'f' + i); } });
    check('e2e images are PNG', () => assert.ok(imgs('m0')[0].payload.image.startsWith('data:image/png;base64,')));
    // Tab press switches page: slot 0 should redraw with different content
    const before = imgs('m0').length;
    sendSD({ event: 'keyDown', context: 'm11', device: 'DEV1', payload: {} });
    sendSD({ event: 'keyUp', context: 'm11', device: 'DEV1', payload: {} });
    await wait(400);
    check('e2e tab switches page', () => assert.ok(imgs('m0').length > before, 'slot 0 redrawn'));
    // Pressing a sim key with no sim running shows the alert
    sendSD({ event: 'keyDown', context: 'm0', device: 'DEV1', payload: {} });
    sendSD({ event: 'keyUp', context: 'm0', device: 'DEV1', payload: {} });
    await wait(300);
    check('e2e no-sim press alerts', () => assert.ok(seen.some((m) => m.event === 'showAlert' && m.context === 'm0')));
    // Hold-to-confirm key (LIGHTS page, AUTO START): a short tap only shows a hint, a 1 s hold fires (and alerts: no sim)
    sendSD({ event: 'keyDown', context: 'm14', device: 'DEV1', payload: {} });
    sendSD({ event: 'keyUp', context: 'm14', device: 'DEV1', payload: {} });
    await wait(300);
    const tapBefore = imgs('m9').length;
    sendSD({ event: 'keyDown', context: 'm9', device: 'DEV1', payload: {} });
    await wait(100);
    sendSD({ event: 'keyUp', context: 'm9', device: 'DEV1', payload: {} });
    await wait(300);
    check('e2e short tap on hold key shows hint, fires nothing', () => {
      assert.ok(imgs('m9').length > tapBefore, 'redrawn with hint');
      assert.ok(!seen.some((m) => m.event === 'showAlert' && m.context === 'm9'), 'no action yet');
    });
    fs.writeFileSync(path.join(outDir, 'e2e-hold-hint.png'), Buffer.from(imgs('m9').pop().payload.image.split(',')[1], 'base64'));
    const ringBefore = imgs('m9').length;
    sendSD({ event: 'keyDown', context: 'm9', device: 'DEV1', payload: {} });
    await wait(500);
    fs.writeFileSync(path.join(outDir, 'e2e-hold-ring.png'), Buffer.from(imgs('m9').pop().payload.image.split(',')[1], 'base64'));
    await wait(700);
    sendSD({ event: 'keyUp', context: 'm9', device: 'DEV1', payload: {} });
    await wait(300);
    check('e2e 1 s hold animates ring then fires', () => {
      assert.ok(imgs('m9').length >= ringBefore + 5, 'ring animated: ' + (imgs('m9').length - ringBefore) + ' frames');
      assert.ok(seen.some((m) => m.event === 'showAlert' && m.context === 'm9'), 'hold action ran');
    });
    // Forza telemetry arrives over UDP and updates the speed key
    const fBefore = imgs('f0').length;
    const u = dgram.createSocket('udp4');
    for (let i = 0; i < 5; i++) { u.send(forzaPacket(), TEST_PORT, '127.0.0.1'); await wait(80); }
    u.close();
    await wait(300);
    check('e2e forza telemetry redraws', () => assert.ok(imgs('f0').length > fBefore, 'speed key redrawn'));
    fs.writeFileSync(path.join(outDir, 'e2e-forza-speed.png'), Buffer.from(imgs('f0').pop().payload.image.split(',')[1], 'base64'));
    check('e2e no crash', () => assert.strictEqual(proc.exitCode, null, stderr));
  } finally {
    proc.kill();
    wss.close();
  }
  const logTail = fs.readFileSync(path.join(outDir, 'data', 'plugin.log'), 'utf8').split('\n').slice(-12).join('\n');
  console.log('--- plugin log tail\n' + logTail);
}

aircraftSwitchCheck().then(e2e).then(() => { console.log(failures ? `${failures} FAILED` : 'ALL PASSED'); process.exit(failures ? 1 : 0); }, (e) => { console.log('E2E ERROR', e.message); process.exit(1); });
