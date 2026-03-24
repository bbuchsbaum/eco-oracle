---
name: eco-join
description: Use to add the current package repository to the ecosystem by scaffolding .ecosystem.yml, EcoAtlas GitHub Action, and atlas tool scripts.
---

Goal: Make this repo publish an EcoAtlas pack on every merge to main.

Create a PR that adds:
1) `.ecosystem.yml`
2) `.github/workflows/eco-atlas.yml`
3) `tools/eco_atlas_extract.R`
4) `tools/eco_atlas_distill.mjs`
5) `AGENTS.md` and `CLAUDE.md` with the oracle-first rule

Include in PR notes:
- Requires GitHub Actions secret `OPENAI_API_KEY`.
- Output artifact: Release `eco-atlas` with `atlas-pack.tgz`.

Use ECO markers sparingly for extra signal:
- `# ECO:howto How do I ...?` above a short canonical snippet.
