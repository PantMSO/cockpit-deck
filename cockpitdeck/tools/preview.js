'use strict';
// Renders a 5x3 deck page (or a list of key specs) to one PNG so the layout can be reviewed.
// usage: node preview.js <out.png> <keys.json>   (keys.json = array of 15 key specs, null = blank)
const fs = require('fs');
const path = require('path');
const plugin = path.join(__dirname, '..', 'com.local.cockpitdeck.sdPlugin');
const { Resvg } = require(path.join(plugin, 'node_modules', '@resvg', 'resvg-js'));
const { renderKey } = require(path.join(plugin, 'bin', 'render.js'));

function sheet(keys, cols = 5) {
  const rows = Math.ceil(keys.length / cols);
  const gap = 18, size = 144;
  const W = cols * size + (cols + 1) * gap, H = rows * size + (rows + 1) * gap;
  let body = '';
  keys.forEach((k, i) => {
    const x = gap + (i % cols) * (size + gap), y = gap + Math.floor(i / cols) * (size + gap);
    if (!k) { body += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="22" fill="#000"/>`; return; }
    body += `<clipPath id="c${i}"><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="22"/></clipPath>`;
    body += `<image clip-path="url(#c${i})" x="${x}" y="${y}" width="${size}" height="${size}" href="${renderKey(k)}"/>`;
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#1b1d20"/>${body}</svg>`;
  return new Resvg(svg).render().asPng();
}

module.exports = { sheet };

if (require.main === module) {
  const [out, file] = process.argv.slice(2);
  fs.writeFileSync(out, sheet(JSON.parse(fs.readFileSync(file, 'utf8'))));
  console.log('wrote', out);
}
