/**
 * `React.lazy` for a chunk a route loader warms before the screen renders.
 *
 * Calling the import factory from a loader puts the module in the browser's
 * module cache, but `React.lazy` keeps its own state: on its first render it
 * calls the factory, gets a promise, and suspends until the next microtask, even
 * when the module is already loaded. That one suspension commits the nearest
 * `<Suspense>` fallback, and React then holds the reveal of a just-shown fallback
 * for 300 ms (`FALLBACK_THROTTLE_MS`). So every cold load, and every first step
 * into a patient's record, showed a spinner for 300 ms and started the page's own
 * reads 300 ms late, with the code already in memory (audit FE-F26-3; measured:
 * shell reads at 158 ms, page reads at 460 ms, chunk in at 81 ms).
 *
 * Here the factory answers with a thenable that settles in the same tick once
 * `preload()` has resolved, which `React.lazy` renders without suspending. A
 * loader that awaits `preload()` therefore mounts its screen with no fallback at
 * all. A chunk that is not loaded yet takes the ordinary path: suspend, fallback,
 * reveal.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

type Module<T> = { default: T };

export type PreloadableComponent<T extends ComponentType<any>> = LazyExoticComponent<T> & {
  /**
   * Starts the chunk download (once) and resolves when it has settled. Never
   * rejects: this is a warm-up, and a chunk that cannot load still fails where it
   * should, on the render path (Suspense → error boundary → the chunk self-heal
   * in core/chunk-reload.ts).
   */
  preload: () => Promise<void>;
};

/**
 * A thenable that calls back before `then` returns. `React.lazy` attaches its
 * callbacks and then checks whether the payload has resolved, so a synchronous
 * call here is what lets it render straight away. Typed as the `Promise` that
 * `lazy()`'s signature asks for; React only ever calls `then` on it.
 */
function settled<M>(value: M): Promise<M> {
  const thenable: PromiseLike<M> = {
    then<R1 = M, R2 = never>(onFulfilled?: ((v: M) => R1 | PromiseLike<R1>) | null): PromiseLike<R1 | R2> {
      onFulfilled?.(value);
      return thenable as unknown as PromiseLike<R1 | R2>;
    },
  };
  return thenable as Promise<M>;
}

export function lazyWithPreload<T extends ComponentType<any>>(
  factory: () => Promise<Module<T>>
): PreloadableComponent<T> {
  let loaded: Module<T> | undefined;
  let inflight: Promise<Module<T>> | undefined;

  const load = (): Promise<Module<T>> => {
    inflight ??= factory().then(
      (mod) => {
        loaded = mod;
        return mod;
      },
      (err: unknown) => {
        // Forget the failed attempt so the next caller (the render path) tries again.
        inflight = undefined;
        throw err;
      }
    );
    return inflight;
  };

  const Component = lazy(() => (loaded ? settled(loaded) : load())) as PreloadableComponent<T>;
  Component.preload = () =>
    load().then(
      () => undefined,
      () => undefined
    );
  return Component;
}
