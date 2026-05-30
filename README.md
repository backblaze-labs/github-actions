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
- `actions/gha-security`: the primary composite action. It scans the checked-out
  caller repository with `actionlint`, the Backblaze pin policy, and `zizmor`.

## Recommended Usage

Add one composite-action step to an existing CI/security workflow after checkout:

```yaml
jobs:
  gha-security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          persist-credentials: false

      - uses: backblaze-labs/github-actions/actions/gha-security@<full-sha> # vX.Y.Z
```

The composite action scans the caller repository checkout. By default it covers:

- `.github/workflows/**/*.yml`
- `.github/workflows/**/*.yaml`
- `.github/actions/**/*.yml`
- `.github/actions/**/*.yaml`
- `actions/**/*.yml`
- `actions/**/*.yaml`
- root `action.yml` / `action.yaml`

Use a full commit SHA for `<full-sha>` and an exact version comment for the
release marker that SHA represents.

Individual lower-level actions are available for specialized jobs, but the
preferred interface for consumer repositories is the single composite action:

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
uses: backblaze-labs/github-actions/actions/gha-security@<full-sha> # vX.Y.Z
```

Optionally create protected semver tags (`v1.0.0`, `v1`) for human discovery,
but consumers should pin by commit SHA in CI. Dependabot can update same-line
version comments for GitHub Actions pins when configured for the `github-actions`
ecosystem.

## Local Formatting And Checks

From this repository:

```sh
bash scripts/actionlint.sh
node scripts/check-action-pins.mjs --root .
node scripts/check-action-pins.mjs --root . --fix
pnpm format:actions
```

From a consumer repository with this repository checked out as a sibling:

```sh
node ../github-actions/scripts/format-workflows.mjs --root . --write --use-npx
node ../github-actions/scripts/check-action-pins.mjs --root . --fix
bash ../github-actions/scripts/actionlint.sh
```

The formatter uses Prettier for workflow/action YAML. If Prettier is already
installed in the consumer repo or in this package, it uses that. Otherwise,
`--use-npx` runs pinned `prettier@3.6.2`.

The pin fixer only auto-fixes exact semver refs:

```yaml
- uses: actions/checkout@v6.0.2
```

becomes:

```yaml
- uses: actions/checkout@<full-sha> # v6.0.2
```

Mutable or ambiguous refs such as `@main`, `@master`, or `@v1` still fail and
must be changed by hand to an exact version first.
