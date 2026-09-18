#!/usr/bin/env node
// inject-items.mjs — expand the `placements` in guide.html's guide-data block into full items,
// copied from research/items.json, so researched data (and every image URL) reaches the page
// verbatim without being retyped.
// Usage: node inject-items.mjs <guide.html> [--items research/items.json]
// Safe to rerun: items named in `placements` are rebuilt each time; hand-authored items are kept.

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname, join } from 'path';

const args = process.argv.slice(2);
const guideFile = args.find(a => !a.startsWith('--'));
if (!guideFile) { console.error('Usage: node inject-items.mjs <guide.html> [--items research/items.json]'); process.exit(1); }
const flag = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const itemsFile = resolve(flag('--items', join(dirname(resolve(guideFile)), 'research', 'items.json')));

const ISLAND = /(<script type="application\/json" id="guide-data">)([\s\S]*?)(<\/script>)/;
let html = readFileSync(guideFile, 'utf8');
const m = html.match(ISLAND);
if (!m) { console.error('No <script type="application/json" id="guide-data"> block found'); process.exit(1); }

let data;
try { data = JSON.parse(m[2]); } catch (e) { console.error(`guide-data JSON is invalid: ${e.message}`); process.exit(1); }
const placements = data.placements;
if (!placements || typeof placements !== 'object' || !Object.keys(placements).length) {
  console.log('  No placements in guide-data; nothing to inject.');
  process.exit(0);
}
if (!existsSync(itemsFile)) { console.error(`No items file at ${itemsFile}. Run collect-items.mjs first.`); process.exit(1); }
const researched = new Map(JSON.parse(readFileSync(itemsFile, 'utf8')).map(it => [it.id, it]));

const errors = [];
const injected = [];
for (const [id, p] of Object.entries(placements)) {
  const src = researched.get(id);
  if (!src) { errors.push(`placement "${id}": no item with that id in ${itemsFile}`); continue; }
  if (!p || typeof p !== 'object') { errors.push(`placement "${id}": must be an object like {"section": "..."}`); continue; }
  if (!p.content && !p.section) { errors.push(`placement "${id}": needs a "section" (a card mount) or "content": true (a data-id element in your prose)`); continue; }

  let images = src.images || [];
  if (p.images !== undefined) {
    if (!Array.isArray(p.images)) { errors.push(`placement "${id}": "images" must be a list of image URLs`); continue; }
    const picked = [];
    for (const url of p.images) {
      const im = images.find(x => x.url === url);
      if (im) picked.push(im); else errors.push(`placement "${id}": image not in this item's research (retyped or from another item?): ${String(url).slice(0, 90)}`);
    }
    images = picked;
  }

  const item = { id, category: p.category ?? src.category, name: p.name ?? src.name, blurb: p.blurb ?? src.blurb ?? '', description: p.description ?? src.description ?? '' };
  if (!p.content) item.section = p.section;
  if (p.feature) item.feature = true;
  const season = p.season ?? src.season;
  if (season != null) item.season = season;
  const lat = p.lat ?? src.lat, lng = p.lng ?? src.lng;
  if (typeof lat === 'number' && typeof lng === 'number') { item.lat = lat; item.lng = lng; }
  item.images = images;
  item.sources = src.sources || [];
  injected.push(item);
}

const placedIds = new Set(Object.keys(placements));
const handAuthored = (data.items || []).filter(it => !placedIds.has(it.id));
for (const it of handAuthored) if (researched.has(it.id)) errors.push(`item "${it.id}" is hand-written in items but also exists in research; give it a placement instead`);

if (errors.length) {
  console.log('\n  ERRORS (guide.html not changed):');
  errors.forEach(e => console.log(`    ${e}`));
  console.log('');
  process.exit(1);
}

data.items = [...handAuthored, ...injected];
// Keep the JSON island from terminating early if any string contains a closing script tag.
const json = JSON.stringify(data, null, 1).replace(/<\/script/gi, '<\\/script');
html = html.replace(ISLAND, (_, open, _body, close) => `${open}\n${json}\n${close}`);
writeFileSync(guideFile, html);

const bySection = {};
for (const it of injected) { const k = it.section ?? '(content)'; bySection[k] = (bySection[k] || 0) + 1; }
console.log(`\n  Injected ${injected.length} items (${handAuthored.length} hand-written kept)`);
console.log(`  ${Object.entries(bySection).map(([s, n]) => `${s} ${n}`).join(' · ')}`);
const noPin = injected.filter(it => it.lat == null), noImg = injected.filter(it => !it.images.length);
if (noPin.length) console.log(`  No coordinates, so no map pin: ${noPin.map(i => i.id).join(', ')}`);
if (noImg.length) console.log(`  No images: ${noImg.map(i => i.id).join(', ')}`);
console.log('');
