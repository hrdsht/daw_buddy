'use strict';

/**
 * The vocal-timeline manifest is the only record of where every block and
 * gap originally sat. A version stamp is not optional here the way it is for
 * the parse cache — a cache can silently rebuild itself from scratch, but a
 * manifest whose shape the reader doesn't understand must fail loudly rather
 * than reconstruct something plausible-looking.
 */

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const MANIFEST_FORMAT = 1;

/**
 * Temp file then rename, same reason the parse cache and the silence trimmer
 * do it this way — a crash or kill mid-write leaves the old manifest (or
 * nothing) rather than a truncated JSON file that looks legitimate.
 */
async function writeManifest(filePath, data) {
  const payload = { format: MANIFEST_FORMAT, ...data };
  const temp = `${filePath}.tmp-${Date.now()}`;

  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(temp, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(temp, filePath);
}

/**
 * Throws rather than migrating or discarding — a manifest with an
 * unrecognised shape isn't safe to guess at, since guessing wrong means
 * placing audio at the wrong position.
 */
async function readManifest(filePath) {
  let raw;
  try {
    raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read manifest: ${err.message}`);
  }

  if (raw.format !== MANIFEST_FORMAT) {
    throw new Error(
      `Manifest format ${raw.format} is not supported (expected ${MANIFEST_FORMAT}). It may be from a newer or older version of DAW Buddy.`
    );
  }
  if (!raw.source || !Array.isArray(raw.segments)) {
    throw new Error('Manifest is missing required fields.');
  }

  return raw;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = require('fs').createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

module.exports = { writeManifest, readManifest, sha256File, MANIFEST_FORMAT };
