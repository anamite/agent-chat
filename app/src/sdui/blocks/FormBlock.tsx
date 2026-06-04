import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { FormBlock as FormBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import InputBlock from "./InputBlock";
import SliderBlock from "./SliderBlock";
import SelectBlock from "./SelectBlock";
import { colors, fontSize, radius, space, weight } from "../../theme/tokens";

type FormValue = string | number | string[];

/**
 * FormBlock — groups input/slider/select fields under one submit button.
 * Holds field values locally (controlled children) and emits a single
 * `submit` event with all values keyed by field id.
 */
export default function FormBlock({ block, msgId }: { block: FormBlockT; msgId: string }) {
  const { sendSubmit } = useBlockEvents(msgId);
  const [sent, setSent] = useState(false);

  const initial = useMemo(() => {
    const v: Record<string, FormValue> = {};
    for (const f of block.fields) {
      if (f.type === "input") v[f.id] = f.value ?? "";
      else if (f.type === "slider") v[f.id] = f.value ?? f.min;
      else if (f.type === "select") v[f.id] = f.value ?? (f.multiple ? [] : "");
    }
    return v;
  }, [block.fields]);

  const [values, setValues] = useState<Record<string, FormValue>>(initial);
  const set = (id: string, value: FormValue) =>
    setValues((prev) => ({ ...prev, [id]: value }));

  const submit = () => {
    if (sent) return;
    setSent(true);
    sendSubmit(block.id, values);
  };

  return (
    <View style={styles.wrap}>
      {block.title ? <Text style={styles.title}>{block.title}</Text> : null}
      {block.fields.map((f) => (
        <View key={f.id} style={styles.field}>
          {f.type === "input" ? (
            <InputBlock
              block={f}
              value={values[f.id] as string}
              onChange={(v) => set(f.id, v)}
            />
          ) : f.type === "slider" ? (
            <SliderBlock
              block={f}
              value={values[f.id] as number}
              onChange={(v) => set(f.id, v)}
            />
          ) : (
            <SelectBlock
              block={f}
              value={values[f.id] as string | string[]}
              onChange={(v) => set(f.id, v)}
            />
          )}
        </View>
      ))}
      <Pressable style={[styles.submit, sent && styles.dim]} onPress={submit} disabled={sent}>
        <Text style={styles.submitText}>{sent ? "Submitted" : block.submitLabel ?? "Submit"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  title: { color: colors.text, fontSize: fontSize.md, fontWeight: weight.semibold },
  field: {},
  submit: {
    backgroundColor: colors.accent,
    borderRadius: radius.control,
    paddingVertical: space.md,
    alignItems: "center",
  },
  dim: { opacity: 0.5 },
  submitText: { color: colors.accentInk, fontSize: fontSize.md, fontWeight: weight.bold },
});
