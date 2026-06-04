import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { CardBlock as CardBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import { colors, fontSize, radius, space, weight } from "../../theme/tokens";

const STATUS: Record<
  string,
  { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  pending: { label: "Pending", color: colors.warn, icon: "time-outline" },
  approved: { label: "Approved", color: colors.ok, icon: "checkmark-circle-outline" },
  rejected: { label: "Rejected", color: colors.fail, icon: "close-circle-outline" },
  done: { label: "Done", color: colors.ok, icon: "checkmark-done-outline" },
  error: { label: "Error", color: colors.fail, icon: "alert-circle-outline" },
  info: { label: "Info", color: colors.text2, icon: "information-circle-outline" },
};

/**
 * CardBlock — an approval card (title/subtitle/body/status + actions). Tapping
 * an action sends an `action` event; the agent then `edit`s the card's status
 * (pending → approved/rejected), which the renderer patches in place. Actions
 * are only live while status is pending/undefined.
 */
export default function CardBlock({ block, msgId }: { block: CardBlockT; msgId: string }) {
  const { sendAction } = useBlockEvents(msgId);
  const [tapped, setTapped] = useState(false);
  const status = block.status ?? "pending";
  const meta = STATUS[status] ?? STATUS.info;
  const interactive = status === "pending" && !tapped;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titles}>
          <Text style={styles.title}>{block.title}</Text>
          {block.subtitle ? <Text style={styles.subtitle}>{block.subtitle}</Text> : null}
        </View>
        <View style={[styles.badge, { borderColor: meta.color }]}>
          <Ionicons name={meta.icon} size={13} color={meta.color} />
          <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {block.body ? <Text style={styles.body}>{block.body}</Text> : null}

      {block.actions && block.actions.length ? (
        <View style={styles.actions}>
          {block.actions.map((a) => (
            <Pressable
              key={a.id}
              disabled={!interactive}
              onPress={() => {
                setTapped(true);
                sendAction(block.id, a.value ?? a.label, a.label);
              }}
              style={[
                styles.action,
                a.style === "primary" && styles.primary,
                a.style === "danger" && styles.danger,
                !interactive && styles.dim,
              ]}
            >
              <Text
                style={[
                  styles.actionText,
                  a.style === "primary" && styles.actionTextPrimary,
                  a.style === "danger" && styles.actionTextDanger,
                ]}
              >
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    minWidth: 240,
  },
  header: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm },
  titles: { flexShrink: 1, gap: 2 },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: weight.semibold },
  subtitle: { color: colors.text2, fontSize: fontSize.sm },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  badgeText: { fontSize: fontSize.xs, fontWeight: weight.semibold },
  body: { color: colors.text, fontSize: fontSize.md, lineHeight: 21 },
  actions: { flexDirection: "row", gap: space.sm },
  action: {
    flex: 1,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
  },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  danger: { borderColor: colors.fail, backgroundColor: "transparent" },
  dim: { opacity: 0.45 },
  actionText: { color: colors.text, fontSize: fontSize.md, fontWeight: weight.medium },
  actionTextPrimary: { color: colors.accentInk, fontWeight: weight.semibold },
  actionTextDanger: { color: colors.fail },
});
