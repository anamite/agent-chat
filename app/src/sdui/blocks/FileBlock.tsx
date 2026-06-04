import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import type { FileBlock as FileBlockT } from "../../protocol/protocol";
import { useApp } from "../../store/app";
import { remoteSource } from "../../transport/files";
import { colors, fontSize, radius, space, weight } from "../../theme/tokens";

const MAX_IMG_HEIGHT = 280;

function fmtSize(bytes?: number): string {
  if (!bytes) return "";
  const u = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

function docIcon(mime?: string): keyof typeof Ionicons.glyphMap {
  if (mime === "application/pdf") return "document-text-outline";
  if (mime?.startsWith("audio/")) return "musical-notes-outline";
  if (mime?.startsWith("video/")) return "videocam-outline";
  return "document-outline";
}

/**
 * FileBlock — images render inline (expo-image, tap to fullscreen); everything
 * else renders as a document chip. (Voice has its own block type / renderer.)
 */
export default function FileBlock({ block, mine }: { block: FileBlockT; mine: boolean }) {
  const pairing = useApp((s) => s.pairing);
  const [full, setFull] = useState(false);
  if (!pairing) return null;

  const isImage = (block.mime ?? "").startsWith("image/");
  const source = remoteSource(block.fileId, pairing, { thumb: isImage });
  const fullSrc = remoteSource(block.fileId, pairing);

  if (isImage) {
    const aspect = block.width && block.height ? block.width / block.height : 1;
    return (
      <>
        <Pressable onPress={() => setFull(true)}>
          <Image
            source={source}
            style={[styles.image, { aspectRatio: aspect, maxHeight: MAX_IMG_HEIGHT }]}
            contentFit="cover"
            transition={150}
          />
        </Pressable>
        <Modal visible={full} transparent animationType="fade" onRequestClose={() => setFull(false)}>
          <Pressable style={styles.backdrop} onPress={() => setFull(false)}>
            <Image source={fullSrc} style={styles.fullImage} contentFit="contain" />
          </Pressable>
        </Modal>
      </>
    );
  }

  return (
    <View style={[styles.chip, mine && styles.chipMine]}>
      <View style={[styles.iconWrap, mine && styles.iconWrapMine]}>
        <Ionicons name={docIcon(block.mime)} size={20} color={mine ? colors.accentInk : colors.accent} />
      </View>
      <View style={styles.chipText}>
        <Text style={[styles.name, mine && styles.nameMine]} numberOfLines={1}>
          {block.name ?? "file"}
        </Text>
        <Text style={[styles.sub, mine && styles.subMine]}>
          {[block.mime, fmtSize(block.size)].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: 220, borderRadius: radius.console, backgroundColor: colors.surfaceAlt },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  fullImage: { width: "100%", height: "100%" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.xs,
    minWidth: 180,
  },
  chipMine: {},
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.console,
    backgroundColor: colors.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapMine: { backgroundColor: "rgba(10,12,0,0.15)" },
  chipText: { flexShrink: 1 },
  name: { color: colors.text, fontSize: fontSize.md, fontWeight: weight.medium },
  nameMine: { color: colors.accentInk },
  sub: { color: colors.text2, fontSize: fontSize.xs },
  subMine: { color: "rgba(10,12,0,0.7)" },
});
