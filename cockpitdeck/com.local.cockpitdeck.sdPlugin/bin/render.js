'use strict';
// Draws every key face as SVG and rasterises it to a 144x144 PNG (Stream Deck MK.2 @2x).
const { Resvg } = require('@resvg/resvg-js');

const FONT_OPTS = {
  font: {
    loadSystemFonts: false,
    fontFiles: ['C:/Windows/Fonts/bahnschrift.ttf', 'C:/Windows/Fonts/segoeuib.ttf', 'C:/Windows/Fonts/segoeui.ttf'],
    defaultFontFamily: 'Bahnschrift',
  },
};

const C = {
  bg0: '#161b22', bg1: '#07090c', bezel: '#2b333e', text: '#e8edf3', dim: '#6b7684', faint: '#3a434f',
  green: '#3dff8b', amber: '#ffb52e', red: '#ff4d4d', cyan: '#3fd8ff', white: '#ffffff', magenta: '#ff5ad1',
};
const COLORS = C;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function frame(inner, opts = {}) {
  const ring = opts.ring
    ? `<rect x="5" y="5" width="134" height="134" rx="20" fill="none" stroke="${opts.ring}" stroke-width="4" filter="url(#glow)" opacity="0.9"/>`
    : '';
  const pressed = opts.pressed ? `<rect x="0" y="0" width="144" height="144" fill="#ffffff" opacity="0.14"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.bg0}"/><stop offset="1" stop-color="${C.bg1}"/></linearGradient>
<linearGradient id="sheen" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.07"/><stop offset="0.45" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
<filter id="softglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>
<rect width="144" height="144" fill="url(#bg)"/>
<rect x="3" y="3" width="138" height="138" rx="22" fill="none" stroke="${C.bezel}" stroke-width="2"/>
<rect x="3" y="3" width="138" height="70" rx="22" fill="url(#sheen)"/>
${inner}
${ring}
${pressed}
</svg>`;
}

function text(x, y, s, size, color, o = {}) {
  const anchor = o.anchor || 'middle';
  const weight = o.bold ? ` font-weight="700"` : '';
  const family = o.bold ? 'Segoe UI' : 'Bahnschrift';
  const glow = o.glow ? ` filter="url(#softglow)"` : '';
  const ls = o.spacing ? ` letter-spacing="${o.spacing}"` : '';
  return `<text x="${x}" y="${y}" font-family="${family}"${weight} font-size="${size}" fill="${color}" text-anchor="${anchor}"${ls}${glow}>${esc(s)}</text>`;
}

// Fit a label to a width by shrinking the font.
function fit(s, max, width) {
  const len = String(s).length || 1;
  return Math.min(max, Math.floor(width / (len * 0.56)));
}

function caption(s, color = C.dim) {
  return text(72, 30, s, fit(s, 19, 120), color, { spacing: 1.5 });
}

// Annunciator capsule along the bottom.
function annunciator(state, color, onText = 'ON', offText = 'OFF') {
  if (state === null || state === undefined) {
    return `<rect x="22" y="100" width="100" height="28" rx="14" fill="#0d1014" stroke="${C.faint}" stroke-width="2"/>${text(72, 120, '– –', 18, C.faint)}`;
  }
  if (state) {
    return `<rect x="22" y="100" width="100" height="28" rx="14" fill="${color}" opacity="0.22" filter="url(#glow)"/>
<rect x="22" y="100" width="100" height="28" rx="14" fill="${color}" opacity="0.9"/>
${text(72, 121, onText, 19, '#06210f', { bold: true })}`;
  }
  return `<rect x="22" y="100" width="100" height="28" rx="14" fill="#0d1014" stroke="${C.faint}" stroke-width="2"/>${text(72, 120, offText, 17, C.dim)}`;
}

// ---- key styles ---------------------------------------------------------------

/** On/off switch with an annunciator: {caption, label, state:true|false|null, color} */
function toggle(k) {
  const color = k.color || C.green;
  const labelColor = k.state ? C.white : C.text;
  const inner = caption(k.caption || '') +
    text(72, 78, k.label, fit(k.label, 40, 124), labelColor, { glow: !!k.state }) +
    annunciator(k.state, color, k.onText, k.offText);
  return frame(inner, { pressed: k.pressed });
}

