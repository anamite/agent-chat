import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { useApp, DEFAULT_CHAT } from "../../src/store/app";
import type { MessageRow } from "../../src/store/db";
import { messageFrame, textMessageFrame } from "../../src/protocol/encode";
import { applyFrame } from "../../src/transport/ingest";
import type { Block } from "../../src/protocol/protocol";
import BlockRenderer from "../../src/sdui/BlockRenderer";
import { uploadFile } from "../../src/transport/files";
import { useVoiceRecorder } from "../../src/media/recorder";
import { colors, fontSize, radius, space, weight } from "../../src/theme/tokens";

const STATE_LABEL: Record<string, string> = {
  idle: "idle",
  connecting: "connecting…",
  open: "connected",
  reconnecting: "reconnecting…",
  closed: "offline",
};

function StatusPill() {
  const connState = useApp((s) => s.connState);
  const ok = connState === "open";
  return (
    <View style={styles.pill}>
      <View
        style={[styles.dot, { backgroundColor: ok ? colors.ok : colors.warn }]}
      />
      <Text style={styles.pillText}>{STATE_LABEL[connState] ?? connState}</Text>
    </View>
  );
}

/** Thin banner shown while the socket isn't open, matching design tokens. */
function OfflineBanner() {
  const connState = useApp((s) => s.connState);
  if (connState === "open") return null;
  const reconnecting = connState === "reconnecting" || connState === "connecting";
  return (
    <View style={[styles.banner, styles.bannerOffline]}>
      <Ionicons name="cloud-offline-outline" size={14} color={colors.warn} />
      <Text style={styles.bannerText}>
        {reconnecting ? "Reconnecting to your Bridge…" : "Offline — messages will send when reconnected"}
      </Text>
    </View>
  );
}

