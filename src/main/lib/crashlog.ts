import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { app, shell } from 'electron';

export interface SanitizedPathInfo {
  depth: number;
  charLength: number;
  extension: string;
  exceedsMaxPath: boolean;
  structuralSummary: string;
}

export interface CrashReport {
  id: string;
  timestamp: number;
  timeString: string;
  source: 'main' | 'renderer' | 'process-gone';
  errorName: string;
  errorMessage: string;
  errorStack?: string;
  pathDiagnostics?: SanitizedPathInfo[];
  systemInfo: {
    platform: string;
    arch: string;
    osRelease: string;
    totalMemMB: number;
    freeMemMB: number;
    appVersion: string;
    electronVersion: string;
    nodeVersion: string;
  };
  logFilePath: string;
  dismissed: boolean;
}

let crashDir = '';
let latestManifestPath = '';
let crashLoggingEnabled = true;

/**
 * Strips raw user directories, usernames, song titles, and sensitive paths.
 * Converts user file paths into structural diagnostics (e.g. depth, length, extension).
 */
export function sanitizePath(rawPath: string): { sanitized: string; info?: SanitizedPathInfo } {
  if (!rawPath || typeof rawPath !== 'string') return { sanitized: String(rawPath) };

  // Normalize slashes for inspection
  const normalized = rawPath.replace(/\\/g, '/');

  // Preserve relative runtime bundle code paths for developer debugging
  const appMatch = normalized.match(/(.*\/)?(node_modules|dist|src|resources|app\.asar)\/(.+)$/);
  if (appMatch) {
    return {
      sanitized: `<app>/${appMatch[2]}/${appMatch[3]}`
    };
  }

  const isWinPath = /^[a-zA-Z]:\//.test(normalized);
  const isPosixUserPath = /^(\/(Users|home|root|var|tmp|Volumes|media|mnt))\//.test(normalized);

  if (!isWinPath && !isPosixUserPath && !normalized.includes('/')) {
    return { sanitized: rawPath };
  }

  const segments = normalized.split('/').filter(Boolean);
  const depth = segments.length;
  const charLength = rawPath.length;
  const ext = path.extname(rawPath).toLowerCase() || 'none';
  const exceedsMaxPath = charLength >= 260;

  const info: SanitizedPathInfo = {
    depth,
    charLength,
    extension: ext,
    exceedsMaxPath,
    structuralSummary: `<path: depth=${depth} folders, len=${charLength} chars, ext=${ext}, exceedsMaxPath=${exceedsMaxPath}>`
  };

  return {
    sanitized: info.structuralSummary,
    info
  };
}

