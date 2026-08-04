# No-Repeat Notifications and Main Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent notifications for historical responses loaded when reopening a conversation, then make `main` the canonical branch containing the complete current extension.

**Architecture:** The detector will only arm response-completion tracking from explicit local submission signals or a visible generation control. DOM hydration alone must remain passive. The completed extension history will be merged forward into `main` without rewriting history.

**Tech Stack:** Chrome Manifest V3, JavaScript, Node.js built-in test runner, GitHub pull requests.

## Global Constraints

- Keep the current extension behavior for genuine locally submitted prompts.
- Add no dependencies.
- Preserve the existing notification, sound, and tab-marker behavior.
- Use `main` as the canonical up-to-date branch after validation.

---

### Task 1: Reproduce historical hydration notification

**Files:**
- Create: `tests/detector-core.test.js`
- Modify: `detector-core.js`

**Interfaces:**
- Consumes: `createDetector({ stableMs, fallbackStableMs })`
- Produces: detector behavior that requires explicit submission state before assistant hydration can complete.

- [ ] Write a test that initializes an empty route, hydrates historical user and assistant nodes, waits past the stable threshold, and asserts no `response_complete` event.
- [ ] Run `node --test tests/detector-core.test.js` and verify the test fails on the old detector.
- [ ] Remove message-count inference as a submission signal and gate assistant-node start signals behind `awaitingResponse`.
- [ ] Add a positive test proving `markUserSubmitted()` still produces one completion event.
- [ ] Run `node --test tests/*.test.js` and all JavaScript syntax checks.

### Task 2: Promote the complete extension to main

**Files:**
- Merge all current extension files and Task 1 changes into `main` through a pull request.

**Interfaces:**
- Consumes: validated head of `fix/no-repeat-notifications-main`
- Produces: `main` containing the full current extension and regression tests.

- [ ] Compare `main` with the fix branch and verify the fix branch is strictly ahead.
- [ ] Open a pull request targeting `main` with root-cause and validation details.
- [ ] Merge only after the pull request is mergeable.
- [ ] Verify `main` matches the merged head and contains `manifest.json`, runtime files, and tests.
