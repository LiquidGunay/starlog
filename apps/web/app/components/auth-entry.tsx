"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useSessionConfig } from "../session-provider";
import styles from "./auth-entry.module.css";

type AuthMode = "login" | "bootstrap";

type AuthResponse = {
  access_token: string;
  expires_at: string;
  token_type: string;
};

function inferIdentity(apiBase: string): string {
  try {
    return new URL(apiBase).host;
  } catch {
    return "local starlog";
  }
}

function safeNextPath(fallback = "/today"): string {
  if (typeof window === "undefined") {
    return fallback;
  }
  const next = new URLSearchParams(window.location.search).get("next") || "";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) {
    return fallback;
  }
  return next;
}

async function responseErrorDetail(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) {
    return "";
  }

  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    if (typeof parsed.detail === "string") {
      return parsed.detail;
    }
  } catch {
    // Fall through to the raw response text.
  }

  return body;
}

async function authErrorMessage(response: Response, action: AuthMode): Promise<string> {
  const detail = await responseErrorDetail(response);
  if (response.status === 401) {
    return "Passphrase not accepted for this Starlog. Use the original passphrase or reset the hosted backend.";
  }
  if (response.status === 409 && action === "bootstrap") {
    return "This Starlog is already set up. Sign in with the original passphrase, or reset the backend before creating a new one.";
  }
  if (response.status === 422) {
    return "Use a passphrase of at least 12 characters for setup, or at least 8 characters for sign in.";
  }
  return `${action === "bootstrap" ? "Setup" : "Login"} failed (${response.status})${detail ? `: ${detail}` : ""}`;
}

export function AuthEntry() {
  const router = useRouter();
  const { apiBase, token, setApiBase, setToken } = useSessionConfig();
  const [passphrase, setPassphrase] = useState("");
  const [revealPassphrase, setRevealPassphrase] = useState(false);
  const [busy, setBusy] = useState<AuthMode | null>(null);
  const [status, setStatus] = useState("Enter your passphrase to open Starlog.");

  const identityPreview = useMemo(() => inferIdentity(apiBase), [apiBase]);
  const hasSession = token.trim().length > 0;

  async function login(passphraseValue: string) {
    const response = await fetch(`${apiBase}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: passphraseValue }),
    });

    if (!response.ok) {
      throw new Error(await authErrorMessage(response, "login"));
    }

    const payload = (await response.json()) as AuthResponse;
    setToken(payload.access_token);
    return payload;
  }

  async function handleLogin() {
    if (passphrase.trim().length < 8) {
      setStatus("Use at least 8 characters for the passphrase.");
      return;
    }
    setBusy("login");
    try {
      await login(passphrase.trim());
      setStatus("Session established.");
      router.push(safeNextPath());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Login failed");
    } finally {
      setBusy(null);
    }
  }

  async function handleBootstrap() {
    if (passphrase.trim().length < 12) {
      setStatus("Bootstrap requires a passphrase of at least 12 characters.");
      return;
    }
    setBusy("bootstrap");
    try {
      const response = await fetch(`${apiBase}/v1/auth/bootstrap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: passphrase.trim() }),
      });

      if (response.status !== 201 && response.status !== 409) {
        throw new Error(await authErrorMessage(response, "bootstrap"));
      }

      await login(passphrase.trim());
      setStatus(response.status === 201 ? "Starlog is ready." : "Starlog already existed. Session refreshed.");
      router.push(safeNextPath());
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Bootstrap failed");
    } finally {
      setBusy(null);
    }
  }

  function handleLogout() {
    setToken("");
    setPassphrase("");
    setStatus("Session cleared on this browser. Sign in again when ready.");
  }

  return (
    <main className={styles.shell}>
      <section className={styles.panel}>
        <div className={styles.brand}>
          <Link href="/today">Starlog</Link>
          <h1>{hasSession ? "Session saved" : "Sign in"}</h1>
          <p>
            {hasSession
              ? "This browser has a saved session. You can open Today, clear it, or replace it with your passphrase."
              : "Use the same passphrase on desktop and phone to sync through the hosted Starlog API."}
          </p>
        </div>

        <label className={styles.field} htmlFor="station-endpoint">
          <span>API endpoint</span>
          <input
            id="station-endpoint"
            value={apiBase}
            onChange={(event) => setApiBase(event.target.value)}
            placeholder="https://starlog-api-production.up.railway.app"
          />
        </label>

        {hasSession ? (
          <div className={styles.sessionBox} aria-label="Saved session">
            <div>
              <span>Current endpoint</span>
              <strong>{identityPreview}</strong>
            </div>
            <div>
              <span>Local browser token</span>
              <strong>Saved</strong>
            </div>
          </div>
        ) : null}

        <label className={styles.field} htmlFor="access-cipher">
          <span>Passphrase</span>
          <input
            id="access-cipher"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            type={revealPassphrase ? "text" : "password"}
            placeholder="Enter your Starlog passphrase"
          />
        </label>

        <div className={styles.buttonRow}>
          <button className={styles.primaryButton} type="button" onClick={handleLogin} disabled={busy !== null}>
            {busy === "login" ? "Signing in..." : hasSession ? "Replace session" : "Sign In"}
          </button>
          <button className={styles.secondaryButton} type="button" onClick={handleBootstrap} disabled={busy !== null}>
            {busy === "bootstrap" ? "Setting up..." : "Set Up Starlog"}
          </button>
          <button className={styles.secondaryButton} type="button" onClick={() => setRevealPassphrase((value) => !value)}>
            {revealPassphrase ? "Hide passphrase" : "Show passphrase"}
          </button>
        </div>

        {hasSession ? (
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} type="button" onClick={() => router.push("/today")}>
              Open Today
            </button>
            <button className={styles.secondaryButton} type="button" onClick={handleLogout}>
              Clear saved session
            </button>
          </div>
        ) : null}

        <p className={styles.status} aria-live="polite">{status}</p>

        {hasSession ? (
          <nav className={styles.footerNav} aria-label="Primary routes">
            <Link href="/today">Today</Link>
            <Link href="/review/decks">Decks</Link>
            <Link href="/review">Review</Link>
            <Link href="/library">Library</Link>
            <Link href="/assistant">Assistant</Link>
          </nav>
        ) : null}
      </section>
    </main>
  );
}
