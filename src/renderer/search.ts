/**
 * The search query language. Pure functions — no DOM — so they can be unit
 * tested directly (see test/search.test.js).
 *
 * Understands field filters — `bpm:140-145`, `key:8A`, `daw:ableton`,
 * `note:vocal` — and a bare `140-145` range as a BPM shorthand. Anything left
 * over is free text, AND-matched against the project's name, location, DAW,
 * note and key.
 */

export interface Query {
  bpm: { lo: number; hi: number } | null;
  key: string | null;
  sig: string | null;
  tala: string | null;
  genre: string | null;
  daw: string | null;
  note: string | null;
  text: string[];
}

export function parseQuery(raw: string): Query {
  const q: Query = { bpm: null, key: null, sig: null, tala: null, genre: null, daw: null, note: null, text: [] };
  const rawTokens = (raw || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  for (let tok of rawTokens) {
    tok = tok.trim().toLowerCase();
    if (!tok) continue;
    let m: RegExpMatchArray | null;
    if ((m = tok.match(/^bpm:(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?$/))) {
      const lo = parseFloat(m[1]);
      const hi = m[2] ? parseFloat(m[2]) : lo;
      q.bpm = { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
    } else if ((m = tok.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/))) {
      // A bare number range only reads as BPM when both ends are plausible
      // tempos — so "2020-2021" in a name still searches as text.
      const lo = parseFloat(m[1]);
      const hi = parseFloat(m[2]);
      if (lo >= 20 && lo <= 400 && hi >= 20 && hi <= 400) {
        q.bpm = { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
      } else {
        q.text.push(tok.replace(/^"|"$/g, ''));
      }
    } else if ((m = tok.match(/^key:(.+)$/))) {
      q.key = m[1].replace(/["']/g, '').replace(/\s+/g, '');
    } else if ((m = tok.match(/^(?:sig|timesig|meter):(.+)$/))) {
      q.sig = m[1].replace(/["']/g, '').replace(/\s+/g, '');
    } else if ((m = tok.match(/^(?:tala|taal):(.+)$/))) {
      q.tala = m[1].replace(/["']/g, '').replace(/\s+/g, '');
    } else if ((m = tok.match(/^genre:(.+)$/))) {
      q.genre = m[1].replace(/^["']|["']$/g, '').trim();
    } else if ((m = tok.match(/^daw:(.+)$/))) {
      q.daw = m[1].replace(/^["']|["']$/g, '').trim();
    } else if ((m = tok.match(/^note:(.+)$/))) {
      q.note = m[1].replace(/^["']|["']$/g, '').trim();
    } else {
      q.text.push(tok.replace(/^["']|["']$/g, '').trim());
    }
  }
  return q;
}

export function hasQuery(q: Query): boolean {
  return Boolean(q.bpm || q.key || q.sig || q.tala || q.genre || q.daw || q.note || q.text.length);
}

export function matchesQuery(entry: any, rec: any, q: Query): boolean {
  if (q.bpm) {
    const bpm = Number(entry.bpm);
    if (!bpm || bpm < q.bpm.lo || bpm > q.bpm.hi) return false;
  }
  if (q.key) {
    const keyText = [rec.key, rec.camelot].filter(Boolean).join(' ').toLowerCase().replace(/\s+/g, '');
    if (!keyText.includes(q.key)) return false;
  }
  if (q.sig) {
    const sig = String((rec && rec.timeSignature) || (entry && entry.timeSignature) || '')
      .toLowerCase()
      .replace(/\s+/g, '');
    if (!sig || !sig.includes(q.sig)) return false;
  }
  if (q.tala) {
    const talaText = String((rec && rec.tala) || (entry && entry.tala) || '')
      .toLowerCase()
      .replace(/\s+/g, '');
    if (!talaText || !talaText.includes(q.tala)) return false;
  }
  if (q.genre && !String((rec && rec.genre) || (entry && entry.genre) || '').toLowerCase().includes(q.genre)) return false;
  if (q.daw && !String(entry.daw || '').toLowerCase().includes(q.daw)) return false;
  if (q.note && !String(rec.note || '').toLowerCase().includes(q.note)) return false;
  if (q.text.length) {
    const names = entry.versions ? entry.versions.map((v: any) => v.name).join(' ') : entry.name;
    const hay = [
      names,
      entry.location,
      entry.daw,
      rec.note,
      rec.key,
      rec.camelot,
      rec.genre,
      entry.genre,
      entry.bpm,
      entry.timeSignature,
      rec.timeSignature,
      rec.tala
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    for (const term of q.text) if (!hay.includes(term)) return false;
  }
  return true;
}
