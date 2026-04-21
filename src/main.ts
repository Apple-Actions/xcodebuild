import {
  getBooleanInput,
  getInput,
  info,
  setFailed,
  setOutput
} from '@actions/core'
import {exec} from '@actions/exec'
import {existsSync, mkdirSync, readdirSync, rmSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'

async function run(): Promise<void> {
  try {
    const workspace = getInput('workspace')
    const project = getInput('project')
    const scheme = getInput('scheme', {required: true})
    const configuration = getInput('configuration') || 'Release'
    const sdk = getInput('sdk')
    const destination = getInput('destination')
    const xcAction = getInput('action') || 'build'
    const archivePathInput = getInput('archive-path')
    const exportOptionsPlist = getInput('export-options-plist')
    const exportPathInput = getInput('export-path')
    const derivedDataPath =
      getInput('derived-data-path') || '.build/DerivedData'
    const resultBundlePathInput = getInput('result-bundle-path')
    const buildNumber = getInput('build-number')
    const buildSettingsInput = getInput('build-settings')
    const extraArguments = getInput('extra-arguments')
    const outputFormatter = getInput('output-formatter')
    const logPathInput = getInput('log-path')
    const parallelizeTargets = getBooleanInput('parallelize-targets')
    const showTimingSummary = getBooleanInput('show-build-timing-summary')
    const disableAutoPackageResolution = getBooleanInput(
      'disable-automatic-package-resolution'
    )
    const zipResultBundle = getBooleanInput('zip-result-bundle')
    const zipArchive = getBooleanInput('zip-archive')
    const workingDirectoryInput = getInput('working-directory')

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
      throw new Error(
        '`archive-path` is required when `export-options-plist` is provided.'
      )
    }

    const cwd = workingDirectoryInput
      ? resolve(workingDirectoryInput)
      : process.cwd()

    const resultBundlePath =
      resultBundlePathInput || join('.build', 'Artifacts', `${scheme}.xcresult`)
    const logPath = logPathInput || join('.build', `${scheme}.log`)
    const archivePath = archivePathInput || ''

    const resultBundleAbs = resolve(cwd, resultBundlePath)
    if (existsSync(resultBundleAbs)) {
      rmSync(resultBundleAbs, {recursive: true, force: true})
    }
    mkdirSync(dirname(resultBundleAbs), {recursive: true})
    mkdirSync(dirname(resolve(cwd, logPath)), {recursive: true})

    const args: string[] = []
    if (workspace) args.push('-workspace', workspace)
    if (project) args.push('-project', project)
    args.push('-scheme', scheme)
    args.push('-configuration', configuration)
    if (sdk) args.push('-sdk', sdk)
    if (destination) args.push('-destination', destination)
    if (parallelizeTargets) args.push('-parallelizeTargets')
    if (showTimingSummary) args.push('-showBuildTimingSummary')
    if (disableAutoPackageResolution)
      args.push('-disableAutomaticPackageResolution')
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
        exportPathInput || join(dirname(resultBundlePath), `${scheme}.ipa`)
      mkdirSync(resolve(cwd, exportPath), {recursive: true})
      const exportArgs = [
        '-exportArchive',
        '-exportOptionsPlist',
        exportOptionsPlist,
        '-archivePath',
        archivePath,
        '-exportPath',
        exportPath
      ]
      await runXcodebuild(exportArgs, outputFormatter, logPath, cwd, true)

      try {
        const exportAbs = resolve(cwd, exportPath)
        const ipa = readdirSync(exportAbs).find(f =>
          f.toLowerCase().endsWith('.ipa')
        )
        if (ipa) ipaPath = join(exportPath, ipa)
      } catch {
        // ignore
      }
    }

    if (zipResultBundle && existsSync(resultBundleAbs)) {
      await ditto(resultBundleAbs, `${resultBundleAbs}.zip`, cwd)
    }
    if (zipArchive && archivePath) {
      const archiveAbs = resolve(cwd, archivePath)
      if (existsSync(archiveAbs)) {
        await ditto(archiveAbs, `${archiveAbs}.zip`, cwd)
      }
    }

    setOutput('result-bundle-path', resultBundlePath)
    setOutput('log-path', logPath)
    if (archivePath) setOutput('archive-path', archivePath)
    if (exportPath) setOutput('export-path', exportPath)
    if (ipaPath) setOutput('ipa-path', ipaPath)
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message)
    } else {
      setFailed(`Action failed with error ${error}`)
    }
  }
}

async function runXcodebuild(
  args: string[],
  formatter: string,
  logPath: string,
  cwd: string,
  appendLog: boolean
): Promise<void> {
  const quoted = ['xcrun', 'xcodebuild', ...args].map(shellQuote).join(' ')
  const tee = `tee ${appendLog ? '-a' : ''} ${shellQuote(logPath)}`.trim()
  const pipeline = formatter
    ? `set -o pipefail; ${quoted} | ${tee} | ${formatter}`
    : `set -o pipefail; ${quoted} | ${tee}`
  info(`Running: ${quoted}`)
  await exec('bash', ['-c', pipeline], {cwd})
}

async function ditto(src: string, dest: string, cwd: string): Promise<void> {
  await exec(
    'ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', src, dest],
    {cwd}
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
