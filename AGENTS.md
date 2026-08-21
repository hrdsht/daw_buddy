# Agent instructions

**Read [`RULES.md`](./RULES.md) before changing, bumping, or releasing anything.**

Two rules matter most — they have already been broken:

1. **Do NOT bump the version, tag, or cut a release** unless the maintainer
   explicitly asks for a release in this request. Never as a side-effect. Follow
   semantic versioning one step at a time, no skips (`0.2.0 → 0.3.0`, never
   `→ 0.4.0`). Bump with `npm version`, never by hand.
2. **Never force-push `main`.** Verify (`npm run typecheck && npm test`) before
   any push; `main` must stay releasable.

Do not bump **major** dependency versions as a side-effect. Ask before outward or
irreversible actions. Full detail: [`RULES.md`](./RULES.md).
