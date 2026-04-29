#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import tarfile
import tempfile
from pathlib import Path
from typing import Iterable


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def git_output(args: list[str], cwd: Path) -> str:
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    ).stdout.strip()


def run(args: list[str], cwd: Path, *, capture: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=cwd,
        check=True,
        text=True,
        stdout=subprocess.PIPE if capture else None,
        stderr=subprocess.PIPE if capture else None,
    )


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w",
        delete=False,
        dir=str(path.parent),
        prefix=f".{path.name}.",
        encoding="utf-8",
        newline="\n",
    ) as handle:
        handle.write(content)
        temp_path = Path(handle.name)
    os.replace(temp_path, path)


def atomic_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        delete=False,
        dir=str(destination.parent),
        prefix=f".{destination.name}.",
    ) as handle:
        temp_path = Path(handle.name)
    try:
        shutil.copy2(source, temp_path)
        os.replace(temp_path, destination)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Refresh the preview bundle, sync release docs, and publish release metadata."
    )
    parser.add_argument(
        "--repo-root",
        default=os.environ.get("STARLOG_RELEASE_REPO_ROOT"),
        help="Repository root. Defaults to the script's parent directory.",
    )
    parser.add_argument(
        "--docs-root",
        default=os.environ.get("STARLOG_RELEASE_DOCS_ROOT"),
        help="Docs root to read release docs from. Defaults to <repo-root>/docs.",
    )
    parser.add_argument(
        "--bundle-root",
        default=os.environ.get("STARLOG_RELEASE_BUNDLE_ROOT", "/home/ubuntu/starlog_preview_bundle"),
        help="Preview bundle root to refresh.",
    )
    parser.add_argument(
        "--tarball",
        default=os.environ.get("STARLOG_RELEASE_TARBALL"),
        help="Tarball path to create. Defaults to /home/ubuntu/starlog-preview-feedback-bundle-<date>.tar.gz",
    )
    parser.add_argument(
        "--apk-source",
        default=os.environ.get("STARLOG_RELEASE_APK"),
        help="APK source to stage into the bundle before publication.",
    )
    parser.add_argument(
        "--apk-target-name",
        default=os.environ.get("STARLOG_RELEASE_APK_TARGET_NAME"),
        help="Target APK filename inside the bundle.",
    )
    parser.add_argument(
        "--desktop-source",
        default=os.environ.get("STARLOG_RELEASE_DESKTOP_DEB"),
        help="Desktop helper .deb source to stage into the bundle before publication.",
    )
    parser.add_argument(
        "--desktop-target-name",
        default=os.environ.get("STARLOG_RELEASE_DESKTOP_TARGET_NAME"),
        help="Target desktop package filename inside the bundle.",
    )
    parser.add_argument(
        "--tag",
        default=os.environ.get("STARLOG_RELEASE_TAG"),
        help="Annotated git tag to create.",
    )
    parser.add_argument(
        "--release-name",
        default=os.environ.get("STARLOG_RELEASE_NAME"),
        help="Human-readable release name for the handoff doc and gh release.",
    )
    parser.add_argument(
        "--commit",
        default=os.environ.get("STARLOG_RELEASE_COMMIT"),
        help="Commit to record. Defaults to HEAD.",
    )
    parser.add_argument(
        "--release-doc",
        default=os.environ.get("STARLOG_RELEASE_DOC", "docs/RELEASE_HANDOFF.md"),
        help="Generated release handoff doc relative to the repo root.",
    )
    parser.add_argument(
        "--runbook-doc",
        default=os.environ.get("STARLOG_RELEASE_RUNBOOK_DOC", "docs/RELEASE_HANDOFF_RUNBOOK.md"),
        help="Runbook doc to include in the bundle.",
    )
    parser.add_argument(
        "--publish-github-release",
        action="store_true",
        default=os.environ.get("STARLOG_RELEASE_PUBLISH_GITHUB_RELEASE") == "1",
        help="Create a GitHub release with gh if the binary is available.",
    )
    parser.add_argument(
        "--skip-git-tag",
        action="store_true",
        help="Skip creating or validating the git tag.",
    )
    parser.add_argument(
        "--prune-old-assets",
        action="store_true",
        help="Remove older matching APK/DEB files after the selected assets are refreshed.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print the planned actions without changing files.",
    )
    return parser.parse_args()


