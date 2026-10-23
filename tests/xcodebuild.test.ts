import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {
  buildPipeline,
  buildXcodebuildArgs,
  findExportArtifacts,
  shellQuote,
  tokenize,
  validateInputs
} from '../src/xcodebuild'

describe('shellQuote', () => {
  it('returns alphanumeric and safe charset unchanged', () => {
    expect(shellQuote('abc123')).toBe('abc123')
    expect(shellQuote('foo@bar%+=:,./-')).toBe('foo@bar%+=:,./-')
  })

  it("returns '' for empty string", () => {
    expect(shellQuote('')).toBe("''")
  })

  it('single-quotes strings with spaces and escapes embedded quotes', () => {
    expect(shellQuote('hello world')).toBe("'hello world'")
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })
})

describe('tokenize', () => {
  it('splits unquoted tokens on whitespace', () => {
    expect(tokenize('foo bar  baz')).toEqual(['foo', 'bar', 'baz'])
  })

  it('handles double-quoted strings with escapes', () => {
    expect(tokenize(String.raw`"hello \"world\""`)).toEqual(['hello "world"'])
    expect(tokenize(String.raw`"path\\with\\backslash"`)).toEqual([
      'path\\with\\backslash'
    ])
  })

  it('treats single-quoted content as literal', () => {
    expect(tokenize('\'keep spaces and "quotes"\'')).toEqual([
      'keep spaces and "quotes"'
    ])
  })

  it('tokenizes mixed extra-arguments style input', () => {
    expect(tokenize(`-flag "quoted value" 'single' plain`)).toEqual([
      '-flag',
      'quoted value',
      'single',
      'plain'
    ])
  })
})

describe('validateInputs', () => {
  const base = {
    workspace: '',
    project: '',
    xcAction: 'build',
    archivePath: '',
    exportOptionsPlist: '',
    cwd: process.cwd()
  }

  it('requires workspace or project when not export-only', () => {
    expect(() => validateInputs(base)).toThrow(
      'Either `workspace` or `project` must be provided.'
    )
  })

  it('rejects workspace and project together', () => {
    expect(() =>
      validateInputs({
        ...base,
        workspace: 'App.xcworkspace',
        project: 'App.xcodeproj'
      })
    ).toThrow('`workspace` and `project` are mutually exclusive.')
  })

  it('requires archive-path for archive and export actions', () => {
    expect(() =>
      validateInputs({
        ...base,
        workspace: 'App.xcworkspace',
        xcAction: 'archive'
      })
    ).toThrow('`archive-path` is required when `action` is `archive`.')

    expect(() =>
      validateInputs({
        ...base,
        xcAction: 'export',
        exportOptionsPlist: 'ExportOptions.plist'
      })
    ).toThrow('`archive-path` is required when `action` is `export`.')
  })

  it('requires export-options-plist for export action', () => {
    expect(() =>
      validateInputs({
        ...base,
        xcAction: 'export',
        archivePath: 'App.xcarchive'
      })
    ).toThrow('`export-options-plist` is required when `action` is `export`.')
  })

  it('requires archive-path when export-options-plist is provided', () => {
    expect(() =>
      validateInputs({
        ...base,
        workspace: 'App.xcworkspace',
        exportOptionsPlist: 'ExportOptions.plist'
      })
    ).toThrow(
      '`archive-path` is required when `export-options-plist` is provided.'
    )
  })

  it('errors when export-only archive file is missing', () => {
    expect(() =>
      validateInputs({
        ...base,
        xcAction: 'export',
        archivePath: 'missing.xcarchive',
        exportOptionsPlist: 'ExportOptions.plist',
        cwd: process.cwd()
      })
    ).toThrow('Archive not found: missing.xcarchive')
  })

  it('accepts valid build inputs', () => {
    expect(() =>
      validateInputs({
        ...base,
        workspace: 'App.xcworkspace'
      })
    ).not.toThrow()
  })
})

