import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { InputBlock as InputBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import { colors, fontSize, radius, space, weight } from "../../theme/tokens";

/**
 * InputBlock — a labelled text field.
 *   - Form mode (controlled): pass `value` + `onChange`; no submit button.
 *   - Standalone: pass `msgId`; shows a submit button that sends an `action`
 *     event (source = field id, value = text).
 */
export default function InputBlock({
  block,
  msgId,
  value,
  onChange,
}: {
  block: InputBlockT;
  msgId?: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  const controlled = onChange != null;
  const events = useBlockEvents(msgId ?? "");
  const [local, setLocal] = useState(block.value ?? "");
  const [sent, setSent] = useState(false);
  const val = controlled ? (value ?? "") : local;

  const setVal = (t: string) => (controlled ? onChange!(t) : setLocal(t));

  const submit = () => {
    if (controlled || !msgId || sent) return;
    setSent(true);
    events.sendAction(block.id, block.id, val);
  };

  return (
    <View style={styles.wrap}>
      {block.label ? <Text style={styles.label}>{block.label}</Text> : null}
      <View style={styles.field}>
        <TextInput
          style={styles.input}
          value={val}
          onChangeText={setVal}
          placeholder={block.placeholder}
          placeholderTextColor={colors.text3}
          editable={!sent}
          multiline={block.multiline}
          secureTextEntry={block.inputType === "password"}
          keyboardType={block.inputType === "number" ? "numeric" : block.inputType === "email" ? "email-address" : "default"}
          autoCapitalize={block.inputType === "email" ? "none" : "sentences"}
          onSubmitEditing={submit}
        />
        {!controlled ? (
          <Pressable style={[styles.send, sent && styles.dim]} onPress={submit} disabled={sent}>
            <Ionicons name={sent ? "checkmark" : "arrow-up"} size={18} color={colors.accentInk} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  label: { color: colors.text2, fontSize: fontSize.sm, fontWeight: weight.medium },
  field: { flexDirection: "row", alignItems: "flex-end", gap: space.sm },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: fontSize.md,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  dim: { opacity: 0.5 },
});
