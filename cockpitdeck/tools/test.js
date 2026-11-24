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
const { forzaPacket, scopeFor, fakeStick } = require('./fixtures.js');
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
  assert.ok(sky(0, 0).draw(held).ring, 'trim lit while stick 6 held');
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

e2e().then(() => { console.log(failures ? `${failures} FAILED` : 'ALL PASSED'); process.exit(failures ? 1 : 0); }, (e) => { console.log('E2E ERROR', e.message); process.exit(1); });
