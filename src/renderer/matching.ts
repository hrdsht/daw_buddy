/**
 * Cross-project harmonic + tempo matching. Pure functions — no DOM — so they're
 * unit tested (test/matching.test.js).
 *
 * "Compatible" uses the Camelot wheel the same way DJs mix in key: same code,
 * the relative major/minor (same number, other letter), or a perfect
 * fourth/fifth away (±1 on the number, same letter, wrapping 12↔1). Tempo is
 * compatible within a tolerance, and also at half/double time (70 ≈ 140).
 */

export interface Camelot {
  num: number; // 1..12
  letter: 'A' | 'B';
}

export function parseCamelot(code: any): Camelot | null {
  const m = String(code || '').trim().toUpperCase().match(/^(\d{1,2})([AB])$/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  if (num < 1 || num > 12) return null;
  return { num, letter: m[2] as 'A' | 'B' };
}

/** How the two keys relate, or null if they don't mix cleanly. */
export function keyRelation(a: any, b: any): string | null {
  const x = parseCamelot(a);
  const y = parseCamelot(b);
  if (!x || !y) return null;
  if (x.num === y.num && x.letter === y.letter) return 'same key';
  if (x.num === y.num) return 'relative'; // same number, A<->B
  if (x.letter === y.letter) {
    const step = (x.num - y.num + 12) % 12;
    if (step === 1) return 'fourth';
    if (step === 11) return 'fifth';
  }
  return null;
}

export function compatibleKey(a: any, b: any): boolean {
  return keyRelation(a, b) !== null;
}

/** Tempo match within tolerance, counting half- and double-time. */
export function tempoRelation(a: any, b: any, tolerance = 0.06): string | null {
  const x = Number(a);
  const y = Number(b);
  if (!x || !y) return null;
  const near = (p: number, q: number) => Math.abs(p - q) <= Math.max(3, q * tolerance);
  if (near(x, y)) return 'same tempo';
  if (near(x, y * 2) || near(x * 2, y)) return 'half/double time';
  return null;
}

export function compatibleTempo(a: any, b: any, tolerance = 0.06): boolean {
  return tempoRelation(a, b, tolerance) !== null;
}

export interface Match {
  entry: any;
  keyRelation: string | null;
  tempoRelation: string | null;
  score: number;
}

/**
 * Everything compatible with `target`. `recordFor(entry)` returns the entry's
 * record (for its camelot). Sorted best-first: same key + same tempo on top.
 */
export function findMatches(
  target: any,
  targetRec: any,
  entries: any[],
  recordFor: (entry: any) => any
): Match[] {
  const out: Match[] = [];
  for (const entry of entries) {
    if (entry === target || entry.path === target.path) continue;
    const rec = recordFor(entry);
    const kr = keyRelation(targetRec.camelot, rec.camelot);
    const tr = tempoRelation(target.bpm, entry.bpm);
    if (!kr && !tr) continue;
    // Need at least a key relation, or a tempo relation with no key data to go on.
    if (!kr && !parseCamelot(targetRec.camelot)) {
      // target has no key — tempo-only match is allowed
    } else if (!kr) {
      continue; // both have keys but they clash — skip
    }
    let score = 0;
    if (kr === 'same key') score += 3;
    else if (kr) score += 2;
    if (tr === 'same tempo') score += 2;
    else if (tr) score += 1;
    out.push({ entry, keyRelation: kr, tempoRelation: tr, score });
  }
  return out.sort((a, b) => b.score - a.score);
}
