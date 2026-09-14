/**
 * Route-table snapshot.
 *
 * Registration order IS the routing contract in Express: the first layer whose
 * path matches wins, so moving a router file, renaming a mount prefix or
 * reordering two `app.use` calls can silently change which handler (and which
 * auth gate) serves a URL. Nothing else in this repo would catch that — every
 * other test is below the routing layer.
 *
 * So this test mounts the REAL route table (`mountRoutes`) onto a bare Express
 * app and writes it out, in registration order, as text. A diff in the snapshot
 * is a diff in what the server serves. Re-run with `vitest -u` to accept an
 * intentional change, and read the diff before you do.
 *
 * ── How the paths are recovered ─────────────────────────────────────────────
 * Express 5 does not keep the mount path on a Layer (`layer.path` is a
 * per-request value, `undefined` at rest — only `matchers`, which are opaque
 * closures, survive). So before importing anything we wrap
 * `Router.prototype.use` / `.route` — the two funnels every registration goes
 * through, `app.get(...)` included — and stamp the path each call was given
 * onto the layers it just pushed. The wrappers are removed in `afterAll`.
 */
import { EventEmitter } from 'events';
import { afterAll, expect, it } from 'vitest';

// The route modules pull in `config/config.ts`, which validates the boot env at
// import time. Stub the required vars so the test is env-free (CI has no .env);
// `??=` leaves a real .env alone, and `dotenv.config()` never overrides an
// already-set value, so these win on a dev box too. Nothing here connects.
process.env.MACHINE_PATH ??= 'C:';
process.env.SESSION_SECRET ??= 'route-table-snapshot-test-secret';
process.env.PG_HOST ??= '127.0.0.1';
process.env.PG_PORT ??= '5432';
process.env.PG_DATABASE ??= 'shwan';
process.env.PG_USER ??= 'shwan_app';
process.env.PG_PASSWORD ??= 'route-table-snapshot-test';

type Layer = {
  route?: { path: string | string[]; methods: Record<string, boolean> };
  handle: unknown;
  name: string;
  __mountPath?: unknown;
};
type RouterLike = { stack: Layer[] };

const express = (await import('express')).default;
const Router = express.Router as unknown as {
  prototype: {
    use: (...args: unknown[]) => unknown;
    route: (path: string) => unknown;
  };
};

const originalUse = Router.prototype.use;
const originalRoute = Router.prototype.route;

/** Mirrors `Router.prototype.use`'s own first-arg disambiguation. */
function pathArgOf(args: unknown[]): unknown {
  let arg: unknown = args[0];
  if (typeof arg === 'function') return '/';
  while (Array.isArray(arg) && arg.length !== 0) arg = arg[0];
  return typeof arg === 'function' ? '/' : args[0];
}

Router.prototype.use = function patchedUse(this: RouterLike, ...args: unknown[]) {
  const before = this.stack.length;
  const result = originalUse.apply(this, args);
  const path = pathArgOf(args);
  for (let i = before; i < this.stack.length; i++) this.stack[i].__mountPath = path;
  return result;
};

Router.prototype.route = function patchedRoute(this: RouterLike, path: string) {
  const result = originalRoute.call(this, path);
  const layer = this.stack[this.stack.length - 1];
  if (layer) layer.__mountPath = path;
  return result;
};

afterAll(() => {
  Router.prototype.use = originalUse;
  Router.prototype.route = originalRoute;
});

// Imported AFTER the wrappers are installed — a route module registering at
// import time would otherwise be recorded with no path.
const { mountRoutes } = await import('./mount-routes.js');

function isRouter(handle: unknown): handle is RouterLike {
  return typeof handle === 'function' && Array.isArray((handle as { stack?: unknown }).stack);
}

function describePath(path: unknown): string {
  if (Array.isArray(path)) return path.map((p) => String(p)).join(' | ');
  if (path instanceof RegExp) return String(path);
  return typeof path === 'string' ? path : '/';
}

function join(prefix: string, path: string): string {
  if (path === '/' || path === '') return prefix || '/';
  const joined = `${prefix === '/' ? '' : prefix}${path}`;
  return joined || '/';
}

function fullPath(prefix: string, raw: unknown): string {
  if (Array.isArray(raw)) return raw.map((p) => join(prefix, describePath(p))).join(' | ');
  return join(prefix, describePath(raw));
}

function walk(router: RouterLike, prefix: string, out: string[]): void {
  for (const layer of router.stack) {
    const here = fullPath(prefix, layer.__mountPath ?? '/');
    if (layer.route) {
      const methods = Object.keys(layer.route.methods)
        .filter((m) => m !== '_all')
        .map((m) => m.toUpperCase())
        .sort()
        .join(',');
      out.push(`${methods.padEnd(8)}${here}`);
    } else if (isRouter(layer.handle)) {
      out.push(`${'MOUNT'.padEnd(8)}${here}`);
      // A router's own layers are relative to the mount, so recurse with it as
      // the new prefix. `here` may list several alternatives; only a single
      // string prefix is meaningful, so fall back to the raw text for the rest.
      walk(layer.handle, here, out);
    } else {
      out.push(`${'USE'.padEnd(8)}${here}  [${layer.name || '<anonymous>'}]`);
    }
  }
}

it('matches the committed route table', async () => {
  const app = express();
  await mountRoutes(app, new EventEmitter());

  const lines: string[] = [];
  walk((app as unknown as { router: RouterLike }).router, '', lines);

  await expect(`${lines.join('\n')}\n`).toMatchFileSnapshot('./__snapshots__/route-table.txt');
});
