## Summary

<!-- What changed and why? -->

## Type

- [ ] User-facing behavior
- [ ] Capture or instrumentation
- [ ] COMMAND state or Local Injection
- [ ] Build, packaging, or release
- [ ] Documentation
- [ ] Tests only

## UI Change Class

<!-- Follow docs/WORKBENCH_UI_STANDARD.md. Select the highest applicable class. -->

- [ ] Not applicable
- [ ] Non-UI
- [ ] Bounded UI
- [ ] Material UI

## User Or Developer Impact

<!-- Who benefits, and what workflow changes? -->

## Verification

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run test:ui`
- [ ] `npm run test:ui:extension`
- [ ] `npm run build`
- [ ] `npm run fixture:test`
- [ ] Documentation-only review

### Panel browser evidence (when applicable)

- [ ] Accepted UI contract and affected developer journey recorded
- [ ] Changed workflows and user-facing acceptance criteria recorded
- [ ] Scenarios and browser tests recorded
- [ ] Compact and normal viewports recorded
- [ ] Representative Dark and Light themes recorded
- [ ] Relevant expected/actual/diff screenshots inspected
- [ ] Accessibility and keyboard/focus results recorded
- [ ] Independent visual QA outcome recorded
- [ ] Intentional baseline changes include an explanation and inspected artifact

### UI standard exception or amendment

- [ ] No exception
- [ ] Scoped exception records the rule, reason, alternatives, evidence, approver, owner, and revisit trigger
- [ ] Standard and directly affected contracts were amended with explicit maintainer approval

Commands run:

```text
# Record the exact commands used for this change, including browser and baseline commands.
```

## Extension Safety Checklist

- [ ] No secrets, credentials, private URLs, or production payloads are committed.
- [ ] Any off-device analytics, logging, or event upload is explicitly consented, narrowly allowlisted, tested, and documented; inspected-page capture data stays local.
- [ ] New permissions or host-access changes are explained.
- [ ] Local Injected Updates remain clearly marked and local to the inspected page workflow.
- [ ] Persistent storage behavior is unchanged or explicitly documented.
- [ ] Chrome Web Store listing, privacy policy, or release notes are updated if user-facing behavior, permissions, or data handling changed.

## Contribution License

- [ ] I have the right to submit these changes under Apache-2.0.
- [ ] Third-party code, generated assets, screenshots, copied documentation, or sample data are identified with source and license details where applicable.

## Related Issues

<!-- Fixes #123, Refs #123 -->
