---
name: eco-fill-directives
description: Fill script TODO comments from eco-oracle MCP. Parse flexible/typo-tolerant directive comments, query eco_howto/eco_symbol, and insert runnable ecosystem code under each directive.
---

Goal: turn lightweight in-script hints into concrete code using eco-oracle, without forcing strict syntax.

Directive detection (robust):
1. Treat a comment line as a directive when it contains:
   - an eco marker: `eco-oracle` OR `ecooracle` OR `eco`
   - and an intent marker: `howto`, `how-to`, `how do i`, `use`, `create`, `build`, `load`
2. Matching is case-insensitive.
3. Be tolerant to punctuation and spacing:
   - normalize by lowercasing, stripping punctuation, and collapsing whitespace.
4. Accept minor variants/typos of `howto` when the line clearly indicates user intent.

Examples that should be accepted:
- `# <eco-oracle> use bidser to load project`
- `# ecooracle howto create baseline_model`
- `# ECO: how do I build design matrix?`

Execution workflow:
1. Parse directives in order from the target script.
2. For each directive:
   - call `eco_howto` with the directive text as query
   - pick the best card
   - call `eco_symbol` for concrete functions used in the chosen recipe
3. Insert code directly below the directive comment.
4. Preserve existing user code/comments outside inserted blocks.

Insertion behavior:
1. If a directive already has a nearby generated block from a prior run, update that block only.
2. Otherwise append a short generated snippet immediately below the directive line.
3. Keep snippets minimal and runnable.
4. Prefer explicit `pkg::fn` usage or explicit `library()` calls.

Failure behavior:
1. If no good match exists, insert a short TODO marker below the directive (do not delete the directive).
2. If multiple packages are plausible, choose the highest-ranked ecosystem result and note the alternative in a one-line comment.

Response/reporting requirements:
- `Ecosystem packages used: ...`
- `Functions used: ...`
- `Fallback needed: yes/no`
