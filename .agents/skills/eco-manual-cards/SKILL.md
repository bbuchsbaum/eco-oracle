---
name: eco-manual-cards
description: Use to create or enhance manual_cards.jsonl safely. Never overwrite the file; append new cards or patch specific existing card IDs only.
---

Goal: Improve retrieval quality by adding high-signal manual cards without clobbering existing cards.

Rules:
1. Never overwrite `manual_cards.jsonl` wholesale.
2. If `manual_cards.jsonl` does not exist, create it.
3. If adding new cards:
   - append newline-delimited JSON objects.
4. If updating existing cards:
   - update only the targeted `id` entries in place.
   - do not delete unrelated entries.
5. Keep one JSON object per line (JSONL), no arrays.
6. Every card must include:
   - `id`
   - `q`
   - `a`
   - `recipe`
   - `symbols` (non-empty array)
7. Prefer IDs in this format:
   - `manual.<package>.<topic>`
8. For cross-package workflows:
   - include symbols from both packages in `symbols`
   - include shared domain/workflow tags

Authoring guidance:
1. Start from ecosystem entrypoints and user workflows, not internal implementation details.
2. Keep `recipe` runnable and short.
3. Prefer explicit namespacing (`pkg::fn`) or explicit `library()` calls.
4. Avoid duplicate cards with the same intent.

When done, report:
- cards added
- card IDs updated
- whether file was created or only appended/target-patched
