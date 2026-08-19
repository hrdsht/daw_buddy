# 0005 — Linux support

**Status:** proposal
**Author:** drafted for review
**Date:** 2026-08-17

---

## Context

Two collaborators run Linux. The motivating case is not "browse projects on a
Linux box" — it's **an external drive carrying projects made on Windows and
macOS, mounted on Linux**, and expecting the app to behave.

DAW support is not the question. A project browser doesn't need the DAW
installed to read a `.als` and show you what's in it.

## What already works

Most of the platform handling was written properly the first time:

- `process.platform` already branches where it matters — `procs.ts` picks
  `ps` over `tasklist`, `settings.ts` only does case-insensitive path
  comparison on Windows and macOS, `main.ts` only applies the macOS title bar
- Everything in `lib/` is plain Node with no platform assumptions
- `dedupe.ts` uses `stat.dev` for volume identity, which is correct on Linux.
  (The earlier version used `path.parse().root`, which returns `/` for every
  mount — that would have been wrong here for the same reason it was wrong on
  macOS)
- Path building goes through `path.join`, never string concatenation

**There is deliberately no per-platform source tree, and there should not be
one.** A launcher cannot tell the app anything `process.platform` doesn't
already say, and two copies of `scanner.ts` would drift apart within a month.
Conditionals inside shared files stay correct.

---

## The real problem: one drive, three machines

This is the part that needs a design decision, not just a port.

The same file has three different absolute paths depending on who's looking:

```
Windows   E:\JUMP\2026\May 2026\Suraag\song.als
Linux     /media/hpkal/JUMP/2026/May 2026/Suraag/song.als
macOS     /Volumes/JUMP/2026/May 2026/Suraag/song.als
```

`notes.json` and `cache.json` are both keyed on the **absolute path**. So on
the second machine:

- Every note, favourite, detected key and stems path appears to have vanished
- The parse cache misses 100%, and every project re-parses from scratch
- Nothing is corrupted — it's all still there under the other key — but it
  looks like catastrophic data loss

Worse, if both people then add notes, you end up with two disjoint sets of
records for the same drive and no obvious way to reconcile them.

### Proposed fix: store paths relative to their root

A record key becomes `<root id>::<path relative to that root>`, with the
separator normalised to `/`:

```
JUMP::2026/May 2026/Suraag/song.als
```

The root id is stable per configured folder and stored in `settings.json`
alongside the path. Each machine maps its own absolute path onto the same id.

**Migration:** on load, any key that looks absolute gets rewritten if it falls
under a known root. Same shape as `migrate.js` — copy rather than move, keep
the original file until the new one is verified.

**Open question:** where does the record file live? Options:

- **App data, per machine.** Simple, but the two people never see each other's
  notes.
- **On the drive itself**, e.g. `JUMP/.dawbuddy/notes.json`. Notes travel with
  the projects, which is probably what you actually want. Needs care with two
  machines writing at once — last-write-wins would lose notes.
- **Both**, with the drive copy as the shared source and app data as a cache.

Recommend starting with the drive copy, single writer at a time, and treating
concurrent access as a later problem.

---

## Filesystem differences that will bite

### Case sensitivity — highest risk

`Renders` and `renders` are the same folder on Windows and macOS and
**different on Linux**. This has already caused one bug in this codebase: an
earlier version joined a lowercase folder name onto a path, which worked on
Windows by luck and found nothing on a case-sensitive filesystem. The fix was
to read the directory and compare lowercased names.

**Audit for any place that constructs a path from a hardcoded name** rather
than matching what's on disk. `renders.ts` and `dedupe.ts` are the ones to
check — both look for folders by name (`Renders`, `Bounces`, `Samples`,
`Imported`, `Splice`).

Note that an NTFS drive mounted via `ntfs-3g` may be case-**in**sensitive
depending on mount options, so behaviour can differ between two Linux machines
with the same drive. Match case-insensitively and this stops mattering.

### Hard links — `dedupe.ts` must check before it acts

| Filesystem | Hard links | Notes |
|---|---|---|
| ext4, btrfs, xfs | yes | fine |
| NTFS via ntfs-3g | usually | depends on mount options |
| exFAT | **no** | common on drives shared with macOS |
| FAT32 | **no** | |
| SMB / NFS | varies | |

The de-duplicator currently assumes `fs.link` works and reports failures per
file. On exFAT **every** link fails, which is a confusing way to find out the
filesystem doesn't support it.

**Add a capability probe before offering to link:** create a link to a temp
file, check it, delete it. If it fails, show "this drive doesn't support
linking" and offer the report-only view instead.

### Other differences worth handling

- **Windows-illegal characters** (`: * ? " < > |`) are legal on Linux. The
  renamer already strips them, which is right — a file created on Linux with
  `:` in the name is unusable on Windows. Consider warning rather than
  silently stripping.
- **macOS metadata** — `.DS_Store`, `._`-prefixed AppleDouble files. Already
  skipped by the dotfile rule.