def resolve_repo_root(args: argparse.Namespace) -> Path:
    if args.repo_root:
        return Path(args.repo_root).resolve()
    return Path(__file__).resolve().parents[1]


def select_or_stage_asset(
    *,
    asset_type: str,
    source: str | None,
    target_name: str | None,
    target_dir: Path,
    pattern: str,
    dry_run: bool,
    allow_existing_duplicates: bool = False,
) -> Path:
    target_dir.mkdir(parents=True, exist_ok=True)
    if source:
        source_path = Path(source).expanduser().resolve()
        if not source_path.is_file():
            raise FileNotFoundError(f"{asset_type} source not found: {source_path}")
        destination = target_dir / (target_name or source_path.name)
        if dry_run:
            return destination
        atomic_copy(source_path, destination)
        return destination

    matches = sorted(
        [path for path in target_dir.glob(pattern) if path.is_file()],
        key=lambda path: (path.stat().st_mtime, path.name),
        reverse=True,
    )
    if not matches:
        raise FileNotFoundError(f"no staged {asset_type} found under {target_dir}")
    if len(matches) > 1:
        if target_name:
            preferred = next((path for path in matches if path.name == target_name), None)
            if preferred is not None:
                return preferred
        if allow_existing_duplicates:
            return matches[0]
        names = ", ".join(path.name for path in matches)
        raise RuntimeError(
            f"multiple staged {asset_type}s found under {target_dir}; specify --{asset_type}-source or clean up first: {names}"
        )
    return matches[0]


def prune_matching_assets(target_dir: Path, keep: Path, pattern: str) -> None:
    for candidate in target_dir.glob(pattern):
        if candidate.is_file() and candidate.resolve() != keep.resolve():
            candidate.unlink()


def generate_checksums(entries: Iterable[tuple[str, Path]]) -> str:
    lines = [f"{sha256_file(path)}  {relative}" for relative, path in entries]
    return "\n".join(lines) + "\n"


def write_tarball(bundle_root: Path, tarball_path: Path, dry_run: bool) -> None:
    if dry_run:
        return
    tarball_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        delete=False,
        dir=str(tarball_path.parent),
        prefix=f".{tarball_path.name}.",
        suffix=".tmp",
    ) as handle:
        temp_path = Path(handle.name)
    try:
        with tarfile.open(temp_path, "w:gz") as archive:
            archive.add(bundle_root, arcname=bundle_root.name)
        os.replace(temp_path, tarball_path)
    finally:
        if temp_path.exists():
            temp_path.unlink(missing_ok=True)


def sync_bundle_docs(
    repo_root: Path,
    bundle_root: Path,
    docs_root: Path,
    runbook_doc_source: Path,
    dry_run: bool,
) -> list[Path]:
    targets = [
        ("README.md", "README.md"),
        ("IMPLEMENTATION_STATUS.md", "docs/IMPLEMENTATION_STATUS.md"),
        ("ANDROID_DEV_BUILD.md", "docs/ANDROID_DEV_BUILD.md"),
        ("UI_CONCEPT_COMPARISON_2026-04-29.md", "docs/UI_CONCEPT_COMPARISON_2026-04-29.md"),
        ("UI_FUNCTIONAL_TEST_HARNESSES.md", "docs/UI_FUNCTIONAL_TEST_HARNESSES.md"),
        ("CODEX_PHONE_PWA_CONNECTION.md", "docs/CODEX_PHONE_PWA_CONNECTION.md"),
        ("RELEASE_HANDOFF.md", "docs/RELEASE_HANDOFF.md"),
    ]
    copied: list[Path] = []
    for source_rel, dest_rel in targets:
        source = docs_root / source_rel if source_rel != "README.md" else repo_root / source_rel
        destination = bundle_root / dest_rel
        if not source.is_file():
            continue
        if dry_run:
            copied.append(destination)
            continue
        atomic_copy(source, destination)
        copied.append(destination)

    runbook_destination = bundle_root / "docs/RELEASE_HANDOFF_RUNBOOK.md"
    if not runbook_doc_source.is_file():
        raise FileNotFoundError(f"runbook source not found: {runbook_doc_source}")
    if dry_run:
        copied.append(runbook_destination)
    else:
        atomic_copy(runbook_doc_source, runbook_destination)
        copied.append(runbook_destination)

    return copied


