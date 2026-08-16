# Proposals

Each feature or design change gets a short numbered proposal here, so decisions
are tracked one at a time instead of buried in a single lab notebook. This
replaces the old `HANDOVER.md` (its orientation now lives in `../../CLAUDE.md`;
the historical version is in git).

## How to use it

1. Copy `0000-template.md` to `NNNN-short-slug.md` (next free number).
2. Fill in **Status / Context / Decision / Consequences**.
3. Set `Status` to `Proposed` while discussing, `Accepted` once agreed,
   `Implemented` when the code lands, or `Superseded by NNNN` when replaced.
4. Keep it short — a screenful. Detail that belongs in code goes in code.

## Index

| # | Title | Status |
|---|---|---|
| [0001](0001-restructure-and-typescript.md) | Repo restructure + TypeScript migration | Implemented |
| [0002](0002-renderer-module-split.md) | Split the renderer into modules | Proposed |
| [0003](0003-packaging-and-release.md) | Installers + release CI | Implemented |
