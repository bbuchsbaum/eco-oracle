# AGENTS.md - Agent Workflow Instructions

## Issue Tracking with Beads

This project uses **beads** (`br`) for git-backed issue tracking.

### Essential Commands

| Command | Purpose |
|---------|---------|
| `br ready` | List tasks without blockers (your next work) |
| `br create "title" -p 1` | Create task (P0=critical, P1=high, P2=medium, P3=low) |
| `br show <id>` | View issue details and history |
| `br update <id> --status in_progress` | Mark task as in progress |
| `br close <id> --reason "text"` | Close completed task |
| `br dep add <child> <parent>` | Add dependency |
| `br list --json` | List all open issues |
| `br sync --flush-only` | Force sync to git |

### Critical Rules for Agents

1. **NEVER use `br edit`** - it opens an interactive editor. Use flag-based updates:
   ```bash
   br update <id> --description "new description"
   br update <id> --title "new title"
   ```

2. **Always use `--json` flag** for programmatic access

3. **Run `br sync --flush-only` after changes** to ensure immediate git sync

### Landing the Plane Protocol

When ending a work session, you MUST complete these steps in order:

1. **File remaining work** as new issues for anything not completed
2. **Run quality gates** (tests, linting, builds as appropriate)
3. **Update issue statuses** - close completed, update in-progress
4. **Sync and push**:
   ```bash
   br sync --flush-only
   git pull --rebase
   git push
   ```
5. **Verify clean state**: `git status` shows nothing pending
6. **Provide handoff context** for next session

**Work is NOT complete until `git push` succeeds.**

### Finding Work

```bash
br ready --json          # Tasks without blockers
br list --status open    # All open tasks
br stale --days 7        # Neglected tasks
```

---

## EcoOracle — Ecosystem Knowledge

This is the **eco-oracle** repo. Before searching code across ecosystem package repos or writing exploratory scripts, query the oracle.

### Golden rule
Use MCP tools first. Only read source files or run experiments if retrieval fails.

### Workflow
1. Break the user goal into 2–6 "How do I …?" subquestions.
2. `eco_howto(query)` for each subquestion.
3. `eco_symbol("pkg::fn")` for any function you need to understand.
4. Stitch returned `recipe` snippets into a single script.
5. Only fall back to file search / experiments if oracle returns nothing relevant.

### Output expectations
- Short, reproducible scripts.
- Explicit `library()` calls or `pkg::fn` namespacing.
- Short comment header listing ecosystem functions used.

### Enter Ecosystem Mode (shared command phrase)

If the user says `enter ecosystem mode`, enforce this policy:

1. Do not activate or invoke other modes/skills unless explicitly requested by the user.
   - Do not auto-enable `oh-my-claudecode:ecomode`.
2. Use `eco-oracle` MCP as source of truth.
3. Break tasks into 2–6 "How do I ...?" subquestions and run `eco_howto` for each.
4. Run `eco_symbol("pkg::fn")` for concrete functions used in the final script.
5. Only use non-ecosystem packages if retrieval has no viable path, and ask user approval first.
6. End answers with:
   - `Ecosystem packages used: ...`
   - `Functions used: ...`
   - `Fallback needed: yes/no`
