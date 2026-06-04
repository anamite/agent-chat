import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { ButtonsBlock as ButtonsBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import { Btn } from "../primitives";
import { space } from "../../theme/tokens";

/**
 * ButtonsBlock — a row of tappable buttons. Tapping sends an `action` event
 * (source = button id, name = label, value = value) and locks the row so the
 * choice can't be double-sent.
 */
export default function ButtonsBlock({
  block,
  msgId,
}: {
  block: ButtonsBlockT;
  msgId: string;
}) {
  const { sendAction } = useBlockEvents(msgId);
  const [chosen, setChosen] = useState<string | null>(null);

  return (
    <View style={styles.row}>
      {block.buttons.map((b) => {
        const picked = chosen === b.id;
        const dim = chosen != null && !picked;
        return (
          <Btn
            key={b.id}
            label={b.label}
            kind={b.style === "primary" ? "primary" : b.style === "danger" ? "danger" : "ghost"}
            disabled={chosen != null}
            dim={dim}
            onPress={() => {
              setChosen(b.id);
              sendAction(b.id, b.label, b.value ?? b.label);
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
