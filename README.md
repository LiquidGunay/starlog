# Starlog

Starlog is a single-user, voice-first system for capture, knowledge work, scheduling, and learning
loops.

The product is built around one persistent assistant thread, with the PWA as the main workspace,
the phone as the quick-capture and briefing companion, and the desktop helper as the fastest path
for clipping from laptop workflows.

## What Starlog Does

- captures text, links, files, screenshots, and voice notes into one artifact system
- keeps provenance across raw, normalized, and extracted content
- turns artifacts into summaries, cards, notes, and follow-up actions
- keeps notes, tasks, calendar, review, and briefings in the same system
- supports a synced PWA, an Android-first phone companion, and a desktop helper

## Current Surfaces

### PWA

Use the PWA as the primary workspace for:

- the assistant thread
- artifacts, notes, and search
- tasks, calendar, and review
- longer-form planning and cleanup

Hosted app:

- [https://starlog-web-production.up.railway.app/assistant](https://starlog-web-production.up.railway.app/assistant)

### Mobile companion

Use the phone app for:

- quick capture
- voice-first intake
- alarms
- offline briefing playback
- light triage and review

### Desktop helper

Use the desktop helper for:

- clipping from desktop apps
- clipboard and screenshot intake
- lightweight local companion workflows

## Install And Try

Current preview bundle on this machine:

- bundle root: `/home/ubuntu/starlog_preview_bundle`
- Android APK: `/home/ubuntu/starlog_preview_bundle/android/starlog-preview-0.1.0-preview.rc3-104.apk`
- Linux desktop helper: `/home/ubuntu/starlog_preview_bundle/desktop/starlog-desktop-helper-v0.1.0-x86_64-linux-starlog-desktop-helper_0.1.0_amd64.deb`
- compressed bundle: `/home/ubuntu/starlog-preview-feedback-bundle-20260330.tar.gz`

Release handoff docs:

- [`docs/PREVIEW_FEEDBACK_BUNDLE.md`](docs/PREVIEW_FEEDBACK_BUNDLE.md)
- [`docs/FINAL_PREVIEW_SIGNOFF.md`](docs/FINAL_PREVIEW_SIGNOFF.md)
- [`docs/RELEASE_20260330.md`](docs/RELEASE_20260330.md)

## Sign-In

This deployment is single-user. Use the current operator-provided credential to sign in.

Do not store passphrases, bearer tokens, bridge tokens, API keys, or secret keys in this README.

## Current Release Status

Current preview baseline:

- branch target: `master`
- baseline commit: `f742097`
- Android preview: `0.1.0-preview.rc3 (104)`
- PWA release gate: passed on 2026-03-30
- hosted smoke: passed on 2026-03-30
- physical-phone install and launch proof: passed on 2026-03-30

Release validation references:

- [`docs/ANDROID_RELEASE_QA_MATRIX.md`](docs/ANDROID_RELEASE_QA_MATRIX.md)
- [`docs/PWA_RELEASE_VERIFICATION_GATE.md`](docs/PWA_RELEASE_VERIFICATION_GATE.md)
- [`docs/PWA_HOSTED_SMOKE_CHECKLIST.md`](docs/PWA_HOSTED_SMOKE_CHECKLIST.md)

## Support Docs

- phone setup: [`docs/PHONE_SETUP.md`](docs/PHONE_SETUP.md)
- desktop helper setup: [`docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md`](docs/DESKTOP_HELPER_MAIN_LAPTOP_SETUP.md)
- codebase map: [`docs/CODEBASE_ORGANIZATION.md`](docs/CODEBASE_ORGANIZATION.md)
- repo runbooks and agent instructions: [`AGENTS.md`](AGENTS.md)
