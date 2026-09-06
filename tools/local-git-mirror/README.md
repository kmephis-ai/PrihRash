# Local Git Mirror

Repository-local development fallback for AI/sandbox environments that can use the GitHub Connector and GitHub Actions but cannot reach `github.com` with ordinary Git because DNS/HTTPS egress is blocked.

## Contract

1. Probe direct Git once. If `git ls-remote` works, use normal Git and stop here.
2. Read the repository source ref and exact source SHA from GitHub immediately before bootstrap.
3. Create a unique disposable transport branch from that exact SHA.
4. Instantiate `bootstrap-workflow.yml.template` on that branch by replacing:
   - `__BOOTSTRAP_BRANCH__`
   - `__SOURCE_SHA__`
   - `__SOURCE_BRANCH__`
   - `__ARTIFACT_NAME__`
5. The push that creates the workflow triggers a GitHub-hosted run. Require exact workflow path, branch, transport SHA, `event=push`, `status=completed`, `conclusion=success`.
6. Download the named one-day artifact through the connector.
7. Materialize locally:

```bash
python tools/local-git-mirror/materialize_bundle.py \
  --artifact-zip <artifact.zip> \
  --target <workspace> \
  --source-sha <exact-source-sha> \
  --source-branch <source-branch> \
  --remote-url https://github.com/<owner>/<repo>.git
```

8. Require `HEAD == exact source SHA`, `git fsck --full --no-dangling` PASS, and a clean initial status.
9. Local Git is authoritative only for the materialized snapshot and local edits. If direct push is blocked, publish through authorized GitHub connector APIs and then verify provider-side exact-head CI.

## Security invariants

- Never infer/replace an unknown exact source SHA with `HEAD` or `latest`.
- Never put PAT/OAuth/connector credentials, product secrets, or private data in branch/workflow/artifact/logs.
- Preferred template has `contents: read`, `persist-credentials: false`, pinned Actions, one-day artifact retention.
- Artifact bytes are untrusted until safe ZIP extraction, manifest checks, SHA-256, `git bundle verify`, exact commit/HEAD checks and `git fsck` all pass.
- The transport branch is disposable and must never become canonical.
- The fallback chunk template requires `contents: write`; use it only when the connector cannot download artifact bytes.
- Never weaken protected branches/rulesets or force-update canonical refs to make this work.
