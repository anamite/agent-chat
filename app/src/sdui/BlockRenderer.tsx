/**
 * BlockRenderer.tsx — map a Block to its component via a registry.
 *
 * Adding a block type later = one zod variant (protocol.ts) + one component +
 * one registry entry here. Interactive blocks receive the containing message's
 * `msgId` so the events they emit reference the right message; the agent's
 * follow-up `edit` then patches the message's blocks in place (handled in the
 * ingest/store layer, so this component just re-renders the new blocks).
 */

import { StyleSheet, Text, View } from "react-native";
import type { Block } from "../protocol/protocol";
import { colors, fontSize, space } from "../theme/tokens";
import TextBlock from "./blocks/TextBlock";
import FileBlock from "./blocks/FileBlock";
import VoiceBlock from "./blocks/VoiceBlock";
import ButtonsBlock from "./blocks/ButtonsBlock";
import InputBlock from "./blocks/InputBlock";
import SliderBlock from "./blocks/SliderBlock";
import SelectBlock from "./blocks/SelectBlock";
import FormBlock from "./blocks/FormBlock";
import CardBlock from "./blocks/CardBlock";
import ChartBlock from "./blocks/ChartBlock";
import HtmlBlock from "./blocks/HtmlBlock";
import BlockErrorBoundary from "./BlockErrorBoundary";

function UnsupportedBlock({ type }: { type: string }) {
  return (
    <View style={styles.fallback}>
      <Text style={styles.fallbackText}>[{type} block — coming soon]</Text>
    </View>
  );
}

function renderBlock(block: Block, mine: boolean, msgId: string) {
  switch (block.type) {
    case "text":
      return <TextBlock block={block} mine={mine} />;
    case "file":
      return <FileBlock block={block} mine={mine} />;
    case "voice":
      return <VoiceBlock block={block} mine={mine} />;
    case "buttons":
      return <ButtonsBlock block={block} msgId={msgId} />;
    case "input":
      return <InputBlock block={block} msgId={msgId} />;
    case "slider":
      return <SliderBlock block={block} msgId={msgId} />;
    case "select":
      return <SelectBlock block={block} msgId={msgId} />;
    case "form":
      return <FormBlock block={block} msgId={msgId} />;
    case "card":
      return <CardBlock block={block} msgId={msgId} />;
    case "chart":
      return <ChartBlock block={block} />;
    case "html":
      return <HtmlBlock block={block} />;
    default:
      return <UnsupportedBlock type={(block as { type: string }).type} />;
  }
}

/** Render an ordered list of blocks for one message. */
export default function BlockRenderer({
  blocks,
  mine,
  msgId,
}: {
  blocks: Block[];
  mine: boolean;
  msgId: string;
}) {
  return (
    <View style={styles.stack}>
      {blocks.map((block, i) => (
        <BlockErrorBoundary key={i} type={(block as { type?: string }).type ?? "block"}>
          {renderBlock(block, mine, msgId)}
        </BlockErrorBoundary>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  fallback: {
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: 6,
    backgroundColor: colors.surfaceAlt,
  },
  fallbackText: { color: colors.text2, fontSize: fontSize.sm, fontStyle: "italic" },
});
