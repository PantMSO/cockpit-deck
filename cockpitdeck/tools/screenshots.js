'use strict';
// Renders the README pictures in docs/images from the plugin's real drawing code.
// usage: node tools/screenshots.js
const fs = require('fs');
const path = require('path');
const { forzaPacket, scopeFor, fakeStick, PLUGIN } = require('./fixtures.js');
const { Resvg } = require(path.join(PLUGIN, 'node_modules', '@resvg', 'resvg-js'));
const { renderKey } = require(path.join(PLUGIN, 'bin', 'render.js'));
const { msfsSlot, forzaSlot, MSFS_TABS, SKYHAWK_TABS } = require(path.join(PLUGIN, 'bin', 'layouts.js'));
const { parse } = require(path.join(PLUGIN, 'bin', 'forza.js'));

const OUT = path.join(__dirname, '..', '..', 'docs', 'images');
fs.mkdirSync(OUT, { recursive: true });
const FONTS = { loadSystemFonts: false, fontFiles: ['C:/Windows/Fonts/bahnschrift.ttf', 'C:/Windows/Fonts/segoeuib.ttf'], defaultFontFamily: 'Bahnschrift' };
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const write = (name, svg, width) => {
  const opts = { font: FONTS };
  if (width) opts.fitTo = { mode: 'width', value: width };
  fs.writeFileSync(path.join(OUT, name), new Resvg(svg, opts).render().asPng());
  console.log('wrote docs/images/' + name);
};

// A generic 15-key deck body (no brand marks) with the key images laid in.
const KEY = 144, GAP = 22, PAD = 46;
const DECK_W = PAD * 2 + KEY * 5 + GAP * 4, DECK_H = PAD * 2 + KEY * 3 + GAP * 2;
function deckSvg(specs, x0 = 0, y0 = 0, id = 'd') {
  let keys = '';
  specs.forEach((k, i) => {
    const x = x0 + PAD + (i % 5) * (KEY + GAP), y = y0 + PAD + Math.floor(i / 5) * (KEY + GAP);
    keys += `<rect x="${x - 3}" y="${y - 1}" width="${KEY + 6}" height="${KEY + 8}" rx="24" fill="#000" opacity="0.55"/>`;
    keys += `<clipPath id="${id}c${i}"><rect x="${x}" y="${y}" width="${KEY}" height="${KEY}" rx="22"/></clipPath>`;
    keys += `<image clip-path="url(#${id}c${i})" x="${x}" y="${y}" width="${KEY}" height="${KEY}" href="${renderKey(k)}"/>`;
  });
  return `<defs><linearGradient id="${id}body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#25282e"/><stop offset="1" stop-color="#121418"/></linearGradient></defs>
<rect x="${x0}" y="${y0 + 10}" width="${DECK_W}" height="${DECK_H}" rx="44" fill="#000" opacity="0.35"/>
<rect x="${x0}" y="${y0}" width="${DECK_W}" height="${DECK_H}" rx="44" fill="url(#${id}body)" stroke="#33373f" stroke-width="2"/>
<rect x="${x0 + 18}" y="${y0 + 18}" width="${DECK_W - 36}" height="${DECK_H - 36}" rx="30" fill="#08090b"/>${keys}`;
}
function deckImage(name, specs, caption) {
  const W = DECK_W + 80, H = DECK_H + 80 + (caption ? 56 : 0);
  write(name, `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#0d1117"/>${deckSvg(specs, 40, 40, name.replace(/\W/g, ''))}${caption ? `<text x="${W / 2}" y="${H - 34}" font-family="Bahnschrift" font-size="26" fill="#8b949e" text-anchor="middle">${esc(caption)}</text>` : ''}</svg>`);
}

const live = scopeFor(true);
const nosim = scopeFor(false);
const msfsPage = (page, s) => [...Array(15).keys()].map((i) => msfsSlot(i, page).draw(s));
const forzaPage = (t) => [...Array(15).keys()].map((i) => forzaSlot(i).draw(scopeFor(false, t)));

