import { StyleSheet, Text } from "react-native";
import type { TextBlock as TextBlockT } from "../../protocol/protocol";
import { colors, fontSize, weight } from "../../theme/tokens";

/**
 * TextBlock — message text. Markdown rendering lands in M4; M2 renders plain
 * text (preserving newlines) so file/voice messages read cleanly.
 */
export default function TextBlock({ block, mine }: { block: TextBlockT; mine: boolean }) {
  if (!block.text) return null;
  return <Text style={[styles.text, mine && styles.mine]}>{block.text}</Text>;
}

const styles = StyleSheet.create({
  text: { color: colors.text, fontSize: fontSize.md, lineHeight: 21 },
  mine: { color: colors.accentInk, fontWeight: weight.medium },
});
