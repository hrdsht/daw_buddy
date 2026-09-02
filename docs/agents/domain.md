# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, if it exists.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in.
- **Existing project docs** (always present, even when `CONTEXT.md` is not):
  - [`RULES.md`](../../RULES.md) — versioning, git, load-bearing invariants
  - [`AGENTS.md`](../../AGENTS.md) — agent constraints
  - [`docs/proposals/`](../proposals/) — numbered human design proposals (this project's decision log today)

If `CONTEXT.md` or `docs/adr/` don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

Do **not** replace `docs/proposals/` with `docs/adr/`. Proposals stay the human feature/design log. Skill-written ADRs go under `docs/adr/` for hard-to-reverse technical decisions; if a proposal already covers the same ground, link it rather than duplicating.

## File structure

Single-context repo:

```
/
├── CONTEXT.md                 ← created lazily by /domain-modeling
├── docs/adr/                  ← created lazily by /domain-modeling
├── docs/proposals/            ← existing human proposals
└── src/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

Load-bearing terms already documented in `RULES.md` (guarded paths, hard-link de-duplicator, one row per session file, loud limits, parser version stamps) are in force whether or not they appear in `CONTEXT.md` yet.

## Flag ADR conflicts

If your output contradicts an existing ADR or an accepted `docs/proposals/` decision, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 / proposal 0005, but worth reopening because…_
