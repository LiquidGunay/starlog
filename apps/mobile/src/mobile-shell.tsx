import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Text, TouchableOpacity, View } from "react-native";

import { MOBILE_TABS, type MobileTab } from "./navigation";

type MobileShellProps = {
  styles: Record<string, any>;
  palette: Record<string, string>;
};

type MobileTopBarProps = MobileShellProps & {
  activeTab: MobileTab;
  isAssistantMode: boolean;
  assistantPanelOpen: boolean;
  onToggleAssistantPanel: () => void;
  onRefresh: () => void;
  onToggleDiagnostics: () => void;
};

type MobileBottomNavProps = MobileShellProps & {
  activeTab: MobileTab;
  onSelectTab: (tab: MobileTab, label: string) => void;
};

type MobileAssistantDrawerProps = MobileShellProps & {
  open: boolean;
  activeTab: MobileTab;
  messageCount: number;
  queuedCaptureCount: number;
  pendingReply: boolean;
  onClose: () => void;
  onSelectTab: (tab: MobileTab, label: string) => void;
  onRefreshThread: () => void;
  onResetSession: () => void;
};

export function MobileTopBar({
  styles,
  palette,
  activeTab,
  isAssistantMode,
  assistantPanelOpen,
  onToggleAssistantPanel,
  onRefresh,
  onToggleDiagnostics,
}: MobileTopBarProps) {
  const surface = MOBILE_TABS.find((tab) => tab.id === activeTab);
  const surfaceLabel = isAssistantMode ? "Assistant" : surface?.label ?? "Starlog";
  const surfaceIcon = isAssistantMode ? "star-four-points-outline" : surface?.icon ?? "star-four-points-outline";

  return (
    <View style={[styles.topBar, isAssistantMode ? styles.topBarAssistant : null]}>
      <View style={[styles.topBarBrand, isAssistantMode ? styles.topBarBrandAssistant : null]}>
        {isAssistantMode ? (
          <TouchableOpacity style={styles.topBarIconButton} onPress={onToggleAssistantPanel}>
            <MaterialCommunityIcons name={assistantPanelOpen ? "close" : "menu"} size={18} color={palette.accent} />
          </TouchableOpacity>
        ) : (
          <View style={styles.topBarAvatar}>
            <MaterialCommunityIcons name={surfaceIcon as never} size={16} color={palette.accent} />
          </View>
        )}
        <View style={{ gap: 0 }}>
          <Text style={[styles.topBarTitle, isAssistantMode ? styles.topBarTitleAssistant : null]}>
            {isAssistantMode ? "Assistant" : `Starlog ${surfaceLabel}`}
          </Text>
        </View>
      </View>
      {isAssistantMode ? (
        <View style={[styles.topBarAssistantStatus, { alignItems: "flex-end" }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <View style={styles.topBarAssistantStatusDot} />
            <Text style={styles.topBarAssistantStatusText}>Live</Text>
          </View>
        </View>
      ) : (
        <View style={styles.topBarActions}>
          <TouchableOpacity style={styles.topBarIconButton} onPress={onRefresh}>
            <MaterialCommunityIcons name="sync" size={16} color={palette.accent} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBarIconButton} onPress={onToggleDiagnostics}>
            <MaterialCommunityIcons name="tune-variant" size={18} color={palette.tertiary} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function MobileAssistantDrawer({
  open,
  activeTab,
  messageCount,
  queuedCaptureCount,
  pendingReply,
  onClose,
  onSelectTab,
  onRefreshThread,
  onResetSession,
  styles,
  palette,
}: MobileAssistantDrawerProps) {
  if (!open) {
    return null;
  }

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 30,
        flexDirection: "row",
      }}
      pointerEvents="box-none"
    >
      <View
        style={{
          width: 272,
          maxWidth: "82%",
          paddingHorizontal: 16,
          paddingTop: 88,
          paddingBottom: 24,
          backgroundColor: "rgba(34, 19, 27, 0.98)",
          borderRightWidth: 1,
          borderRightColor: "rgba(241, 182, 205, 0.08)",
          gap: 18,
        }}
      >
        <View style={{ gap: 6 }}>
          <Text style={[styles.sectionKicker, { color: palette.accent }]}>Workspace</Text>
          <Text style={[styles.panelTitle, { fontSize: 23, lineHeight: 27 }]}>Stay in the thread</Text>
          <Text style={styles.subtle}>Open Library, Planner, or Review when you need the deeper surface.</Text>
        </View>
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {["Shared transcript", "Docked composer", "Secondary surfaces"].map((label) => (
            <View
              key={label}
              style={{
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 6,
                backgroundColor: "rgba(255,255,255,0.03)",
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.05)",
              }}
            >
              <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                {label}
              </Text>
            </View>
          ))}
        </View>
        <View
          style={{
            borderRadius: 22,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.05)",
            backgroundColor: "rgba(255,255,255,0.02)",
            padding: 14,
            gap: 10,
          }}
        >
          <Text style={[styles.sectionKicker, { color: palette.accent }]}>Thread state</Text>
          <View style={{ flexDirection: "row", gap: 10 }}>
            {[
              { label: pendingReply ? "Live" : "Ready", meta: "Assistant" },
              { label: String(messageCount), meta: "Messages" },
              { label: String(queuedCaptureCount), meta: "Queued" },
            ].map((item) => (
              <View
                key={`${item.meta}-${item.label}`}
                style={{
                  flex: 1,
                  borderRadius: 16,
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                  backgroundColor: "rgba(255,255,255,0.025)",
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.04)",
                  gap: 4,
                }}
              >
                <Text style={{ color: palette.text, fontSize: 16, fontWeight: "800" }}>{item.label}</Text>
                <Text style={{ color: palette.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.7 }}>
                  {item.meta}
                </Text>
              </View>
            ))}
          </View>
        </View>
        <View style={{ gap: 10 }}>
          {MOBILE_TABS.map((tab) => (
            <TouchableOpacity
              key={tab.id}
              style={{
                borderRadius: 20,
                paddingHorizontal: 14,
                paddingVertical: 13,
                borderWidth: 1,
                borderColor: activeTab === tab.id ? "rgba(241, 182, 205, 0.16)" : "rgba(255,255,255,0.05)",
                backgroundColor: activeTab === tab.id ? "rgba(88, 53, 69, 0.92)" : "rgba(255,255,255,0.03)",
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}
              onPress={() => {
                onSelectTab(tab.id, tab.label);
                onClose();
              }}
            >
              <MaterialCommunityIcons
                name={tab.icon as never}
                size={18}
                color={activeTab === tab.id ? palette.accent : palette.muted}
              />
              <Text style={{ color: activeTab === tab.id ? palette.text : palette.muted, fontSize: 14, fontWeight: "700" }}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <View
          style={{
            borderRadius: 22,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.05)",
            backgroundColor: "rgba(255,255,255,0.03)",
            padding: 14,
            gap: 10,
          }}
        >
          <Text style={[styles.sectionKicker, { color: palette.secondary }]}>Thread tools</Text>
          <TouchableOpacity style={styles.button} onPress={onRefreshThread}>
            <Text style={styles.buttonText}>Refresh thread</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={onResetSession}>
            <Text style={styles.buttonText}>Reset session</Text>
          </TouchableOpacity>
        </View>
      </View>
      <TouchableOpacity
        style={{ flex: 1, backgroundColor: "rgba(8, 5, 8, 0.42)" }}
        activeOpacity={1}
        onPress={onClose}
      />
    </View>
  );
}

export function MobileBottomNav({ styles, palette, activeTab, onSelectTab }: MobileBottomNavProps) {
  return (
    <View style={styles.bottomNav}>
      {MOBILE_TABS.map((tab) => (
        <TouchableOpacity
          key={tab.id}
          style={[styles.bottomNavItem, activeTab === tab.id ? styles.bottomNavItemActive : null]}
          onPress={() => onSelectTab(tab.id, tab.label)}
        >
          <MaterialCommunityIcons
            name={tab.icon as never}
            size={20}
            color={activeTab === tab.id ? palette.accent : "#49473f"}
          />
          <Text style={[styles.bottomNavLabel, activeTab === tab.id ? styles.bottomNavLabelActive : null]}>
            {tab.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
