import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as fs from 'fs'
import * as path from 'path'

async function run(): Promise<void> {
  try {
    const workspace = core.getInput('workspace')
    const project = core.getInput('project')
    const scheme = core.getInput('scheme', { required: true })
    const configuration = core.getInput('configuration') || 'Release'
    const sdk = core.getInput('sdk')
    const destination = core.getInput('destination')
    const xcAction = core.getInput('action') || 'build'
    const archivePathInput = core.getInput('archive-path')
    const exportOptionsPlist = core.getInput('export-options-plist')
    const exportPathInput = core.getInput('export-path')
    const derivedDataPath = core.getInput('derived-data-path') || '.build/DerivedData'
    const resultBundlePathInput = core.getInput('result-bundle-path')
    const buildNumber = core.getInput('build-number')
    const buildSettingsInput = core.getInput('build-settings')
    const extraArguments = core.getInput('extra-arguments')
    const outputFormatter = core.getInput('output-formatter')
    const logPathInput = core.getInput('log-path')
    const parallelizeTargets = core.getBooleanInput('parallelize-targets')
    const showTimingSummary = core.getBooleanInput('show-build-timing-summary')
    const disableAutoPackageResolution = core.getBooleanInput('disable-automatic-package-resolution')
    const zipResultBundle = core.getBooleanInput('zip-result-bundle')
    const zipArchive = core.getBooleanInput('zip-archive')
    const workingDirectoryInput = core.getInput('working-directory')

    if (!workspace && !project) {
      throw new Error('Either `workspace` or `project` must be provided.')
    }
    if (workspace && project) {
      throw new Error('`workspace` and `project` are mutually exclusive.')
    }
    if (xcAction === 'archive' && !archivePathInput) {
      throw new Error('`archive-path` is required when `action` is `archive`.')
    }
    if (exportOptionsPlist && !archivePathInput) {
      throw new Error('`archive-path` is required when `export-options-plist` is provided.')
    }

    const cwd = workingDirectoryInput
      ? path.resolve(workingDirectoryInput)
      : process.cwd()

    const resultBundlePath =
      resultBundlePathInput || path.join('.build', 'Artifacts', `${scheme}.xcresult`)
    const logPath = logPathInput || path.join('.build', `${scheme}.log`)
    const archivePath = archivePathInput || ''

    const resultBundleAbs = path.resolve(cwd, resultBundlePath)
    if (fs.existsSync(resultBundleAbs)) {
      fs.rmSync(resultBundleAbs, { recursive: true, force: true })
    }
    fs.mkdirSync(path.dirname(resultBundleAbs), { recursive: true })
    fs.mkdirSync(path.dirname(path.resolve(cwd, logPath)), { recursive: true })

    const args: string[] = []
    if (workspace) args.push('-workspace', workspace)
    if (project) args.push('-project', project)
    args.push('-scheme', scheme)
    args.push('-configuration', configuration)
    if (sdk) args.push('-sdk', sdk)
    if (destination) args.push('-destination', destination)
    if (parallelizeTargets) args.push('-parallelizeTargets')
    if (showTimingSummary) args.push('-showBuildTimingSummary')
    if (disableAutoPackageResolution) args.push('-disableAutomaticPackageResolution')
    args.push('-derivedDataPath', derivedDataPath)
    args.push('-resultBundlePath', resultBundlePath)
    if (archivePath) args.push('-archivePath', archivePath)

    if (buildNumber) {
      args.push(`CURRENT_PROJECT_VERSION=${buildNumber}`)
    }
    if (buildSettingsInput) {
      for (const line of buildSettingsInput.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) args.push(trimmed)
      }
    }
    if (extraArguments) {
      args.push(...tokenize(extraArguments))
    }

    args.push(xcAction)

    await runXcodebuild(args, outputFormatter, logPath, cwd, false)

    let exportPath = ''
    let ipaPath = ''
    if (exportOptionsPlist && archivePath) {
      exportPath =
        exportPathInput || path.join(path.dirname(resultBundlePath), `${scheme}.ipa`)
      fs.mkdirSync(path.resolve(cwd, exportPath), { recursive: true })
      const exportArgs = [
        '-exportArchive',
        '-exportOptionsPlist', exportOptionsPlist,
        '-archivePath', archivePath,
        '-exportPath', exportPath,
      ]
      await runXcodebuild(exportArgs, outputFormatter, logPath, cwd, true)

      try {
        const exportAbs = path.resolve(cwd, exportPath)
        const ipa = fs
          .readdirSync(exportAbs)
          .find((f) => f.toLowerCase().endsWith('.ipa'))
        if (ipa) ipaPath = path.join(exportPath, ipa)
      } catch {
        // ignore
      }
    }

    if (zipResultBundle && fs.existsSync(resultBundleAbs)) {
      await ditto(resultBundleAbs, `${resultBundleAbs}.zip`, cwd)
    }
    if (zipArchive && archivePath) {
      const archiveAbs = path.resolve(cwd, archivePath)
      if (fs.existsSync(archiveAbs)) {
        await ditto(archiveAbs, `${archiveAbs}.zip`, cwd)
      }
    }

    core.setOutput('result-bundle-path', resultBundlePath)
    core.setOutput('log-path', logPath)
    if (archivePath) core.setOutput('archive-path', archivePath)
    if (exportPath) core.setOutput('export-path', exportPath)
    if (ipaPath) core.setOutput('ipa-path', ipaPath)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    core.setFailed(message)
  }
}

async function runXcodebuild(
  args: string[],
  formatter: string,
  logPath: string,
  cwd: string,
  appendLog: boolean,
): Promise<void> {
  const quoted = ['xcrun', 'xcodebuild', ...args].map(shellQuote).join(' ')
  const tee = `tee ${appendLog ? '-a' : ''} ${shellQuote(logPath)}`.trim()
  const pipeline = formatter
    ? `set -o pipefail; ${quoted} | ${tee} | ${formatter}`
    : `set -o pipefail; ${quoted} | ${tee}`
  core.info(`Running: ${quoted}`)
  await exec.exec('bash', ['-c', pipeline], { cwd })
}

async function ditto(src: string, dest: string, cwd: string): Promise<void> {
  await exec.exec(
    'ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', src, dest],
    { cwd },
  )
}

function shellQuote(s: string): string {
  if (s === '') return "''"
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

function tokenize(input: string): string[] {
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

run()
