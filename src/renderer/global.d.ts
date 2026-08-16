/**
 * The renderer's view of the world. `window.api` is the contextBridge surface
 * exposed by preload.ts; `window.splashApi` by splash-preload.ts. These are the
 * only ways the windows reach the main process.
 *
 * `api` is typed as a dictionary of async IPC calls — permissive on purpose so
 * it stays in step with preload.ts without hand-maintaining ~40 signatures.
 * Tighten individual methods here if a call site needs a precise return type.
 */

interface Api {
  [channel: string]: (...args: any[]) => any;
}

interface SplashApi {
  finished(): void;
}

interface Window {
  api: Api;
  splashApi: SplashApi;
}
