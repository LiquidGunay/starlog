# Release Handoff Runbook

Use `scripts/release_handoff.py` as the single entrypoint for a release pass.

## What it does

The command can:

- refresh the preview bundle from staged APK and desktop package inputs
- stage a PWA standalone tarball alongside the installable binaries
- write `checksums.sha256` and a tarball checksum atomically
- sync the release docs into the bundle
- generate a current release handoff markdown snapshot
- create an annotated git tag
- optionally publish a GitHub release when `gh` is available, attaching the APK, desktop helper package, PWA bundle, and bundle metadata

## Recommended command

```bash
STARLOG_RELEASE_TAG=v0.1.0-preview.rc4 \
STARLOG_RELEASE_NAME="Starlog preview rc4" \
STARLOG_RELEASE_APK=/path/to/starlog-preview.apk \
STARLOG_RELEASE_DESKTOP_DEB=/path/to/starlog-desktop-helper.deb \
STARLOG_RELEASE_PWA=/path/to/starlog-pwa-standalone.tar.gz \
python3 scripts/release_handoff.py
```

## Useful inputs

- `STARLOG_RELEASE_BUNDLE_ROOT`: bundle root to refresh
- `STARLOG_RELEASE_TARBALL`: tarball output path
- `STARLOG_RELEASE_DOCS_ROOT`: docs root to read release docs from
- `STARLOG_RELEASE_APK`: APK to stage into `android/`
- `STARLOG_RELEASE_DESKTOP_DEB`: desktop helper `.deb` to stage into `desktop/`
- `STARLOG_RELEASE_PWA`: PWA standalone tarball to stage into `pwa/`
- `STARLOG_RELEASE_RUNBOOK_DOC`: runbook source to copy into the bundle
- `STARLOG_RELEASE_TAG`: git tag to create
- `STARLOG_RELEASE_NAME`: human-readable release name
- `STARLOG_RELEASE_PUBLISH_GITHUB_RELEASE=1`: publish a GitHub release if `gh` is installed

## Safety rules

- The script fails if a requested asset is missing.
- The script fails if the runbook source path does not exist.
- Existing staged assets are not deleted unless `--prune-old-assets` is passed.
- Checksums are written through temporary files and then moved into place.
- The tarball is written separately from the bundle so its checksum can be published too.

## Validation

Run the regression smoke after changes to the release driver:

```bash
python3 scripts/release_handoff_smoke.py
```

## Outputs

- bundle root: `/home/ubuntu/starlog_preview_bundle`
- bundle checksum file: `checksums.sha256`
- tarball checksum: `<tarball>.sha256`
- generated release snapshot: `docs/RELEASE_HANDOFF.md`
- GitHub release assets, when enabled: APK, desktop `.deb`, PWA standalone tarball, bundle tarball, and checksum files
