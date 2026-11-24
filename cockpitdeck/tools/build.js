'use strict';
// Generates plugin icons and the bundled profile folders (zipped by build.ps1).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PLUGIN = path.join(__dirname, '..', 'com.local.cockpitdeck.sdPlugin');
const { Resvg } = require(path.join(PLUGIN, 'node_modules', '@resvg', 'resvg-js'));
const { renderKey } = require(path.join(PLUGIN, 'bin', 'render.js'));
const STAGE = path.join(__dirname, '..', 'build', 'profiles');

const png = (svg, w) => new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();

// --- icons -------------------------------------------------------------------
const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d6fd6"/><stop offset="1" stop-color="#58b6ff"/></linearGradient>
<linearGradient id="gnd" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8a5a2b"/><stop offset="1" stop-color="#4a2f16"/></linearGradient>
<clipPath id="c"><circle cx="128" cy="128" r="92"/></clipPath></defs>
<rect width="256" height="256" rx="56" fill="#0b0e12"/>
<g clip-path="url(#c)" transform="rotate(-12 128 128)"><rect x="0" y="0" width="256" height="138" fill="url(#sky)"/><rect x="0" y="138" width="256" height="118" fill="url(#gnd)"/><line x1="0" y1="138" x2="256" y2="138" stroke="#fff" stroke-width="4"/></g>
<circle cx="128" cy="128" r="92" fill="none" stroke="#2b333e" stroke-width="12"/>
<path d="M66 132 h40 l22 16 l22 -16 h40" fill="none" stroke="#ffb52e" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="128" cy="132" r="7" fill="#ffb52e"/></svg>`;
const mono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><circle cx="20" cy="20" r="15" fill="none" stroke="#fff" stroke-width="3"/><path d="M8 21 h8 l4 3 l4 -3 h8" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const imgs = path.join(PLUGIN, 'imgs');
fs.mkdirSync(imgs, { recursive: true });
fs.writeFileSync(path.join(imgs, 'plugin.png'), png(logo, 256));
fs.writeFileSync(path.join(imgs, 'plugin@2x.png'), png(logo, 512));
fs.writeFileSync(path.join(imgs, 'category.png'), png(mono, 28));
fs.writeFileSync(path.join(imgs, 'category@2x.png'), png(mono, 56));
fs.writeFileSync(path.join(imgs, 'action.png'), png(mono, 20));
fs.writeFileSync(path.join(imgs, 'action@2x.png'), png(mono, 40));
const keyPng = (w) => Buffer.from(renderKey({ style: 'status', caption: 'COCKPIT', title: 'DECK', color: '#3fd8ff' }).split(',')[1], 'base64');
fs.writeFileSync(path.join(imgs, 'key@2x.png'), keyPng());
fs.writeFileSync(path.join(imgs, 'key.png'), new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="72" height="72"><image width="72" height="72" href="data:image/png;base64,${keyPng().toString('base64')}"/></svg>`).render().asPng());

// --- profiles (Stream Deck "V1" bundled-profile layout, as shipped by other plugins) ---
const profiles = [
  { file: 'CockpitDeck-MSFS2024', game: 'msfs' },
  { file: 'CockpitDeck-Forza', game: 'forza' },
];
fs.rmSync(STAGE, { recursive: true, force: true });
for (const p of profiles) {
  const actions = {};
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 5; col++) {
      actions[`${col},${row}`] = {
        Name: 'Cockpit key',
        Settings: { game: p.game },
        State: 0,
        States: [{ FFamily: '', FSize: '12', FStyle: '', FUnderline: 'off', Image: '', Title: '', TitleAlignment: 'bottom', TitleColor: '#ffffff', TitleShow: '' }],
        UUID: 'com.local.cockpitdeck.slot',
      };
    }
  }
  // Stable UUID per profile so rebuilding doesn't create duplicates.
  const h = crypto.createHash('md5').update('cockpitdeck/' + p.file).digest('hex').toUpperCase();
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  const dir = path.join(STAGE, p.file, `${uuid}.sdProfile`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ Actions: actions, DeviceModel: '20GBA9901', Name: p.file, Version: '1.0' }));
  console.log('profile', p.file, uuid);
}
console.log('icons + profiles staged');
