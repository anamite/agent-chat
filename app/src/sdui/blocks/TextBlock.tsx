import { Fragment, useState, type ReactNode } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import type { TextBlock as TextBlockT } from "../../protocol/protocol";
import { colors, font, fontSize, radius, space, weight } from "../../theme/tokens";

/**
 * TextBlock — message text with light markdown: fenced code blocks (with a Copy
 * button), inline code, clickable links (markdown `[text](url)` and bare URLs).
 * Everything else renders as plain text with newlines preserved.
 */
export default function TextBlock({ block, mine }: { block: TextBlockT; mine: boolean }) {
  if (!block.text) return null;
  const segments = parseSegments(block.text);

  // Fast path: no code fences → a single Text so it wraps inside the bubble.
  if (segments.every((s) => s.type === "text")) {
    return (
      <Text style={[styles.text, mine && styles.mine]}>
        <Inline text={block.text} mine={mine} />
      </Text>
    );
  }

  return (
    <View style={styles.stack}>
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <CodeBlock key={i} code={seg.content} lang={seg.lang} />
        ) : (
          <Text key={i} style={[styles.text, mine && styles.mine]}>
            <Inline text={seg.content} mine={mine} />
          </Text>
        ),
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Block-level parse: split out ```fenced``` code blocks.
// ---------------------------------------------------------------------------

type Segment =
  | { type: "text"; content: string }
  | { type: "code"; content: string; lang?: string };

const FENCE = /```([^\n`]*)\n?([\s\S]*?)```/g;

function parseSegments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(text)) !== null) {
    if (m.index > last) out.push({ type: "text", content: text.slice(last, m.index) });
    out.push({ type: "code", content: m[2].replace(/\n$/, ""), lang: m[1].trim() || undefined });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: "text", content: text.slice(last) });
  // Trim a leading/trailing blank line left by the fence newlines.
  return out
    .map((s) => (s.type === "text" ? { ...s, content: s.content.replace(/^\n+|\n+$/g, "") } : s))
    .filter((s) => s.type === "code" || s.content.length > 0);
}

// ---------------------------------------------------------------------------
// Inline parse: links (markdown + bare) and inline code.
// ---------------------------------------------------------------------------

const INLINE =
  /(`[^`\n]+`)|(\[[^\]\n]+\]\((?:https?:\/\/|www\.|mailto:)[^)\s]+\))|((?:https?:\/\/|www\.)[^\s<>()]+)/g;

function openURL(href: string) {
  const url = href.startsWith("www.") ? `https://${href}` : href;
  Linking.openURL(url).catch(() => {});
}

function Inline({ text, mine }: { text: string; mine: boolean }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  INLINE.lastIndex = 0;

  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) nodes.push(<Fragment key={key++}>{text.slice(last, m.index)}</Fragment>);

    if (m[1]) {
      // inline `code`
      nodes.push(
        <Text key={key++} style={[styles.inlineCode, mine && styles.inlineCodeMine]}>
          {m[1].slice(1, -1)}
        </Text>,
      );
    } else if (m[2]) {
      // [label](href)
      const label = m[2].slice(1, m[2].indexOf("]"));
      const href = m[2].slice(m[2].indexOf("](") + 2, -1);
      nodes.push(
        <Text key={key++} style={[styles.link, mine && styles.linkMine]} onPress={() => openURL(href)}>
          {label}
        </Text>,
      );
    } else {
      // bare URL — keep trailing punctuation out of the link target.
      let url = m[3];
      let trailing = "";
      const tm = url.match(/[.,;:!?)]+$/);
      if (tm) {
        trailing = tm[0];
        url = url.slice(0, -trailing.length);
      }
      nodes.push(
        <Text key={key++} style={[styles.link, mine && styles.linkMine]} onPress={() => openURL(url)}>
          {url}
        </Text>,
      );
      if (trailing) nodes.push(<Fragment key={key++}>{trailing}</Fragment>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(<Fragment key={key++}>{text.slice(last)}</Fragment>);
  return <>{nodes}</>;
}

// ---------------------------------------------------------------------------
// Copyable fenced code block.
// ---------------------------------------------------------------------------

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <View style={styles.code}>
      <View style={styles.codeHeader}>
        <Text style={styles.codeLang}>{lang || "code"}</Text>
        <Pressable style={styles.copyBtn} onPress={copy} hitSlop={8}>
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={13}
            color={copied ? colors.ok : colors.text2}
          />
          <Text style={[styles.copyText, copied && styles.copyTextOn]}>
            {copied ? "Copied" : "Copy"}
          </Text>
        </Pressable>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.codeScroll}
      >
        <Text style={styles.codeText}>{code}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm, alignSelf: "stretch" },
  text: { color: colors.text, fontSize: fontSize.md, lineHeight: 21 },
  mine: { color: colors.accentInk, fontWeight: weight.medium },

  link: { color: colors.accent, textDecorationLine: "underline" },
  linkMine: { color: colors.accentInk, fontWeight: weight.semibold, textDecorationLine: "underline" },

  inlineCode: {
    fontFamily: font.mono,
    fontSize: fontSize.sm,
    color: colors.text,
    backgroundColor: colors.canvas,
  },
  inlineCodeMine: { color: colors.accentInk, backgroundColor: "rgba(11,12,10,0.12)" },

  code: {
    alignSelf: "stretch",
    backgroundColor: colors.canvas,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.console,
    overflow: "hidden",
  },
  codeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.md,
    paddingVertical: 6,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  codeLang: {
    fontFamily: font.mono,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: colors.text3,
  },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingVertical: 2 },
  copyText: { fontFamily: font.mono, fontSize: 11, color: colors.text2 },
  copyTextOn: { color: colors.ok },
  codeScroll: { padding: space.md },
  codeText: { fontFamily: font.mono, fontSize: fontSize.sm, color: colors.text, lineHeight: 19 },
});
