import { describe, it, expect } from 'vitest';
import { createElement, lazy, Suspense, type ComponentType } from 'react';
import { renderToString } from 'react-dom/server';
import { lazyWithPreload } from './lazyWithPreload';

const Hello = () => createElement('p', null, 'loaded');

/** One synchronous render pass: a component that suspends leaves the fallback in the markup. */
const render = (C: ComponentType) =>
  renderToString(createElement(Suspense, { fallback: 'FALLBACK' }, createElement(C)));

describe('lazyWithPreload', () => {
  it('renders without suspending once preload() has resolved', async () => {
    const C = lazyWithPreload(() => Promise.resolve({ default: Hello }));
    await C.preload();
    const html = render(C);
    expect(html).toContain('loaded');
    expect(html).not.toContain('FALLBACK');
  });

  it('is needed: plain React.lazy suspends once even when the module is already loaded', async () => {
    const factory = () => Promise.resolve({ default: Hello });
    await factory(); // what calling the import factory from a loader used to do
    expect(render(lazy(factory))).toContain('FALLBACK');
  });

  it('suspends the ordinary way when nothing preloaded the chunk', () => {
    const C = lazyWithPreload(() => Promise.resolve({ default: Hello }));
    expect(render(C)).toContain('FALLBACK');
  });

  it('downloads the chunk once, however often it is preloaded and rendered', async () => {
    let calls = 0;
    const C = lazyWithPreload(() => {
      calls += 1;
      return Promise.resolve({ default: Hello });
    });
    await Promise.all([C.preload(), C.preload()]);
    render(C);
    await C.preload();
    expect(calls).toBe(1);
  });

  it('preload() never rejects, and a failed download is tried again', async () => {
    let calls = 0;
    const C = lazyWithPreload(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('chunk 404')) : Promise.resolve({ default: Hello });
    });
    await expect(C.preload()).resolves.toBeUndefined();
    await C.preload();
    expect(calls).toBe(2);
    expect(render(C)).toContain('loaded');
  });
});
