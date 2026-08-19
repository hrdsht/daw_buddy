'use strict';

/**
 * Resolves a filename to a category and subtype using the dictionary.
 *
 * This is the fast path and it does most of the work. Exports are almost
 * always named something — a filename is evidence, a spectrum is only an
 * inference, so the name wins when it says anything at all.
 */

const path = require('path');
const { DICTIONARY, NOISE_TOKENS, VENDOR_TOKENS } = require('./instruments');

/**
 * Articulations and playing styles. These describe HOW something is played,
 * not WHAT it is, so they must never outrank an instrument name.
 *
 * Without this, "bassoon_legato" resolves to strings_legato — "legato" is a
 * specific subtype and sits later in the name, so it won both tie-breaks and
 * beat the actual instrument. Same reason "vln_ens_stacc" lost its violin.
 *
 * They still resolve a name on their own: a file called just "legato.wav"
 * from a strings library is better as strings_legato than as nothing.
 */
const MODIFIER_SUBTYPES = new Set([
  'legato', 'staccato', 'pizzicato', 'tremolo', 'palmmute', 'slide',
  'clean', 'distorted', 'loop', 'fill', 'reverse'
]);

/* Flatten the dictionary once into lookup maps. */
const SINGLE = new Map(); // token       → [{category, subtype, specific}]
const PHRASE = new Map(); // "two words" → same

for (const [category, subtypes] of Object.entries(DICTIONARY)) {
  for (const [subtype, names] of Object.entries(subtypes)) {
    for (const name of names) {
      const entry = {
        category,
        subtype: subtype === 'generic' ? null : subtype,
        // A named subtype is more specific than a bare category word.
        specific: subtype !== 'generic',
        // …unless it only describes how the thing is played.
        modifier: MODIFIER_SUBTYPES.has(subtype)
      };
      const target = name.includes(' ') ? PHRASE : SINGLE;
      const key = name.toLowerCase();
      if (!target.has(key)) target.set(key, []);
      target.get(key).push(entry);
    }
  }
}

/**
 * Splits a filename into comparable tokens.
 *
 * camelCase is broken up too, so "KickDrumHard" yields kick, drum, hard —
 * plenty of exports are named that way.
 */
function tokenise(name) {
  const stem = name.replace(/\.[^.]+$/, '');
  return stem
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

function isNoise(token) {
  if (NOISE_TOKENS.has(token) || VENDOR_TOKENS.has(token)) return true;
  if (/^\d+$/.test(token)) return true; // bare numbers
  if (/^v\d+$/.test(token)) return true; // v2, v13
  if (/^\d{1,3}bpm$/.test(token)) return true;
  if (token.length === 1) return true;
  return false;
}

function buildLookupMaps(dict) {
  const single = new Map();
  const phrase = new Map();
  for (const [category, subtypes] of Object.entries(dict)) {
    for (const [subtype, names] of Object.entries(subtypes)) {
      for (const name of names) {
        const entry = {
          category,
          subtype: subtype === 'generic' ? null : subtype,
          specific: subtype !== 'generic',
          modifier: MODIFIER_SUBTYPES.has(subtype)
        };
        const target = name.includes(' ') ? phrase : single;
        const key = name.toLowerCase();
        if (!target.has(key)) target.set(key, []);
        target.get(key).push(entry);
      }
    }
  }
  return { single, phrase };
}

/**
 * Every dictionary hit in the name, in order.
 *
 * Two-word phrases are tested first so "bass drum" resolves to a kick rather
 * than to a bass — a real collision that would otherwise route the kick to
 * the wrong bus.
 */
function findMatches(tokens, userDict = null) {
  let singleMap = SINGLE;
  let phraseMap = PHRASE;

  if (userDict) {
    const { merge } = require('./userdict');
    const merged = merge(DICTIONARY, userDict.data || userDict);
    const customMaps = buildLookupMaps(merged);
    singleMap = customMaps.single;
    phraseMap = customMaps.phrase;
  }

  const matches = [];
  const consumed = new Set();

  for (let i = 0; i < tokens.length - 1; i += 1) {
    const phrase = `${tokens[i]} ${tokens[i + 1]}`;
    const hits = phraseMap.get(phrase);
    if (!hits) continue;
    for (const hit of hits) matches.push({ ...hit, at: i, token: phrase, phrase: true });
    consumed.add(i);
    consumed.add(i + 1);
  }

  for (let i = 0; i < tokens.length; i += 1) {
    if (consumed.has(i)) continue;
    const token = tokens[i];
    if (isNoise(token)) continue;
    const hits = singleMap.get(token);
    if (!hits) continue;
    for (const hit of hits) matches.push({ ...hit, at: i, token, phrase: false });
  }

  return matches;
}

/**
 * Picks a winner.
 *
 * Specific beats generic — "kshmr_percussion_oneshot_tabla" contains both
 * "percussion" and "tabla", and tabla is the answer. Where two matches are
 * equally specific the later one wins, since names are generally written
 * broad to narrow.
 */
function classify(fileName, userDict = null) {
  const tokens = tokenise(fileName);
  const matches = findMatches(tokens, userDict);

  if (matches.length === 0) {
    return { matched: false, category: null, subtype: null, confidence: 0, tokens };
  }

  const rank = (m) => {
    if (m.specific && !m.modifier) return 0; // a real instrument
    if (m.specific && m.modifier) return 1; // an articulation
    return 2; // a bare category word
  };

  const ranked = matches.slice().sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (a.phrase !== b.phrase) return a.phrase ? -1 : 1;
    return b.at - a.at; // names run broad to narrow, so later wins
  });

  const winner = ranked[0];

  /**
   * An instrument plus an articulation is not a conflict — it's a fuller
   * description. Keep the instrument, and note the articulation so the UI
   * can offer "strings_violin_stacc" if the user wants it.
   */
  const articulation = matches.find(
    (m) => m.modifier && m.category === winner.category && m !== winner
  );

  // Two different categories both claiming the name is worth flagging rather
  // than silently resolving — "bass" and "guitar" in one name could be a bass
  // guitar or a guitar stem sitting next to a bass one.
  const rivals = new Set(
    matches.filter((m) => rank(m) === rank(winner)).map((m) => m.category)
  );
  const contested = rivals.size > 1;

  return {
    matched: true,
    category: winner.category,
    subtype: winner.subtype,
    matchedOn: winner.token,
    // A specific subtype from the filename is about as certain as this gets.
    // A bare category word is weaker. A contested name weaker still.
    confidence: contested ? 0.6 : winner.specific ? 0.95 : 0.75,
    contested,
    articulation: articulation ? articulation.subtype : null,
    alternatives: [...rivals].filter((c) => c !== winner.category),
    tokens
  };
}

/** The output name, before indexing. */
function nameFor(result) {
  if (!result.matched) return null;
  return result.subtype ? `${result.category}_${result.subtype}` : result.category;
}

/** Every category, for the UI's override dropdown. */
function categories() {
  return Object.entries(DICTIONARY).map(([category, subtypes]) => ({
    category,
    subtypes: Object.keys(subtypes).filter((s) => s !== 'generic')
  }));
}

module.exports = { classify, nameFor, tokenise, categories, SINGLE, PHRASE };
