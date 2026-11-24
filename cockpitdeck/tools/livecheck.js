'use strict';
// Read-only check against a running MSFS 2024 and the real stick: draws every Skyhawk page from live data.
// It never sends events or sets inputs (send/setInput throw). usage: node livecheck.js <outDir>
const fs = require('fs');
const path = require('path');
const PLUGIN = path.join(__dirname, '..', 'com.local.cockpitdeck.sdPlugin');
const { Msfs } = require(path.join(PLUGIN, 'bin', 'msfs.js'));
const { Stick } = require(path.join(PLUGIN, 'bin', 'stick.js'));
const { msfsSlot, isSkyhawk } = require(path.join(PLUGIN, 'bin', 'layouts.js'));
const { sheet } = require('./preview.js');
const { cfg } = require('./fixtures.js');

const outDir = process.argv[2] || '.';
fs.mkdirSync(outDir, { recursive: true });
const log = () => {};
const msfs = new Msfs(log);
const stick = new Stick(log);
const blocked = () => { throw new Error('livecheck is read-only'); };
const scope = {
  cfg, k: {},
  v: (n, u) => msfs.get(msfs.watch(n, u)),
  input: (n) => msfs.input(n),
  send: blocked, setInput: blocked, setKnob: blocked, setPage: blocked,
  paused: () => msfs.paused, connected: () => msfs.connected,
  stick: () => stick, knob: () => 0, apDisc: () => false,
};
const names = ['fly', 'engine', 'autopilot', 'radio', 'lights'];
const drawAll = () => names.map((_, p) => [...Array(15).keys()].map((i) => msfsSlot(i, p, 'skyhawk').draw(scope)));

msfs.start();
stick.start(cfg.stick.device);
const title = msfs.watch('TITLE', null), model = msfs.watch('ATC MODEL', null);
setTimeout(() => drawAll(), 1500); // first pass registers every SimVar and input the pages use
setTimeout(() => {
  const pages = drawAll();
  console.log('connected', msfs.connected, '| aircraft', JSON.stringify(msfs.get(title)), '| skyhawk', isSkyhawk(msfs.get(title), msfs.get(model)),
    '| input events', msfs.inputs.size, '| stick', stick.connected);
  const missingVars = [...msfs.vars.values()].filter((v) => v.value == null).map((v) => v.name);
  const missingInputs = [...msfs.inputWanted].filter((n) => !msfs.hasInput(n) || msfs.inputs.get(n).value == null);
  console.log('SimVars without a value:', missingVars.length ? missingVars.join(', ') : 'none');
  console.log('Inputs without a value:', missingInputs.length ? missingInputs.join(', ') : 'none');
  pages.forEach((specs, p) => {
    const unknown = specs.map((s, i) => [i, s]).filter(([, s]) => s.state === null || s.value === null || s.pos === null).map(([i]) => i);
    console.log(`page ${names[p].padEnd(9)} unknown slots: ${unknown.length ? unknown.join(',') : 'none'}`);
    fs.writeFileSync(path.join(outDir, `live-${p}-${names[p]}.png`), sheet(specs));
  });
  console.log('stick axes', JSON.stringify(stick.axes), 'buttons', stick.buttons.toString(2));
  msfs.stop(); stick.stop(); process.exit(0);
}, 5000);