/** Big readout: {caption, value, unit, color, active(bool|null)} */
function value(k) {
  const color = k.value === null || k.value === undefined ? C.faint : (k.color || C.cyan);
  const v = k.value === null || k.value === undefined ? '– – –' : String(k.value);
  let inner = caption(k.caption || '') +
    text(72, 90, v, fit(v, 50, 128), color, { glow: k.value != null });
  if (k.unit) inner += text(72, 124, k.unit, 17, C.dim, { spacing: 2 });
  if (k.active === true) inner += `<circle cx="120" cy="24" r="7" fill="${C.green}" filter="url(#glow)"/>`;
  else if (k.active === false) inner += `<circle cx="120" cy="24" r="6" fill="none" stroke="${C.faint}" stroke-width="2"/>`;
  return frame(inner, { pressed: k.pressed, ring: k.ring });
}

/** Momentary button with a glyph: {caption, glyph, label, color} */
function button(k) {
  const color = k.color || C.text;
  const inner = caption(k.caption || '') + glyph(k.glyph, color) +
    (k.label ? text(72, 126, k.label, fit(k.label, 20, 124), C.dim, { spacing: 1 }) : '');
  return frame(inner, { pressed: k.pressed });
}

/** Page tab: {label, active} */
function tab(k) {
  const col = k.active ? C.cyan : C.dim;
  const inner = (k.active ? `<rect x="0" y="0" width="144" height="144" fill="${C.cyan}" opacity="0.07"/>` : '') +
    (k.link === false && k.active ? text(72, 26, 'NO SIM', 16, C.amber, { spacing: 2 }) : '') +
    tabGlyph(k.icon, col) +
    text(72, 112, k.label, fit(k.label, 22, 124), k.active ? C.white : C.text, { spacing: 1 }) +
    (k.active
      ? `<rect x="34" y="122" width="76" height="7" rx="3.5" fill="${C.cyan}" filter="url(#glow)"/>`
      : `<rect x="54" y="123" width="36" height="5" rx="2.5" fill="${C.faint}"/>`);
  return frame(inner, { pressed: k.pressed });
}

/** Landing gear: {down:null|bool, positions:[nose,left,right] 0..1, retractable} */
function gear(k) {
  const lights = (k.positions || [null, null, null]).map((p) => {
    if (p === null || p === undefined) return { fill: '#0d1014', stroke: C.faint, glow: false };
    if (p >= 0.99) return { fill: C.green, stroke: C.green, glow: true };
    if (p <= 0.01) return { fill: '#0d1014', stroke: C.faint, glow: false };
    return { fill: C.red, stroke: C.red, glow: true };
  });
  const dot = (cx, cy, l) => `<circle cx="${cx}" cy="${cy}" r="13" fill="${l.fill}" stroke="${l.stroke}" stroke-width="2.5"${l.glow ? ' filter="url(#glow)"' : ''}/>`;
  const handle = k.down === null || k.down === undefined ? '– –' : (k.down ? 'DOWN' : 'UP');
  const inTransit = (k.positions || []).some((p) => p != null && p > 0.01 && p < 0.99);
  const hcol = k.down == null ? C.faint : inTransit ? C.red : k.down ? C.green : C.text;
  const inner = caption(k.retractable === false ? 'GEAR · FIXED' : 'GEAR') +
    dot(72, 56, lights[0]) + dot(44, 84, lights[1]) + dot(100, 84, lights[2]) +
    text(72, 128, inTransit ? 'TRANSIT' : handle, 22, hcol, { glow: k.down != null });
  return frame(inner, { pressed: k.pressed });
}

