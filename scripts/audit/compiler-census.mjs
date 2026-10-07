#!/usr/bin/env node
/**
 * React Compiler census + frozen-clock scan (audits FE-F26-1/-2/-8).
 *
 *   node scripts/audit/compiler-census.mjs            # summary
 *   node scripts/audit/compiler-census.mjs --list     # + every bailout, by file
 *   node scripts/audit/compiler-census.mjs <file>…    # only these files
 *
 * 1. CENSUS. Runs babel-plugin-react-compiler over every file under public/js
 *    with a logger, and reports how many functions compile and why the rest are
 *    skipped. A skipped component is SAFE (it runs as plain React, unmemoized);
 *    this is for deciding whether one is worth restructuring, with a profile.
 *    2026-10-06: 268 compiled, 165 bailout events in 100 files — 107 `try…finally`,
 *    14 `throw` in `try`, 11 value blocks in `try`, 9 `try` without `catch`, 20 for a
 *    disabled hooks rule, 2 `++` on a captured variable, 1 `??=`, Modal's refs.
 *
 * 2. CLOCK SCAN. The compiler caches a render block on its reactive inputs, and
 *    the clock is not one: `new Date()` in such a block runs once per mount, or
 *    once per change of some unrelated prop. So "today" stays yesterday and "5m
 *    ago" stays "5m ago". This walks the SOURCE of every component and hook and
 *    reports a clock read that happens during render: directly, inside a
 *    `useMemo`, inside an array callback (`days.map(day => …)`), inside a local
 *    helper that render calls (`renderSlot(…)`), or through a function, in this
 *    file or imported, whose own body reads the clock. Handlers, effects and
 *    `useState` initialisers run later or once and are not render.
 *    It reads the source, not the compiled output, on purpose: the compiler
 *    hoists a `.map` callback into a temp, where it looks like a handler. Two
 *    scans of the compiled output missed the week grid that way (FE-F26-8).
 *    Every hit needs a human: read the code. The 12 it prints today are all
 *    fine, each because the value is used once or the screen is short-lived:
 *      BookingForm              the picker's starting month
 *      SimplifiedCalendarPicker builds its days on every render of a form page
 *      ExpenseModal / DiagnosisEditor / StandSalesHistory
 *                               seed a form or a default date range once, on open
 *      PhotoSessionDialog       a dialog: "today" for its date shortcuts
 *      SnoozeDate (TasksBell)   the date box's `min`, mounted only while a row is open
 *      ViewPatientInfo          age from the birth date (and the component is
 *                               one the compiler skips, so nothing is cached)
 *      NewWorkComponent         the "Date: Today (…)" line of a form
 *      MessageStatusTable       the empty state's wording
 *      Dashboard                the footer's copyright YEAR
 *    A new line here that feeds something a screen shows all day (a "today"
 *    highlight, an overdue flag, an age, a past/future split) is a bug of the
 *    FE-F26-2 / FE-F26-8 kind.
 *    The rule for new code: read the clock through hooks/useClock.ts, or take it
 *    as an argument.
 *
 * Exit code is always 0: this is a review tool, not a gate. `scripts/**` is
 * eslint-ignored.
 */
import { transformAsync, parseSync, traverse, types as t } from '@babel/core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'public', 'js');
const LIST = process.argv.includes('--list');

const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const files = only.map((p) => path.resolve(p));
if (!only.length) (function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !/\.d\.ts$|\.test\.tsx?$/.test(e.name)) files.push(p);
  }
})(SRC);

const PARSE = { babelrc: false, configFile: false, parserOpts: { plugins: ['typescript', 'jsx'] } };
const ITERATION = new Set(['map', 'filter', 'forEach', 'reduce', 'reduceRight', 'some', 'every', 'find', 'findIndex', 'findLast', 'flatMap', 'sort', 'toSorted']);
const isFn = (n) => t.isFunctionExpression(n) || t.isArrowFunctionExpression(n) || t.isFunctionDeclaration(n);
/** `new Date()` with no argument, `Date.now()`, `performance.now()`. */
const isClockRead = (n) =>
  (t.isNewExpression(n) && t.isIdentifier(n.callee, { name: 'Date' }) && n.arguments.length === 0) ||
  (t.isCallExpression(n) && t.isMemberExpression(n.callee) && t.isIdentifier(n.callee.property, { name: 'now' }) &&
    (t.isIdentifier(n.callee.object, { name: 'Date' }) || t.isIdentifier(n.callee.object, { name: 'performance' })));
