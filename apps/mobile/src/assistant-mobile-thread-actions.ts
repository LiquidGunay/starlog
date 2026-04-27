import type { AssistantCard, AssistantCardAction, AssistantEntityRef } from "@starlog/contracts";
import type { MobileTab } from "./navigation";
import {
  mobileTabForAssistantHref,
  supportSurfaceActionLabel,
  supportSurfaceForEntityType,
} from "./assistant-mobile-ui";

type OpenWebPath = (path: string, failureLabel: string) => Promise<void>;
type RefreshCallback = () => void;
type ActivateSurface = (tab: MobileTab) => void;
type SetStatus = (value: string) => void;
type SetDraft = (value: string) => void;
type ReloadConversation = () => Promise<void>;

type MobileEntityNavigationOptions = {
  activateSurface: ActivateSurface;
  openWebPath: OpenWebPath;
  setStatus: SetStatus;
};

type MobileCardActionOptions = {
  apiBase: string;
  token: string;
  activateSurface: ActivateSurface;
  setHomeDraft: SetDraft;
  setStatus: SetStatus;
  openWebPath: OpenWebPath;
  reloadConversation: ReloadConversation;
  reloadArtifacts: RefreshCallback;
  reloadDueCards: RefreshCallback;
};

function jsonHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function openAssistantEntityOnMobile(
  entityRef: AssistantEntityRef,
  options: MobileEntityNavigationOptions,
): Promise<void> {
  const href = typeof entityRef.href === "string" ? entityRef.href.trim() : "";
  if (href) {
    const tab = mobileTabForAssistantHref(href);
    if (tab) {
      options.activateSurface(tab);
      return;
    }
    await options.openWebPath(href, `Failed to open ${supportSurfaceActionLabel(entityRef)}`);
    return;
  }

  const surface = supportSurfaceForEntityType(entityRef.entity_type);
  if (surface === "library" || surface === "planner" || surface === "review") {
    options.activateSurface(surface);
    return;
  }

  options.setStatus(`${supportSurfaceActionLabel(entityRef)} is not available on mobile yet`);
}

export async function handleAssistantCardActionOnMobile(
  action: AssistantCardAction,
  card: AssistantCard,
  options: MobileCardActionOptions,
): Promise<void> {
  if (action.kind === "navigate") {
    const href = typeof action.payload?.href === "string" ? action.payload.href : "";
    if (!href) {
      options.setStatus(`Action "${action.label}" is missing a destination`);
      return;
    }
    const tab = mobileTabForAssistantHref(href);
    if (tab) {
      options.activateSurface(tab);
      return;
    }
    await options.openWebPath(href, `Failed to open ${action.label.toLowerCase()}`);
    return;
  }

  if (action.kind === "composer") {
    const prompt = typeof action.payload?.prompt === "string" ? action.payload.prompt : card.body || card.title || "";
    options.activateSurface("assistant");
    options.setHomeDraft(prompt);
    options.setStatus(`Loaded "${action.label}" into Assistant`);
    return;
  }

  const endpoint = typeof action.payload?.endpoint === "string" ? action.payload.endpoint : "";
  const method = typeof action.payload?.method === "string" ? action.payload.method : "POST";
  const body = action.payload?.body ?? {};
  if (!endpoint) {
    options.setStatus(`Action "${action.label}" is missing an endpoint`);
    return;
  }

  options.setStatus(`${action.label}...`);
  try {
    const response = await fetch(`${options.apiBase}${endpoint}`, {
      method,
      headers: jsonHeaders(options.token),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`${action.label} failed: ${response.status} ${errorBody}`);
    }

    await options.reloadConversation();
    if (card.kind === "capture_item" || card.kind === "knowledge_note") {
      options.reloadArtifacts();
    }
    if (card.kind === "review_queue") {
      options.reloadDueCards();
    }
    options.setStatus(`${action.label} complete`);
  } catch (error) {
    options.setStatus(error instanceof Error ? error.message : `${action.label} failed`);
  }
}
