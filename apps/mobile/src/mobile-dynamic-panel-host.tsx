import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import type { AssistantInterrupt } from "@starlog/contracts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Modal, ScrollView, Text as RNText, TouchableOpacity, View } from "react-native";

import {
  defaultPanelValues,
  nextMobileSheetLifecycleState,
  panelKicker,
  shouldHostPanelInNativeSheet,
  type MobileDynamicPanelState,
} from "./mobile-assistant-panel-state";

const TEXT_PROPS = { maxFontSizeMultiplier: 1.08 } as const;

function Text({ maxFontSizeMultiplier = TEXT_PROPS.maxFontSizeMultiplier, ...props }: ComponentProps<typeof RNText>) {
  return <RNText maxFontSizeMultiplier={maxFontSizeMultiplier} {...props} />;
}

export type MobileDynamicPanelHostProps = {
  interrupts: AssistantInterrupt[];
  panelStates: MobileDynamicPanelState[];
  palette: Record<string, string>;
  renderPanel: (interrupt: AssistantInterrupt, values: Record<string, unknown>, onResolve: () => void) => ReactNode;
};

export function MobileDynamicPanelHost({ interrupts, panelStates, palette, renderPanel }: MobileDynamicPanelHostProps) {
  const [openSheetInterruptId, setOpenSheetInterruptId] = useState<string | null>(null);
  const [dismissedSheetInterruptId, setDismissedSheetInterruptId] = useState<string | null>(null);
  const panelStateById = useMemo(
    () => new Map(panelStates.map((state) => [state.interrupt.id, state])),
    [panelStates],
  );
  const hostPanelStates = useMemo(
    () => interrupts.map((interrupt) => panelStateById.get(interrupt.id)).filter((state): state is MobileDynamicPanelState => Boolean(state)),
    [interrupts, panelStateById],
  );
  const activeSheetPanelState = hostPanelStates.find(shouldHostPanelInNativeSheet) || null;
  const activeSheetInterruptId = activeSheetPanelState?.interrupt.id ?? null;
  const visibleSheetPanelState =
    activeSheetPanelState && openSheetInterruptId === activeSheetPanelState.interrupt.id ? activeSheetPanelState : null;
  const hostSheetState = {
    hasSheetCandidate: activeSheetPanelState !== null,
    isSheetOpen: visibleSheetPanelState !== null,
    activeSheetInterruptId: activeSheetInterruptId || "",
    queuedCount: hostPanelStates.filter((state) => state.renderState === "queued").length,
  };

  useEffect(() => {
    const nextSheetState = nextMobileSheetLifecycleState(activeSheetInterruptId, {
      openSheetInterruptId,
      dismissedSheetInterruptId,
    });
    if (nextSheetState.openSheetInterruptId !== openSheetInterruptId) {
      setOpenSheetInterruptId(nextSheetState.openSheetInterruptId);
    }
    if (nextSheetState.dismissedSheetInterruptId !== dismissedSheetInterruptId) {
      setDismissedSheetInterruptId(nextSheetState.dismissedSheetInterruptId);
    }
  }, [activeSheetInterruptId, dismissedSheetInterruptId, openSheetInterruptId]);

  const closeSheetForActiveInterrupt = () => {
    setDismissedSheetInterruptId(activeSheetInterruptId);
    setOpenSheetInterruptId(null);
  };

  const closeSheetForInterrupt = (interruptId: string) => {
    setDismissedSheetInterruptId(interruptId);
    setOpenSheetInterruptId(null);
  };

  const reopenSheetForInterrupt = (interruptId: string) => {
    setDismissedSheetInterruptId(null);
    setOpenSheetInterruptId(interruptId);
  };

  return (
    <View style={{ gap: 10, paddingLeft: 10 }} testID="mobile-dynamic-panel-host">
      <View
        testID="mobile-dynamic-panel-host-state"
        accessibilityRole="status"
        accessibilityLabel="Mobile dynamic panel host state"
        accessibilityValue={{ text: hostSheetState.isSheetOpen ? "sheet-open" : "sheet-closed" }}
        accessibilityState={{ busy: hostSheetState.hasSheetCandidate }}
        style={{ height: 1, width: 1, opacity: 0.01 }}
        pointerEvents="none"
      />
      {interrupts.map((interrupt) => {
        const panelState = panelStateById.get(interrupt.id);
        const effectiveInterrupt = panelState?.interrupt || interrupt;
        const values = panelState?.values || defaultPanelValues(effectiveInterrupt);
          if (panelState?.renderState === "queued") {
            return (
              <View
                key={effectiveInterrupt.id}
                testID={`mobile-dynamic-panel-queued-${effectiveInterrupt.id}`}
                accessibilityRole="status"
                accessibilityLabel={`Queued dynamic panel ${effectiveInterrupt.id}`}
                accessibilityValue={{ text: "queued" }}
                style={{
                borderRadius: 14,
                paddingHorizontal: 11,
                paddingVertical: 9,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.05)",
                backgroundColor: "rgba(255,255,255,0.014)",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              <MaterialCommunityIcons name={"clock-outline" as never} size={14} color={palette.muted} />
              <Text style={{ flex: 1, color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>
                {panelKicker(effectiveInterrupt)} is waiting behind the active decision.
              </Text>
            </View>
          );
        }
          if (panelState && shouldHostPanelInNativeSheet(panelState)) {
            return (
              <TouchableOpacity
                key={effectiveInterrupt.id}
                testID={`mobile-dynamic-panel-sheet-row-${effectiveInterrupt.id}`}
                style={{
                borderRadius: 14,
                paddingHorizontal: 11,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.05)",
                backgroundColor: "rgba(255,255,255,0.014)",
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
                onPress={() => reopenSheetForInterrupt(effectiveInterrupt.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${panelKicker(effectiveInterrupt)} sheet`}
                accessibilityValue={{ text: `sheet:${effectiveInterrupt.id}` }}
              >
              <MaterialCommunityIcons name={"dock-bottom" as never} size={15} color={palette.accent} />
              <Text style={{ flex: 1, color: palette.muted, fontSize: 12.5, lineHeight: 18 }}>
                {panelKicker(effectiveInterrupt)} is open in a sheet.
              </Text>
              <MaterialCommunityIcons name={"chevron-up" as never} size={17} color={palette.muted} />
            </TouchableOpacity>
          );
        }
        return (
          <View key={effectiveInterrupt.id}>
            {renderPanel(effectiveInterrupt, values, () => closeSheetForInterrupt(effectiveInterrupt.id))}
          </View>
        );
      })}

      <Modal visible={Boolean(visibleSheetPanelState)} transparent animationType="slide" onRequestClose={closeSheetForActiveInterrupt}>
        <View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.48)" }} testID="mobile-dynamic-panel-sheet">
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={closeSheetForActiveInterrupt}
            accessibilityRole="button"
            accessibilityLabel="Close assistant sheet"
            accessibilityValue={{ text: "close-sheet" }}
            testID="mobile-dynamic-panel-sheet-backdrop"
          />
          <View
            testID="mobile-dynamic-panel-sheet-content"
            accessibilityRole="summary"
            accessibilityState={{ expanded: visibleSheetPanelState !== null }}
            style={{
              maxHeight: "84%",
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 14,
              paddingTop: 10,
              paddingBottom: 18,
              backgroundColor: "#101720",
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <View style={{ alignItems: "center", paddingBottom: 10 }}>
              <View
                style={{
                  width: 44,
                  height: 4,
                  borderRadius: 999,
                  backgroundColor: "rgba(255,255,255,0.18)",
                }}
              />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
              {visibleSheetPanelState
                ? renderPanel(visibleSheetPanelState.interrupt, visibleSheetPanelState.values, () =>
                    closeSheetForInterrupt(visibleSheetPanelState.interrupt.id),
                  )
                : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