const isComponentOrHook = (name) => /^[A-Z]/.test(name) || /^use[A-Z]/.test(name);

/** Top-level functions of a file: name → the function's path. */
function topLevelFunctions(ast) {
  const out = new Map();
  traverse(ast, {
    Program(p) {
      for (const stmt of p.get('body')) {
        const decl = stmt.isExportNamedDeclaration() || stmt.isExportDefaultDeclaration() ? stmt.get('declaration') : stmt;
        if (decl.isFunctionDeclaration() && decl.node.id) out.set(decl.node.id.name, decl);
        else if (decl.isVariableDeclaration())
          for (const d of decl.get('declarations')) {
            let init = d.get('init');
            // memo(…), forwardRef(…)
            while (init.isCallExpression() && init.get('arguments')[0] && isFn(init.get('arguments')[0].node)) init = init.get('arguments')[0];
            if (t.isIdentifier(d.node.id) && isFn(init.node)) out.set(d.node.id.name, init);
          }
      }
      p.stop();
    },
  });
  return out;
}

/**
 * How a plain function reads the clock: `null` (it does not), `{ always: true }`
 * (in its body), or `{ fromParam: i }` (only as the DEFAULT of parameter i, as in
 * `formatISODate(date = new Date())`: a call that passes that argument is fine).
 */
function clockUse(fnPath) {
  let inBody = false;
  fnPath.get('body').traverse({ enter(p) { if (isClockRead(p.node)) { inBody = true; p.stop(); } } });
  if (inBody || isClockRead(fnPath.node.body)) return { always: true };
  const params = fnPath.get('params');
  for (let i = 0; i < params.length; i++) {
    let inDefault = false;
    params[i].traverse({ enter(p) { if (isClockRead(p.node)) { inDefault = true; p.stop(); } } });
    if (inDefault || (params[i].isAssignmentPattern() && isClockRead(params[i].node.right))) return { fromParam: i };
  }
  return null;
}

/** An initial value (`useState(x)`, `useRef(x)`) is read once, on mount: not a stale-clock risk. */
function isInitialValue(p, scope) {
  for (let q = p; q && q !== scope; q = q.parentPath)
    if (q.isCallExpression() && t.isIdentifier(q.node.callee) && /^use(State|Ref|Reducer)$/.test(q.node.callee.name)) return true;
  return false;
}

/**
 * Walk one component or hook and report the clock reads that run during render.
 * `clockFns` = names (local to the file or imported) of plain functions that
 * read the clock themselves.
 */
function scanRender(fnPath, clockFns, report) {
  const risky = (call) => {
    const use = clockFns.get(call.callee.name);
    return !!use && (use.always || call.arguments.length <= use.fromParam);
  };
  // local functions declared inside the component: name → path
  const locals = new Map();
  fnPath.traverse({
    FunctionDeclaration(p) { if (p.node.id) locals.set(p.node.id.name, p); },
    VariableDeclarator(p) { if (t.isIdentifier(p.node.id) && isFn(p.node.init)) locals.set(p.node.id.name, p.get('init')); },
  });
  const seen = new Set();
  const queue = [fnPath];
  /** Is the nested function at `p` run while its parent renders? */
  const runsInRender = (p) => {
    const parent = p.parentPath;
    if (!parent.isCallExpression() || !parent.node.arguments.includes(p.node)) return false;
    const callee = parent.node.callee;
    if (t.isIdentifier(callee, { name: 'useMemo' })) return true;
    return t.isMemberExpression(callee) && t.isIdentifier(callee.property) && ITERATION.has(callee.property.name);
  };
  while (queue.length) {
    const scope = queue.pop();
    if (seen.has(scope.node)) continue;
    seen.add(scope.node);
    scope.traverse({
      enter(p) {
        if (p !== scope && isFn(p.node)) {
          if (runsInRender(p)) queue.push(p);
          p.skip();
          return;
        }
        if (isClockRead(p.node) && !isInitialValue(p, scope)) report(p.node.loc?.start.line, 'reads the clock');
        if (p.isCallExpression() && t.isIdentifier(p.node.callee)) {
          const name = p.node.callee.name;
          if (locals.has(name)) queue.push(locals.get(name)); // a local helper render calls
          else if (risky(p.node) && !isInitialValue(p, scope)) report(p.node.loc?.start.line, `calls ${name}(), which reads the clock`);
        }
      },
    });
  }
}

