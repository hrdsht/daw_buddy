'use strict';

/**
 * The user's own naming vocabulary.
 *
 * Kept SEPARATE from `instruments.js`, which ships with the app. Editing that
 * file directly would work until the next update overwrote it, taking every
 * custom entry with it. This is stored as its own JSON and merged over the
 * top at load, so shipped entries improve with updates and personal ones
 * survive them.
 *
 * Three things it holds:
 *
 *   categories   entirely new ones — a genre or workflow we didn't ship
 *   tokens       extra names for existing subtypes, which is most of it
 *   disabled     shipped tokens the user wants ignored
 *
 * The third matters more than it looks. Shipped dictionaries always contain a
 * token that is wrong for someone: "bell" resolves to a cowbell here, which
 * is unhelpful if your library calls tubular bells "bell". Being able to
 * switch one off beats arguing about the default.
 */

const fs = require('fs/promises');
const path = require('path');

const VERSION = 1;

/* Tokens that would wreck matching if allowed through. */
const TOO_GENERIC = new Set([
  'a', 'b', 'c', 'd', 'e', 'f', 'g', 'the', 'and', 'of', 'in', 'on',
  'wav', 'mp3', 'aiff', 'flac', 'file', 'audio', 'sound', 'new', 'old',
  'final', 'test', 'temp', 'copy', 'untitled', 'sample', 'take', 'mix',
  'render', 'bounce', 'export', 'stem', 'track'
]);

