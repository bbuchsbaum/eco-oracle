---
name: eco-join
description: Use to add a package repository to the ecosystem so external users can discover and use it via EcoOracle (how-to recipes + API lookup).
---

Goal: Make this repo publish a consumer-focused EcoAtlas pack on every merge to main.

Do the following changes in a single PR:

1) Add `.ecosystem.yml` at repo root.
   - Set package name from DESCRIPTION.
   - Set language to R.
   - Add role/tags if obvious; otherwise leave minimal.

2) Add the EcoAtlas workflow:
   - Create `.github/workflows/eco-atlas.yml` using the standard template from the eco-oracle repo.
   - Ensure it runs on push to main and publishes `atlas-pack.tgz` to a Release named `eco-atlas`.

3) Add the tool scripts:
   - `tools/eco_atlas_extract.R`
   - `tools/eco_atlas_distill.mjs`
   Ensure the workflow calls them.

4) Validate locally (if possible):
   - `R CMD check` (or `R -q -e 'devtools::check()'`)
   - Run the extractor: `Rscript tools/eco_atlas_extract.R`
   - If OPENAI_API_KEY is present, run distiller: `node tools/eco_atlas_distill.mjs`

5) In the PR description:
   - Mention that the repo needs an `OPENAI_API_KEY` GitHub Actions secret.
   - Mention where the Release asset will appear (eco-atlas → atlas-pack.tgz).

Do not add large documentation. Prefer user-facing examples from vignettes/README, and only use tests as fallback evidence.
Prefer ECO markers in code/examples if extra guidance is needed:
- `# ECO:howto How do I ...?` above a small canonical snippet.
