import {existsSync, readdirSync} from 'node:fs'
import {join, resolve} from 'node:path'

export function shellQuote(s: string): string {
  if (s === '') return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

export function tokenize(input: string): string[] {
  const out: string[] = []
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(input)) !== null) {
    if (m[1] !== undefined) out.push(m[1].replace(/\\(.)/g, '$1'))
    else if (m[2] !== undefined) out.push(m[2])
    else if (m[3] !== undefined) out.push(m[3])
  }
  return out
}

export function validateInputs(opts: {
  workspace: string
  project: string
  xcAction: string
  archivePath: string
  exportOptionsPlist: string
  cwd: string
}): void {
  const {workspace, project, xcAction, archivePath, exportOptionsPlist, cwd} =
    opts
  const exportOnly = xcAction === 'export'

  if (!exportOnly && !workspace && !project) {
    throw new Error('Either `workspace` or `project` must be provided.')
  }
  if (workspace && project) {
    throw new Error('`workspace` and `project` are mutually exclusive.')
  }
  if ((xcAction === 'archive' || exportOnly) && !archivePath) {
    throw new Error(
      `\`archive-path\` is required when \`action\` is \`${xcAction}\`.`
    )
  }
  if (exportOnly && !exportOptionsPlist) {
    throw new Error(
      '`export-options-plist` is required when `action` is `export`.'
    )
  }
  if (exportOptionsPlist && !archivePath) {
    throw new Error(
      '`archive-path` is required when `export-options-plist` is provided.'
    )
  }
  if (exportOnly && !existsSync(resolve(cwd, archivePath))) {
    throw new Error(`Archive not found: ${archivePath}`)
  }
}

export function buildXcodebuildArgs(opts: {
  workspace: string
  project: string
  scheme: string
  configuration: string
  sdk: string
  destination: string
  parallelizeTargets: boolean
  showTimingSummary: boolean
  disableAutoPackageResolution: boolean
  derivedDataPath: string
  resultBundlePath: string
  archivePath: string
  buildNumber: string
  buildSettings: string
  extraArguments: string
  action: string
}): string[] {
  const args: string[] = []
  if (opts.workspace) args.push('-workspace', opts.workspace)
  if (opts.project) args.push('-project', opts.project)
  args.push('-scheme', opts.scheme)
  args.push('-configuration', opts.configuration)
  if (opts.sdk) args.push('-sdk', opts.sdk)
  if (opts.destination) args.push('-destination', opts.destination)
  if (opts.parallelizeTargets) args.push('-parallelizeTargets')
  if (opts.showTimingSummary) args.push('-showBuildTimingSummary')
  if (opts.disableAutoPackageResolution)
    args.push('-disableAutomaticPackageResolution')
  args.push('-derivedDataPath', opts.derivedDataPath)
  args.push('-resultBundlePath', opts.resultBundlePath)
  if (opts.archivePath) args.push('-archivePath', opts.archivePath)

  if (opts.buildNumber) {
    args.push(`CURRENT_PROJECT_VERSION=${opts.buildNumber}`)
  }
  if (opts.buildSettings) {
    for (const line of opts.buildSettings.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed) args.push(trimmed)
    }
  }
  if (opts.extraArguments) {
    args.push(...tokenize(opts.extraArguments))
  }

  args.push(opts.action)
  return args
}

export function findExportArtifacts(
  exportPath: string,
  cwd: string = process.cwd()
): {
  ipaPath: string
  appPath: string
  pkgPath: string
} {
  try {
    const entries = readdirSync(resolve(cwd, exportPath))
    const find = (ext: string): string => {
      const match = entries.find(f => f.toLowerCase().endsWith(ext))
      return match ? join(exportPath, match) : ''
    }
    return {
      ipaPath: find('.ipa'),
      appPath: find('.app'),
      pkgPath: find('.pkg')
    }
  } catch {
    return {ipaPath: '', appPath: '', pkgPath: ''}
  }
}

export function buildPipeline(
  args: string[],
  formatter: string,
  logPath: string,
  appendLog: boolean
): string {
  const quoted = ['xcrun', 'xcodebuild', ...args].map(shellQuote).join(' ')
  const tee = appendLog
    ? `tee -a ${shellQuote(logPath)}`
    : `tee ${shellQuote(logPath)}`
  return formatter
    ? `set -o pipefail; ${quoted} | ${tee} | ${formatter}`
    : `set -o pipefail; ${quoted} | ${tee}`
}
