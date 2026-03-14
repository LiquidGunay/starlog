import json
from sqlite3 import Connection
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from app.core.security import (
    decrypt_sensitive_config,
    encrypt_sensitive_config,
    redact_sensitive_config,
    secrets_encryption_mode,
)
from app.core.time import utc_now
from app.services import events_service, google_calendar_service
from app.services.common import execute_fetchall, execute_fetchone, new_id

DEFAULT_EXECUTION_POLICY = {
    "version": 1,
    "llm": ["mobile_bridge", "desktop_bridge", "api"],
    "stt": ["mobile_bridge", "desktop_bridge", "api"],
    "tts": ["mobile_bridge", "desktop_bridge", "api"],
    "ocr": ["mobile_bridge", "desktop_bridge"],
}

AVAILABLE_EXECUTION_TARGETS = {
    "llm": ["mobile_bridge", "desktop_bridge", "api"],
    "stt": ["mobile_bridge", "desktop_bridge", "api"],
    "tts": ["mobile_bridge", "desktop_bridge", "api"],
    "ocr": ["mobile_bridge", "desktop_bridge"],
}

CAPABILITY_FAMILY = {
    "llm_summary": "llm",
    "llm_cards": "llm",
    "llm_tasks": "llm",
    "llm_agent_plan": "llm",
    "stt": "stt",
    "tts": "tts",
    "ocr": "ocr",
}

BATCH_PROVIDER_HINT = {
    "llm": "desktop_bridge_codex",
    "stt": "desktop_bridge_stt",
    "tts": "desktop_bridge_tts",
}

LEGACY_TARGET_MAP = {
    "on_device": "mobile_bridge",
    "batch_local_bridge": "desktop_bridge",
    "server_local": "desktop_bridge",
    "codex_bridge": "desktop_bridge",
    "api_fallback": "api",
}

CODEX_BRIDGE_FEATURE_FLAG_KEY = "experimental_enabled"
CODEX_BRIDGE_SUPPORTED_ADAPTERS = ["openai_compatible"]
CODEX_BRIDGE_SUPPORTED_AUTH = ["api_key", "access_token", "token"]
CODEX_BRIDGE_SUPPORTED_CAPABILITIES = ["llm_summary", "llm_cards", "llm_tasks", "llm_agent_plan"]
CODEX_BRIDGE_UNSUPPORTED_CAPABILITIES = ["stt", "tts", "ocr"]


def _decoded_config(row: dict) -> dict:
    config = row.get("config_json")
    if not isinstance(config, dict):
        return {}
    return decrypt_sensitive_config(config)


def _response_config(row: dict) -> dict:
    return redact_sensitive_config(_decoded_config(row))


def _normalized_execution_policy(raw_policy: dict | None) -> dict:
    normalized = dict(DEFAULT_EXECUTION_POLICY)
    if isinstance(raw_policy, dict):
        if isinstance(raw_policy.get("version"), int):
            normalized["version"] = int(raw_policy["version"])
        for key, allowed in AVAILABLE_EXECUTION_TARGETS.items():
            raw_targets = raw_policy.get(key)
            if not isinstance(raw_targets, list):
                continue
            seen: list[str] = []
            for item in raw_targets:
                if not isinstance(item, str):
                    continue
                normalized_item = _normalize_execution_target(item, key)
                if normalized_item in allowed and normalized_item not in seen:
                    seen.append(normalized_item)
            if seen:
                normalized[key] = seen
    return normalized


def _normalize_execution_target(target: str, family: str) -> str:
    normalized = LEGACY_TARGET_MAP.get(target, target)
    if family == "ocr" and normalized == "api":
        return "mobile_bridge"
    return normalized


def _contains_any(config: dict, keys: set[str]) -> bool:
    for key in keys:
        value = config.get(key)
        if isinstance(value, str) and value.strip():
            return True
    return False