// --- one image per MSFS page, plus the no-sim state
MSFS_TABS.forEach((tab, p) => deckImage(`msfs-${tab.label.toLowerCase()}.png`, msfsPage(p, live)));
deckImage('msfs-no-sim.png', msfsPage(0, nosim));
// a landing-config variant: gear in transit, flaps 2/3, spoilers armed, brake set
deckImage('msfs-gear-transit.png', msfsPage(0, scopeFor(true, null, {
  'GEAR CENTER POSITION': 0.45, 'GEAR LEFT POSITION': 0.6, 'GEAR RIGHT POSITION': 0.52, 'FLAPS HANDLE INDEX': 2,
  'SPOILERS ARMED': 1, 'AIRSPEED INDICATED': 78, 'INDICATED ALTITUDE': 1210, 'VERTICAL SPEED': -520,
})));

// --- Cessna 172 Skyhawk pages (stick at rest, nothing held)
const skyPage = (page, s) => [...Array(15).keys()].map((i) => msfsSlot(i, page, 'skyhawk').draw(s));
SKYHAWK_TABS.forEach((tab, p) => { if (p !== 3) deckImage(`skyhawk-${tab.label.toLowerCase()}.png`, skyPage(p, live)); });
// stick and deck together: trim-down (stick 6) held on approach, flaps 20°, park brake off
deckImage('skyhawk-stick-echo.png', skyPage(0, scopeFor(true, null, {
  'ELEVATOR TRIM PCT': 0.21, 'FLAPS HANDLE INDEX': 2, 'GENERAL ENG RPM:1': 1650, 'GENERAL ENG THROTTLE LEVER POSITION:1': 31,
  'ENG FUEL FLOW GPH:1': 5.2, 'GENERAL ENG EXHAUST GAS TEMPERATURE:1': 1180,
}, { stick: fakeStick(true, [6]) })), 'Stick button 6 held: TRIM ▼ lights cyan');
// AP disconnected from the stick (button 11)
deckImage('skyhawk-ap-disc.png', skyPage(2, scopeFor(true, null, { 'AUTOPILOT MASTER': 0, 'AUTOPILOT HEADING LOCK': 0, 'AUTOPILOT VERTICAL HOLD': 0 }, { apDisc: true })),
  'Stick button 11 disconnects the autopilot: the AP key flashes DISC for 3 seconds');
// engine start: battery on, magnetos BOTH, fuel pump on, engine not yet running
deckImage('skyhawk-engine-start.png', skyPage(1, scopeFor(true, null, {
  'ENG COMBUSTION:1': 0, 'GENERAL ENG MIXTURE LEVER POSITION:1': 100,
}, { inputs: { ELECTRICAL_LINE_BUS_1_TO_AVIONICS_BUS_1: 0, ELECTRICAL_LINE_BUS_2_TO_AVIONICS_BUS_2: 0, FUEL_PUMP_1: 1 } })),
'Before start: master on, avionics off, fuel pump on, mixture rich, magnetos BOTH');

// --- Forza
const race = parse(forzaPacket());
deckImage('forza-live.png', forzaPage(race));
deckImage('forza-no-data.png', forzaPage(null));