/** Flaps: {index, count, dir:'up'|'down'} */
function flaps(k) {
  const known = k.index !== null && k.index !== undefined && k.count;
  const pct = known ? Math.max(0, Math.min(1, k.index / Math.max(1, k.count))) : 0;
  const ang = 8 + pct * 40;
  const rad = (ang * Math.PI) / 180;
  const x2 = 78 + Math.cos(rad) * 40, y2 = 66 + Math.sin(rad) * 40;
  const col = known ? (pct > 0 ? C.amber : C.cyan) : C.faint;
  const arrow = k.dir === 'up'
    ? `<path d="M106 40 l12 -14 l12 14" fill="none" stroke="${C.text}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<path d="M106 26 l12 14 l12 -14" fill="none" stroke="${C.text}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  const inner = text(16, 34, 'FLAPS', 18, C.dim, { anchor: 'start', spacing: 1.5 }) + arrow +
    `<path d="M18 66 Q40 48 78 60 L78 70 Q40 74 18 66 Z" fill="${C.bezel}" stroke="${C.dim}" stroke-width="2"/>` +
    `<line x1="78" y1="66" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="7" stroke-linecap="round"${known ? ' filter="url(#softglow)"' : ''}/>` +
    text(72, 128, known ? (k.index === 0 ? 'UP' : `${k.index} / ${k.count}`) : '– –', 24, col, { glow: known });
  return frame(inner, { pressed: k.pressed });
}

/** Radio: {caption, active, standby} (strings) */
function radio(k) {
  const a = k.active || '– – –', s = k.standby || '– – –';
  const inner = caption(k.caption) +
    text(72, 76, a, fit(a, 36, 130), k.active ? C.green : C.faint, { glow: !!k.active }) +
    `<path d="M40 92 h64 m-10 -7 l10 7 l-10 7" fill="none" stroke="${C.dim}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>` +
    text(72, 128, s, fit(s, 28, 120), k.standby ? C.amber : C.faint);
  return frame(inner, { pressed: k.pressed });
}

/** Status / connection key: {title, line, color} */
function status(k) {
  const inner = caption(k.caption || '') +
    `<circle cx="72" cy="66" r="18" fill="${k.color}" opacity="${k.color === C.faint ? 0.5 : 0.95}"${k.color === C.faint ? '' : ' filter="url(#glow)"'}/>` +
    text(72, 114, k.title, fit(k.title, 22, 128), C.text) +
    (k.line ? text(72, 134, k.line, fit(k.line, 15, 124), C.dim) : '');
  return frame(inner, { pressed: k.pressed });
}

// ---- Forza specific ------------------------------------------------------------

/** Rev bar with shift light: {rpm, max, idle} */
function rpm(k) {
  const ok = k.rpm != null && k.max > 0;
  const f = ok ? Math.max(0, Math.min(1, k.rpm / k.max)) : 0;
  const segs = 12;
  let bars = '';
  for (let i = 0; i < segs; i++) {
    const lit = ok && f >= (i + 1) / segs - 0.0001;
    const zone = i < 7 ? C.green : i < 10 ? C.amber : C.red;
    const h = 14 + i * 3.4;
    const x = 12 + i * 10.4;
    bars += `<rect x="${x.toFixed(1)}" y="${(92 - h).toFixed(1)}" width="7.6" height="${h.toFixed(1)}" rx="2" fill="${lit ? zone : '#151a20'}"${lit ? ' filter="url(#softglow)"' : ''}/>`;
  }
  const shift = ok && f >= 0.92;
  const inner = caption('RPM', shift ? C.red : C.dim) + bars +
    text(72, 126, ok ? Math.round(k.rpm).toLocaleString('en-US') : '– – –', 26, shift ? C.red : (ok ? C.text : C.faint), { glow: shift }) +
    (shift ? `<rect x="5" y="5" width="134" height="134" rx="20" fill="none" stroke="${C.red}" stroke-width="5" filter="url(#glow)"/>` : '');
  return frame(inner, { pressed: k.pressed });
}

/** Gear indicator: {gear:'R'|'N'|number|null} */
function gearBig(k) {
  const g = k.gear == null ? '–' : String(k.gear);
  const col = k.gear == null ? C.faint : g === 'R' ? C.red : g === 'N' ? C.amber : C.white;
  const inner = caption('GEAR') + text(72, 120, g, 84, col, { glow: k.gear != null });
  return frame(inner, { pressed: k.pressed });
}

