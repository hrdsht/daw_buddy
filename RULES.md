# Project rules

Rules for **everyone working on DAW Buddy — humans and AI agents alike.** They
exist because these things have already gone wrong. Read before you change,
bump, or release anything.

---

## 1. Versioning & releases — the strict part

**Why this section exists:** releases jumped `v0.1.0 → v0.2.0 → v0.4.0` (v0.3.0
skipped) with dangling betas (`0.3.0-beta.1`, `0.4.2-beta.1`) because multiple
people/agents bumped the version independently, without thinking. Stop that.

1. **One source of truth.** The version lives in `package.json` `"version"`. The
   git tag **must** equal it (`vX.Y.Z`). They never drift.

2. **Semantic versioning, one step at a time. No skips.**
   - `patch` (`0.4.0 → 0.4.1`) — bug fixes only.
   - `minor` (`0.4.0 → 0.5.0`) — new, backward-compatible features.
   - `major` (`0.4.0 → 1.0.0`) — breaking changes, or "we're calling it stable".
   - **Never jump numbers** (`0.2.0 → 0.4.0` is forbidden). If a number was
     skipped in the past, do **not** try to reclaim it — continue from the
     highest already released.

3. **Do NOT bump the version autonomously.** An AI agent must never bump the
   version, tag, or cut a release unless the maintainer **explicitly asks for a
   release in this request.** "chore: bump version" as a side-effect of feature
   work is not allowed. When unsure, leave the version alone and ask.

4. **Bump with `npm version <patch|minor|major>`**, never by hand-editing
   `package.json`. It updates the file, the lockfile, and the tag atomically so
   they can't drift.

5. **Pre-releases finalise before you move on.** A `-beta.N` / `-rc.N` is a
   candidate for **one specific version**. Ship it as that final version (drop
   the suffix) *before* starting the next one. Do not leave a dangling beta and
   jump ahead (`0.3.0-beta.1` must become `0.3.0` before anything touches
   `0.4.x`).

6. **Check state before releasing — coordinate.** Before any release:
   `git fetch`, then `gh release list` and `git tag --sort=-v:refname`. Only one
   person cuts a release at a time. Parallel releases are exactly how `v0.3.0`
   got skipped.

7. **Release only from `main`, only when green.** `npm run typecheck && npm test`
   pass locally, CI is green, then `gh release create vX.Y.Z`.

8. **Releases stay `--prerelease` until the app is code-signed** (macOS
   Gatekeeper / Windows SmartScreen). See `docs/proposals/0008-code-signing.md`.

---

## 2. Dependencies

1. **Never bump a *major* dependency version as a side-effect.** electron,
   chokidar, typescript, esbuild — a major bump is its own reviewed change with a
   full `typecheck` + `test` + smoke-run pass, not a line snuck into a feature
   commit. (This has already happened: electron `^39 → ^43`, chokidar `^3 → ^5`.)
2. Let **Dependabot** propose updates; review and test them deliberately.

---

## 3. Git & shared history

1. **Never force-push `main`** (or any shared branch). It destroys teammates'
   in-flight work. This nearly deleted a released version once — don't.
2. **Verify before pushing to `main`:** `npm run typecheck` and `npm test` green.
   `main` must stay releasable at all times.
3. **Commits:** signed, granular, Conventional-Commit style
   (`feat:`/`fix:`/`chore:`/`docs:`/…). Clean, hand-written messages — no
   AI/co-author trailers, no "Generated with" footers.
4. **Ask before outward or irreversible actions:** publishing a release,
   deleting a tag/release, force-pushing, or a major dependency bump.

---

## 4. Don't break the load-bearing invariants

These are safety decisions, each of which was a real bug once. Do not "simplify"
them away (full detail lives with the code):

- Every path from the window is **guarded** against escaping a configured root.
- The de-duplicator **hard-links, never deletes**.
- **One row per session file**, not per folder.
- Limits (depth caps, budgets, truncation) must be **loud** when hit.
- Bump the **parser version stamp** when you change a format parser, or the cache
  serves stale values forever.

---

## 5. External media & assets

Sample audio, packs, stems and commercial media **never** live in the repo. Keep
them in a per-machine directory pointed to by `$DAWBUDDY_ASSETS` — never a
hardcoded absolute path. `.gitignore` blocks audio extensions as a backstop.
Full policy: [`.agents/rules/assets-policy.md`](.agents/rules/assets-policy.md).

---

_When a rule and a request conflict, surface the conflict — don't silently pick
one. The rules are the default; the maintainer can override them explicitly._
