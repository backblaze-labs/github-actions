#!/usr/bin/env node
/**
 * Enforce Backblaze's workflow action-pinning convention:
 *
 *   1. Remote `uses:` refs must be pinned to a full 40-character commit SHA.
 *   2. SHA-pinned refs must include a same-line exact version comment such as
 *      `# v6.0.2`, so reviewers and Dependabot can track the human version.
 *
 * The script is intentionally language-agnostic and scans only GitHub Actions
 * workflow/action YAML. It does not inspect project source code.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'

const FULL_SHA = /^[0-9a-f]{40}$/
const EXACT_VERSION = /\bv\d+\.\d+\.\d+\b/
const DEFAULT_SCAN_DIRS = ['.github/workflows', '.github/actions', 'actions']

function usage() {
  console.error(`Usage: check-action-pins [--root <path>] [--scan-dir <path>]...

Options:
  --root <path>      Repository root to scan. Defaults to the current directory.
  --scan-dir <path>  Relative directory to scan. May be repeated.
  --help            Show this help.
`)
}

function parseArgs(argv) {
  let root = process.cwd()
  const scanDirs = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    if (arg === '--root') {
      root = argv[++i]
      if (!root) throw new Error('--root requires a path')
      continue
    }
    if (arg === '--scan-dir') {
      const dir = argv[++i]
      if (!dir) throw new Error('--scan-dir requires a path')
      scanDirs.push(dir)
      continue
    }
    throw new Error(`unknown argument: ${arg}`)
  }
  return { root: resolve(root), scanDirs: scanDirs.length > 0 ? scanDirs : DEFAULT_SCAN_DIRS }
}

function collectYaml(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...collectYaml(full))
    } else if (/\.ya?ml$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function stripInlineComment(line) {
  let quote = null
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if ((char === '"' || char === "'") && line[i - 1] !== '\\') {
      quote = quote === char ? null : quote || char
    }
    if (char === '#' && quote === null) {
      return line.slice(0, i)
    }
  }
  return line
}

function usesRefFromLine(line) {
  const code = stripInlineComment(line)
  const match = code.match(/^\s*-?\s*uses:\s*['"]?([^'"\s]+)/)
  return match ? match[1] : null
}

function shouldSkip(ref) {
  return (
    ref.startsWith('./') ||
    ref.startsWith('../') ||
    ref.startsWith('docker://') ||
    !ref.includes('@')
  )
}

function main() {
  const { root, scanDirs } = parseArgs(process.argv.slice(2))
  const violations = []

  for (const rel of scanDirs) {
    for (const file of collectYaml(join(root, rel))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          const ref = usesRefFromLine(line)
          if (ref === null || shouldSkip(ref)) return

          const pin = ref.slice(ref.lastIndexOf('@') + 1)
          const where = `${relative(root, file)}:${i + 1}`

          if (!FULL_SHA.test(pin)) {
            violations.push({ where, ref, reason: `ref "${pin}" is not a full 40-character commit SHA` })
            return
          }

          const hash = line.indexOf('#')
          const comment = hash === -1 ? '' : line.slice(hash + 1)
          if (!EXACT_VERSION.test(comment)) {
            violations.push({
              where,
              ref,
              reason: 'missing exact-version comment (expected `# vX.Y.Z`)',
            })
          }
        })
    }
  }

  if (violations.length > 0) {
    console.error('Action pinning violation(s):')
    for (const violation of violations) {
      console.error(`  ${violation.where}  ${violation.ref}  ${violation.reason}`)
    }
    console.error('')
    console.error('Each remote action must be pinned to a full commit SHA with an exact-version comment, e.g.:')
    console.error('  uses: actions/checkout@<sha> # v6.0.2')
    console.error('Resolve a tag to its SHA with:')
    console.error('  gh api repos/<owner>/<repo>/commits/<tag> -q .sha')
    process.exit(1)
  }

  console.log('All scanned GitHub Actions references are SHA-pinned with exact-version comments.')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}

