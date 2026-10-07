#!/usr/bin/env node
/**
 * Proves the React Compiler actually ran on the last client build.
 *
 * Why this exists (FE-F26-1): the Vite 8 upgrade (2026-06-01) moved to
 * @vitejs/plugin-react v6, which dropped the `babel` option. vite.config.js kept
 * passing `react({ babel: { plugins: ['babel-plugin-react-compiler'] } })`, a JS
 * config, so nothing type-checked it, and the option was ignored without a
 * warning. Four months of code were written under "the compiler memoizes, don't
 * hand-memoize" while no component was compiled. The only reliable signal is the
 * build output, so this reads it.
 *
 * The compiler emits `Symbol.for("react.memo_cache_sentinel")` in every function
 * it compiles, and minification keeps the string. React's own runtime carries it
 * once too, so chunks holding React internals (`react.transitional.element`) are
 * not counted. A healthy build has ~50 compiled chunks (49 on 2026-10-06). MIN is
 * 30: low enough that routine code-splitting changes never trip it, high enough
 * that it also fails when a config change stops compiling a large part of the
 * tree, not only when the compiler is off altogether (it was 10; audit
 * FE-F26-10). It is a coarse net on purpose. A list of expected bailouts would
 * fail the gate on every new `try { … } finally { … }` in a component, the most
 * common skip there is and a safe one. `node scripts/audit/compiler-census.mjs`
 * is the fine-grained view: what compiles, what is skipped and why.
 *
 * Run after `vite build` (the gate does). `scripts/**` is eslint-ignored.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'dist', 'assets');
const SENTINEL = 'react.memo_cache_sentinel';
const REACT_INTERNAL = 'react.transitional.element';
const MIN_COMPILED_CHUNKS = 30;

let files;
try {
  files = readdirSync(ASSETS).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`check-react-compiler: ${ASSETS} not found — run \`vite build\` first.`);
  process.exit(1);
}

const compiled = [];
for (const f of files) {
  const src = readFileSync(join(ASSETS, f), 'utf8');
  if (src.includes(REACT_INTERNAL)) continue;
  if (src.includes(SENTINEL)) compiled.push(f);
}

if (compiled.length < MIN_COMPILED_CHUNKS) {
  console.error(
    `check-react-compiler: FAIL. ${compiled.length} app chunk(s) carry React Compiler output ` +
      `(expected at least ${MIN_COMPILED_CHUNKS}). The compiler is not running; check the ` +
      '`babel({ presets: [reactCompilerPreset()] })` entry in vite.config.js.',
  );
  process.exit(1);
}
console.log(`check-react-compiler: OK. ${compiled.length} of ${files.length} JS chunks carry compiled components.`);
