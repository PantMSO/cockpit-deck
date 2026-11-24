'use strict';
// Read-only check against a running MSFS 2024 and the real stick: works out which pages the loaded aircraft gets
// and draws them from live data. It never sends events or sets inputs (send/setInput throw).
// usage: node livecheck.js <outDir>
const fs = require('fs');
const path = require('path');
const PLUGIN = path.join(__dirname, '..', 'com.local.cockpitdeck.sdPlugin');
const { Msfs } = require(path.join(PLUGIN, 'bin', 'msfs.js'));
const { Stick } = require(path.join(PLUGIN, 'bin', 'stick.js'));
const { msfsSlot } = require(path.join(PLUGIN, 'bin', 'layouts.js'));
const { classify, pagesFor, KIND_NAMES } = require(path.join(PLUGIN, 'bin', 'aircraft.js'));
const { sheet } = require('./preview.js');
const { cfg } = require('./fixtures.js');

const outDir = process.argv[2] || '.';
fs.mkdirSync(outDir, { recursive: true });
const msfs = new Msfs(() => {});
const stick = new Stick(() => {});
const blocked = () => { throw new Error('livecheck is read-only'); };
const scope = {
  cfg, k: {},
  v: (n, u) => msfs.get(msfs.watch(n, u)),
  input: (n) => msfs.input(n),
  send: blocked, setInput: blocked, setKnob: blocked, setPage: blocked,
  paused: () => msfs.paused, connected: () => msfs.connected,
  stick: () => stick, knob: () => 0, apDisc: () => false,
};
const w = {
  title: msfs.watch('TITLE', null), model: msfs.watch('ATC MODEL', null), category: msfs.watch('CATEGORY', null),
  engineType: msfs.watch('ENGINE TYPE', 'Enum'), engines: msfs.watch('NUMBER OF ENGINES', 'Number'), retract: msfs.watch('IS GEAR RETRACTABLE', 'Bool'),
};
const g = (k) => msfs.get(w[k]);
const currentSet = () => {
  const cls = classify({ title: g('title'), model: g('model'), category: g('category'), engineType: g('engineType') });
  return { cls, set: pagesFor({ cls, title: g('title'), engines: g('engines'), retract: g('retract') === 1, engineType: g('engineType'), inputs: msfs.inputNames() }) };
};
const drawAll = (set) => [0, 1, 2, 3, 4].map((p) => [...Array(15).keys()].map((i) => { const d = msfsSlot(i, p, set); return d ? d.draw(scope) : { style: 'button', caption: '', glyph: '', label: '' }; }));

msfs.start();
stick.start(cfg.stick.device);
setTimeout(() => drawAll(currentSet().set), 2500); // first pass registers every SimVar and input the pages use
setTimeout(() => {
  const { cls, set } = currentSet();
  const pages = drawAll(set);
  const tabs = typeof set === 'object' ? set.tabs.map((t) => t.label) : [];
  console.log('connected', msfs.connected, '| aircraft', JSON.stringify(g('title')), '| category', JSON.stringify(g('category')),
    '| engine type', g('engineType'), 'x', g('engines'), '| retractable', g('retract'), '| input events', msfs.inputs.size, '| stick', stick.connected);
  console.log('pages:', KIND_NAMES[cls], tabs.length ? '(' + tabs.join(' / ') + ')' : '');
  const missingVars = [...msfs.vars.values()].filter((v) => v.value == null).map((v) => v.name);
  const missingInputs = [...msfs.inputWanted].filter((n) => !msfs.hasInput(n) || msfs.inputs.get(n).value == null);
  console.log('SimVars without a value:', missingVars.length ? missingVars.join(', ') : 'none');
  console.log('Inputs used:', [...msfs.inputWanted].filter((n) => msfs.hasInput(n)).map((n) => `${n}=${msfs.inputs.get(n).value}`).join(', ') || 'none');
  console.log('Inputs without a value:', missingInputs.length ? missingInputs.join(', ') : 'none');
  const label = (s) => [s.caption, s.label].filter(Boolean).join(' ');
  pages.forEach((specs, p) => {
    const unknown = specs.slice(0, 10).map((s, i) => [i, s]).filter(([, s]) => s.state === null || s.value === null || s.pos === null).map(([i, s]) => `${i}:${label(s)}`);
    console.log(`page ${p} unknown: ${unknown.length ? unknown.join(' | ') : 'none'}`);
    fs.writeFileSync(path.join(outDir, `live-${p}.png`), sheet(specs));
  });
  msfs.stop(); stick.stop(); process.exit(0);
}, 7000);
