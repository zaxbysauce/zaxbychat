---
name: writing-tests
description: >
  Apply when writing tests, modifying test files, fixing test failures, debugging CI failures,
  adding test coverage, creating adversarial tests, or reviewing any file under tests/.
  Also apply when implementing features or fixes that require corresponding test changes.
  Enforces bun:test framework rules, mock isolation, cross-platform compatibility (Linux,
  macOS, Windows), and CI pipeline awareness. Load this skill before touching any test file.
effort: medium
---

# Writing Tests for opencode-swarm

## Framework: bun:test Only

All test files MUST import from `bun:test`