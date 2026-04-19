#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix="starlog-release-handoff-smoke-") as tmp:
        tmp_root = Path(tmp)
        bundle_root = tmp_root / "bundle"
        tarball_path = tmp_root / "out.tar.gz"
        apk_source = tmp_root / "starlog-preview.apk"
        deb_source = tmp_root / "starlog-desktop-helper.deb"
        pwa_source = tmp_root / "starlog-pwa.tar.gz"
        release_doc = tmp_root / "release-handoff.md"
        runbook_source = tmp_root / "custom-runbook.md"

        apk_source.write_text("fake apk\n", encoding="utf-8")
        deb_source.write_text("fake deb\n", encoding="utf-8")
        pwa_source.write_text("fake pwa\n", encoding="utf-8")
        runbook_source.write_text("# Custom Runbook\n\nOverride sentinel.\n", encoding="utf-8")

        subprocess.run(
            [
                "python3",
                str(repo_root / "scripts" / "release_handoff.py"),
                "--skip-git-tag",
                "--bundle-root",
                str(bundle_root),
                "--tarball",
                str(tarball_path),
                "--apk-source",
                str(apk_source),
                "--desktop-source",
                str(deb_source),
                "--pwa-source",
                str(pwa_source),
                "--release-doc",
                str(release_doc),
                "--runbook-doc",
                str(runbook_source),
            ],
            cwd=repo_root,
            check=True,
        )

        manifest = json.loads((bundle_root / "release-manifest.json").read_text(encoding="utf-8"))
        assert "tarball_sha256" not in manifest
        assert manifest["runbook_doc_source_path"] == str(runbook_source.resolve())
        assert manifest["runbook_doc_path"] == str(bundle_root / "docs" / "RELEASE_HANDOFF_RUNBOOK.md")

        checksums = (bundle_root / "checksums.sha256").read_text(encoding="utf-8").strip().splitlines()
        assert len(checksums) == 3, checksums
        for line in checksums:
            digest, rel = line.split()
            assert sha256(bundle_root / rel) == digest, (rel, digest)

        tarball_sha_file = Path(str(tarball_path) + ".sha256")
        assert tarball_sha_file.is_file()
        assert tarball_sha_file.read_text(encoding="utf-8").startswith(sha256(tarball_path))

        with tarfile.open(tarball_path, "r:gz") as archive:
            names = set(archive.getnames())
            prefix = f"{bundle_root.name}/"
            assert f"{prefix}docs/RELEASE_HANDOFF_RUNBOOK.md" in names
            assert f"{prefix}docs/RELEASE_HANDOFF.md" in names
            assert f"{prefix}release-manifest.json" in names
            runbook_text = archive.extractfile(f"{prefix}docs/RELEASE_HANDOFF_RUNBOOK.md").read().decode("utf-8")
            release_text = archive.extractfile(f"{prefix}docs/RELEASE_HANDOFF.md").read().decode("utf-8")
            manifest_text = archive.extractfile(f"{prefix}release-manifest.json").read().decode("utf-8")

        assert "Override sentinel." in runbook_text
        assert "<pending>" not in release_text
        assert "<pending>" not in manifest_text
        assert "tarball_sha256" not in manifest_text

        bundle_root_prune = tmp_root / "bundle-prune"
        tarball_prune = tmp_root / "out-prune.tar.gz"
        (bundle_root_prune / "android").mkdir(parents=True)
        (bundle_root_prune / "desktop").mkdir(parents=True)
        (bundle_root_prune / "pwa").mkdir(parents=True)
        old_apk = bundle_root_prune / "android" / "starlog-preview-older.apk"
        new_apk = bundle_root_prune / "android" / "starlog-preview-newer.apk"
        old_deb = bundle_root_prune / "desktop" / "starlog-helper-older.deb"
        new_deb = bundle_root_prune / "desktop" / "starlog-helper-newer.deb"
        old_pwa = bundle_root_prune / "pwa" / "starlog-pwa-older.tar.gz"
        new_pwa = bundle_root_prune / "pwa" / "starlog-pwa-newer.tar.gz"
        old_apk.write_text("old apk\n", encoding="utf-8")
        new_apk.write_text("new apk\n", encoding="utf-8")
        old_deb.write_text("old deb\n", encoding="utf-8")
        new_deb.write_text("new deb\n", encoding="utf-8")
        old_pwa.write_text("old pwa\n", encoding="utf-8")
        new_pwa.write_text("new pwa\n", encoding="utf-8")
        os.utime(old_apk, (old_apk.stat().st_atime, old_apk.stat().st_mtime - 10))
        os.utime(old_deb, (old_deb.stat().st_atime, old_deb.stat().st_mtime - 10))
        os.utime(old_pwa, (old_pwa.stat().st_atime, old_pwa.stat().st_mtime - 10))

        subprocess.run(
            [
                "python3",
                str(repo_root / "scripts" / "release_handoff.py"),
                "--skip-git-tag",
                "--prune-old-assets",
                "--bundle-root",
                str(bundle_root_prune),
                "--tarball",
                str(tarball_prune),
                "--release-doc",
                str(tmp_root / "release-handoff-prune.md"),
                "--runbook-doc",
                str(runbook_source),
            ],
            cwd=repo_root,
            check=True,
        )

        assert sorted(path.name for path in (bundle_root_prune / "android").glob("*.apk")) == ["starlog-preview-newer.apk"]
        assert sorted(path.name for path in (bundle_root_prune / "desktop").glob("*.deb")) == ["starlog-helper-newer.deb"]
        assert sorted(path.name for path in (bundle_root_prune / "pwa").glob("*.tar.gz")) == ["starlog-pwa-newer.tar.gz"]

        print("release-handoff-smoke-ok")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
