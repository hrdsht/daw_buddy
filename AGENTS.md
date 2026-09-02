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

## Agent skills

Matt Pocock engineering skills live in `.agents/skills/` (and a Cursor copy in
`.cursor/skills/`). Type `/ask-matt` when you are not sure which flow to run.

### Issue tracker

GitHub Issues on `ba55ick/daw_buddy` via `gh --repo ba55ick/daw_buddy`. See
`docs/agents/issue-tracker.md`.

### Triage labels

Default five roles (`needs-triage`, `needs-info`, `ready-for-agent`,
`ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: lazy `CONTEXT.md` + `docs/adr/`, plus existing
`docs/proposals/`. See `docs/agents/domain.md`.