def sync_bundle_artifacts(repo_root: Path, bundle_root: Path, dry_run: bool) -> list[Path]:
    targets = [
        ("artifacts/ui-comparison/2026-04-29", "artifacts/ui-comparison/2026-04-29"),
        ("artifacts/phone-current/2026-04-29", "artifacts/phone-current/2026-04-29"),
        ("artifacts/ui-concept", "artifacts/ui-concept"),
    ]
    copied: list[Path] = []
    for source_rel, dest_rel in targets:
        source = repo_root / source_rel
        destination = bundle_root / dest_rel
        if not source.exists():
            continue
        copied.append(destination)
        if dry_run:
            continue
        if destination.exists():
            shutil.rmtree(destination)
        shutil.copytree(source, destination)
    return copied


def render_release_doc(manifest: dict[str, object]) -> str:
    assets = manifest["assets"]
    lines = [
        "# Release Handoff",
        "",
        f"Generated at: `{manifest['generated_at_utc']}`",
        f"Commit: `{manifest['commit']}`",
        f"Branch: `{manifest['branch']}`",
        f"Tag: `{manifest['tag']}`",
        f"Release name: `{manifest['release_name']}`",
        "",
        "## Bundle",
        "",
        f"- Bundle root: `{manifest['bundle_root']}`",
        f"- Tarball: `{manifest['tarball_path']}`",
        f"- Tarball checksum: `{manifest['tarball_checksum_path']}`",
        f"- Checksums: `{manifest['checksums_path']}`",
        "",
        "## Assets",
        "",
    ]
    for asset in assets:
        lines.extend(
            [
                f"- `{asset['kind']}`",
                f"  - path: `{asset['path']}`",
                f"  - sha256: `{asset['sha256']}`",
            ]
        )
    lines.extend(
        [
        "",
        "## Publication",
        "",
        f"- Git tag: `{manifest['tag']}`",
        f"- GitHub release requested: `{str(manifest['publish_github_release']).lower()}`",
        f"- Release doc sync: `{manifest['release_doc_path']}`",
        f"- Runbook source: `{manifest['runbook_doc_source_path']}`",
        f"- Runbook bundle path: `{manifest['runbook_doc_path']}`",
        "",
        "## Verification",
            "",
            "Run `sha256sum -c checksums.sha256` from the bundle root to verify the staged binaries.",
        ]
    )
    return "\n".join(lines) + "\n"


def create_or_verify_tag(repo_root: Path, tag: str, commit: str, dry_run: bool) -> None:
    existing = run(["git", "tag", "--list", tag], cwd=repo_root, capture=True).stdout.strip()
    if existing and existing == tag:
        tagged_commit = git_output(["rev-list", "-n", "1", tag], cwd=repo_root)
        if tagged_commit != commit:
            raise RuntimeError(f"tag {tag} already exists at {tagged_commit}, expected {commit}")
        return
    if dry_run:
        return
    run(["git", "tag", "-a", tag, "-m", f"Starlog release {tag}", commit], cwd=repo_root)


def create_github_release(
    repo_root: Path,
    tag: str,
    release_name: str,
    notes_path: Path,
    assets: list[Path],
    dry_run: bool,
) -> None:
    if not shutil.which("gh"):
        raise RuntimeError("gh is not installed, cannot publish GitHub release")
    if dry_run:
        return
    cmd = [
        "gh",
        "release",
        "create",
        tag,
        *[str(asset) for asset in assets],
        "--title",
        release_name,
        "--notes-file",
        str(notes_path),
    ]
    run(cmd, cwd=repo_root)