const compiled = [];
const bailouts = [];
const clockHits = [];

for (const file of files) {
  const rel = path.relative(ROOT, file);
  let out;
  try {
    out = await transformAsync(fs.readFileSync(file, 'utf8'), {
      filename: file,
      babelrc: false,
      configFile: false,
      ast: false,
      parserOpts: { plugins: ['typescript', 'jsx'] },
      plugins: [['babel-plugin-react-compiler', {
        logger: {
          logEvent(_filename, ev) {
            const line = ev.fnLoc?.start?.line;
            if (ev.kind === 'CompileSuccess') compiled.push({ rel, line, name: ev.fnName });
            else if (ev.kind === 'CompileError') bailouts.push({ rel, line, reason: ev.detail?.reason || ev.detail?.options?.reason || 'unknown' });
            else if (ev.kind === 'PipelineError') bailouts.push({ rel, line, reason: `PipelineError: ${String(ev.data).slice(0, 80)}` });
          },
        },
      }]],
    });
  } catch (err) {
    bailouts.push({ rel, reason: `babel: ${String(err.message).slice(0, 100)}` });
    continue;
  }
  void out;
}

// Pass 1: every plain (non-component, non-hook) top-level function, and how it
// reads the clock. A name is resolved to the file's own function first, so
// TasksHistory's `isExpired(row, today)` is not mistaken for another file's.
const parsed = [];
const shared = new Map();
for (const file of files) {
  let ast;
  try { ast = parseSync(fs.readFileSync(file, 'utf8'), { ...PARSE, filename: file }); } catch { continue; }
  const fns = topLevelFunctions(ast);
  const own = new Map();
  for (const [name, p] of fns) {
    if (isComponentOrHook(name)) continue;
    const use = clockUse(p);
    own.set(name, use);
    if (use && !shared.has(name)) shared.set(name, use);
  }
  parsed.push({ file, fns, own });
}

// Pass 2: render-time reads in every component and hook.
for (const { file, fns, own } of parsed) {
  const rel = path.relative(ROOT, file);
  if (/hooks[\\/]useClock\.ts$/.test(rel)) continue; // the clock store is the sanctioned reader
  const clockFns = new Map(shared);
  for (const [name, use] of own) use ? clockFns.set(name, use) : clockFns.delete(name);
  for (const [name, p] of fns) {
    if (!isComponentOrHook(name)) continue;
    scanRender(p, clockFns, (line, what) => clockHits.push(`${rel}:${line ?? '?'}  ${name} ${what}`));
  }
}

const tally = new Map();
for (const b of bailouts) tally.set(b.reason, (tally.get(b.reason) || 0) + 1);

console.log(`React Compiler census — ${files.length} files`);
console.log(`  compiled functions: ${compiled.length}`);
console.log(`  bailout events:     ${bailouts.length} in ${new Set(bailouts.map((b) => b.rel)).size} files\n`);
for (const [reason, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${reason}`);
if (LIST) {
  console.log('\nBailouts by file:');
  for (const b of bailouts.sort((x, y) => x.rel.localeCompare(y.rel))) console.log(`  ${b.rel}:${b.line ?? '?'}  ${b.reason}`);
}
console.log(`\nClock scan — ${new Set(clockHits).size} render-time clock read(s) to judge (the header lists the known-fine ones):`);
for (const h of [...new Set(clockHits)]) console.log(`  ${h}`);
