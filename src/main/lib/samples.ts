/**
 * Missing-sample detection for Ableton Live sets.
 *
 * An `.als` is gzipped XML. Each audio clip stores a `<SampleRef>` whose
 * `<FileRef>` records both a project-relative path and the original absolute
 * path. We extract those, resolve them, and report the ones that exist in
 * neither place — a sample that has been moved or deleted since the set was
 * saved.
 *
 * **Conservative by design:** a sample is only flagged missing when BOTH the
 * relative-resolved path AND the absolute path are absent. Ableton also pulls
 * samples from packs and the user library (paths that resolve elsewhere), so
 * requiring both to be gone avoids crying wolf on library content. Ableton-only
 * for now; other formats return `{ supported: false }`.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gunzip = promisify(zlib.gunzip);

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

async function readAls(filePath: string): Promise<string> {
  const raw = await fs.readFile(filePath);
  return raw[0] === 0x1f && raw[1] === 0x8b
    ? (await gunzip(raw)).toString('utf8')
    : raw.toString('utf8');
}

/**
 * Pull the sample references out of a decompressed `.als` XML string. Handles
 * modern Live (`<RelativePath Value=".."/>` + `<Path Value=".."/>`) and the
 * older per-directory form (`<RelativePathElement Dir=".."/>` series).
 */
function extractSampleRefs(xml: string) {
  const refs: Array<{ name: string; relativePath: string | null; path: string | null }> = [];
  const blocks = xml.match(/<SampleRef\b[\s\S]*?<\/SampleRef>/g) || [];
  for (const block of blocks) {
    const rel = block.match(/<RelativePath Value="([^"]*)"/);
    const abs = block.match(/<Path Value="([^"]*)"/);
    const elems = [...block.matchAll(/<RelativePathElement[^>]*Dir="([^"]*)"/g)].map((m) =>
      decodeXml(m[1])
    );

    let relativePath = rel ? decodeXml(rel[1]) : null;
    if (!relativePath && elems.length) relativePath = elems.join('/');
    const absPath = abs ? decodeXml(abs[1]) : null;
    if (!relativePath && !absPath) continue;

    refs.push({
      name: path.basename(absPath || relativePath || ''),
      relativePath,
      path: absPath
    });
  }
  return refs;
}

/**
 * Audit one Ableton set. Returns `{ supported, referenced, present, missing }`.
 * `missing` is a de-duplicated list of `{ name, relativePath, path }`.
 */
async function auditSamples(sessionPath: string) {
  const ext = path.extname(sessionPath).toLowerCase();
  if (ext !== '.als') {
    return { supported: false, referenced: 0, present: 0, missing: [] };
  }

  let xml: string;
  try {
    xml = await readAls(sessionPath);
  } catch (err) {
    return {
      supported: true,
      error: `Could not read set: ${(err as Error).message}`,
      referenced: 0,
      present: 0,
      missing: []
    };
  }

  const refs = extractSampleRefs(xml);
  const projectDir = path.dirname(sessionPath);
  const missing: Array<{ name: string; relativePath: string | null; path: string | null }> = [];
  const seen = new Set<string>();
  let present = 0;

  for (const ref of refs) {
    const key = (ref.path || '') + '::' + (ref.relativePath || '');
    if (seen.has(key)) continue;
    seen.add(key);

    const candidates: string[] = [];
    if (ref.relativePath) candidates.push(path.resolve(projectDir, ref.relativePath));
    if (ref.path) candidates.push(ref.path);

    if (candidates.some((p) => fsSync.existsSync(p))) present += 1;
    else missing.push(ref);
  }

  return { supported: true, referenced: seen.size, present, missing };
}

module.exports = { auditSamples, extractSampleRefs, readAls };