- **Permissions** — NTFS mounts often report every file as `777` or every file
  as read-only, depending on `uid`/`gid` mount options. Write failures should
  say "check how the drive is mounted", not "permission denied".
- **Timestamps** — FAT and exFAT store local time with no timezone, so
  `mtime` can shift by hours between machines. This affects **cache
  invalidation**, which keys on mtime: a drive moved between machines may
  invalidate the whole cache. Not harmful, just slow. Worth a note in the
  cache's stats output rather than a fix.
- **Path length** — no 260-character limit on Linux, so a Linux user can
  create paths Windows can't open. The existing `ENAMETOOLONG` message covers
  the reverse case.

---

## Tasks

### L-1 · Launcher

`DAW Buddy.sh` — supplied with this proposal. Checks for Node 18+, warns if
`libgtk-3` is missing (Electron's failure without it is an opaque linker
error), runs `npm install` on first run, and mentions `--no-sandbox` in the
error path since some kernels reject Electron's sandbox.

- [ ] Committed with the executable bit set (`git update-index --chmod=+x`)
- [ ] Mentioned in the README next to the `.bat` and `.command`

### L-2 · Record keys relative to root

The change described above. Blocks meaningful shared use of one drive.

- [ ] Keys become `<root id>::<relative path>` with `/` separators
- [ ] Migration rewrites absolute keys under a known root
- [ ] Original file retained until verified
- [ ] Decide where the record file lives (see open question)

### L-3 · Hard link capability probe

- [ ] Probe before offering to link; cache per volume
- [ ] Explain the filesystem limitation rather than reporting N failures
- [ ] Report-only mode when linking is unavailable

### L-4 · Case-sensitivity audit

- [ ] No path built from a hardcoded folder name; read and match instead
- [ ] Tests run against a case-sensitive fixture tree
- [ ] Priority: `renders.ts`, `dedupe.ts`, `scanner.ts` skip lists

### L-5 · Build targets

- [ ] AppImage and deb in `electron-builder.yml`
- [ ] Linux job in the CI matrix (tests already run on three OSes; packaging
      doesn't)
- [ ] Linux packages can be built on Linux without special tooling, unlike
      macOS

### L-6 · Linux DAW process names

`procs.ts` looks for Windows and macOS binaries, so the "a DAW is already
running" guard never fires on Linux. Add Bitwig, REAPER, Ardour, Waveform.
Data change, not a code change.

---

## Appendix — notes for a security review

Offered as a map of where the interesting surface is, not as a claim that any
of it is sound.

**Trust boundary.** The renderer has no file access; `contextIsolation` is on
and `nodeIntegration` off. Everything crossing the boundary goes through the
channel list in `preload.ts`. That list is the entire attack surface from the
renderer's side.

**Path validation.** `guardApproved()` in `main.ts` checks paths against
configured roots before any read, rename or rewrite. Worth probing:

- Traversal via `..`, symlinks pointing outside a root, Windows 8.3 short
  names, UNC paths, and on Linux `/proc/self/...`
- The `pickedFolders` set, which exempts folders chosen through an OS dialog.
  It is never pruned — check whether an entry can be reused later for
  something it wasn't approved for
- Whether validation happens per file inside batch loops or once on the batch
  (it should be per file; `finish:process` does this correctly)

**Untrusted file content is parsed by hand.** `.flp`, `.als`, `.cpr`,
`.logicx`, WAV/RIFF, zip, ID3. All hand-written parsers over
attacker-influenceable bytes:

- Length fields read from the file and used as offsets — `zipreader.ts` reads
  a central directory offset and entry sizes, `silence.ts` reads chunk sizes,
  `id3.ts` reads a syncsafe size
- Zip: no extraction to disk, so path traversal doesn't apply, but decompressed
  size is bounded only by an 8 MB cap — check the ratio, not just the output
- The `.flp` event walk advances by attacker-controlled lengths

**Command execution.** `procs.ts` runs `tasklist`/`ps`; `encoders.ts` runs
ffmpeg via `execFile` with an argument array (not a shell string). The ffmpeg
path can come from settings — check whether a crafted `settings.json` can
point it at an arbitrary binary, and what that implies.

**Outbound network.** One optional webhook, opt-in, URL from settings. Worth
checking for SSRF into localhost or link-local addresses, and whether the
posted payload can carry filesystem contents.

**Write paths.** Every writing tool uses temp-file-then-rename. Check the temp
name for predictability and for symlink races in a shared `/tmp`. `dedupe.ts`
re-hashes immediately before linking to close a TOCTOU window — worth
confirming the window is actually closed rather than narrowed.

**Persisted state.** `settings.json`, `notes.json` and `cache.json` are plain
JSON in the app data folder, read at startup with no schema validation. A
hostile `settings.json` controls the scan roots, the ignore list, the ffmpeg
path and the webhook URL.
