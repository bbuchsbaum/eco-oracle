---
name: eco-oracle
description: Use for tasks involving our internal package ecosystem. Query MCP tools (eco_howto, eco_symbol, eco_packages, eco_where_used) to onboard quickly and avoid exploratory scripts.
---

When working with the internal ecosystem:

1) Decompose the goal into 2–6 subquestions phrased as "How do I …?"
2) For each subquestion:
   - Call `eco_howto(query, top_k=5)`.
   - Fetch at most the top 1–2 cards.
3) If a card references a function you need to understand:
   - Call `eco_symbol("pkg::fn")`.
4) Assemble the final script by stitching the `recipe` blocks.
5) Only if retrieval fails or is ambiguous:
   - read source files, or
   - run exploratory scripts.

Keep outputs concise and reproducible.

Skills can be invoked directly as `/eco-oracle` or activate automatically when ecosystem packages are mentioned.