def main() -> int:
    args = parse_args()
    repo_root = resolve_repo_root(args)
    docs_root = Path(args.docs_root).resolve() if args.docs_root else repo_root / "docs"
    bundle_root = Path(args.bundle_root).expanduser().resolve()
    commit = args.commit or git_output(["rev-parse", "HEAD"], cwd=repo_root)
    branch = git_output(["rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_root)
    tag = args.tag or f"starlog-release-{utc_now().strftime('%Y%m%d')}"
    release_name = args.release_name or tag
    tarball_path = (
        Path(args.tarball).expanduser().resolve()
        if args.tarball
        else bundle_root.parent / f"starlog-preview-feedback-bundle-{utc_now().strftime('%Y%m%d')}.tar.gz"
    )
    release_doc_path = (repo_root / args.release_doc).resolve()
    runbook_doc_path = (repo_root / args.runbook_doc).resolve()

    android_dir = bundle_root / "android"
    desktop_dir = bundle_root / "desktop"
    bundle_docs_dir = bundle_root / "docs"
    evidence_dir = bundle_root / "evidence"

    staged_apk = select_or_stage_asset(
        asset_type="apk",
        source=args.apk_source,
        target_name=args.apk_target_name,
        target_dir=android_dir,
        pattern="starlog-preview-*.apk",
        dry_run=args.dry_run,
        allow_existing_duplicates=args.prune_old_assets,
    )
    staged_deb = select_or_stage_asset(
        asset_type="desktop-package",
        source=args.desktop_source,
        target_name=args.desktop_target_name,
        target_dir=desktop_dir,
        pattern="*.deb",
        dry_run=args.dry_run,
        allow_existing_duplicates=args.prune_old_assets,
    )

    if args.prune_old_assets and not args.dry_run:
        prune_matching_assets(android_dir, staged_apk, "starlog-preview-*.apk")
        prune_matching_assets(desktop_dir, staged_deb, "*.deb")

    copied_docs = sync_bundle_docs(repo_root, bundle_root, docs_root, runbook_doc_path, args.dry_run)
    copied_artifacts = sync_bundle_artifacts(repo_root, bundle_root, args.dry_run)

    assets_for_checksums = [
        ("android/" + staged_apk.name, staged_apk),
        ("desktop/" + staged_deb.name, staged_deb),
    ]

    manifest: dict[str, object] = {
        "generated_at_utc": utc_now().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "repo_root": str(repo_root),
        "commit": commit,
        "branch": branch,
        "tag": tag,
        "release_name": release_name,
        "bundle_root": str(bundle_root),
        "tarball_path": str(tarball_path),
        "checksums_path": str(bundle_root / "checksums.sha256"),
        "tarball_checksum_path": str(tarball_path) + ".sha256",
        "release_doc_path": str(release_doc_path),
        "runbook_doc_source_path": str(runbook_doc_path),
        "runbook_doc_path": str(bundle_root / "docs" / "RELEASE_HANDOFF_RUNBOOK.md"),
        "publish_github_release": bool(args.publish_github_release),
        "assets": [
            {
                "kind": "android-apk",
                "path": str(staged_apk),
                "sha256": sha256_file(staged_apk) if not args.dry_run else "<dry-run>",
            },
            {
                "kind": "desktop-deb",
                "path": str(staged_deb),
                "sha256": sha256_file(staged_deb) if not args.dry_run else "<dry-run>",
            },
        ],
        "copied_docs": [str(path) for path in copied_docs],
        "copied_artifacts": [str(path) for path in copied_artifacts],
        "bundle_docs_dir": str(bundle_docs_dir),
        "evidence_dir": str(evidence_dir),
    }

    release_doc_text = render_release_doc(manifest)

    if args.dry_run:
        print(json.dumps(manifest, indent=2))
        return 0

    atomic_write_text(bundle_root / "release-manifest.json", json.dumps(manifest, indent=2) + "\n")
    atomic_write_text(bundle_root / "checksums.sha256", generate_checksums(assets_for_checksums))
    atomic_write_text(release_doc_path, release_doc_text)

    bundle_release_doc = bundle_root / "docs" / "RELEASE_HANDOFF.md"
    atomic_write_text(bundle_release_doc, release_doc_text)

    write_tarball(bundle_root, tarball_path, dry_run=False)
    tarball_sha256 = sha256_file(tarball_path)
    atomic_write_text(Path(str(tarball_path) + ".sha256"), f"{tarball_sha256}  {tarball_path.name}\n")

    if not args.skip_git_tag:
        create_or_verify_tag(repo_root, tag, commit, dry_run=False)

    if args.publish_github_release:
        create_github_release(
            repo_root=repo_root,
            tag=tag,
            release_name=release_name,
            notes_path=release_doc_path,
            assets=[bundle_root / "checksums.sha256", tarball_path, Path(str(tarball_path) + ".sha256")],
            dry_run=False,
        )

    print(
        json.dumps(
            {
                "tag": tag,
                "release_name": release_name,
                "commit": commit,
                "bundle_root": str(bundle_root),
                "tarball": str(tarball_path),
                "release_doc": str(release_doc_path),
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
