---
name: swarm
description: Enable a high-quality swarm-like Claude Code workflow for the current session, and optionally execute a task immediately using that mode. Uses parallel subagents for breadth, independent reviewer validation for precision, and critic challenge for final confidence. Use when the user wants swarm-like behavior, higher review rigor, or maximum quality without sacrificing Claude Code speed.
disable-model-invocation: true
argument-hint: "[optional task]"
---

# /swarm

Enable swarm mode for the current session.
If arguments are provided, enable swarm mode first and then execute that task using the swarm-like implementation workflow.

Argument handling:
- If no arguments are provided: only enable swarm mode.
- If the first word of `$ARGUMENTS` is a **known plugin subcommand** (see list below): do NOT treat it as a swarm task. Instead, tell the user to run it as a slash command directly (e.g., `/swarm close`, `/swarm handoff`). These are OpenCode plugin commands handled by the swarm plugin's command system, not tasks for the swarm workflow. Do NOT try to interpret or execute them yourself.
- Otherwise: enable swarm mode, then treat `$ARGUMENTS` as the task to execute immediately.

Known plugin subcommands (do NOT interpret these as tasks):
<!-- Keep in sync with COMMAND_REGISTRY in src/commands/registry.ts -->
`status`, `plan`, `agents`, `history`, `config`, `evidence`, `handoff`, `archive`, `diagnose`, `preflight`, `sync-plan`, `benchmark`, `export`, `reset`, `rollback`, `retrieve`, `clarify`, `analyze`, `specify`, `brainstorm`, `qa-gates`, `dark-matter`, `knowledge`, `curate`, `turbo`, `full-auto`, `write-retro`, `reset-session`, `simulate`, `promote`, `checkpoint`, `close`

Examples:
- `/swarm` — enable swarm mode only
- `/swarm implement OAuth login without breaking existing session handling` — enable swarm mode, then execute the task
- `/swarm fix the failing auth refresh tests and verify the session flow` — enable swarm mode, then execute the task
- `/swarm close` — this is a plugin subcommand; tell the user it will be handled by the plugin command system
- `/swarm handoff` — this is a plugin subcommand; tell the user it will be handled by the plugin command system

## Goal
Turn Claude Code into a swarm-like orchestrator while preserving Claude Code speed advantages.

## What this mode changes
When enabled, Claude should:
- use parallel subagents aggressively for disjoint exploration, codebase mapping, and specialist review
- separate candidate generation from validation
- use independent reviewer and critic contexts that are explicitly skeptical and suspicious
- avoid letting implementation and verification happen in the same context when verification quality would benefit from separation
- keep quality as the only metric that matters
- treat time pressure as nonexistent
- preserve normal Claude Code strengths: parallel subagents, scoped exploration, and fast synthesis
- protect speed by spending the deepest validation effort only where it materially reduces ship risk

## Quality and speed policy
Code quality and pre-ship defect detection are paramount.
Speed still matters.
The point of swarm mode is not to recreate slow serial swarm behavior inside Claude Code.
The point is to keep Claude Code fast by parallelizing everything that can safely be parallelized while preserving a strict validation architecture.

That means:
- parallelize breadth aggressively
- validate in depth selectively based on risk
- avoid running the heaviest critic loop on every low-value issue
- spend the most time on correctness, security, edge cases, regressions, and claimed-vs-actual mismatches
- keep low-risk nits cheap

If a workflow step does not materially improve quality, correctness, or trust, keep it lightweight or skip it.
If a workflow step prevents real bugs from shipping, keep it even if it costs time.