def _truthy(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    if isinstance(value, (int, float)):
        return value != 0
    return False


def _valid_url(value: object) -> bool:
    if not isinstance(value, str) or not value.strip():
        return False
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _is_local_url(url: str) -> bool:
    parsed = urlparse(url)
    hostname = (parsed.hostname or "").lower()
    return hostname in {"localhost", "127.0.0.1", "::1"}


def _default_probe_url(endpoint: str, explicit_health_url: str | None) -> str:
    if explicit_health_url and _valid_url(explicit_health_url):
        return explicit_health_url

    parsed = urlparse(endpoint)
    if parsed.path and parsed.path not in {"", "/"}:
        return endpoint
    base = endpoint.rstrip("/")
    return f"{base}/health"


def _default_codex_bridge_probe_url(config: dict) -> str | None:
    candidate = str(
        config.get("model_list_url")
        or config.get("auth_probe_url")
        or config.get("bridge_url")
        or config.get("endpoint")
        or ""
    ).strip()
    if not _valid_url(candidate):
        return None

    parsed = urlparse(candidate)
    if parsed.path.endswith("/models"):
        return candidate
    if parsed.path.endswith("/v1"):
        return f"{candidate.rstrip('/')}/models"
    if parsed.path in {"", "/"}:
        return f"{candidate.rstrip('/')}/v1/models"
    return f"{candidate.rstrip('/')}/models"


def _default_codex_bridge_execute_url(config: dict) -> str | None:
    explicit = str(config.get("chat_completions_url") or "").strip()
    if _valid_url(explicit):
        return explicit

    base = str(config.get("bridge_url") or config.get("endpoint") or config.get("base_url") or "").strip()
    if not _valid_url(base):
        return None
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1"):
        return f"{base.rstrip('/')}/chat/completions"
    if urlparse(base).path in {"", "/"}:
        return f"{base.rstrip('/')}/v1/chat/completions"
    return f"{base.rstrip('/')}/chat/completions"


def _probe_endpoint(
    probe_url: str,
    timeout_seconds: float = 2.0,
    headers: dict[str, str] | None = None,
) -> tuple[bool, str]:
    request = Request(probe_url, headers=headers or {}, method="GET")
    try:
        with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310
            status = int(response.status)
        if 200 <= status < 400:
            return True, f"Probe succeeded ({status})"
        return False, f"Probe failed with status {status}"
    except HTTPError as exc:
        return False, f"Probe failed with HTTP {exc.code}"
    except URLError as exc:
        return False, f"Probe failed: {exc.reason}"
    except TimeoutError:
        return False, "Probe timed out"


def _auth_probe_header(config: dict) -> tuple[dict[str, str], str | None]:
    explicit_header = str(config.get("auth_probe_header") or "").strip()
    explicit_prefix = str(config.get("auth_probe_prefix") or "")

    if isinstance(config.get("access_token"), str) and str(config["access_token"]).strip():
        token = str(config["access_token"]).strip()
        header_name = explicit_header or "Authorization"
        prefix = explicit_prefix if explicit_header else (explicit_prefix or "Bearer ")
        return {header_name: f"{prefix}{token}" if prefix else token}, header_name

    if isinstance(config.get("token"), str) and str(config["token"]).strip():
        token = str(config["token"]).strip()
        header_name = explicit_header or "Authorization"
        prefix = explicit_prefix if explicit_header else (explicit_prefix or "Bearer ")
        return {header_name: f"{prefix}{token}" if prefix else token}, header_name

    if isinstance(config.get("api_key"), str) and str(config["api_key"]).strip():
        token = str(config["api_key"]).strip()
        header_name = explicit_header or "Authorization"
        prefix = explicit_prefix if explicit_header else (explicit_prefix or "Bearer ")
        return {header_name: f"{prefix}{token}" if prefix else token}, header_name

    return {}, None


def build_auth_headers(config: dict) -> dict[str, str]:
    headers, _ = _auth_probe_header(config)
    return headers


def _codex_bridge_state(provider: dict | None) -> dict:
    configured = provider is not None
    enabled = bool(provider["enabled"]) if provider is not None else False
    config = dict(provider["config"]) if provider is not None else {}
    configured_adapter_kind = (
        str(config.get("adapter_kind") or CODEX_BRIDGE_SUPPORTED_ADAPTERS[0]).strip()
        if configured
        else None
    )
    experimental_enabled = _truthy(config.get(CODEX_BRIDGE_FEATURE_FLAG_KEY))
    execute_endpoint = _default_codex_bridge_execute_url(config) or ""
    model_list_endpoint = _default_codex_bridge_probe_url(config) or ""
    auth_headers_buildable = bool(build_auth_headers(config))

    missing_requirements: list[str] = []
    if not configured:
        missing_requirements.append("Configure the codex_bridge provider first.")
    elif not enabled:
        missing_requirements.append("Enable the codex_bridge provider before using it.")

    if not experimental_enabled:
        missing_requirements.append(
            f"Set config.{CODEX_BRIDGE_FEATURE_FLAG_KEY}=true to opt into the experimental bridge."
        )
    if configured_adapter_kind not in CODEX_BRIDGE_SUPPORTED_ADAPTERS:
        missing_requirements.append("Only adapter_kind=openai_compatible is supported right now.")
    if configured and not execute_endpoint:
        missing_requirements.append("Configure bridge_url or chat_completions_url for request execution.")
    if configured and not auth_headers_buildable:
        missing_requirements.append("Configure api_key, access_token, or token for bridge auth.")

    return {
        "configured": configured,
        "enabled": enabled,
        "experimental_enabled": experimental_enabled,
        "configured_adapter_kind": configured_adapter_kind,
        "execute_endpoint": execute_endpoint,
        "model_list_endpoint": model_list_endpoint,
        "auth_headers_buildable": auth_headers_buildable,
        "missing_requirements": missing_requirements,
        "execute_enabled": configured and enabled and not missing_requirements,
    }


def codex_bridge_contract(conn: Connection) -> dict:
    provider = get_provider_config(conn, "codex_bridge", redact=False)
    state = _codex_bridge_state(provider)
    verified_at = utc_now().isoformat()
    recommended_runtime_mode = (
        "experimental_openai_compatible_bridge" if state["execute_enabled"] else "api_fallback"
    )

    derived_endpoints = {}
    if state["execute_endpoint"]:
        derived_endpoints["execute"] = state["execute_endpoint"]
    if state["model_list_endpoint"]:
        derived_endpoints["model_list"] = state["model_list_endpoint"]

    return {
        "contract_version": 2,
        "provider_name": "codex_bridge",
        "summary": (
            "Starlog currently supports Codex only through an explicit experimental "
            "OpenAI-compatible bridge adapter. A first-party native Codex OAuth handshake "
            "is not implemented in this repo yet, so bridge misses fall back to the next "
            "execution-policy target."
        ),
        "native_contract_state": "unavailable",
        "native_contract_detail": (
            "No first-party Codex subscription/OAuth handshake contract is implemented in Starlog yet. "
            "Use the experimental OpenAI-compatible bridge adapter with explicit opt-in, or fall back to API providers."
        ),
        "feature_flag_key": CODEX_BRIDGE_FEATURE_FLAG_KEY,
        "supported_adapter_kinds": CODEX_BRIDGE_SUPPORTED_ADAPTERS,
        "configured_adapter_kind": state["configured_adapter_kind"],
        "supported_auth": CODEX_BRIDGE_SUPPORTED_AUTH,
        "supported_capabilities": CODEX_BRIDGE_SUPPORTED_CAPABILITIES,
        "unsupported_capabilities": CODEX_BRIDGE_UNSUPPORTED_CAPABILITIES,
        "required_config": [
            "enabled=true",
            f"config.{CODEX_BRIDGE_FEATURE_FLAG_KEY}=true",
            "config.adapter_kind=openai_compatible",
            "config.bridge_url or config.chat_completions_url",
            "one auth credential: api_key, access_token, or token",
        ],
        "optional_config": [
            "config.model",
            "config.temperature",
            "config.model_list_url",
            "config.auth_probe_url",
            "config.auth_probe_header",
            "config.auth_probe_prefix",
            "config.chat_completions_url",
        ],
        "native_oauth_supported": False,
        "safe_fallback": (
            "If the bridge is missing required config or a request fails, Starlog keeps "
            "walking the execution policy toward mobile/desktop bridge and API fallbacks."
        ),
        "recommended_runtime_mode": recommended_runtime_mode,
        "first_party_blockers": [
            "No first-party Codex OAuth token exchange flow is implemented in this repository.",
            "No stable upstream native Codex subscription handshake contract is wired into Starlog yet.",
            "Bridge execution currently depends on explicit openai_compatible adapter configuration.",
        ],
        "configured": state["configured"],
        "enabled": state["enabled"],
        "execute_enabled": state["execute_enabled"],
        "missing_requirements": state["missing_requirements"],
        "derived_endpoints": derived_endpoints,
        "verified_at": verified_at,
    }


def codex_bridge_runtime_config(conn: Connection) -> tuple[dict | None, list[str]]:
    provider = get_provider_config(conn, "codex_bridge", redact=False)
    state = _codex_bridge_state(provider)
    if provider is None or not state["execute_enabled"]:
        return None, list(state["missing_requirements"])
    return dict(provider["config"]), []


def _probe_authenticated_endpoint(
    probe_url: str,
    config: dict,
    timeout_seconds: float = 4.0,
) -> tuple[bool, str, dict[str, str]]:
    headers, header_name = _auth_probe_header(config)
    if not headers:
        return False, "Auth probe could not build auth headers from configured credentials", {
            "target": probe_url,
            "status": "failed",
            "detail": "Credential missing or unsupported header configuration",
        }

    ok, detail = _probe_endpoint(probe_url, timeout_seconds=timeout_seconds, headers=headers)
    return ok, detail, {
        "target": probe_url,
        "status": "ok" if ok else "failed",
        "detail": detail,
        "header": header_name or "Authorization",
    }


def _health_checks(
    conn: Connection,
    provider_name: str,
    mode: str,
    config: dict,
) -> tuple[bool, list[str], dict[str, bool], dict[str, str], dict[str, str]]:
    checks: dict[str, bool] = {}
    problems: list[str] = []
    probe: dict[str, str] = {}
    auth_probe: dict[str, str] = {}

    if mode.startswith("api"):
        has_credential = _contains_any(config, {"api_key", "access_token", "token"})
        checks["credential_present"] = has_credential
        if not has_credential:
            problems.append("missing API credentials")

    endpoint = config.get("endpoint") or config.get("base_url")
    if endpoint is not None:
        endpoint_ok = _valid_url(endpoint)
        checks["endpoint_valid"] = endpoint_ok
        if not endpoint_ok:
            problems.append("invalid endpoint URL")
        elif mode.startswith("local") or provider_name in {"codex_bridge", "local_llm", "local_tts", "local_stt"}:
            endpoint_str = str(endpoint)
            probe["target"] = _default_probe_url(endpoint_str, str(config.get("health_url") or ""))
            if _is_local_url(endpoint_str):
                probe_ok, probe_detail = _probe_endpoint(probe["target"])
                checks["runtime_probe_ok"] = probe_ok
                probe["status"] = "ok" if probe_ok else "failed"
                probe["detail"] = probe_detail
                if not probe_ok:
                    problems.append(probe_detail)
            else:
                checks["runtime_probe_ok"] = True
                probe["status"] = "skipped_non_local"
                probe["detail"] = "Runtime probe is only executed for localhost endpoints"

    if provider_name == "google_calendar":
        source = str(config.get("source") or "")
        checks["source_present"] = bool(source)
        if not source:
            problems.append("missing source marker")
        if source == "google_oauth":
            has_access = isinstance(config.get("access_token"), str) and bool(str(config.get("access_token")).strip())
            checks["access_token_present"] = has_access
            if not has_access:
                problems.append("missing Google access token")
            else:
                probe_ok, probe_detail, probe_meta = google_calendar_service.probe_oauth_connection(conn)
                checks["auth_probe_configured"] = True
                checks["auth_probe_ok"] = probe_ok
                auth_probe = probe_meta
                if not probe_ok:
                    problems.append(probe_detail)

    auth_probe_url = str(config.get("auth_probe_url") or "").strip()
    if provider_name == "codex_bridge" and not auth_probe_url:
        derived_probe_url = _default_codex_bridge_probe_url(config)
        auth_probe_url = derived_probe_url or ""

    if (mode.startswith("api") or provider_name == "codex_bridge") and auth_probe_url:
        checks["auth_probe_configured"] = True
        if not _valid_url(auth_probe_url):
            checks["auth_probe_ok"] = False
            auth_probe = {
                "target": auth_probe_url,
                "status": "failed",
                "detail": "Invalid auth probe URL",
            }
            problems.append("invalid auth probe URL")
        else:
            auth_ok, auth_detail, auth_meta = _probe_authenticated_endpoint(auth_probe_url, config)
            checks["auth_probe_ok"] = auth_ok
            auth_probe = auth_meta
            if not auth_ok:
                problems.append(auth_detail)

    if provider_name == "codex_bridge":
        codex_state = _codex_bridge_state(
            {
                "enabled": True,
                "config": config,
            }
        )
        checks["bridge_url_valid"] = bool(codex_state["execute_endpoint"])
        checks["experimental_enabled"] = bool(codex_state["experimental_enabled"])
        checks["adapter_kind_supported"] = (
            codex_state["configured_adapter_kind"] in CODEX_BRIDGE_SUPPORTED_ADAPTERS
        )
        checks["execute_endpoint_configured"] = bool(codex_state["execute_endpoint"])
        checks["auth_headers_buildable"] = bool(codex_state["auth_headers_buildable"])
        for requirement in codex_state["missing_requirements"]:
            if requirement not in problems:
                problems.append(requirement)

    return len(problems) == 0, problems, checks, probe, auth_probe


def get_execution_policy(conn: Connection) -> dict:
    row = execute_fetchone(conn, "SELECT value_json, updated_at FROM app_settings WHERE key = ?", ("execution_policy",))
    raw_policy = row.get("value_json") if row is not None else None
    normalized = _normalized_execution_policy(raw_policy if isinstance(raw_policy, dict) else None)
    resolved_routes = _resolved_execution_routes(conn, normalized)
    return {
        **normalized,
        "available_targets": AVAILABLE_EXECUTION_TARGETS,
        "resolved_routes": resolved_routes,
        "updated_at": row.get("updated_at") if row is not None else None,
    }


def upsert_execution_policy(conn: Connection, policy: dict) -> dict:
    normalized = _normalized_execution_policy(policy)
    now = utc_now().isoformat()
    conn.execute(
        """
        INSERT INTO app_settings (key, value_json, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          updated_at = excluded.updated_at
        """,
        ("execution_policy", json.dumps(normalized, sort_keys=True), now),
    )
    events_service.emit(
        conn,
        "execution_policy.updated",
        {
            "llm": normalized["llm"],
            "stt": normalized["stt"],
            "tts": normalized["tts"],
            "ocr": normalized["ocr"],
        },
    )
    conn.commit()
    return get_execution_policy(conn)


def capability_execution_order(
    conn: Connection,
    capability: str,
    *,
    executable_targets: set[str] | None = None,
    prefer_local: bool = True,
) -> list[str]:
    policy = get_execution_policy(conn)
    family = CAPABILITY_FAMILY.get(capability, "llm")
    order = [str(item) for item in policy.get(family, DEFAULT_EXECUTION_POLICY[family])]

    if not prefer_local:
        order = [item for item in order if item == "api"]

    if executable_targets is not None:
        order = [item for item in order if item in executable_targets]
    return order


def default_batch_provider_hint(conn: Connection, capability: str) -> str | None:
    family = CAPABILITY_FAMILY.get(capability)
    if family is None:
        return None
    order = capability_execution_order(conn, capability, executable_targets={"mobile_bridge", "desktop_bridge"})
    if "desktop_bridge" not in order and "mobile_bridge" not in order:
        return None
    if "mobile_bridge" in order:
        return {
            "llm": "mobile_bridge_codex",
            "stt": "mobile_bridge_stt",
            "tts": "mobile_bridge_tts",
        }.get(family)
    return BATCH_PROVIDER_HINT.get(family)


def _capability_probe_for_family(family: str) -> str:
    if family == "stt":
        return "stt"
    if family == "tts":
        return "tts"
    if family == "ocr":
        return "ocr"
    return "llm_summary"


def _resolved_execution_routes(conn: Connection, normalized_policy: dict) -> dict:
    from app.services import worker_service

    resolved: dict[str, dict] = {}
    for family, order in AVAILABLE_EXECUTION_TARGETS.items():
        family_order = normalized_policy.get(family, DEFAULT_EXECUTION_POLICY[family])
        requested = family_order[0] if family_order else "none"
        active = requested
        reason = ""

        capability_probe = _capability_probe_for_family(family)
        online_classes = worker_service.online_worker_classes_for_capability(conn, capability_probe)

        if requested in {"mobile_bridge", "desktop_bridge"} and requested not in online_classes:
            fallback = next(
                (
                    item
                    for item in family_order
                    if item == "api" or (item in {"mobile_bridge", "desktop_bridge"} and item in online_classes)
                ),
                None,
            )
            if fallback:
                active = fallback
                reason = "Requested bridge is unavailable; using next available target."
            else:
                active = "none"
                reason = "No currently available execution target."
        elif requested == "api":
            reason = "Using API fallback path."

        resolved[family] = {
            "requested": requested,
            "active": active,
            "order": family_order,
            "online_workers": sorted(online_classes),
            "reason": reason,
        }
    return resolved


def upsert_provider_config(
    conn: Connection,
    provider_name: str,
    enabled: bool,
    mode: str,
    config: dict,
) -> dict:
    now = utc_now().isoformat()
    encrypted_config = encrypt_sensitive_config(config)
    existing = execute_fetchone(
        conn,
        "SELECT id FROM provider_configs WHERE provider_name = ?",
        (provider_name,),
    )

    if existing is None:
        conn.execute(
            """
            INSERT INTO provider_configs (id, provider_name, enabled, mode, config_json, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (new_id("prv"), provider_name, 1 if enabled else 0, mode, json.dumps(encrypted_config, sort_keys=True), now),
        )
    else:
        conn.execute(
            """
            UPDATE provider_configs
            SET enabled = ?, mode = ?, config_json = ?, updated_at = ?
            WHERE provider_name = ?
            """,
            (1 if enabled else 0, mode, json.dumps(encrypted_config, sort_keys=True), now, provider_name),
        )

    events_service.emit(
        conn,
        "provider.configured",
        {"provider_name": provider_name, "enabled": enabled, "mode": mode},
    )
    conn.commit()

    row = execute_fetchone(
        conn,
        "SELECT provider_name, enabled, mode, config_json, updated_at FROM provider_configs WHERE provider_name = ?",
        (provider_name,),
    )
    if row is None:
        raise RuntimeError("Provider config upsert failed")

    return {
        "provider_name": row["provider_name"],
        "enabled": bool(row["enabled"]),
        "mode": row["mode"],
        "config": _response_config(row),
        "updated_at": row["updated_at"],
    }


def list_provider_configs(conn: Connection) -> list[dict]:
    rows = execute_fetchall(
        conn,
        "SELECT provider_name, enabled, mode, config_json, updated_at FROM provider_configs ORDER BY provider_name ASC",
    )

    formatted: list[dict] = []
    for row in rows:
        formatted.append(
            {
                "provider_name": row["provider_name"],
                "enabled": bool(row["enabled"]),
                "mode": row["mode"],
                "config": _response_config(row),
                "updated_at": row["updated_at"],
            }
        )
    return formatted


def get_provider_config(conn: Connection, provider_name: str, redact: bool = True) -> dict | None:
    row = execute_fetchone(
        conn,
        "SELECT provider_name, enabled, mode, config_json, updated_at FROM provider_configs WHERE provider_name = ?",
        (provider_name,),
    )
    if row is None:
        return None

    config = _response_config(row) if redact else _decoded_config(row)
    return {
        "provider_name": row["provider_name"],
        "enabled": bool(row["enabled"]),
        "mode": row["mode"],
        "config": config,
        "updated_at": row["updated_at"],
    }


def provider_health(conn: Connection, provider_name: str) -> dict:
    row = execute_fetchone(
        conn,
        "SELECT enabled, mode, config_json FROM provider_configs WHERE provider_name = ?",
        (provider_name,),
    )
    if row is None:
        return {
            "provider_name": provider_name,
            "healthy": False,
            "detail": "Provider is not configured",
        }

    enabled = bool(row["enabled"])
    mode = str(row["mode"])
    config = _decoded_config(row)

    if not enabled:
        return {
            "provider_name": provider_name,
            "healthy": False,
            "detail": "Provider is disabled",
            "checks": {"enabled": False},
            "secure_storage": secrets_encryption_mode(),
        }

    healthy, problems, checks, probe, auth_probe = _health_checks(conn, provider_name, mode, config)
    checks["enabled"] = True
    checks["config_present"] = bool(config)
    checks["secure_storage_configured"] = secrets_encryption_mode() == "configured"

    if healthy:
        detail = f"Configured in {mode} mode"
        if config:
            detail += " with config keys: " + ", ".join(sorted(config.keys()))
    else:
        detail = "Health check failed: " + ", ".join(problems)

    return {
        "provider_name": provider_name,
        "healthy": healthy,
        "detail": detail,
        "checks": checks,
        "secure_storage": secrets_encryption_mode(),
        "probe": probe,
        "auth_probe": auth_probe,
    }
