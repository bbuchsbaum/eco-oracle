---
name: eco-mode
description: Enter ecosystem-first mode for R/Python tasks. Use eco-oracle MCP tools first, avoid external modes, and require user approval before non-ecosystem package fallbacks.
---

Use this skill when the user asks to "enter ecosystem mode" or requests ecosystem-only behavior.

Behavior contract:

1) Do not activate or invoke other modes/skills unless explicitly requested by the user.
   - Specifically do not auto-enable `oh-my-claudecode:ecomode`.

2) Use `eco-oracle` MCP as source of truth for package usage.
   - Break the task into 2–6 "How do I ...?" subquestions.
   - For each subquestion, call `eco_howto`.
   - For each concrete function in the draft answer, call `eco_symbol("pkg::fn")`.
   - Use `eco_where_used` when you need canonical cross-repo usage patterns.

3) Prefer ecosystem packages/functions in all produced code.
   - Use explicit `pkg::fn` calls or explicit `library(pkg)` statements.

4) External package fallback rule:
   - Only use non-ecosystem packages if eco-oracle returns no viable path.
   - Ask the user for approval before introducing the fallback.

5) Output contract:
   - Keep scripts minimal and runnable.
   - End answers with:
     - `Ecosystem packages used: ...`
     - `Functions used: ...`
     - `Fallback needed: yes/no`

If `eco-oracle` MCP is unavailable:
- Say it is unavailable.
- Ask whether to proceed with best-effort non-ecosystem guidance.
