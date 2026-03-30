# Semi-Stable Release Checklist

Use this checklist before calling a `master` snapshot a preview / semi-stable release for user testing.

This is the short operator checklist. Surface-specific runbooks still live in their existing docs.

## 1. Confirm the target snapshot

- Start from current `origin/master`.
- Verify no required PR is still open for the release scope.
- Record the target commit hash in the release note or handoff doc.
- Confirm the live workitem registry has no active locks that still belong to the release scope:
  - `python3 scripts/workitem_lock.py status`

## 2. Refresh user-facing and developer-facing docs

- Update `README.md` if setup, product capabilities, or install/download guidance changed.
- Update `docs/CODEBASE_ORGANIZATION.md` if code ownership or surface layout changed.
- Update `docs/IMPLEMENTATION_STATUS.md` with the new validation snapshot and remaining blockers.
- Refresh `docs/VNEXT_TEST_BUNDLE.md` or the current operator handoff doc with the new commit and artifact paths.
- Refresh surface-specific docs when relevant:
  - `docs/ANDROID_RELEASE_QA_MATRIX.md`
  - `docs/VELVET_VALIDATION_MATRIX.md`
  - `docs/PDF_OCR_CARD_SMOKE.md`
- Confirm forward-looking plan docs are aligned:
  - the canonical root `PLAN.md` should exist on the release branch
  - superseded forward-looking docs should not compete with it

## 3. Run the validation gates

Run the baseline gates:

```bash
make test-api
./scripts/ci_smoke_matrix.sh
./scripts/pwa_release_gate.sh
```

Run cross-surface validation when web/mobile/helper UI or capture flows changed:

```bash
./scripts/cross_surface_proof_bundle.sh
```

Add the environment flags required for:

- PWA cross-surface proof
- Android connected-phone smoke and screenshots
- Windows helper host probes and screenshots

Run additional targeted checks when the touched scope requires them:

- Mobile installable build:
  - `cd apps/mobile/android && ./gradlew assembleRelease`
- Desktop helper smoke:
  - `./node_modules/.bin/playwright test tools/desktop-helper/tests/helper.spec.ts`
- PDF/OCR ingest smoke:
  - follow `docs/PDF_OCR_CARD_SMOKE.md`

## 4. Produce release artifacts

- Use the single release driver to refresh the bundle, sync docs, and publish checksums:
  - `python3 scripts/release_handoff.py`
- Hosted PWA URL verified and reachable.
- Android APK generated from the target commit if mobile changed.
- Desktop helper package/generated binary refreshed if desktop helper changed.
- Validation bundle path recorded under `artifacts/`.
- Preferred unified proof path: `artifacts/cross-surface-proof/<timestamp>/`
- SHA-256 or equivalent checksum recorded for downloadable binaries.

## 5. Check the evidence bundle

- Confirm screenshots show the real target UI, not launcher/error states.
- Confirm logs and run summaries are stored alongside screenshots.
- Mark superseded or invalid evidence bundles explicitly so later passes do not reuse them by mistake.

## 6. Record blockers and open follow-up work

- List anything not rerun in this pass.
- List anything that passed only partially.
- Convert every remaining release blocker into a pending workitem in:
  - `docs/CODEX_PARALLEL_WORK_ITEMS.md`
  - `$(git rev-parse --git-common-dir)/codex-workitems/workitems.json`

## 7. Final release call

Call the build semi-stable only if all of the following are true:

- PWA release gate passed on the target commit.
- Current UI proof exists for the changed surfaces.
- Download/install artifacts exist for any surface you expect the user to install directly.
- Docs point to the current commit, current artifact paths, and current runbooks.
- Remaining blockers are explicitly documented and acceptable for the intended feedback pass.
