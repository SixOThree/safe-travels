#!/usr/bin/env node
// collect-items.mjs — merge the researchers' *.items.json files into one items.json and print a
// compact index, so the guide can be planned without reading every research file end to end.
// Usage: node collect-items.mjs [research-dir]      (default: ./research)
// Safe to rerun: it rebuilds <research-dir>/items.json from scratch each time.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

const dir = resolve(process.argv[2] || './research');
if (!existsSync(dir)) { console.error(`No research folder at ${dir}`); process.exit(1); }

const files = readdirSync(dir);
const itemFiles = files.filter(f => f.endsWith('.items.json')).sort();
const mdFiles = files.filter(f => f.endsWith('.md')).sort();
const COMPLETE = '<!-- research complete -->';
const CATS = new Set(['do', 'food', 'stay']);

const errors = [], warnings = [], merged = [];
const slug = s => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'item';
const isUrl = u => typeof u === 'string' && /^https?:\/\//.test(u);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const seasonKey = s => JSON.stringify(s ?? null);
function metres(a, b) {
  const R = 6371000, rad = d => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function host(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } }

const items = [];
const ids = new Set();

for (const f of itemFiles) {
  if (f === 'items.json') continue;
  let list;
  try {
    const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    list = Array.isArray(parsed) ? parsed : parsed.items;
  } catch (e) { errors.push(`${f}: invalid JSON (${e.message})`); continue; }
  if (!Array.isArray(list)) { errors.push(`${f}: expected an array of items`); continue; }

  list.forEach((raw, n) => {
    const where = `${f} #${n + 1}`;
    if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) { errors.push(`${where}: item has no name`); return; }
    const it = {
      id: null,
      name: raw.name.trim(),
      category: raw.category,
      kind: raw.kind ?? null,
      place: raw.place ?? null,
      blurb: raw.blurb ?? '',
      description: raw.description ?? '',
      address: raw.address ?? null,
      lat: null, lng: null,
      images: [],
      sources: [],
      availability: raw.availability ?? null,
      confidence: raw.confidence ?? null,
      from: f,
    };
    if (raw.season != null) it.season = raw.season;
    if (!CATS.has(it.category)) warnings.push(`${where} "${it.name}": category "${raw.category}" is not do, food or stay`);
    if (isNum(raw.lat) && isNum(raw.lng) && Math.abs(raw.lat) <= 90 && Math.abs(raw.lng) <= 180) { it.lat = raw.lat; it.lng = raw.lng; }
    else if (raw.lat != null || raw.lng != null) warnings.push(`${where} "${it.name}": lat/lng must both be numbers or null; dropped`);
    // Copy image and source objects as written: extra keys (an image's own `season`) must survive.
    for (const im of raw.images || []) {
      if (isUrl(im?.url)) it.images.push({ ...im, label: im.label ?? '' });
      else warnings.push(`${where} "${it.name}": image without a usable url dropped`);
    }
    for (const s of raw.sources || []) {
      const url = typeof s === 'string' ? s : s?.url;
      if (isUrl(url)) it.sources.push(typeof s === 'string' ? { url, title: host(url) } : { ...s, title: s.title || host(url) });
    }

    // The same place from two researchers (same name and season, and close together or unplaced): merge.
    const dup = items.find(o => slug(o.name) === slug(it.name) && seasonKey(o.season) === seasonKey(it.season)
      && (o.lat == null || it.lat == null || metres(o, it) < 250));
    if (dup) {
      for (const im of it.images) if (!dup.images.some(x => x.url === im.url)) dup.images.push(im);
      for (const s of it.sources) if (!dup.sources.some(x => x.url === s.url)) dup.sources.push(s);
      for (const k of ['description', 'blurb', 'address', 'kind', 'availability']) if (!dup[k] && it[k]) dup[k] = it[k];
      if (dup.lat == null && it.lat != null) { dup.lat = it.lat; dup.lng = it.lng; }
      dup.from += `, ${f}`;
      merged.push(`"${it.name}" (${f}) merged into ${dup.id}`);
      return;
    }

    let id = slug(it.name);
    if (it.season != null) id += '-' + slug([].concat(it.season).join('-'));
    if (ids.has(id)) id = `${id}-${slug(it.place || f.replace(/\.items\.json$/, ''))}`.slice(0, 60);
    for (let k = 2, base = id; ids.has(id); k++) id = `${base}-${k}`;
    it.id = id; ids.add(id);
    items.push(it);
  });
}

// The same image on two different places is almost always a bad image-to-place match.
const owner = new Map();
for (const it of items) for (const im of it.images) {
  const o = owner.get(im.url);
  if (o && o !== it.id) warnings.push(`image shared by ${o} and ${it.id}: ${im.url.slice(0, 90)}`);
  else owner.set(im.url, it.id);
}
for (const md of mdFiles) {
  const stem = md.replace(/\.md$/, '');
  const text = readFileSync(join(dir, md), 'utf8').trimEnd();
  if (!text.endsWith(COMPLETE)) warnings.push(`${md} is not marked complete (the researcher may have been cut off)`);
  if (!files.includes(`${stem}.items.json`)) warnings.push(`${md} has no ${stem}.items.json; read its items from the markdown`);
}

if (errors.length) {
  console.log('\n  ERRORS:'); errors.forEach(e => console.log(`    ${e}`));
}
writeFileSync(join(dir, 'items.json'), JSON.stringify(items, null, 1));

// ---- index ----
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const idW = Math.min(44, Math.max(2, ...items.map(i => i.id.length)));
console.log(`\n  ${items.length} items from ${itemFiles.filter(f => f !== 'items.json').length} files → ${join(dir, 'items.json')}`);
const byCat = {};
for (const it of items) byCat[it.category] = (byCat[it.category] || 0) + 1;
console.log(`  ${Object.entries(byCat).map(([c, n]) => `${c} ${n}`).join(' · ')} · ${items.filter(i => i.lat == null).length} without coordinates · ${items.filter(i => !i.images.length).length} without images\n`);
console.log(`  ${'id'.padEnd(idW)}  cat   pin img conf  name · blurb · description`);
for (const it of items) {
  const season = it.season != null ? ` [${[].concat(it.season).join('/')}]` : '';
  const line = `${it.name}${season} · ${clip(it.blurb, 40)} · ${clip(it.description, 110)}`;
  console.log(`  ${it.id.padEnd(idW)}  ${String(it.category).padEnd(5)} ${it.lat != null ? ' ✓ ' : ' – '} ${String(it.images.length).padStart(2)}  ${String(it.confidence || '').slice(0, 4).padEnd(4)}  ${line}`);
}
if (merged.length) { console.log('\n  MERGED:'); merged.forEach(m => console.log(`    ${m}`)); }
if (warnings.length) { console.log('\n  WARNINGS:'); warnings.forEach(w => console.log(`    ${w}`)); }
console.log('');
process.exit(errors.length ? 1 : 0);
