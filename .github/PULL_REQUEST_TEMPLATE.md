<!--
Thanks for the PR. Please fill in the sections below so reviewers have
context. The lists at the bottom are short on purpose — anything you
can tick saves a review round-trip.
-->

## Summary

<!-- One paragraph: what changes, why now. Link a relevant tc39/* issue if
the change is in response to upstream spec evolution. -->

## Type of change

<!-- Delete the ones that don't apply. -->

- New tool / new schema field (MINOR bump)
- Bug fix (PATCH bump)
- Internal refactor / docs / tests (PATCH bump)
- Tool removed / schema change that breaks callers (MAJOR bump — see CONTRIBUTING)
- New ECMA-262 / ECMA-402 edition support

## Contract check

The tool surface stays narrow. Tick what's still true with this PR.

- [ ] Read-only (no tool mutates anything)
- [ ] No execution (no `eval`, no spawning user-supplied code)
- [ ] No auth (no tokens, headers, or login flows added)
- [ ] No writes (no filesystem writes outside `build/.tmp`)
- [ ] No subprocess fallbacks for hosted-incompatible code paths

If you ticked anything off, please describe in the Summary why the
deviation is necessary.

## Verification

- [ ] `npm test` passes
- [ ] `npm run typecheck` clean
- [ ] If touching the Worker: `cd worker && npm test && npm run typecheck`
- [ ] If touching docs: `npm run docs:build` succeeds
- [ ] If adding a tool: a `docs/tools.md` section + a `clause.test.ts`-style unit test

## Other notes

<!-- Anything else reviewers should know. Caveats, follow-ups deferred,
benchmarks, before/after numbers, etc. -->
