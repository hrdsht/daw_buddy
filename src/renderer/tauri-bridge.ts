'use strict';

/**
 * Tauri bridge (proposal 0007).
 *
 * Under Electron, preload.ts defines `window.api` and this script does
 * nothing. Under Tauri there is no preload, so this defines `window.api` with
 * the same shape: every `window.api.foo(...args)` becomes the Rust command
 * `api({ method: 'foo', args })`, and every `window.api.onFoo(cb)` listens for
 * the Rust event `foo`. The screens never need to know which shell they run in.
 *
 * Loaded before app.js.
 */

(function installTauriBridge() {
  const w = window as any;
  if (w.api || !w.__TAURI__) return;

  const { invoke } = w.__TAURI__.core;
  const { listen } = w.__TAURI__.event;
  const warned = new Set<string>();

  const call = (method: string) => async (...args: unknown[]) => {
    try {
      return await invoke('api', { method, args });
    } catch (error) {
      const message = String((error && (error as any).message) || error);
      if (message.startsWith('NOT_PORTED') && !warned.has(method)) {
        warned.add(method);
        console.warn(`[tauri-bridge] ${message}`);
      }
      throw new Error(message.replace(/^NOT_PORTED: /, ''));
    }
  };

  // onProjectConvertProgress(cb) → listen('projectConvertProgress', …)
  const subscribe = (eventName: string) => (callback: (data: unknown) => void) => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    listen(eventName, (event: any) => callback(event.payload)).then((off: () => void) => {
      if (cancelled) off();
      else unlisten = off;
    });
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  };

  const cache = new Map<string, unknown>();
  w.api = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (!cache.has(prop)) {
          const isEvent = /^on[A-Z]/.test(prop);
          cache.set(prop, isEvent ? subscribe(prop[2].toLowerCase() + prop.slice(3)) : call(prop));
        }
        return cache.get(prop);
      }
    }
  );
})();
