# Security Policy

This repository is CI/CD infrastructure. A malicious change here can affect
every repository that consumes its workflows or actions.

## Required Maintenance Practices

- Require CODEOWNER review for changes under `.github/`, `actions/`, and
  `scripts/`.
- Keep all remote `uses:` references pinned to full 40-character commit SHAs.
- Keep same-line exact version comments on pinned actions, for example
  `# v6.0.2`.
- Do not store secrets in this repository.
- Prefer composite actions and shell scripts over bundled dependencies unless a
  stronger abstraction is justified.
- Verify downloaded tool binaries by checksum before execution.

## Reporting Vulnerabilities

Please follow the Backblaze Labs security reporting process for private reports.
Do not disclose CI/CD vulnerabilities in public issues before maintainers have
had time to respond.

