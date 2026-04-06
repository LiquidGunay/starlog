"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { readEntitySnapshot, readEntitySnapshotAsync, writeEntitySnapshot } from "../lib/entity-snapshot";
import { searchLocalSnapshots } from "../lib/local-search";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type SearchResult = {
  kind:
    | "artifact"
    | "note"
    | "task"
    | "calendar_event"
    | "planner_block"
    | "assistant_command"
    | "integration_provider"
    | "sync_event";
  id: string;
  title: string;
  snippet: string;
  updated_at: string;
  metadata: Record<string, unknown>;
};

type SearchResponse = {
  query: string;
  total: number;
  results: SearchResult[];
};

const SEARCH_RESULTS_SNAPSHOT = "search.results";

function resultHref(result: SearchResult): string {
  if (result.kind === "artifact") {
    return `/artifacts?artifact=${encodeURIComponent(result.id)}`;
  }
  if (result.kind === "note") {
    return `/notes?note=${encodeURIComponent(result.id)}`;
  }
  if (result.kind === "task") {
    return `/tasks?task=${encodeURIComponent(result.id)}`;
  }
  if (result.kind === "calendar_event") {
    return `/calendar?event=${encodeURIComponent(result.id)}`;
  }
  if (result.kind === "planner_block") {
    return "/planner";
  }
  if (result.kind === "assistant_command") {
    return "/assistant";
  }
  if (result.kind === "integration_provider") {
    return "/integrations";
  }
  if (result.kind === "sync_event") {
    return "/sync-center";
  }
  return "/";
}

export default function SearchPage() {
  const { apiBase, token, outbox } = useSessionConfig();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [status, setStatus] = useState("Ready");

  useEffect(() => {
    setResults((previous) => previous.length > 0 ? previous : readEntitySnapshot<SearchResult[]>(SEARCH_RESULTS_SNAPSHOT, []));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const cachedResults = await readEntitySnapshotAsync<SearchResult[]>(SEARCH_RESULTS_SNAPSHOT, []);
      if (!cancelled && cachedResults.length > 0) {
        setResults(cachedResults);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function runSearch() {
    if (!query.trim()) {
      setStatus("Enter a query first");
      return;
    }

    try {
      const payload = await apiRequest<SearchResponse>(
        apiBase,
        token,
        `/v1/search?q=${encodeURIComponent(query.trim())}&limit=30`,
      );
      setResults(payload.results);
      writeEntitySnapshot(SEARCH_RESULTS_SNAPSHOT, payload.results);
      setStatus(`Found ${payload.total} result(s)`);
    } catch (error) {
      const fallback = await searchLocalSnapshots(query.trim(), outbox, 30);
      setResults(fallback);
      writeEntitySnapshot(SEARCH_RESULTS_SNAPSHOT, fallback);
      const detail = error instanceof Error ? error.message : "Search failed";
      setStatus(
        fallback.length > 0
          ? `Loaded ${fallback.length} cached result(s). ${detail}`
          : detail,
      );
    }
  }

  return (
    <main className="shell">
      <section className="workspace glass">
        <div>
          <p className="eyebrow">Knowledge Base</p>
          <h1>Cross-workspace retrieval</h1>
          <p className="console-copy">
            Search notes, artifacts, tasks, planner blocks, integrations, assistant history, and calendar events
            from one place. If the API is unavailable, Starlog falls back to recent local snapshots.
          </p>
          <label className="label" htmlFor="search-query">Query</label>
          <input
            id="search-query"
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="nebula, calendar, review..."
          />
          <div className="button-row">
            <button className="button" type="button" onClick={() => runSearch()}>Run Search</button>
          </div>
          <p className="status">{status}</p>
        </div>

        <div className="panel glass">
          <h2>Results</h2>
          {results.length === 0 ? (
            <p className="console-copy">No search results yet.</p>
          ) : (
            <ul>
              {results.map((result) => (
                <li key={`${result.kind}-${result.id}`}>
                  <Link className="button" href={resultHref(result)}>
                    {result.title}
                  </Link>
                  <p className="console-copy">
                    {result.kind} | updated {new Date(result.updated_at).toLocaleString()}
                  </p>
                  <p className="console-copy">{result.snippet}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
