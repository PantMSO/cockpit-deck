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
  return frame(inner, { pressed: k.pressed, ring: k.ring });
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
    text(72, 128, known ? (k.index === 0 ? 'UP' : k.degrees ? `${k.degrees[k.index] != null ? k.degrees[k.index] : k.index}°` : `${k.index} / ${k.count}`) : '– –', 24, col, { glow: known });
  return frame(inner, { pressed: k.pressed, ring: k.ring });
}

/** Elevator trim: {pct -1..1 (+ = nose up), note} */
function trim(k) {
  const known = k.pct != null;
  const p = known ? Math.max(-1, Math.min(1, k.pct)) : 0;
  const top = 42, bot = 118, mid = (top + bot) / 2;
  const y = mid - p * (bot - top) / 2;
  const col = known ? (Math.abs(p) < 0.03 ? C.green : C.cyan) : C.faint;
  const pctTxt = known ? (Math.abs(p) < 0.005 ? 'NEUTRAL' : `${p > 0 ? 'UP' : 'DN'} ${Math.round(Math.abs(p) * 100)}%`) : '– –';
  let ticks = '';
  for (let i = 0; i <= 8; i++) {
    const ty = top + (i * (bot - top)) / 8;
    ticks += `<line x1="${i % 4 === 0 ? 30 : 36}" y1="${ty}" x2="48" y2="${ty}" stroke="${i === 4 ? C.dim : C.faint}" stroke-width="${i === 4 ? 3 : 2}"/>`;
  }
  const inner = caption('ELEV TRIM') +
    `<rect x="50" y="${top - 4}" width="16" height="${bot - top + 8}" rx="8" fill="#0d1014" stroke="${C.faint}" stroke-width="2"/>` + ticks +
    text(24, top + 6, 'UP', 13, C.dim, { anchor: 'middle' }) + text(24, bot + 2, 'DN', 13, C.dim, { anchor: 'middle' }) +
    (known ? `<path d="M46 ${y.toFixed(1)} l24 0 l10 -9 v18 l-10 -9" fill="${col}" stroke="${col}" stroke-width="2" stroke-linejoin="round" filter="url(#softglow)"/>` : '') +
    (known && pctTxt !== 'NEUTRAL'
      ? text(106, 78, pctTxt.split(' ')[0], 22, col, { glow: true }) + text(106, 106, pctTxt.split(' ')[1], 24, col, { glow: true })
      : text(106, 92, pctTxt, known ? 15 : 22, col, { glow: known })) +
    (k.note ? text(106, 130, k.note, fit(k.note, 14, 58), C.dim) : '');
  return frame(inner, { pressed: k.pressed, ring: k.ring });
}

/** Ignition key: {pos 0 OFF,1 R,2 L,3 BOTH,4 START or null, note} */
function magnetos(k) {
  const names = ['OFF', 'R', 'L', 'BOTH', 'START'];
  const known = k.pos != null && names[k.pos] !== undefined;
  const name = known ? names[k.pos] : '– –';
  const l = known && (k.pos === 2 || k.pos >= 3), r = known && (k.pos === 1 || k.pos >= 3);
  const col = !known ? C.faint : k.pos === 0 ? C.red : k.pos === 3 ? C.green : C.amber;
  const lamp = (cx, on, label) => `<circle cx="${cx}" cy="50" r="10" fill="${on ? C.green : '#0d1014'}" stroke="${on ? C.green : C.faint}" stroke-width="2"${on ? ' filter="url(#glow)"' : ''}/>` + text(cx, 76, label, 14, on ? C.text : C.dim);
  const inner = text(72, 26, 'MAGNETOS', 16, C.dim, { spacing: 1.5 }) + lamp(46, l, 'L') + lamp(98, r, 'R') +
    text(72, 110, name, fit(name, 34, 120), col, { glow: known }) +
    (k.note ? text(72, 132, k.note, fit(k.note, 14, 124), C.dim) : '');
  return frame(inner, { pressed: k.pressed, ring: k.ring });
}

/** Two fuel tanks: {left, right, cap} gallons */
function tanks(k) {
  const cap = k.cap > 0 ? k.cap : 28;
  const colFor = (g) => (g == null ? C.faint : g < 5 ? C.red : g < 10 ? C.amber : C.green);
  const bar = (x, g, label) => {
    const known = g != null;
    const f = known ? Math.max(0, Math.min(1, g / cap)) : 0;
    const h = 62 * f;
    return `<rect x="${x}" y="40" width="30" height="66" rx="7" fill="#0d1014" stroke="${C.faint}" stroke-width="2"/>` +
      (known ? `<rect x="${x + 2}" y="${(104 - h).toFixed(1)}" width="26" height="${h.toFixed(1)}" rx="5" fill="${colFor(g)}" opacity="0.9"${g < 10 ? ' filter="url(#softglow)"' : ''}/>` : '') +
      text(x + 15, 128, known ? g.toFixed(g < 10 ? 1 : 0) : '–', 19, known ? colFor(g) : C.faint, { glow: known && g < 10 }) +
      text(label === 'L' ? x - 10 : x + 40, 78, label, 15, C.dim);
  };
  const inner = caption('FUEL GAL') + bar(28, k.left, 'L') + bar(86, k.right, 'R');
  return frame(inner, { pressed: k.pressed });
}

