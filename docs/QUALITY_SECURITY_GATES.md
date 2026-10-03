# Quality / security gates

## Dependency Review

Pull requests run the standalone `Dependency Review / dependency-review` check. It uses GitHub's Dependency Review Action with read-only repository contents permission and fails when a PR introduces a dependency vulnerability with severity `high` or `critical`.

The check stays independent from `npm run check`, Browser Quality, R2 UI Preview, and every R1 provider/recovery workflow. It must not receive provider credentials or financial/runtime payloads.

## CodeQL

For this public JavaScript/TypeScript repository the preferred code-scanning mode is GitHub-managed **CodeQL Default Setup**. Do not add a custom/Advanced CodeQL workflow while Default Setup is sufficient.

Default Setup is a repository-provider setting, not a repository workflow file. Its current enablement and first successful JavaScript/TypeScript analysis must be verified from GitHub's code-scanning configuration/evidence before it is treated as an active gate. If that provider setting cannot be read or changed with the currently authorized administration surface, the result is `BLOCKED/REASSESS`; do not silently substitute Advanced Setup.

CodeQL Default Setup is not a required PR-check candidate until GitHub exposes a stable check contract that is actually observed on this repository.