// --- gallery of individual key states with labels
const gallery = [
  [{ style: 'toggle', caption: 'AUTOPILOT', label: 'AP', state: true, onText: 'ENGAGED' }, 'Switch: on'],
  [{ style: 'toggle', caption: 'LIGHTS', label: 'STROBE', state: false, color: '#ffb52e' }, 'Switch: off'],
  [{ style: 'toggle', caption: 'LIGHTS', label: 'NAV', state: null }, 'No sim connected'],
  [{ style: 'value', caption: 'HDG', value: '270°', unit: 'BUG', active: true, color: '#ff5ad1' }, 'Mode + target'],
  [{ style: 'radio', caption: 'COM 1 · SWAP', active: '121.500', standby: '118.300' }, 'Radio: tap to swap'],
  [{ style: 'gear', down: true, positions: [1, 1, 1] }, 'Gear: 3 green'],
  [{ style: 'gear', down: false, positions: [0.5, 0.4, 0.6] }, 'Gear: in transit'],
  [{ style: 'gear', down: false, positions: [0, 0, 0] }, 'Gear: up'],
  [{ style: 'flaps', index: 2, count: 3, dir: 'down' }, 'Flaps 2 of 3'],
  [{ style: 'tab', label: 'FLIGHT', icon: 'flight', active: true, link: false }, 'Tab: active, no sim'],
  [{ style: 'rpm', rpm: 5200, max: 8000 }, 'Revs: normal'],
  [{ style: 'rpm', rpm: 7600, max: 8000 }, 'Revs: shift light'],
  [{ style: 'gearBig', gear: 'R' }, 'Gear: reverse'],
  [{ style: 'tyres', temps: [48, 84, 104, 122] }, 'Tyres: cold to hot'],
  [{ style: 'button', caption: 'HDG BUG', glyph: 'plus', label: 'HOLD TO SLEW' }, 'Hold to repeat'],
  [{ style: 'magnetos', pos: 3, note: 'TAP: NEXT · HOLD: OFF' }, 'Magnetos: BOTH'],
  [{ style: 'trim', dir: 'down', pct: 0.14, note: 'BTN 6', ring: '#3fd8ff' }, 'Trim: stick button held'],
  [{ style: 'tanks', left: 18.4, right: 4.2, cap: 28 }, 'Fuel: right tank low'],
  [{ style: 'toggle', caption: 'HOLD 1 S', label: 'AUTO START', state: false, offText: 'ENGINE OFF', progress: 0.6 }, 'Hold-to-confirm ring'],
  [{ style: 'stick', connected: true, x: 0.3, y: -0.4, twist: -0.3, slider: 0.62, throttle: 62 }, 'Live stick view'],
];
{
  const cols = 5, cw = 200, ch = 230, W = cols * cw + 40, H = Math.ceil(gallery.length / cols) * ch + 40;
  let body = '';
  gallery.forEach(([spec, label], i) => {
    const x = 20 + (i % cols) * cw + (cw - KEY) / 2, y = 20 + Math.floor(i / cols) * ch + 10;
    body += `<clipPath id="g${i}"><rect x="${x}" y="${y}" width="${KEY}" height="${KEY}" rx="22"/></clipPath><image clip-path="url(#g${i})" x="${x}" y="${y}" width="${KEY}" height="${KEY}" href="${renderKey(spec)}"/>`;
    body += `<text x="${x + KEY / 2}" y="${y + KEY + 36}" font-family="Bahnschrift" font-size="20" fill="#c9d1d9" text-anchor="middle">${esc(label)}</text>`;
  });
  write('key-states.png', `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#0d1117"/>${body}</svg>`);
}

// --- banner (1280x640, also fits GitHub's social preview)
{
  const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(PLUGIN, 'imgs', 'plugin@2x.png')).toString('base64');
  const scale = 0.62, dx = 1280 - DECK_W * scale - 60, dy = (640 - DECK_H * scale) / 2 + 20;
  write('banner.png', `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640">
<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#05070a"/></linearGradient>
<radialGradient id="glow" cx="0.75" cy="0.5" r="0.6"><stop offset="0" stop-color="#3fd8ff" stop-opacity="0.18"/><stop offset="1" stop-color="#3fd8ff" stop-opacity="0"/></radialGradient></defs>
<rect width="1280" height="640" fill="url(#bg)"/><rect width="1280" height="640" fill="url(#glow)"/>
<image x="60" y="150" width="120" height="120" href="${logo}"/>
<text x="60" y="350" font-family="Bahnschrift" font-size="78" fill="#ffffff">Cockpit Deck</text>
<text x="62" y="404" font-family="Bahnschrift" font-size="28" fill="#8fb8d8">Live Stream Deck keys for</text>
<text x="62" y="442" font-family="Bahnschrift" font-size="28" fill="#8fb8d8">MSFS 2024 + Forza Horizon 6</text>
${[['real switch states', 62], ['telemetry', 300], ['auto profiles', 450]].map(([s, x]) => `<circle cx="${x + 7}" cy="505" r="7" fill="#3dff8b"/><text x="${x + 22}" y="512" font-family="Bahnschrift" font-size="22" fill="#3dff8b">${s}</text>`).join('')}
<g transform="translate(${dx} ${dy}) scale(${scale})">${deckSvg(msfsPage(1, live), 0, 0, 'b')}</g>
</svg>`);
}

// --- logo copy for the README header
fs.copyFileSync(path.join(PLUGIN, 'imgs', 'plugin@2x.png'), path.join(OUT, 'logo.png'));
console.log('wrote docs/images/logo.png');
