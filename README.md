# xcodebuild

A GitHub Action that wraps `xcrun xcodebuild` to build, archive, and export an Xcode project or workspace. Designed to compose with the rest of the Apple-Actions suite:

- [`Apple-Actions/import-codesign-certs`](https://github.com/Apple-Actions/import-codesign-certs)
- [`Apple-Actions/download-provisioning-profiles`](https://github.com/Apple-Actions/download-provisioning-profiles)
- [`Apple-Actions/upload-testflight-build`](https://github.com/Apple-Actions/upload-testflight-build)

## Usage

### Simulator build (unsigned)

```yaml
- uses: Apple-Actions/xcodebuild@v1
  with:
    workspace: ios/MyApp.xcworkspace
    scheme: MyApp
    sdk: iphonesimulator
    build-number: ${{ github.run_number }}
```

### Device archive + IPA export

```yaml
- id: build
  uses: Apple-Actions/xcodebuild@v1
  with:
    workspace: ios/MyApp.xcworkspace
    scheme: MyApp
    sdk: iphoneos
    action: archive
    archive-path: .build/Archives/MyApp.xcarchive
    export-options-plist: ios/ExportOptions.plist
    build-number: ${{ github.run_number }}
```

### Archive once, export twice (macOS App Store + Developer ID)

`action: export` runs only `xcodebuild -exportArchive` against an existing archive, so one archive can be exported with several methods. `workspace` and `project` aren't needed in this mode.

```yaml
- uses: Apple-Actions/xcodebuild@v1
  with:
    project: App.xcodeproj
    scheme: App
    action: archive
    archive-path: .build/Artifacts/App.xcarchive
    export-options-plist: ExportOptions.plist
    export-path: .build/Artifacts/export
- id: developer-id
  uses: Apple-Actions/xcodebuild@v1
  with:
    scheme: App
    action: export
    archive-path: .build/Artifacts/App.xcarchive
    export-options-plist: ExportOptions-DeveloperID.plist
    export-path: .build/Artifacts/developer-id
# steps.developer-id.outputs.app-path -> .build/Artifacts/developer-id/App.app
```

## Inputs

| Name | Description | Default |
| --- | --- | --- |
| `workspace` | Path to the `.xcworkspace`. Mutually exclusive with `project`. Required unless `action` is `export`. | — |
| `project` | Path to the `.xcodeproj`. Mutually exclusive with `workspace`. Required unless `action` is `export`. | — |
| `scheme` | Scheme to build. **Required.** | — |
| `configuration` | Build configuration. | `Release` |
| `sdk` | SDK to build against (e.g. `iphoneos`, `iphonesimulator`, `macosx`). | — |
| `destination` | Destination specifier, e.g. `generic/platform=iOS`. | — |
| `action` | xcodebuild action: `build`, `archive`, `test`, `build-for-testing`, `clean`, or `export`. `export` only runs `-exportArchive` on an existing `archive-path` and requires `export-options-plist`. | `build` |
| `archive-path` | Output path for the `.xcarchive`. Required when `action` is `archive` or `export`. | — |
| `export-options-plist` | Path to an `ExportOptions.plist`. When set, the archive is exported. | — |
| `export-path` | Export directory for the IPA. | `<result-bundle-dir>/<scheme>.ipa` |
| `derived-data-path` | Derived data directory. | `.build/DerivedData` |
| `result-bundle-path` | Path for the `.xcresult` bundle. | `.build/Artifacts/<scheme>.xcresult` |
| `build-number` | Value passed as `CURRENT_PROJECT_VERSION`. | — |
| `build-settings` | Additional `KEY=VALUE` build settings, one per line. | — |
| `extra-arguments` | Additional arguments passed verbatim to `xcodebuild`. | — |
| `output-formatter` | Command to pipe output through (`xcbeautify`, `xcpretty`, or empty). The default enables xcbeautify's `github-actions` renderer so compile errors/warnings surface as inline PR annotations. | `xcbeautify --renderer github-actions` |
| `log-path` | Path to write the raw xcodebuild log. | `.build/<scheme>.log` |
| `parallelize-targets` | Pass `-parallelizeTargets`. | `true` |
| `show-build-timing-summary` | Pass `-showBuildTimingSummary`. | `true` |
| `disable-automatic-package-resolution` | Pass `-disableAutomaticPackageResolution`. | `true` |
| `zip-result-bundle` | Zip the `.xcresult` bundle next to itself. | `false` |
| `zip-archive` | Zip the `.xcarchive` next to itself. | `false` |
| `working-directory` | Working directory to run `xcodebuild` in. | — |

## Outputs

| Name | Description |
| --- | --- |
| `archive-path` | Resolved `.xcarchive` path, if any. |
| `export-path` | Resolved directory containing the exported IPA, if any. |
| `ipa-path` | First `.ipa` found inside `export-path`, if any. |
| `app-path` | First `.app` found inside `export-path`, if any (e.g. Developer ID). |
| `pkg-path` | First `.pkg` found inside `export-path`, if any (e.g. Mac App Store). |
| `result-bundle-path` | Resolved `.xcresult` path. Not set when `action` is `export`. |
| `log-path` | Resolved raw log path. |

## Requirements

- A macOS runner with Xcode installed (e.g. `runs-on: macos-14` or newer).
- The chosen `output-formatter` must be on `PATH`. `xcbeautify` is pre-installed on GitHub-hosted macOS runners; install it with `brew install xcbeautify` elsewhere, or set `output-formatter: ''` to disable.

## Development

```sh
yarn install
yarn build   # bundles dist/index.js via @vercel/ncc
```

The bundled `dist/` directory is committed so the action can be consumed without a build step, matching the Apple-Actions convention.

## License

MIT
