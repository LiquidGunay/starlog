import { productCardLabel } from "@starlog/contracts";

export function mobileConversationCardLabel(kind: string, title?: string | null): string {
  return productCardLabel(kind);
}
