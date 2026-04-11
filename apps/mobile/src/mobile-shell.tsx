import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Text, TouchableOpacity, View } from "react-native";

import { MOBILE_TABS, type MobileTab } from "./navigation";

type MobileShellProps = {
  styles: Record<string, any>;
  palette: Record<string, string>;
};

type MobileTopBarProps = MobileShellProps & {
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
  onClose: () => void;
  onSelectTab: (tab: MobileTab, label: string) => void;
  onRefreshThread: () => void;
  onResetSession: () => void;
};

export function MobileTopBar({
  styles,
  palette,
  isAssistantMode,
  assistantPanelOpen,
  onToggleAssistantPanel,
  onRefresh,
  onToggleDiagnostics,
}: MobileTopBarProps) {
  return (
    <View style={[styles.topBar, isAssistantMode ? styles.topBarAssistant : null]}>
      <View style={[styles.topBarBrand, isAssistantMode ? styles.topBarBrandAssistant : null]}>
        {isAssistantMode ? (
          <TouchableOpacity style={styles.topBarIconButton} onPress={onToggleAssistantPanel}>
            <MaterialCommunityIcons name={assistantPanelOpen ? "close" : "menu"} size={18} color={palette.accent} />
          </TouchableOpacity>
        ) : (
          <View style={styles.topBarAvatar}>
            <Text style={styles.topBarAvatarText}>◉</Text>
          </View>
        )}
        <View style={{ gap: 2 }}>
          <Text style={[styles.topBarTitle, isAssistantMode ? styles.topBarTitleAssistant : null]}>Starlog</Text>
          {isAssistantMode ? <Text style={styles.topBarAssistantCaption}>Assistant</Text> : null}
        </View>
      </View>
      {isAssistantMode ? (
        <View style={styles.topBarAssistantStatus}>
          <View style={styles.topBarAssistantStatusDot} />
          <Text style={styles.topBarAssistantStatusText}>Live thread</Text>
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
          width: 280,
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
          <Text style={[styles.panelTitle, { fontSize: 24, lineHeight: 28 }]}>Move between surfaces</Text>
          <Text style={styles.subtle}>Keep Assistant primary, then step into Library, Planner, or Review when you need the deeper view.</Text>
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
