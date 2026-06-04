import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { FormBlock as FormBlockT } from "../../protocol/protocol";
import { useBlockEvents } from "../events";
import InputBlock from "./InputBlock";
import SliderBlock from "./SliderBlock";
import SelectBlock from "./SelectBlock";
import { Btn, WidgetCard, WTitle } from "../primitives";
import { space } from "../../theme/tokens";

type FormValue = string | number | string[];

/**
 * FormBlock — groups input/slider/select fields under one submit button inside
 * a widget card. Holds field values locally (controlled children) and emits a
 * single `submit` event with all values keyed by field id.
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
    <WidgetCard>
      {block.title ? <WTitle kicker="Form">{block.title}</WTitle> : null}
      <View style={styles.fields}>
        {block.fields.map((f) => (
          <View key={f.id}>
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
      </View>
      <Btn
        full
        kind="primary"
        label={sent ? "Submitted" : block.submitLabel ?? "Submit"}
        icon={sent ? "checkmark" : undefined}
        disabled={sent}
        dim={sent}
        onPress={submit}
        style={styles.submit}
      />
    </WidgetCard>
  );
}

const styles = StyleSheet.create({
  fields: { gap: space.md, marginBottom: space.md },
  submit: {},
});