/** Tyre temps: {temps:[fl,fr,rl,rr] in °C or null} */
function tyres(k) {
  const t = k.temps || [null, null, null, null];
  const colFor = (c) => (c == null ? '#151a20' : c < 60 ? C.cyan : c < 95 ? C.green : c < 115 ? C.amber : C.red);
  const cell = (x, y, c) => `<rect x="${x}" y="${y}" width="44" height="36" rx="8" fill="${colFor(c)}" opacity="${c == null ? 1 : 0.9}"/>` +
    text(x + 22, y + 26, c == null ? '–' : Math.round(c), 20, c == null ? C.faint : '#081016', { bold: true });
  const inner = caption('TYRES °C') + cell(22, 46, t[0]) + cell(78, 46, t[1]) + cell(22, 92, t[2]) + cell(78, 92, t[3]);
  return frame(inner, { pressed: k.pressed });
}

// ---- glyphs --------------------------------------------------------------------

function glyph(name, color) {
  const s = `stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  switch (name) {
    case 'plus': return `<path d="M72 46 v48 M48 70 h48" ${s}/>`;
    case 'minus': return `<path d="M48 70 h48" ${s}/>`;
    case 'up': return `<path d="M46 82 l26 -26 l26 26" ${s}/>`;
    case 'down': return `<path d="M46 58 l26 26 l26 -26" ${s}/>`;
    case 'swap': return `<path d="M40 58 h60 m-12 -12 l12 12 l-12 12 M104 86 h-60 m12 -12 l-12 12 l12 12" ${s.replace('7', '6')}/>`;
    case 'pause': return `<path d="M58 48 v44 M86 48 v44" ${s.replace('7', '10')}/>`;
    case 'rewind': return `<path d="M70 48 l-26 22 l26 22 Z M100 48 l-26 22 l26 22 Z" fill="${color}" stroke="${color}" stroke-width="3" stroke-linejoin="round"/>`;
    case 'horn': return `<path d="M42 60 h12 l26 -16 v52 l-26 -16 h-12 Z" fill="${color}"/><path d="M90 56 q10 14 0 28 M100 48 q18 22 0 44" ${s.replace('7', '5')}/>`;
    case 'reset': return `<path d="M92 52 a26 26 0 1 0 6 26" ${s.replace('7', '6')}/><path d="M86 40 l10 13 l-15 4" ${s.replace('7', '6')}/>`;
    case 'start': return `<circle cx="72" cy="72" r="26" ${s.replace('7', '6')}/><path d="M72 52 v20" ${s.replace('7', '6')}/>`;
    default: return '';
  }
}

function tabGlyph(name, color) {
  const s = `stroke="${color}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  switch (name) {
    case 'flight': return `<path d="M72 30 v52 M44 60 l28 -10 l28 10 M60 82 l12 -4 l12 4" ${s}/>`;
    case 'ap': return `<circle cx="72" cy="56" r="24" ${s}/><path d="M72 40 v16 l10 8" ${s}/>`;
    case 'lights': return `<path d="M62 76 h20 M64 84 h16 M60 70 a18 18 0 1 1 24 0 l-2 4 h-20 Z" ${s}/>`;
    case 'radio': return `<path d="M48 80 h48 v-26 h-48 Z M58 54 l24 -18" ${s}/><circle cx="62" cy="67" r="5" fill="${color}"/>`;
    case 'systems': return `<path d="M58 34 v12 M86 34 v12 M50 46 h44 v14 a22 22 0 0 1 -44 0 Z M72 82 v8" ${s}/>`;
    default: return '';
  }
}

// ---- raster --------------------------------------------------------------------

const cache = new Map();
function png(svg) {
  let out = cache.get(svg);
  if (!out) {
    out = 'data:image/png;base64,' + new Resvg(svg, FONT_OPTS).render().asPng().toString('base64');
    if (cache.size > 600) cache.clear();
    cache.set(svg, out);
  }
  return out;
}

const styles = { toggle, value, button, tab, gear, flaps, radio, status, rpm, gearBig, tyres };

function renderKey(k) {
  const fn = styles[k.style];
  if (!fn) throw new Error('unknown style ' + k.style);
  return png(fn(k));
}

module.exports = { renderKey, svgFor: (k) => styles[k.style](k), COLORS };
