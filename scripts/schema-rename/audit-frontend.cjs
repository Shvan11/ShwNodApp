const fs = require('fs'), path = require('path');
const m = require('./mapping.json');

// Build old->new for columns that actually changed
const changed = new Map();
for (const t of Object.keys(m.columns)) {
  for (const [o, i] of Object.entries(m.columns[t])) {
    if (i.new !== o) {
      if (!changed.has(o)) changed.set(o, new Set());
      changed.get(o).add(i.new);
    }
  }
}
const names = [...changed.keys()];

function walk(d, acc) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx)$/.test(e.name)) acc.push(p);
  }
  return acc;
}
const files = walk('public/js', []);

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fileHits = {};
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const n of names) {
    const re = new RegExp('(?<![A-Za-z0-9_])' + esc(n) + '(?![A-Za-z0-9_])');
    if (re.test(src)) {
      (fileHits[f] = fileHits[f] || new Set()).add(n + '->' + [...changed.get(n)].join('|'));
    }
  }
}
const ranked = Object.entries(fileHits).sort((a, b) => b[1].size - a[1].size);
console.log('FILES WITH POTENTIAL OLD-NAME TOKENS:', ranked.length, 'of', files.length, 'scanned');
for (const [f, ns] of ranked) {
  console.log(String(ns.size).padStart(3), f.replace(/\\/g, '/'));
  console.log('     ', [...ns].join('  '));
}
