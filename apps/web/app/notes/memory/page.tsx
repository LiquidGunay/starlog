"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { AprilWorkspaceShell } from "../../components/april-observatory-shell";
import { apiRequest } from "../../lib/starlog-client";
import { useSessionConfig } from "../../session-provider";

type MemoryTreeNode = {
  kind: "directory" | "page";
  name: string;
  path: string;
  page_id?: string | null;
  title?: string | null;
  namespace?: string | null;
  status?: string | null;
  children?: MemoryTreeNode[];
};

type MemoryPage = {
  id: string;
  path: string;
  title: string;
  kind: string;
  namespace: string;
  status: string;
  latest_version: number;
  markdown_source: string;
  backlinks: Array<{ id: string; relation_type: string; source_page_id: string; target_id: string }>;
  linked_entities: Array<{ id: string; relation_type: string; target_type: string; target_id: string }>;
};

type ProfileProposal = {
  id: string;
  title: string;
  path: string;
  rationale?: string | null;
};

function flattenPages(node: MemoryTreeNode): MemoryTreeNode[] {
  if (node.kind === "page") {
    return [node];
  }
  return (node.children || []).flatMap(flattenPages);
}

function MemoryVaultPageContent() {
  const searchParams = useSearchParams();
  const { apiBase, token } = useSessionConfig();
  const [tree, setTree] = useState<MemoryTreeNode | null>(null);
  const [page, setPage] = useState<MemoryPage | null>(null);
  const [editorValue, setEditorValue] = useState("");
  const [status, setStatus] = useState("Loading memory vault…");
  const [createTitle, setCreateTitle] = useState("New project page");
  const [createKind, setCreateKind] = useState("project");
  const [createNamespace, setCreateNamespace] = useState("wiki/projects");
  const [proposals, setProposals] = useState<ProfileProposal[]>([]);

  const flatPages = useMemo(() => (tree ? flattenPages(tree) : []), [tree]);
  const requestedPageId = searchParams.get("page") || "";

  async function loadTree(preferredPageId?: string) {
    const payload = await apiRequest<{ tree: MemoryTreeNode }>(apiBase, token, "/v1/memory/tree");
    setTree(payload.tree);
    const pages = flattenPages(payload.tree);
    const target = preferredPageId || requestedPageId || pages[0]?.page_id || "";
    if (target) {
      await loadPage(target);
    } else {
      setPage(null);
      setEditorValue("");
    }
  }

  async function loadPage(pageId: string) {
    const payload = await apiRequest<MemoryPage>(apiBase, token, `/v1/memory/pages/${pageId}`);
    setPage(payload);
    setEditorValue(payload.markdown_source);
    setStatus(`Loaded ${payload.path}`);
  }

  async function loadProposals() {
    try {
      const payload = await apiRequest<ProfileProposal[]>(apiBase, token, "/v1/memory/profile-proposals");
      setProposals(payload);
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    void (async () => {
      try {
        await Promise.all([loadTree(), loadProposals()]);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "Failed to load memory vault");
      }
    })();
  }, [apiBase, token]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!requestedPageId) {
      return;
    }
    void loadPage(requestedPageId).catch((error) => {
      setStatus(error instanceof Error ? error.message : "Failed to load requested memory page");
    });
  }, [requestedPageId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function savePage() {
    if (!page) {
      setStatus("Select a memory page first");
      return;
    }
    setStatus(`Saving ${page.path}…`);
    try {
      const updated = await apiRequest<MemoryPage>(apiBase, token, `/v1/memory/pages/${page.id}`, {
        method: "PUT",
        body: JSON.stringify({
          markdown_source: editorValue,
          base_version: page.latest_version,
        }),
      });
      setPage(updated);
      setEditorValue(updated.markdown_source);
      await loadTree(updated.id);
      setStatus(`Saved ${updated.path}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to save memory page");
    }
  }

  async function createPage() {
    setStatus("Creating memory page…");
    try {
      const created = await apiRequest<MemoryPage>(apiBase, token, "/v1/memory/pages", {
        method: "POST",
        body: JSON.stringify({
          title: createTitle,
          kind: createKind,
          namespace: createNamespace,
          body_md: "",
          tags: [],
        }),
      });
      await loadTree(created.id);
      setStatus(`Created ${created.path}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to create memory page");
    }
  }

  async function confirmProposal(proposalId: string) {
    setStatus("Confirming profile proposal…");
    try {
      const confirmed = await apiRequest<MemoryPage>(apiBase, token, `/v1/memory/profile-proposals/${proposalId}/confirm`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await Promise.all([loadTree(confirmed.id), loadProposals()]);
      setStatus(`Confirmed ${confirmed.path}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to confirm profile proposal");
    }
  }

  async function dismissProposal(proposalId: string) {
    setStatus("Dismissing profile proposal…");
    try {
      await apiRequest(apiBase, token, `/v1/memory/profile-proposals/${proposalId}/dismiss`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadProposals();
      setStatus("Dismissed profile proposal");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to dismiss profile proposal");
    }
  }

  return (
    <AprilWorkspaceShell
      activeSurface="knowledge-base"
      statusLabel={status}
      queueLabel={`${proposals.length} pending profile proposal${proposals.length === 1 ? "" : "s"}`}
      searchPlaceholder="Search memory pages"
    >
      <div style={{ display: "grid", gap: "1rem" }}>
        <section style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, padding: "1rem", background: "rgba(7,13,24,0.72)", display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
          <div>
            <p style={{ margin: 0, textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 12, opacity: 0.65 }}>Library</p>
            <h1 style={{ margin: "0.35rem 0 0.5rem", fontSize: "2rem" }}>Memory Vault</h1>
            <p style={{ margin: 0, maxWidth: 720, opacity: 0.8 }}>
              Edit the long-term Markdown vault, inspect page links, and confirm pending profile promotions.
            </p>
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <Link href="/notes">Open notes</Link>
            <Link href="/assistant">Open Assistant</Link>
          </div>
        </section>

        <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "1rem" }}>
        <section style={{ display: "grid", gap: "1rem" }}>
          <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, padding: "1rem", background: "rgba(7,13,24,0.72)" }}>
            <h3 style={{ marginTop: 0 }}>Create page</h3>
            <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              <span>Title</span>
              <input value={createTitle} onChange={(event) => setCreateTitle(event.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              <span>Kind</span>
              <input value={createKind} onChange={(event) => setCreateKind(event.target.value)} />
            </label>
            <label style={{ display: "grid", gap: 6, marginBottom: 12 }}>
              <span>Namespace</span>
              <select value={createNamespace} onChange={(event) => setCreateNamespace(event.target.value)}>
                <option value="wiki/projects">wiki/projects</option>
                <option value="wiki/concepts">wiki/concepts</option>
                <option value="wiki/sources">wiki/sources</option>
                <option value="wiki/people">wiki/people</option>
                <option value="wiki/decisions">wiki/decisions</option>
                <option value="wiki/questions">wiki/questions</option>
              </select>
            </label>
            <button type="button" onClick={createPage}>Create page</button>
          </div>

          <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, padding: "1rem", background: "rgba(7,13,24,0.72)" }}>
            <h3 style={{ marginTop: 0 }}>Vault pages</h3>
            <div style={{ display: "grid", gap: 8, maxHeight: 420, overflow: "auto" }}>
              {flatPages.map((item) => (
                <button
                  key={item.page_id || item.path}
                  type="button"
                  onClick={() => item.page_id && loadPage(item.page_id)}
                  style={{
                    textAlign: "left",
                    borderRadius: 14,
                    border: page?.id === item.page_id ? "1px solid rgba(248,198,85,0.9)" : "1px solid rgba(255,255,255,0.08)",
                    padding: "0.8rem",
                    background: page?.id === item.page_id ? "rgba(248,198,85,0.12)" : "rgba(255,255,255,0.03)",
                  }}
                >
                  <strong>{item.title || item.name}</strong>
                  <div style={{ opacity: 0.75, fontSize: 13 }}>{item.path}</div>
                  <div style={{ opacity: 0.6, fontSize: 12 }}>{item.namespace} · {item.status}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, padding: "1rem", background: "rgba(7,13,24,0.72)" }}>
            <h3 style={{ marginTop: 0 }}>Pending profile proposals</h3>
            <div style={{ display: "grid", gap: 10 }}>
              {proposals.length === 0 ? <p style={{ margin: 0, opacity: 0.72 }}>No pending proposals.</p> : null}
              {proposals.map((proposal) => (
                <div key={proposal.id} style={{ border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: "0.8rem" }}>
                  <strong>{proposal.title}</strong>
                  <div style={{ opacity: 0.72, fontSize: 13 }}>{proposal.path}</div>
                  {proposal.rationale ? <p style={{ marginBottom: 12 }}>{proposal.rationale}</p> : null}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => confirmProposal(proposal.id)}>Confirm</button>
                    <button type="button" onClick={() => dismissProposal(proposal.id)}>Dismiss</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section style={{ border: "1px solid rgba(255,255,255,0.12)", borderRadius: 18, padding: "1rem", background: "rgba(7,13,24,0.72)", display: "grid", gap: "0.75rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start" }}>
            <div>
              <h3 style={{ margin: 0 }}>{page?.title || "Memory page"}</h3>
              <p style={{ margin: "0.35rem 0 0", opacity: 0.72 }}>
                {page ? `${page.path} · v${page.latest_version} · ${page.namespace}` : "Select a page to edit its Markdown source."}
              </p>
            </div>
            <button type="button" onClick={savePage} disabled={!page}>Save page</button>
          </div>
          <textarea
            value={editorValue}
            onChange={(event) => setEditorValue(event.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: 520,
              resize: "vertical",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(2,6,15,0.84)",
              color: "inherit",
              padding: "1rem",
              fontFamily: "monospace",
              fontSize: 14,
              lineHeight: 1.5,
            }}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            <div>
              <h4>Backlinks</h4>
              <ul>
                {(page?.backlinks || []).map((edge) => (
                  <li key={edge.id}>{edge.relation_type} from {edge.source_page_id}</li>
                ))}
              </ul>
            </div>
            <div>
              <h4>Linked entities</h4>
              <ul>
                {(page?.linked_entities || []).map((edge) => (
                  <li key={edge.id}>{edge.relation_type} {"->"} {edge.target_type}:{edge.target_id}</li>
                ))}
              </ul>
            </div>
          </div>
          <p style={{ margin: 0, opacity: 0.75 }}>{status}</p>
        </section>
        </div>
      </div>
    </AprilWorkspaceShell>
  );
}

export default function MemoryVaultPage() {
  return (
    <Suspense fallback={<main className="shell"><section className="observatory-panel glass"><p className="status">Loading memory vault...</p></section></main>}>
      <MemoryVaultPageContent />
    </Suspense>
  );
}
