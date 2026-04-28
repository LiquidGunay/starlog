"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PRODUCT_SURFACES, productCopy } from "@starlog/contracts";

import { useSessionConfig } from "../session-provider";

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

export function AuthEntry() {
  const router = useRouter();
  const { apiBase, token, setApiBase, setToken } = useSessionConfig();
  const [passphrase, setPassphrase] = useState("");
  const [revealPassphrase, setRevealPassphrase] = useState(false);
  const [busy, setBusy] = useState<AuthMode | null>(null);
  const [status, setStatus] = useState(productCopy.auth.readyStatus);

  const identityPreview = useMemo(() => inferIdentity(apiBase), [apiBase]);
  const hasSession = token.trim().length > 0;

  async function login(passphraseValue: string) {
    const response = await fetch(`${apiBase}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passphrase: passphraseValue }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(body || `Login failed (${response.status})`);
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
      router.push("/assistant");
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
        const body = await response.text();
        throw new Error(body || `Bootstrap failed (${response.status})`);
      }

      await login(passphrase.trim());
      setStatus(response.status === 201 ? "Starlog is ready." : "Starlog already existed. Session refreshed.");
      router.push("/assistant");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Bootstrap failed");
    } finally {
      setBusy(null);
    }
  }

  function handleLogout() {
    setToken("");
    setStatus("Session cleared on this client.");
  }

  return (
    <main className="auth-shell">
      <div className="auth-nebula" aria-hidden="true" />
      <div className="auth-orb auth-orb-top" aria-hidden="true" />
      <div className="auth-orb auth-orb-bottom" aria-hidden="true" />

      <section className="auth-column">
        <div className="auth-brand">
          <div className="auth-brand-mark">✦</div>
          <h1>{hasSession ? productCopy.auth.signedInTitle : productCopy.auth.signedOutTitle}</h1>
          <p>
            {hasSession
              ? "The current browser already carries a valid session token."
              : productCopy.auth.signedOutBody}
          </p>
        </div>

        <div className="auth-panel">
          {hasSession ? (
            <>
              <div className="auth-field">
                <label htmlFor="station-endpoint">Station endpoint</label>
                <input id="station-endpoint" value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
              </div>
              <div className="auth-session-meta">
                <div>
                  <span>Universal Identifier</span>
                  <strong>{identityPreview}</strong>
                </div>
                <div>
                  <span>Session state</span>
                  <strong>Linked</strong>
                </div>
              </div>
              <div className="auth-actions">
                <button className="auth-primary-button" type="button" onClick={() => router.push("/assistant")}>
                  Open {PRODUCT_SURFACES.assistant.label}
                </button>
                <button className="auth-secondary-button" type="button" onClick={() => router.push("/review")}>
                  Open {PRODUCT_SURFACES.review.label}
                </button>
                <button className="auth-tertiary-button" type="button" onClick={handleLogout}>
                  Clear Session
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="auth-field">
                <label htmlFor="station-endpoint">Universal Identifier</label>
                <input
                  id="station-endpoint"
                  value={apiBase}
                  onChange={(event) => setApiBase(event.target.value)}
                  placeholder="http://localhost:8000"
                />
              </div>
              <div className="auth-field">
                <div className="auth-field-row">
                  <label htmlFor="access-cipher">Passphrase</label>
                  <button type="button" className="auth-inline-action" onClick={() => setRevealPassphrase((value) => !value)}>
                    {revealPassphrase ? "Hide" : "Reveal"}
                  </button>
                </div>
                <input
                  id="access-cipher"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  type={revealPassphrase ? "text" : "password"}
                  placeholder="minimum 12 characters for first setup"
                />
              </div>
              <div className="auth-actions stacked">
                <button className="auth-primary-button" type="button" onClick={handleLogin} disabled={busy !== null}>
                  {busy === "login" ? "Signing in..." : "Sign In"}
                </button>
                <button className="auth-secondary-button" type="button" onClick={handleBootstrap} disabled={busy !== null}>
                  {busy === "bootstrap" ? "Setting up..." : "Set Up Starlog"}
                </button>
              </div>
            </>
          )}
          <p className="auth-status">{status}</p>
        </div>

        <footer className="auth-footer">
          <p>{hasSession ? "Primary routes:" : productCopy.brand.tagline}</p>
          <div className="auth-footer-links">
            <Link href="/assistant">{PRODUCT_SURFACES.assistant.label}</Link>
            <Link href="/library">{PRODUCT_SURFACES.library.label}</Link>
            <Link href="/review">{PRODUCT_SURFACES.review.label}</Link>
            <Link href="/planner">{PRODUCT_SURFACES.planner.label}</Link>
          </div>
        </footer>
      </section>
    </main>
  );
}
