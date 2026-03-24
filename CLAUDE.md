# CLAUDE.md

## Issue Tracking

This project uses **beads** (`br`) for issue tracking. See AGENTS.md for full workflow.

```bash
br list                   # List open issues
br create "title" -p 1    # Create issue (P0-P3 priority)
br show br-xxx            # View issue details
br close br-xxx           # Close issue
br sync --flush-only      # Sync to git
```

## Session Management

When ending a work session, always "land the plane":

1. File issues for remaining work
2. Run quality gates
3. Update issue status
4. `br sync --flush-only && git push`
5. Provide handoff context for next session

## EcoOracle — Ecosystem Knowledge

Use oracle MCP tools first for any ecosystem task. Avoid repo-wide search unless retrieval fails.

- `eco_howto(query)` — How do I …? → microcards with recipes
- `eco_symbol("pkg::fn")` — compact API card
- `eco_packages()` — list all ecosystem packages
- Assemble a script from returned recipes; only then read files.

## Enter Ecosystem Mode (prompt contract)

When the user says `enter ecosystem mode`, enforce:

1. Do not activate or invoke other modes/skills unless explicitly requested.
   - Do not auto-enable `oh-my-claudecode:ecomode`.
2. Use `eco-oracle` MCP as source of truth.
3. Decompose into 2–6 "How do I ...?" subquestions and call `eco_howto` for each.
4. Call `eco_symbol("pkg::fn")` for each function you plan to use.
5. Use ecosystem packages only unless no viable result exists; ask for approval before any external fallback.
6. End answers with:
   - `Ecosystem packages used: ...`
   - `Functions used: ...`
   - `Fallback needed: yes/no`