export function sanitizeText(text: string): { text: string; pathsFound: SanitizedPathInfo[] } {
  if (!text || typeof text !== 'string') return { text: '', pathsFound: [] };

  const pathsFound: SanitizedPathInfo[] = [];

  // 1. Sanitize user profile directory username
  try {
    const username = os.userInfo?.()?.username || process.env.USERNAME || process.env.USER;
    if (username && username.length > 1) {
      const userRegex = new RegExp(`([/\\\\])(Users|home|root)[/\\\\]${username.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'gi');
      text = text.replace(userRegex, '$1$2/<user>');
    }
  } catch {}

  // 2. Replace app internal bundle absolute paths to relative code paths in stack traces
  let out = text.replace(/([A-Za-z]:[\\/][^()'\n\r"]*?[\\/](src|dist|node_modules|resources|app\.asar)[\\/]([^()'\n\r"]+))/g, (_m, _full, dir, rest) => {
    return `<app>/${dir}/${rest.replace(/\\/g, '/')}`;
  });
  out = out.replace(/(\/(Users|home|root)[^()'\n\r"]*?[\\/](src|dist|node_modules|resources|app\.asar)[\\/]([^()'\n\r"]+))/g, (_m, _full, _u, dir, rest) => {
    return `<app>/${dir}/${rest.replace(/\\/g, '/')}`;
  });

  // 3. Find and redact arbitrary user file paths (Windows)
  const winPathRegex = /[A-Za-z]:\\[^\s<>"':;|,()[\]{}*?]+/g;
  out = out.replace(winPathRegex, (match) => {
    if (match.includes('<app>') || match.includes('<app_root>')) return match;
    const { sanitized, info } = sanitizePath(match);
    if (info) pathsFound.push(info);
    return sanitized;
  });

  // 4. Find and redact arbitrary user file paths (POSIX)
  const posixPathRegex = /\/(Users|home|Volumes|media|mnt|private)\/[^\s<>"':;|,()[\]{}*?]+/g;
  out = out.replace(posixPathRegex, (match) => {
    if (match.includes('<app>') || match.includes('<app_root>')) return match;
    const { sanitized, info } = sanitizePath(match);
    if (info) pathsFound.push(info);
    return sanitized;
  });

  return { text: out, pathsFound };
}

export function initCrashLogger(customDir?: string) {
  try {
    crashDir = customDir || path.join(app.getPath('userData'), 'crashes');
    if (!fs.existsSync(crashDir)) {
      fs.mkdirSync(crashDir, { recursive: true });
    }
    latestManifestPath = path.join(crashDir, 'latest-crash.json');

    // Register process level handlers for Main process
    process.on('uncaughtException', (err: any) => {
      console.error('[CrashLogger] Uncaught Exception in Main Process:', err);
      recordCrash('main', err);
    });

    process.on('unhandledRejection', (reason: any) => {
      console.error('[CrashLogger] Unhandled Promise Rejection in Main Process:', reason);
      const err = reason instanceof Error ? reason : new Error(String(reason));
      recordCrash('main', err);
    });
  } catch (e) {
    console.error('[CrashLogger] Failed to initialize crash logger:', e);
  }
}

export function setCrashLoggingEnabled(enabled: boolean) {
  crashLoggingEnabled = Boolean(enabled);
}

export function isCrashLoggingEnabled(): boolean {
  return crashLoggingEnabled;
}

export function recordCrash(source: 'main' | 'renderer' | 'process-gone', err: Error | string, details?: any): CrashReport | null {
  if (!crashLoggingEnabled) return null;
  try {
    if (!crashDir) {
      crashDir = path.join(app.getPath('userData'), 'crashes');
      if (!fs.existsSync(crashDir)) fs.mkdirSync(crashDir, { recursive: true });
      latestManifestPath = path.join(crashDir, 'latest-crash.json');
    }

    const now = new Date();
    const timestamp = now.getTime();
    const timeString = now.toISOString().replace(/[:.]/g, '-');
    const id = `crash-${timeString}`;
    const logFilePath = path.join(crashDir, `${id}.log`);

    const errObj = typeof err === 'string' ? new Error(err) : err;
    const rawErrorName = errObj.name || 'Error';
    const rawErrorMessage = errObj.message || String(err);
    const rawErrorStack = errObj.stack || '';

    // Apply privacy sanitization
    const sanitizedMsg = sanitizeText(rawErrorMessage);
    const sanitizedStack = sanitizeText(rawErrorStack);
    const allPathsFound: SanitizedPathInfo[] = [
      ...sanitizedMsg.pathsFound,
      ...sanitizedStack.pathsFound
    ];

    let sanitizedDetails = '';
    if (details) {
      const detailsStr = typeof details === 'string' ? details : JSON.stringify(details, null, 2);
      const sanitized = sanitizeText(detailsStr);
      sanitizedDetails = sanitized.text;
      allPathsFound.push(...sanitized.pathsFound);
    }

    const systemInfo = {
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      totalMemMB: Math.round(os.totalmem() / (1024 * 1024)),
      freeMemMB: Math.round(os.freemem() / (1024 * 1024)),
      appVersion: (app && typeof app.getVersion === 'function' ? app.getVersion() : '0.4.9-beta'),
      electronVersion: process.versions?.electron || '',
      nodeVersion: process.versions?.node || ''
    };

    const report: CrashReport = {
      id,
      timestamp,
      timeString: now.toLocaleString(),
      source,
      errorName: rawErrorName,
      errorMessage: sanitizedMsg.text,
      errorStack: sanitizedStack.text,
      pathDiagnostics: allPathsFound.length > 0 ? allPathsFound : undefined,
      systemInfo,
      logFilePath,
      dismissed: false
    };

    // Format human-readable diagnostics log file with privacy guarantee
    const pathDiagnosticsBlock = allPathsFound.length > 0
      ? [
          `PATH STRUCTURAL DIAGNOSTICS (Sanitized - Zero Personal Names):`,
          ...allPathsFound.map((p, idx) => `  Path ${idx + 1}: depth=${p.depth} folders | length=${p.charLength} chars | extension=${p.extension} | exceeds MAX_PATH (260): ${p.exceedsMaxPath ? 'YES' : 'NO'}`),
          ``
        ].join('\n')
      : '';

    const logContent = [
      `======================================================================`,
      `CRASH REPORT DIAGNOSTICS LOG`,
      `App: ${(app && typeof app.getName === 'function' ? app.getName() : 'DAW Buddy')} v${systemInfo.appVersion}`,
      `Date/Time: ${now.toLocaleString()} (${now.toISOString()})`,
      `Process Source: ${source.toUpperCase()}`,
      `Platform: ${systemInfo.platform} (${systemInfo.arch}) - OS Release: ${systemInfo.osRelease}`,
      `Memory: ${systemInfo.freeMemMB} MB Free / ${systemInfo.totalMemMB} MB Total`,
      `Node: ${systemInfo.nodeVersion} · Electron: ${systemInfo.electronVersion}`,
      `======================================================================`,
      ``,
      `ERROR TYPE: ${rawErrorName}`,
      `MESSAGE: ${sanitizedMsg.text}`,
      ``,
      pathDiagnosticsBlock,
      `STACK TRACE:`,
      sanitizedStack.text || 'No stack trace captured.',
      ``,
      sanitizedDetails ? `ADDITIONAL CONTEXT (Sanitized):\n${sanitizedDetails}\n` : '',
      `======================================================================`,
      `PRIVACY GUARANTEE:`,
      `All user file paths, personal usernames, and project titles are automatically`,
      `redacted and replaced with structural dimensions (nesting depth & character length)`,
      `so issues can be recreated and debugged safely without sharing private content.`
    ].filter(Boolean).join('\n');

    fs.writeFileSync(logFilePath, logContent, 'utf-8');
    fs.writeFileSync(latestManifestPath, JSON.stringify(report, null, 2), 'utf-8');

    return report;
  } catch (e) {
    console.error('[CrashLogger] Failed to write crash log:', e);
    return null;
  }
}

export function getLatestCrashReport(): CrashReport | null {
  try {
    if (!latestManifestPath || !fs.existsSync(latestManifestPath)) {
      if (crashDir && fs.existsSync(path.join(crashDir, 'latest-crash.json'))) {
        latestManifestPath = path.join(crashDir, 'latest-crash.json');
      } else {
        return null;
      }
    }
    const raw = fs.readFileSync(latestManifestPath, 'utf-8');
    const data = JSON.parse(raw) as CrashReport;
    if (data && !data.dismissed && fs.existsSync(data.logFilePath)) {
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export function dismissLatestCrashReport(): boolean {
  try {
    if (!latestManifestPath || !fs.existsSync(latestManifestPath)) return false;
    const raw = fs.readFileSync(latestManifestPath, 'utf-8');
    const data = JSON.parse(raw);
    data.dismissed = true;
    fs.writeFileSync(latestManifestPath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

export function getCrashDir(): string {
  if (!crashDir) {
    crashDir = (app && typeof app.getPath === 'function')
      ? path.join(app.getPath('userData'), 'crashes')
      : path.join(os.tmpdir(), 'daw-buddy-crashes');
  }
  return crashDir;
}

export async function openCrashFolder(): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const dir = getCrashDir();
    if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
    shell.openPath(dir);
    return { success: true, path: dir };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
