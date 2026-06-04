import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useApp } from "../../src/store/app";
import { parsePairingPayload } from "../../src/features/pairing/pairing";
import { colors, fontSize, radius, space, weight } from "../../src/theme/tokens";

/**
 * Settings — pairing + connection. M0 supports pasting the QR JSON payload (or
 * tunnelUrl + token) directly; a camera QR scanner lands in M1.
 */
export default function SettingsScreen() {
  const pairing = useApp((s) => s.pairing);
  const connState = useApp((s) => s.connState);
  const pair = useApp((s) => s.pair);
  const unpair = useApp((s) => s.unpair);

  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");
  const [payload, setPayload] = useState("");

  const onPairManual = async () => {
    try {
      if (payload.trim()) {
        const p = parsePairingPayload(payload.trim());
        await pair(p);
      } else if (url.trim() && token.trim()) {
        await pair({ tunnelUrl: url.trim(), deviceToken: token.trim() });
      } else {
        Alert.alert("Pairing", "Paste the QR payload, or enter URL + token.");
        return;
      }
      setUrl("");
      setToken("");
      setPayload("");
      Alert.alert("Paired", "Device paired with the Bridge.");
    } catch {
      Alert.alert(
        "Pairing failed",
        "That pairing code didn't look right. Re-run `bridge pair` on the Pi and paste the full payload.",
      );
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.section}>CONNECTION</Text>
        <View style={styles.card}>
          <Row label="Status" value={pairing ? connState : "not paired"} />
          {pairing && <Row label="Tunnel" value={pairing.tunnelUrl} />}
          {pairing && (
            <Row label="Token" value={`${pairing.deviceToken.slice(0, 8)}…`} />
          )}
        </View>

        {pairing ? (
          <Pressable style={styles.dangerBtn} onPress={() => void unpair()}>
            <Text style={styles.dangerText}>Unpair device</Text>
          </Pressable>
        ) : (
          <>
            <Text style={styles.section}>PAIR A DEVICE</Text>
            <View style={styles.card}>
              <Text style={styles.fieldLabel}>QR payload (JSON)</Text>
              <TextInput
                style={styles.input}
                value={payload}
                onChangeText={setPayload}
                placeholder='{"tunnelUrl":"wss://…","deviceToken":"…"}'
                placeholderTextColor={colors.text3}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />
              <Text style={[styles.fieldLabel, { marginTop: space.md }]}>
                …or enter manually
              </Text>
              <TextInput
                style={styles.input}
                value={url}
                onChangeText={setUrl}
                placeholder="wss://hermes.example.com"
                placeholderTextColor={colors.text3}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TextInput
                style={[styles.input, { marginTop: space.sm }]}
                value={token}
                onChangeText={setToken}
                placeholder="device token"
                placeholderTextColor={colors.text3}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable style={styles.primaryBtn} onPress={onPairManual}>
                <Text style={styles.primaryText}>Pair</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              Run `bridge pair` on the Pi to mint a token + QR.
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kv}>
      <Text style={styles.kvLabel}>{label}</Text>
      <Text style={styles.kvValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  header: { paddingHorizontal: space.lg, paddingVertical: space.md },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: weight.bold },
  content: { padding: space.lg, gap: space.sm },
  section: {
    color: colors.text2,
    fontSize: fontSize.xs,
    letterSpacing: 1,
    marginTop: space.md,
    marginBottom: space.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: space.lg,
  },
  kv: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: space.xs,
    gap: space.md,
  },
  kvLabel: { color: colors.text2, fontSize: fontSize.md },
  kvValue: { color: colors.text, fontSize: fontSize.md, flexShrink: 1 },
  fieldLabel: { color: colors.text2, fontSize: fontSize.sm, marginBottom: space.xs },
  input: {
    color: colors.text,
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: fontSize.md,
  },
  primaryBtn: {
    marginTop: space.md,
    backgroundColor: colors.accent,
    borderRadius: radius.control,
    paddingVertical: space.md,
    alignItems: "center",
  },
  primaryText: { color: colors.accentInk, fontSize: fontSize.md, fontWeight: weight.bold },
  dangerBtn: {
    marginTop: space.md,
    borderColor: colors.fail,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingVertical: space.md,
    alignItems: "center",
  },
  dangerText: { color: colors.fail, fontSize: fontSize.md, fontWeight: weight.semibold },
  hint: { color: colors.text3, fontSize: fontSize.sm, marginTop: space.sm },
});
