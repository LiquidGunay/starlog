import { ReactNode } from "react";
import { Text, TouchableOpacity, View } from "react-native";

type SharedProps = {
  styles: Record<string, any>;
};

type MobileOpsChipProps = SharedProps & {
  label: string;
  active: boolean;
  onPress: () => void;
};

type MobileSupportPanelSection<Section extends string> = {
  id: Section;
  label: string;
  content: ReactNode;
};

type MobileSupportPanelProps<Section extends string> = SharedProps & {
  visible: boolean;
  kicker: string;
  title: string;
  description: string;
  activeSection: Section;
  onSelectSection: (section: Section) => void;
  sections: Array<MobileSupportPanelSection<Section>>;
};

export function MobileOpsChip({ styles, label, active, onPress }: MobileOpsChipProps) {
  return (
    <TouchableOpacity
      style={[styles.opsChip, active ? styles.opsChipActive : null]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <Text style={[styles.opsChipText, active ? styles.opsChipTextActive : null]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function MobileSupportPanel<Section extends string>({
  visible,
  kicker,
  title,
  description,
  activeSection,
  onSelectSection,
  sections,
  styles,
}: MobileSupportPanelProps<Section>) {
  if (!visible) {
    return null;
  }

  const active = sections.find((section) => section.id === activeSection) ?? sections[0];
  if (!active) {
    return null;
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.sectionKicker}>{kicker}</Text>
      <Text style={styles.panelTitle}>{title}</Text>
      <Text style={styles.subtle}>{description}</Text>
      <View style={styles.opsChipRow}>
        {sections.map((section) => (
          <MobileOpsChip
            key={section.id}
            styles={styles}
            label={section.label}
            active={section.id === activeSection}
            onPress={() => onSelectSection(section.id)}
          />
        ))}
      </View>
      <View style={styles.opsSectionCard}>{active.content}</View>
    </View>
  );
}