class UserDictionary {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: VERSION, categories: {}, disabled: [], learned: {} };
  }

  async load() {
    try {
      const raw = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      if (raw.version === VERSION) this.data = { learned: {}, ...raw };
    } catch {
      /* first run, or unreadable — start clean rather than fail */
    }
    return this.data;
  }

  async save() {
    const temp = `${this.filePath}.tmp`;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(temp, JSON.stringify(this.data, null, 2), 'utf8');
    await fs.rename(temp, this.filePath);
  }

  /* ---------------------------------------------------------------- */

  /**
   * Checks a token before it goes in. Returning a reason rather than a
   * boolean so the UI can explain the refusal.
   */
  validate(token, shipped) {
    const clean = String(token || '').trim().toLowerCase();

    if (!clean) return { ok: false, reason: 'Empty' };
    if (clean.length < 2) {
      return { ok: false, reason: 'Too short — single letters match nearly everything' };
    }
    if (TOO_GENERIC.has(clean)) {
      return {
        ok: false,
        reason: `"${clean}" appears in too many filenames to mean anything specific`
      };
    }
    if (/^\d+$/.test(clean)) {
      return { ok: false, reason: 'Numbers alone are treated as version markers' };
    }
    if (clean.split(' ').length > 2) {
      return { ok: false, reason: 'One or two words only' };
    }

    // A token that already means something else is allowed, but the user
    // should be told what they're overriding rather than discovering it later.
    const existing = shipped && shipped.get(clean);
    if (existing && existing.length > 0) {
      const where = existing
        .map((e) => (e.subtype ? `${e.category}_${e.subtype}` : e.category))
        .join(', ');
      return { ok: true, warning: `Already used by ${where} — yours will win` };
    }

    return { ok: true };
  }

  /** Adds a token to a category/subtype, creating either if needed. */
  addToken(category, subtype, token, shipped) {
    const check = this.validate(token, shipped);
    if (!check.ok) return check;

    const clean = String(token).trim().toLowerCase();
    const cat = String(category).trim().toLowerCase();
    const sub = subtype ? String(subtype).trim().toLowerCase() : 'generic';

    if (!this.data.categories[cat]) this.data.categories[cat] = {};
    if (!this.data.categories[cat][sub]) this.data.categories[cat][sub] = [];

    if (!this.data.categories[cat][sub].includes(clean)) {
      this.data.categories[cat][sub].push(clean);
    }

    return { ok: true, warning: check.warning, category: cat, subtype: sub, token: clean };
  }

  removeToken(category, subtype, token) {
    const cat = this.data.categories[category];
    if (!cat || !cat[subtype]) return false;

    cat[subtype] = cat[subtype].filter((t) => t !== token);
    if (cat[subtype].length === 0) delete cat[subtype];
    if (Object.keys(cat).length === 0) delete this.data.categories[category];
    return true;
  }

  /** Switches off a shipped token without editing the shipped file. */
  disable(token) {
    const clean = String(token).trim().toLowerCase();
    if (!this.data.disabled.includes(clean)) this.data.disabled.push(clean);
  }

  enable(token) {
    this.data.disabled = this.data.disabled.filter((t) => t !== token);
  }

  /**
   * Records a correction made in the staging table.
   *
   * This is where the dictionary gets good. When someone overrides a
   * classification, the unmatched tokens from that filename are candidates
   * for meaning what they chose. Counted rather than trusted immediately —
   * one correction could be a one-off, three is a pattern.
   */
  learn(tokens, category, subtype, shipped) {
    const promoted = [];

    for (const token of tokens) {
      const check = this.validate(token, shipped);
      if (!check.ok) continue;
      if (shipped && shipped.has(token)) continue; // already means something

      const key = `${token}::${category}::${subtype || ''}`;
      const entry = this.data.learned[key] || { token, category, subtype, count: 0 };
      entry.count += 1;
      entry.lastSeen = new Date().toISOString();
      this.data.learned[key] = entry;

      // Three sightings is a habit, not an accident.
      if (entry.count >= 3) {
        this.addToken(category, subtype, token, shipped);
        promoted.push(token);
      }
    }

    return promoted;
  }

  /* ---------------------------------------------------------------- */

  /**
   * What to share.
   *
   * Tokens and categories only — no filenames, no paths, nothing about the
   * machine. Someone sending this in should be able to read the whole file
   * and see that it says nothing about them beyond what they call a duff.
   */
  exportForSharing() {
    const out = { version: VERSION, exportedAt: new Date().toISOString(), categories: {} };

    for (const [category, subtypes] of Object.entries(this.data.categories)) {
      out.categories[category] = {};
      for (const [subtype, tokens] of Object.entries(subtypes)) {
        out.categories[category][subtype] = [...tokens].sort();
      }
    }

    out.tokenCount = Object.values(out.categories).reduce(
      (sum, subtypes) => sum + Object.values(subtypes).reduce((s, t) => s + t.length, 0),
      0
    );
    return out;
  }

  /** Brings in a dictionary someone else exported. */
  importShared(shared, shipped) {
    if (!shared || shared.version !== VERSION) {
      return { ok: false, message: 'Not a dictionary file this version understands' };
    }

    let added = 0;
    const skipped = [];

    for (const [category, subtypes] of Object.entries(shared.categories || {})) {
      for (const [subtype, tokens] of Object.entries(subtypes)) {
        for (const token of tokens) {
          const result = this.addToken(category, subtype, token, shipped);
          if (result.ok) added += 1;
          else skipped.push({ token, reason: result.reason });
        }
      }
    }

    return { ok: true, added, skipped };
  }

  stats() {
    const categories = Object.keys(this.data.categories).length;
    const tokens = Object.values(this.data.categories).reduce(
      (sum, subtypes) => sum + Object.values(subtypes).reduce((s, t) => s + t.length, 0),
      0
    );
    const pending = Object.values(this.data.learned).filter((l) => l.count < 3).length;
    return { categories, tokens, disabled: this.data.disabled.length, pending };
  }
}

/**
 * Merges the user's dictionary over the shipped one.
 *
 * User entries win outright — someone who has typed a token in means it more
 * than a default does.
 */
function merge(shippedDictionary, userData) {
  const merged = {};

  for (const [category, subtypes] of Object.entries(shippedDictionary)) {
    merged[category] = {};
    for (const [subtype, tokens] of Object.entries(subtypes)) {
      merged[category][subtype] = tokens.filter(
        (t) => !userData.disabled.includes(t.toLowerCase())
      );
    }
  }

  for (const [category, subtypes] of Object.entries(userData.categories || {})) {
    if (!merged[category]) merged[category] = {};
    for (const [subtype, tokens] of Object.entries(subtypes)) {
      const existing = merged[category][subtype] || [];
      merged[category][subtype] = [...new Set([...existing, ...tokens])];
    }
  }

  return merged;
}

module.exports = { UserDictionary, merge, VERSION, TOO_GENERIC };
