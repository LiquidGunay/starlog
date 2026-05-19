#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: bash scripts/use_shared_worktree_state.sh [--source /path/to/canonical/checkout] [--no-build-caches]

Links shared dependency and cache directories from a canonical Starlog checkout into the current worktree.
Do this before reinstalling dependencies in a fresh worktree.
USAGE
}

source_root="${STARLOG_SHARED_ROOT:-}"
link_build_caches=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source)
      source_root="$2"
      shift 2
      ;;
    --no-build-caches)
      link_build_caches=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
repo_root="$(cd "$repo_root" && pwd -P)"

resolve_git_common_dir() {
  local repo="$1"
  local common

  common="$(git -C "$repo" rev-parse --git-common-dir)"
  if [[ "$common" != /* ]]; then
    common="$repo/$common"
  fi

  (cd "$common" && pwd -P)
}

if [[ -z "$source_root" ]]; then
  if [[ -d /home/ubuntu/starlog && "$repo_root" != "/home/ubuntu/starlog" ]]; then
    source_root="/home/ubuntu/starlog"
  else
    echo "Set --source <canonical-checkout> or STARLOG_SHARED_ROOT before running this helper." >&2
    exit 1
  fi
fi

if [[ ! -d "$source_root" ]]; then
  echo "Shared source root does not exist: $source_root" >&2
  exit 1
fi

source_root="$(cd "$source_root" && pwd -P)"

if [[ "$repo_root" == "$source_root" ]]; then
  echo "Current checkout is already the shared source root: $repo_root"
  exit 0
fi

current_common="$(resolve_git_common_dir "$repo_root")"
source_common="$(resolve_git_common_dir "$source_root")"

if [[ "$current_common" != "$source_common" ]]; then
  echo "Source root must share the same git common dir as this worktree." >&2
  echo "Current: $current_common" >&2
  echo "Source:  $source_common" >&2
  exit 1
fi

link_one() {
  local rel="$1"
  local src="$source_root/$rel"
  local dest="$repo_root/$rel"

  if [[ ! -e "$src" ]]; then
    echo "skip  $rel (missing in source root)"
    return
  fi

  if [[ -L "$dest" ]]; then
    local target
    target="$(readlink -f "$dest")"
    if [[ "$target" == "$src" ]]; then
      if ! validate_source_path "$rel" "$src"; then
        echo "      existing link left in place: $dest -> $src"
        echo "      remove that symlink before running the remediation command above"
        return
      fi
      echo "reuse $rel"
      return
    fi
    echo "skip  $rel (already linked elsewhere: $target)"
    return
  fi

  if ! validate_source_path "$rel" "$src"; then
    return
  fi

  if [[ -e "$dest" ]]; then
    echo "skip  $rel (local path already exists)"
    return
  fi

  mkdir -p "$(dirname "$dest")"
  ln -s "$src" "$dest"
  echo "link  $rel -> $src"
}

validate_source_path() {
  local rel="$1"
  local src="$2"

  if [[ "$rel" != "apps/mobile/node_modules" ]]; then
    return 0
  fi

  local required=(
    "react-native/package.json"
    "expo/package.json"
    "@react-native/gradle-plugin/package.json"
  )
  local missing=()
  local package_path

  for package_path in "${required[@]}"; do
    if [[ ! -e "$src/$package_path" ]]; then
      missing+=("$package_path")
    fi
  done

  if [[ "${#missing[@]}" -eq 0 ]]; then
    return 0
  fi

  echo "skip  $rel (source dependency tree is stale or incomplete)"
  for package_path in "${missing[@]}"; do
    echo "      missing $rel/$package_path"
  done
  cat <<'NOTE'
      remediation: localize this worktree's mobile dependencies before native builds:
        corepack pnpm install --filter mobile... --offline
      If offline install cannot satisfy the lockfile, refresh the canonical checkout's
      node_modules before linking shared state again.
NOTE
  return 1
}

paths=(
  "node_modules"
  "apps/web/node_modules"
  "apps/mobile/node_modules"
  "tools/desktop-helper/node_modules"
  "services/api/.venv"
)

if [[ "$link_build_caches" -eq 1 ]]; then
  paths+=(
    "apps/mobile/android/.gradle"
    "tools/desktop-helper/src-tauri/target"
  )
fi

for rel in "${paths[@]}"; do
  link_one "$rel"
done

cat <<'NOTE'

Shared worktree state linked.
If your task changes package manifests, lockfiles, Android native deps, or Rust crate/build inputs for a surface,
keep that surface local instead of relying on the shared link, then rerun setup only for the touched surface.
NOTE
