#!/usr/bin/env node
/**
 * Format GitHub Actions workflow/action YAML in a caller repository.
 *
 * This script uses Prettier when available as a dependency of this package or
 * the caller repository. Passing `--use-npx` lets it fall back to
 * `npx --yes prettier@<pinned-version>`.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const PRETTIER_VERSION = '3.6.2'
const DEFAULT_SCAN_DIRS = ['.github/workflows', '.github/actions', 'actions']
const DEFAULT_SCAN_FILES = ['action.yml', 'action.yaml']

function usage() {
  console.error(`Usage: format-workflows [--root <path>] [--scan-dir <path>]... [--write|--check] [--use-npx]

Options:
  --root <path>      Repository root to format. Defaults to the current directory.
  --scan-dir <path>  Relative directory to scan. May be repeated.
  --write            Rewrite files in place. This is the default.
  --check            Report files that are not formatted, without changing them.
  --use-npx          If Prettier is not installed, run pinned prettier through npx.
  --help             Show this help.
`)
}

function parseArgs(argv) {
  let root = process.cwd()
  let write = true
  let useNpx = false
  const scanDirs = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') {
      usage()
      process.exit(0)
    }
    if (arg === '--check') {
      write = false
      continue
    }
    if (arg === '--write') {
      write = true
      continue
    }
    if (arg === '--use-npx') {
      useNpx = true
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
  return { root: resolve(root), scanDirs: scanDirs.length > 0 ? scanDirs : DEFAULT_SCAN_DIRS, useNpx, write }
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

async function loadPrettier({ useNpx, root, files, write }) {
  try {
    return await import('prettier')
  } catch {
    // Keep going below.
  }

  try {
    const { createRequire } = await import('node:module')
    const requireFromRoot = createRequire(join(root, 'package.json'))
    const prettierPath = requireFromRoot.resolve('prettier')
    return await import(prettierPath)
  } catch {
    // Keep going below.
  }

  if (!useNpx) {
    throw new Error(
      `Prettier is not installed. Install prettier in this repo, run this script from the github-actions package, or pass --use-npx to run prettier@${PRETTIER_VERSION}.`,
    )
  }

  const mode = write ? '--write' : '--check'
  const result = spawnSync('npx', ['--yes', `prettier@${PRETTIER_VERSION}`, mode, ...files], {
    cwd: root,
    stdio: 'inherit',
  })
  process.exit(result.status ?? 1)
}

async function main() {
  const { root, scanDirs, useNpx, write } = parseArgs(process.argv.slice(2))
  const files = collectScanTargets(root, scanDirs)
  if (files.length === 0) {
    console.log('No GitHub Actions workflow/action YAML files found.')
    return
  }

  const prettier = await loadPrettier({ files, root, useNpx, write })
  const changed = []

  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const config = (await prettier.resolveConfig(file)) ?? {}
    const formatted = await prettier.format(source, { ...config, filepath: file })
    if (formatted !== source) {
      changed.push(relative(root, file))
      if (write) writeFileSync(file, formatted)
    }
  }

  if (changed.length === 0) {
    console.log('All GitHub Actions workflow/action YAML files are formatted.')
    return
  }

  if (write) {
    console.log('Formatted GitHub Actions workflow/action YAML:')
    for (const file of changed) console.log(`  ${file}`)
    return
  }

  console.error('GitHub Actions workflow/action YAML needs formatting:')
  for (const file of changed) console.error(`  ${file}`)
  process.exit(1)
}

try {
  await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(2)
}