/** Two stacked readouts: {caption, rows:[{label, value, unit, color}]} */
function dual(k) {
  const row = (y, r) => {
    const known = r.value != null;
    const v = known ? String(r.value) : '– –';
    return text(16, y - 26, r.label, 14, C.dim, { anchor: 'start', spacing: 1 }) +
      text(128, y, v, fit(v, 32, 80), known ? (r.color || C.cyan) : C.faint, { anchor: 'end', glow: known }) +
      text(16, y, r.unit || '', 14, C.dim, { anchor: 'start' });
  };
  const inner = caption(k.caption || '') + row(76, k.rows[0]) +
    `<line x1="16" y1="88" x2="128" y2="88" stroke="${C.faint}" stroke-width="1.5"/>` + row(128, k.rows[1]);
  return frame(inner, { pressed: k.pressed });
}

/** Live view of the joystick: {connected, x, y, twist, slider 0..1, throttle (sim %), footer} */
function stick(k) {
  const on = !!k.connected;
  const cx = 52, cy = 74, r = 30;
  const dx = on ? cx + k.x * r : cx, dy = on ? cy + k.y * r : cy;
  const tw = on ? k.twist : 0;
  const sl = on ? Math.max(0, Math.min(1, k.slider)) : 0;
  const inner = caption('STICK', on ? C.dim : C.amber) +
    `<rect x="${cx - r - 4}" y="${cy - r - 4}" width="${2 * r + 8}" height="${2 * r + 8}" rx="10" fill="#0d1014" stroke="${C.faint}" stroke-width="2"/>` +
    `<line x1="${cx - r}" y1="${cy}" x2="${cx + r}" y2="${cy}" stroke="${C.faint}" stroke-width="1.5"/><line x1="${cx}" y1="${cy - r}" x2="${cx}" y2="${cy + r}" stroke="${C.faint}" stroke-width="1.5"/>` +
    (on ? `<circle cx="${dx.toFixed(1)}" cy="${dy.toFixed(1)}" r="7" fill="${C.cyan}" filter="url(#glow)"/>` : '') +
    // twist bar under the box
    `<rect x="${cx - r}" y="${cy + r + 10}" width="${2 * r}" height="6" rx="3" fill="#151a20"/>` +
    (on ? `<rect x="${(cx + Math.min(0, tw) * r).toFixed(1)}" y="${cy + r + 10}" width="${(Math.abs(tw) * r).toFixed(1)}" height="6" rx="3" fill="${C.magenta}"/>` : '') +
    // throttle slider on the right
    `<rect x="102" y="44" width="22" height="66" rx="7" fill="#0d1014" stroke="${C.faint}" stroke-width="2"/>` +
    (on ? `<rect x="104" y="${(108 - 62 * sl).toFixed(1)}" width="18" height="${(62 * sl).toFixed(1)}" rx="5" fill="${C.green}" opacity="0.9"/>` : '') +
    text(113, 128, on ? (k.throttle != null ? Math.round(k.throttle) + '%' : Math.round(sl * 100) + '%') : '', 17, C.text) +
    (on ? '' : text(72, 132, k.footer || 'NOT FOUND', 15, C.amber));
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
    case 'engine': return `<circle cx="72" cy="58" r="8" fill="${color}"/><path d="M72 50 c-4 -14 2 -22 6 -22 c2 8 -2 16 -6 22 M79 62 c13 5 18 14 15 18 c-8 0 -14 -6 -15 -18 M65 62 c-13 5 -18 14 -15 18 c8 0 14 -6 15 -18" stroke="${color}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="${color}" fill-opacity="0.25"/>`;
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

const styles = { toggle, value, button, tab, gear, flaps, radio, status, rpm, gearBig, tyres, trim, magnetos, tanks, dual, stick };

// Rounded-rect perimeter of the progress ring (x=5,y=5,134x134,rx=20).
const RING_LEN = 4 * (134 - 40) + 2 * Math.PI * 20;

/** Overlays shared by every style: a hold-to-confirm progress ring and a short hint banner. */
function overlays(svg, k) {
  let extra = '';
  if (k.progress > 0) {
    const len = (Math.min(1, k.progress) * RING_LEN).toFixed(1);
    extra += `<rect x="5" y="5" width="134" height="134" rx="20" fill="none" stroke="${C.amber}" stroke-width="6" stroke-dasharray="${len} ${RING_LEN.toFixed(1)}" filter="url(#glow)"/>`;
  }
  if (k.hint) {
    extra += `<rect x="10" y="52" width="124" height="40" rx="12" fill="#000000" opacity="0.82" stroke="${C.amber}" stroke-width="2"/>` +
      text(72, 79, k.hint, fit(k.hint, 20, 116), C.amber, { bold: true });
  }
  return extra ? svg.replace(/<\/svg>\s*$/, extra + '</svg>') : svg;
}

function svgFor(k) {
  const fn = styles[k.style];
  if (!fn) throw new Error('unknown style ' + k.style);
  return overlays(fn(k), k);
}

function renderKey(k) { return png(svgFor(k)); }

module.exports = { renderKey, svgFor, COLORS };
