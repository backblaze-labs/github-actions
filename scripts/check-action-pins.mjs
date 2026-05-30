#!/usr/bin/env node
/**
 * Enforce Backblaze's workflow action-pinning convention:
 *
 *   1. Remote `uses:` refs must be pinned to a full 40-character commit SHA.
 *   2. SHA-pinned refs must include a same-line exact version comment such as
 *      `# v6.0.2`, so reviewers and Dependabot can track the human version.
 *
 * With `--fix`, exact semver refs such as `actions/checkout@v6.0.2` are
 * resolved through the GitHub API and rewritten as
 * `actions/checkout@<sha> # v6.0.2`.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'

const FULL_SHA = /^[0-9a-f]{40}$/
const EXACT_VERSION = /\bv\d+\.\d+\.\d+\b/
const EXACT_VERSION_REF = /^v\d+\.\d+\.\d+$/
const DEFAULT_SCAN_DIRS = ['.github/workflows', '.github/actions', 'actions']
const DEFAULT_SCAN_FILES = ['action.yml', 'action.yaml']

function usage() {
  console.error(`Usage: check-action-pins [--root <path>] [--scan-dir <path>]... [--fix]

Options:
  --root <path>      Repository root to scan. Defaults to the current directory.
  --scan-dir <path>  Relative directory to scan. May be repeated.
  --fix              Rewrite exact semver refs (vX.Y.Z) to full SHA pins.
  --help             Show this help.
`)
}

function parseArgs(argv) {
  let root = process.cwd()
  let fix = false
  const scanDirs = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    if (arg === '--fix') {
      fix = true
      continue
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
  return { fix, root: resolve(root), scanDirs: scanDirs.length > 0 ? scanDirs : DEFAULT_SCAN_DIRS }
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

function collectScanTargets(root, scanDirs) {
  const targets = []
  for (const rel of scanDirs) {
    targets.push(...collectYaml(join(root, rel)))
  }
  for (const rel of DEFAULT_SCAN_FILES) {
    const file = join(root, rel)
    if (existsSync(file) && statSync(file).isFile()) {
      targets.push(file)
    }
  }
  return [...new Set(targets)]
}

function inlineCommentIndex(line) {
  let quote = null
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if ((char === '"' || char === "'") && line[i - 1] !== '\\') {
      quote = quote === char ? null : quote || char
    }
    if (char === '#' && quote === null) {
      return i
    }
  }
  return -1
}

function stripInlineComment(line) {
  const index = inlineCommentIndex(line)
  return index === -1 ? line : line.slice(0, index)
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

function actionRepoFromRef(ref) {
  const target = ref.slice(0, ref.lastIndexOf('@'))
  const [owner, repo] = target.split('/')
  if (!owner || !repo) return null
  return { owner, repo }
}

function versionComment(line, version) {
  const index = inlineCommentIndex(line)
  const code = index === -1 ? line : line.slice(0, index)
  return `${code.trimEnd()} # ${version}`
}

const shaCache = new Map()

async function resolveRefToSha({ owner, repo, version }) {
  const key = `${owner}/${repo}@${version}`
  if (shaCache.has(key)) return shaCache.get(key)

  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'backblaze-github-actions-check-action-pins',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`

  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${version}`
  const response = await fetch(url, { headers })
  if (!response.ok) {
    throw new Error(`failed to resolve ${key}: GitHub API returned ${response.status}`)
  }
  const payload = await response.json()
  if (!FULL_SHA.test(payload.sha)) {
    throw new Error(`failed to resolve ${key}: response did not include a full commit SHA`)
  }
  shaCache.set(key, payload.sha)
  return payload.sha
}

async function analyzeLine({ line, where, fix }) {
  const ref = usesRefFromLine(line)
  if (ref === null || shouldSkip(ref)) {
    return { line, violation: null, fix: null }
  }

  const pin = ref.slice(ref.lastIndexOf('@') + 1)

  if (FULL_SHA.test(pin)) {
    const hash = inlineCommentIndex(line)
    const comment = hash === -1 ? '' : line.slice(hash + 1)
    if (EXACT_VERSION.test(comment)) {
      return { line, violation: null, fix: null }
    }
    return {
      line,
      violation: {
        where,
        ref,
        reason: 'missing exact-version comment (expected `# vX.Y.Z`)',
      },
      fix: null,
    }
  }

  if (!fix || !EXACT_VERSION_REF.test(pin)) {
    const suffix = fix ? '; only exact refs like vX.Y.Z can be auto-fixed' : ''
    return {
      line,
      violation: {
        where,
        ref,
        reason: `ref "${pin}" is not a full 40-character commit SHA${suffix}`,
      },
      fix: null,
    }
  }

  const repo = actionRepoFromRef(ref)
  if (repo === null) {
    return {
      line,
      violation: {
        where,
        ref,
        reason: 'could not determine GitHub owner/repo for auto-fix',
      },
      fix: null,
    }
  }

  const sha = await resolveRefToSha({ ...repo, version: pin })
  const fixedRef = `${ref.slice(0, ref.lastIndexOf('@') + 1)}${sha}`
  const fixedLine = versionComment(line.replace(ref, fixedRef), pin)

  return {
    line: fixedLine,
    violation: null,
    fix: `${where}  ${ref} -> ${fixedRef} # ${pin}`,
  }
}

async function analyzeFile({ file, root, fix }) {
  const text = readFileSync(file, 'utf8')
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const nextLines = []
  const violations = []
  const fixes = []

  for (let i = 0; i < lines.length; i += 1) {
    const where = `${relative(root, file)}:${i + 1}`
    const result = await analyzeLine({ line: lines[i], where, fix })
    nextLines.push(result.line)
    if (result.violation) violations.push(result.violation)
    if (result.fix) fixes.push(result.fix)
  }

  const nextText = nextLines.join(newline)
  if (fix && nextText !== text) {
    writeFileSync(file, nextText)
  }

  return { violations, fixes }
}

async function main() {
  const { fix, root, scanDirs } = parseArgs(process.argv.slice(2))
  const violations = []
  const fixes = []

  for (const file of collectScanTargets(root, scanDirs)) {
    const result = await analyzeFile({ file, root, fix })
    violations.push(...result.violations)
    fixes.push(...result.fixes)
  }

  if (fixes.length > 0) {
    console.log('Fixed GitHub Actions pins:')
    for (const fixed of fixes) console.log(`  ${fixed}`)
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

  const mode = fix ? 'fixed or verified' : 'verified'
  console.log(`All scanned GitHub Actions references are ${mode} as SHA pins with exact-version comments.`)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}

