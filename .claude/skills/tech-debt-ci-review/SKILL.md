---
name: tech-debt-ci-review
description: Deep technical debt and CI stability audit for identifying test theater, missing or mis-scoped tests, actual and potential test failures, flaky-test risk, dependency/toolchain brittleness, and structural debt that prevents PRs from going green safely.
disable-model-invocation: true
---

# /tech-debt-ci-review

Run a deep technical debt and CI stability audit of the current repository.

## Mission

Identify every meaningful source of:
- technical debt with real CI impact
- test theater
- missing or mis-scoped tests
- actual and potential test failures
- CI instability
- flaky-test risk
- dependency/build/toolchain brittleness
- verification gaps that prevent the repository from reaching and staying green in pull requests

Do not build features.
Do not do opportunistic cleanup for its own sake.
Do not preserve noisy tests or workflows just because they make dashboards look busy.