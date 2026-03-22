#!/usr/bin/env bash
set -euo pipefail

HOST="${STARLOG_LOCAL_WHISPER_HOST:-127.0.0.1}"
PORT="${STARLOG_LOCAL_WHISPER_PORT:-8171}"
MODEL="${STARLOG_LOCAL_WHISPER_MODEL:-}"
SERVER_BIN="${STARLOG_LOCAL_WHISPER_SERVER_BIN:-}"
EXTRA_ARGS="${STARLOG_LOCAL_WHISPER_SERVER_EXTRA_ARGS:-}"

if [[ -z "$MODEL" ]]; then
  echo "Set STARLOG_LOCAL_WHISPER_MODEL to your whisper.cpp model path." >&2
  exit 1
fi

if [[ -z "$SERVER_BIN" ]]; then
  if command -v whisper-server >/dev/null 2>&1; then
    SERVER_BIN="$(command -v whisper-server)"
  elif command -v server >/dev/null 2>&1; then
    SERVER_BIN="$(command -v server)"
  else
    echo "Set STARLOG_LOCAL_WHISPER_SERVER_BIN to the whisper.cpp server binary." >&2
    exit 1
  fi
fi

if [[ -n "${STARLOG_LOCAL_WHISPER_GPU_LAYERS:-}" ]]; then
  EXTRA_ARGS="${EXTRA_ARGS} -ngl ${STARLOG_LOCAL_WHISPER_GPU_LAYERS}"
fi

if [[ -n "${STARLOG_LOCAL_WHISPER_THREADS:-}" ]]; then
  EXTRA_ARGS="${EXTRA_ARGS} -t ${STARLOG_LOCAL_WHISPER_THREADS}"
fi

read -r -a extra_parts <<<"${EXTRA_ARGS}"

echo "[starlog-whisper] binary=${SERVER_BIN} model=${MODEL} host=${HOST} port=${PORT}"
exec "${SERVER_BIN}" -m "${MODEL}" --host "${HOST}" --port "${PORT}" "${extra_parts[@]}"
