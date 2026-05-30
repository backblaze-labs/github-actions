# Backblaze GitHub Actions

Shared, non-Marketplace GitHub Actions automation for Backblaze Labs projects.

This repository is intended to hold small reusable workflows and composite
actions that protect CI/CD workflow files across language ecosystems. It is not
published to npm and does not need to be listed in GitHub Marketplace.

## What Is Included

- `actions/actionlint`: runs a pinned `rhysd/actionlint` binary after verifying
  the extracted executable's SHA-256 on every invocation.
- `actions/check-action-pins`: checks workflow and action YAML files for remote
  `uses:` references that are not pinned to full 40-character commit SHAs with
  same-line exact version comments such as `# v6.0.2`.
- `actions/gha-security`: direct composite action that runs both checks.
- `.github/workflows/gha-security.yml`: reusable workflow for consumer
  repositories. It runs `actionlint`, the Backblaze pin policy, and `zizmor`.

## Recommended Consumer Workflow

Create a tiny workflow in each repository:

```yaml
name: GitHub Actions security

on:
  pull_request:
    paths:
      - ".github/**"
      - "action.yml"
      - "action.yaml"
      - "actions/**"
  push:
    branches: [main]
    paths:
      - ".github/**"
      - "action.yml"
      - "action.yaml"
      - "actions/**"
  workflow_dispatch:

permissions:
  contents: read
  actions: read

jobs:
  gha-security:
    uses: backblaze-labs/github-actions/.github/workflows/gha-security.yml@<full-sha>
```

Use a full commit SHA for `<full-sha>`. If you also enable GitHub's organization
policy requiring full-SHA action pins, this caller workflow will satisfy it.

## Direct Composite Action Usage

If a repository already has a security or lint job and only needs the checks:

```yaml
steps:
  - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
    with:
      persist-credentials: false

  - uses: backblaze-labs/github-actions/actions/gha-security@<full-sha>
```

Individual actions are also available:

```yaml
- uses: backblaze-labs/github-actions/actions/actionlint@<full-sha>
- uses: backblaze-labs/github-actions/actions/check-action-pins@<full-sha>
```

## Repository Access

For private or internal sharing, configure this repository under:

`Settings -> Actions -> General -> Access`

Then allow access from repositories in the Backblaze Labs organization. GitHub
passes a scoped read token to runners so they can download shared private
actions and workflows. Avoid putting secrets or sensitive implementation details
in this repository; consumers may be able to see logs from runs that use it.

For public consumer repositories, this repository should generally be public too.
GitHub reusable workflows from private repositories are not available to public
repositories.

## Versioning

Prefer immutable consumer pins:

```yaml
uses: backblaze-labs/github-actions/.github/workflows/gha-security.yml@<full-sha>
```

Optionally create protected semver tags (`v1.0.0`, `v1`) for human discovery,
but consumers should pin by commit SHA in CI. Dependabot can update same-line
version comments for GitHub Actions pins when configured for the `github-actions`
ecosystem.

## Local Checks

From this repository:

```sh
bash scripts/actionlint.sh
node scripts/check-action-pins.mjs --root .
```

From a consumer repository, after checking out this repository's action:

```sh
node /path/to/github-actions/scripts/check-action-pins.mjs --root /path/to/consumer
```

