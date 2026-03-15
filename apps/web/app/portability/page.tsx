"use client";

import { useEffect, useMemo, useState } from "react";

import { readEntitySnapshot, readEntitySnapshotAsync, writeEntitySnapshot } from "../lib/entity-snapshot";
import { apiRequest } from "../lib/starlog-client";
import { useSessionConfig } from "../session-provider";

type ExportPayload = {
  exported_at: string;
  manifest: {
    table_counts?: Record<string, number>;
    format_version?: string;
  };
  notes_markdown: Record<string, string>;
  entities: Record<string, Array<Record<string, unknown>>>;
};

type RestoreResponse = {
  restored_tables: Record<string, number>;
  restored_at: string;
};

const PORTABILITY_EXPORT_SNAPSHOT = "portability.export_payload";
const PORTABILITY_IMPORT_TEXT_SNAPSHOT = "portability.import_text";

export default function PortabilityPage() {
  const { apiBase, token } = useSessionConfig();
  const [exportPayload, setExportPayload] = useState<ExportPayload | null>(
    () => readEntitySnapshot<ExportPayload | null>(PORTABILITY_EXPORT_SNAPSHOT, null),
  );
  const [importText, setImportText] = useState(
    () => readEntitySnapshot<string>(PORTABILITY_IMPORT_TEXT_SNAPSHOT, ""),
  );
  const [status, setStatus] = useState("Ready");

  const tableCounts = useMemo(
    () => Object.entries(exportPayload?.manifest.table_counts ?? {}).sort((left, right) => left[0].localeCompare(right[0])),
    [exportPayload],
  );

  useEffect(() => {
    setExportPayload((previous) => previous ?? readEntitySnapshot<ExportPayload | null>(PORTABILITY_EXPORT_SNAPSHOT, null));
    setImportText((previous) => previous || readEntitySnapshot<string>(PORTABILITY_IMPORT_TEXT_SNAPSHOT, ""));
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [cachedExportPayload, cachedImportText] = await Promise.all([
        readEntitySnapshotAsync<ExportPayload | null>(PORTABILITY_EXPORT_SNAPSHOT, null),
        readEntitySnapshotAsync<string>(PORTABILITY_IMPORT_TEXT_SNAPSHOT, ""),
      ]);

      if (cancelled) {
        return;
      }

      if (cachedExportPayload) {
        setExportPayload(cachedExportPayload);
      }
      if (cachedImportText) {
        setImportText(cachedImportText);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function loadExport() {
    try {
      const payload = await apiRequest<ExportPayload>(apiBase, token, "/v1/export");
      setExportPayload(payload);
      setImportText(JSON.stringify(payload, null, 2));
      writeEntitySnapshot(PORTABILITY_EXPORT_SNAPSHOT, payload);
      writeEntitySnapshot(PORTABILITY_IMPORT_TEXT_SNAPSHOT, JSON.stringify(payload, null, 2));
      setStatus(`Loaded export snapshot from ${new Date(payload.exported_at).toLocaleString()}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load export");
    }
  }

  function downloadExport() {
    if (!exportPayload) {
      setStatus("Load an export snapshot first");
      return;
    }

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], { type: "application/json" });
    const url = window.URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = `starlog-export-${exportPayload.exported_at}.json`;
    anchor.click();
    window.URL.revokeObjectURL(url);
    setStatus("Downloaded export snapshot");
  }

  async function restoreExport() {
    let parsed: ExportPayload;
    try {
      parsed = JSON.parse(importText) as ExportPayload;
    } catch {
      setStatus("Import payload is not valid JSON");
      return;
    }

    try {
      const response = await apiRequest<RestoreResponse>(apiBase, token, "/v1/import/export", {
        method: "POST",
        body: JSON.stringify({
          export_payload: parsed,
          replace_existing: true,
        }),
      });
      setStatus(`Restored export at ${new Date(response.restored_at).toLocaleString()}`);
      await loadExport();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to restore export");
    }
  }

  useEffect(() => {
    writeEntitySnapshot(PORTABILITY_EXPORT_SNAPSHOT, exportPayload);
  }, [exportPayload]);

  useEffect(() => {
    writeEntitySnapshot(PORTABILITY_IMPORT_TEXT_SNAPSHOT, importText);
  }, [importText]);

  return (
    <main className="shell">
      <section className="workspace glass">
        <div>
          <p className="eyebrow">Artifact Nexus</p>
          <h1>Export, restore, and verification</h1>
          <p className="console-copy">
            Use the API snapshot directly, restore it into the local Starlog database, and validate with `make verify-export`.
          </p>
          <div className="button-row">
            <button className="button" type="button" onClick={() => loadExport()}>Load Export</button>
            <button className="button" type="button" onClick={() => downloadExport()}>Download JSON</button>
            <button className="button" type="button" onClick={() => restoreExport()}>Restore Snapshot</button>
          </div>
          <p className="status">{status}</p>
          <label className="label" htmlFor="portability-import">Export JSON</label>
          <textarea
            id="portability-import"
            className="textarea"
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
          />
        </div>

        <div className="panel glass">
          <h2>Manifest</h2>
          {!exportPayload ? (
            <p className="console-copy">No export loaded yet.</p>
          ) : (
            <div>
              <p className="console-copy">
                Format: {exportPayload.manifest.format_version || "unknown"} | exported {new Date(exportPayload.exported_at).toLocaleString()}
              </p>
              <p className="console-copy">Markdown notes: {Object.keys(exportPayload.notes_markdown || {}).length}</p>
              {tableCounts.map(([table, count]) => (
                <p key={table} className="console-copy">
                  {table}: {count}
                </p>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