/** Dismissable error banner fed by structured error frames / auth failures. */
function ErrorBanner() {
  const lastError = useApp((s) => s.lastError);
  const setError = useApp((s) => s.setError);
  if (!lastError) return null;
  return (
    <Pressable style={[styles.banner, styles.bannerError]} onPress={() => setError(null)}>
      <Ionicons name="alert-circle-outline" size={14} color={colors.fail} />
      <Text style={[styles.bannerText, styles.bannerTextError]}>{lastError}</Text>
      <Ionicons name="close" size={14} color={colors.fail} />
    </Pressable>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function MessageBubble({
  row,
  grouped,
}: {
  row: MessageRow;
  grouped: boolean;
}) {
  const mine = row.sender === "user";

  // Inline the streaming cursor into the last text block so it appears at the end
  // of the text rather than on a separate line after the block view.
  let displayBlocks: Block[] = row.blocks;
  let showTrailingCursor = false;
  if (row.streaming) {
    const lastIdx = row.blocks.length - 1;
    const last = row.blocks[lastIdx];
    if (last?.type === "text") {
      displayBlocks = [
        ...row.blocks.slice(0, lastIdx),
        { type: "text" as const, text: last.text + "▋" },
      ];
    } else {
      showTrailingCursor = true;
    }
  }

  return (
    <View
      style={[
        styles.row,
        mine ? styles.rowMine : styles.rowTheirs,
        { marginTop: grouped ? space.xs : space.md },
      ]}
    >
      <View style={styles.column}>
        <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
          <BlockRenderer blocks={displayBlocks} mine={mine} msgId={row.msg_id} />
          {showTrailingCursor ? (
            <Text style={[styles.bubbleText, mine && styles.bubbleTextMine]}>▋</Text>
          ) : null}
        </View>
        <Text style={[styles.meta, mine ? styles.metaMine : styles.metaTheirs]}>
          {formatTime(row.ts)}
        </Text>
      </View>
    </View>
  );
}

/** Animated three-dot "Hermes is typing…" indicator. */
function TypingIndicator() {
  const dots = [useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current, useRef(new Animated.Value(0.3)).current];
  useEffect(() => {
    const loops = dots.map((d, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(d, { toValue: 1, duration: 320, useNativeDriver: true }),
          Animated.timing(d, { toValue: 0.3, duration: 320, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);
  return (
    <View style={[styles.row, styles.rowTheirs, { marginTop: space.md }]}>
      <View style={[styles.bubble, styles.bubbleTheirs, styles.typing]}>
        {dots.map((d, i) => (
          <Animated.View key={i} style={[styles.typingDot, { opacity: d }]} />
        ))}
      </View>
    </View>
  );
}

export default function BrainScreen() {
  const messages = useApp((s) => s.messages);
  const pairing = useApp((s) => s.pairing);
  const socket = useApp((s) => s.socket);
  const refresh = useApp((s) => s.refreshMessages);
  const agentTyping = useApp((s) => s.agentTyping);
  const [draft, setDraft] = useState("");
  const listRef = useRef<FlatList<MessageRow>>(null);

  const setError = useApp((s) => s.setError);
  const recorder = useVoiceRecorder();
  const [attachOpen, setAttachOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const sendFrame = useCallback(
    async (frame: ReturnType<typeof messageFrame>) => {
      if (!socket) return;
      await applyFrame(frame); // optimistic local echo
      await refresh();
      await socket.send(frame);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    },
    [socket, refresh],
  );

  const onSend = useCallback(async () => {
    const text = draft.trim();
    if (!text || !socket) return;
    setDraft("");
    await sendFrame(textMessageFrame(DEFAULT_CHAT, text));
  }, [draft, socket, sendFrame]);

  const sendFileBlock = useCallback(
    async (block: Block) => {
      await sendFrame(messageFrame(DEFAULT_CHAT, [block]));
    },
    [sendFrame],
  );

  const onPickImage = useCallback(async () => {
    setAttachOpen(false);
    if (!pairing) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setBusy(true);
    try {
      const mime = a.mimeType ?? "image/jpeg";
      const up = await uploadFile(a.uri, pairing, { name: a.fileName ?? undefined, mime });
      await sendFileBlock({
        type: "file",
        fileId: up.id,
        name: a.fileName ?? undefined,
        mime,
        size: up.size,
        width: a.width,
        height: a.height,
      });
    } catch {
      setError("Couldn't upload that image. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [pairing, sendFileBlock, setError]);

  const onPickDocument = useCallback(async () => {
    setAttachOpen(false);
    if (!pairing) return;
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    setBusy(true);
    try {
      const up = await uploadFile(a.uri, pairing, { name: a.name, mime: a.mimeType ?? undefined });
      await sendFileBlock({
        type: "file",
        fileId: up.id,
        name: a.name,
        mime: a.mimeType ?? undefined,
        size: up.size,
      });
    } catch {
      setError("Couldn't upload that file. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [pairing, sendFileBlock, setError]);

  const onStartRecording = useCallback(() => {
    void recorder.start();
  }, [recorder]);

  const onStopRecording = useCallback(async () => {
    if (!pairing) return;
    const result = await recorder.stop();
    if (!result) return;
    setBusy(true);
    try {
      const up = await uploadFile(result.uri, pairing, {
        name: "voice.m4a",
        mime: "audio/m4a",
      });
      await sendFileBlock({
        type: "voice",
        fileId: up.id,
        durationMs: result.durationMs,
        peaks: result.peaks,
      });
    } catch {
      setError("Couldn't send that voice note. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [pairing, recorder, sendFileBlock, setError]);

  if (!pairing) {
    return (
      <SafeAreaView style={styles.safe} edges={["top"]}>
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>Not paired</Text>
          <Text style={styles.emptyBody}>
            Open Settings and pair with your Hermes Bridge to start chatting.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={styles.header}>
        <StatusPill />
      </View>

      <OfflineBanner />
      <ErrorBanner />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior="padding"
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.msg_id}
          renderItem={({ item, index }) => (
            <MessageBubble
              row={item}
              grouped={index > 0 && messages[index - 1].sender === item.sender}
            />
          )}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <Text style={styles.hint}>Say hello to your agent.</Text>
          }
          ListFooterComponent={agentTyping ? <TypingIndicator /> : null}
        />

        {recorder.isRecording ? (
          <View style={styles.recordingBar}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>Recording… release to send</Text>
          </View>
        ) : null}

        <View style={styles.composer}>
          <Pressable
            style={styles.attach}
            onPress={() => setAttachOpen((v) => !v)}
            disabled={busy}
            hitSlop={6}
          >
            <Ionicons name="add" size={24} color={busy ? colors.text3 : colors.text2} />
          </Pressable>

          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={busy ? "Uploading…" : "Message"}
            placeholderTextColor={colors.text3}
            multiline
            editable={!recorder.isRecording}
            onSubmitEditing={onSend}
          />

          {draft.trim() ? (
            <Pressable style={styles.send} onPress={onSend}>
              <Ionicons name="arrow-up" size={22} color={colors.accentInk} />
            </Pressable>
          ) : (
            <Pressable
              style={[styles.send, recorder.isRecording && styles.sendRecording]}
              onPressIn={onStartRecording}
              onPressOut={onStopRecording}
            >
              <Ionicons
                name="mic"
                size={20}
                color={recorder.isRecording ? colors.canvas : colors.accentInk}
              />
            </Pressable>
          )}
        </View>
      </KeyboardAvoidingView>

      <Modal visible={attachOpen} transparent animationType="fade" onRequestClose={() => setAttachOpen(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setAttachOpen(false)}>
          <View style={styles.sheet}>
            <Pressable style={styles.sheetItem} onPress={onPickImage}>
              <Ionicons name="image-outline" size={22} color={colors.accent} />
              <Text style={styles.sheetText}>Photo</Text>
            </Pressable>
            <Pressable style={styles.sheetItem} onPress={onPickDocument}>
              <Ionicons name="document-outline" size={22} color={colors.accent} />
              <Text style={styles.sheetText}>File</Text>
            </Pressable>
            <View style={styles.sheetHintRow}>
              <Ionicons name="mic-outline" size={18} color={colors.text2} />
              <Text style={styles.sheetHint}>Hold the mic button to record a voice note</Text>
            </View>
          </View>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  title: { color: colors.text, fontSize: fontSize.xl, fontWeight: weight.bold },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    marginHorizontal: space.lg,
    marginBottom: space.xs,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.console,
    borderWidth: 1,
  },
  bannerOffline: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  bannerError: {
    backgroundColor: "#241416",
    borderColor: colors.fail,
  },
  bannerText: { color: colors.text2, fontSize: fontSize.sm, flex: 1 },
  bannerTextError: { color: colors.fail },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.xs,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  dot: { width: 7, height: 7, borderRadius: radius.pill },
  pillText: { color: colors.text2, fontSize: fontSize.xs },
  listContent: { padding: space.lg, gap: space.sm },
  row: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  column: { maxWidth: "82%" },
  meta: {
    color: colors.text3,
    fontSize: fontSize.xs,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  metaMine: { textAlign: "right" },
  metaTheirs: { textAlign: "left" },
  typing: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 14 },
  typingDot: {
    width: 7,
    height: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.text2,
  },
  bubble: {
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  bubbleMine: { backgroundColor: colors.accent },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
  },
  bubbleText: { color: colors.text, fontSize: fontSize.md },
  bubbleTextMine: { color: colors.accentInk, fontWeight: weight.medium },
  hint: { color: colors.text3, textAlign: "center", marginTop: space.xxl },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.sm,
    padding: space.md,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.canvas,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: fontSize.md,
  },
  attach: {
    width: 44,
    height: 44,
    borderRadius: radius.control,
    alignItems: "center",
    justifyContent: "center",
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  sendRecording: { backgroundColor: colors.fail },
  recordingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  recDot: { width: 9, height: 9, borderRadius: radius.pill, backgroundColor: colors.fail },
  recText: { color: colors.text2, fontSize: fontSize.sm },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: space.sm,
    paddingBottom: space.xxl,
    paddingHorizontal: space.lg,
    gap: space.xs,
  },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
  },
  sheetText: { color: colors.text, fontSize: fontSize.lg, fontWeight: weight.medium },
  sheetHintRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingTop: space.sm,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    marginTop: space.xs,
  },
  sheetHint: { color: colors.text2, fontSize: fontSize.sm, flexShrink: 1 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  emptyTitle: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: weight.semibold,
    marginBottom: space.sm,
  },
  emptyBody: { color: colors.text2, fontSize: fontSize.md, textAlign: "center" },
});