describe('buildXcodebuildArgs', () => {
  const base = {
    workspace: '',
    project: '',
    scheme: 'App',
    configuration: 'Release',
    sdk: '',
    destination: '',
    parallelizeTargets: false,
    showTimingSummary: false,
    disableAutoPackageResolution: false,
    derivedDataPath: '.build/DerivedData',
    resultBundlePath: '.build/Artifacts/App.xcresult',
    archivePath: '',
    buildNumber: '',
    buildSettings: '',
    extraArguments: '',
    action: 'build'
  }

  it('uses -workspace or -project, not both', () => {
    expect(
      buildXcodebuildArgs({...base, workspace: 'App.xcworkspace'})
    ).toEqual(expect.arrayContaining(['-workspace', 'App.xcworkspace']))
    expect(
      buildXcodebuildArgs({...base, workspace: 'App.xcworkspace'})
    ).not.toContain('-project')

    expect(buildXcodebuildArgs({...base, project: 'App.xcodeproj'})).toEqual(
      expect.arrayContaining(['-project', 'App.xcodeproj'])
    )
    expect(
      buildXcodebuildArgs({...base, project: 'App.xcodeproj'})
    ).not.toContain('-workspace')
  })

  it('includes scheme, configuration, and optional sdk/destination', () => {
    const args = buildXcodebuildArgs({
      ...base,
      workspace: 'App.xcworkspace',
      sdk: 'iphoneos',
      destination: 'generic/platform=iOS'
    })
    expect(args).toEqual(
      expect.arrayContaining([
        '-scheme',
        'App',
        '-configuration',
        'Release',
        '-sdk',
        'iphoneos',
        '-destination',
        'generic/platform=iOS'
      ])
    )
  })

  it('adds flags only when true', () => {
    const off = buildXcodebuildArgs({...base, workspace: 'W'})
    expect(off).not.toContain('-parallelizeTargets')
    expect(off).not.toContain('-showBuildTimingSummary')
    expect(off).not.toContain('-disableAutomaticPackageResolution')

    const on = buildXcodebuildArgs({
      ...base,
      workspace: 'W',
      parallelizeTargets: true,
      showTimingSummary: true,
      disableAutoPackageResolution: true
    })
    expect(on).toContain('-parallelizeTargets')
    expect(on).toContain('-showBuildTimingSummary')
    expect(on).toContain('-disableAutomaticPackageResolution')
  })

  it('includes derivedData, resultBundle, and optional archivePath', () => {
    const args = buildXcodebuildArgs({
      ...base,
      workspace: 'W',
      archivePath: 'App.xcarchive'
    })
    expect(args).toEqual(
      expect.arrayContaining([
        '-derivedDataPath',
        '.build/DerivedData',
        '-resultBundlePath',
        '.build/Artifacts/App.xcresult',
        '-archivePath',
        'App.xcarchive'
      ])
    )
  })

  it('adds CURRENT_PROJECT_VERSION when build number is set', () => {
    const args = buildXcodebuildArgs({
      ...base,
      workspace: 'W',
      buildNumber: '42'
    })
    expect(args).toContain('CURRENT_PROJECT_VERSION=42')
  })

  it('adds one arg per non-empty trimmed build-settings line', () => {
    const args = buildXcodebuildArgs({
      ...base,
      workspace: 'W',
      buildSettings: 'FOO=1\n\n  BAR=2  \n'
    })
    expect(args).toContain('FOO=1')
    expect(args).toContain('BAR=2')
  })

  it('appends tokenized extra-arguments', () => {
    const args = buildXcodebuildArgs({
      ...base,
      workspace: 'W',
      extraArguments: '-quiet "OTHER=1 2"'
    })
    expect(args).toContain('-quiet')
    expect(args).toContain('OTHER=1 2')
  })

  it('puts action as the last element', () => {
    const args = buildXcodebuildArgs({
      ...base,
      workspace: 'W',
      action: 'archive',
      archivePath: 'A.xcarchive',
      extraArguments: '-quiet'
    })
    expect(args.at(-1)).toBe('archive')
  })
})

describe('findExportArtifacts', () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, {recursive: true, force: true})
  })

  it('finds ipa, app, and pkg under export path', () => {
    dir = mkdtempSync(join(tmpdir(), 'xcodebuild-export-'))
    writeFileSync(join(dir, 'App.ipa'), '')
    mkdirSync(join(dir, 'App.app'))
    writeFileSync(join(dir, 'App.pkg'), '')

    expect(findExportArtifacts(dir)).toEqual({
      ipaPath: join(dir, 'App.ipa'),
      appPath: join(dir, 'App.app'),
      pkgPath: join(dir, 'App.pkg')
    })
  })

  it('matches extensions case-insensitively', () => {
    dir = mkdtempSync(join(tmpdir(), 'xcodebuild-export-'))
    writeFileSync(join(dir, 'App.IPA'), '')
    mkdirSync(join(dir, 'App.APP'))

    expect(findExportArtifacts(dir)).toEqual({
      ipaPath: join(dir, 'App.IPA'),
      appPath: join(dir, 'App.APP'),
      pkgPath: ''
    })
  })

  it('returns empty strings for missing types', () => {
    dir = mkdtempSync(join(tmpdir(), 'xcodebuild-export-'))
    writeFileSync(join(dir, 'App.ipa'), '')

    expect(findExportArtifacts(dir)).toEqual({
      ipaPath: join(dir, 'App.ipa'),
      appPath: '',
      pkgPath: ''
    })
  })
})

describe('buildPipeline', () => {
  it('includes formatter when provided', () => {
    const pipeline = buildPipeline(['build'], 'xcbeautify', 'out.log', false)
    expect(pipeline).toBe(
      'set -o pipefail; xcrun xcodebuild build | tee out.log | xcbeautify'
    )
  })

  it('omits trailing formatter when empty', () => {
    const pipeline = buildPipeline(['build'], '', 'out.log', false)
    expect(pipeline).toBe(
      'set -o pipefail; xcrun xcodebuild build | tee out.log'
    )
    expect(pipeline).not.toMatch(/\| $/)
  })

  it('uses tee -a when appendLog is true', () => {
    const pipeline = buildPipeline(['build'], '', 'out.log', true)
    expect(pipeline).toContain('tee -a out.log')
  })
})
