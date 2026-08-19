'use strict';

const FLAT_TO_SHARP = {
  Cb: 'B', Db: 'C#', Eb: 'D#', Fb: 'E',
  Gb: 'F#', Ab: 'G#', Bb: 'A#'
};

/** Convert an analysed key or tonic label such as "G# min", "Bb major", or "A#" to a root. */
function rootNoteOf(record) {
  if (!record) return null;
  if (record.tonic) {
    const rawTonic = String(record.tonic).trim();
    const match = rawTonic.match(/^([A-Ga-g])([#b♭]?)/);
    if (match) {
      const letter = match[1].toUpperCase();
      const accidental = match[2] === '♭' ? 'b' : match[2];
      const note = `${letter}${accidental}`;
      return FLAT_TO_SHARP[note] || note;
    }
    return FLAT_TO_SHARP[rawTonic] || rawTonic;
  }
  if (!record.key) return null;
  const match = String(record.key).trim().match(/^([A-Ga-g])([#b♭]?)/);
  if (!match) return null;

  const letter = match[1].toUpperCase();
  const accidental = match[2] === '♭' ? 'b' : match[2];
  const note = `${letter}${accidental}`;
  return FLAT_TO_SHARP[note] || note;
}

/**
 * The project whose audio is currently loaded wins. A Play button stops the
 * row click from bubbling, so relying only on the highlighted row can play a
 * stale project's drone even though the analyser found the correct new key.
 */
function droneNoteFor(records, activeAuditionPath, openProjectPath, selectedPath) {
  const candidates = [activeAuditionPath, openProjectPath, selectedPath];
  for (const key of candidates) {
    if (!key) continue;
    const note = rootNoteOf(records && records[key]);
    if (note) return note;
  }
  return null;
}

export { rootNoteOf, droneNoteFor };
