import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { CardBlock as CardBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import { Btn, Chip, type ChipTone, WidgetCard, WTitle } from "../primitives";
import { colors, fontSize, radius, space, font } from "../../theme/tokens";

const STATUS: Record<string, { label: string; tone: ChipTone; dot: boolean }> = {
  pending: { label: "pending", tone: "warn", dot: true },
  approved: { label: "approved", tone: "ok", dot: true },
  rejected: { label: "rejected", tone: "fail", dot: true },
  done: { label: "done", tone: "ok", dot: true },
  error: { label: "error", tone: "fail", dot: true },
  info: { label: "info", tone: "default", dot: false },
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
  const hasActions = !!block.actions?.length;
  const kicker = hasActions && status === "pending" ? "Action · needs approval" : undefined;

  return (
    <WidgetCard>
      <WTitle kicker={kicker} right={<Chip tone={meta.tone} dot={meta.dot}>{meta.label}</Chip>}>
        {block.title}
      </WTitle>

      {block.body || block.subtitle ? (
        <View style={styles.bodyBox}>
          {block.subtitle ? <Text style={styles.subtitle}>{block.subtitle}</Text> : null}
          {block.body ? <Text style={styles.body}>{block.body}</Text> : null}
        </View>
      ) : null}

      {hasActions ? (
        <View style={styles.actions}>
          {block.actions!.map((a) => (
            <Btn
              key={a.id}
              full
              label={a.label}
              kind={a.style === "primary" ? "primary" : a.style === "danger" ? "danger" : "ghost"}
              icon={a.style === "primary" ? "checkmark" : a.style === "danger" ? "close" : undefined}
              disabled={!interactive}
              dim={!interactive}
              onPress={() => {
                setTapped(true);
                sendAction(block.id, a.value ?? a.label, a.label);
              }}
            />
          ))}
        </View>
      ) : null}
    </WidgetCard>
  );
}

const styles = StyleSheet.create({
  bodyBox: {
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.control,
    padding: space.md,
    marginBottom: space.md,
    gap: 6,
  },
  subtitle: { fontFamily: font.mono, color: colors.text3, fontSize: fontSize.xs },
  body: { color: colors.text2, fontSize: fontSize.sm + 0.5, lineHeight: 20 },
  actions: { flexDirection: "row", gap: space.sm },
});
