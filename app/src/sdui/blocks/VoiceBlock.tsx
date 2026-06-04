import { useEffect, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import type { VoiceBlock as VoiceBlockT } from "../../protocol/protocol";
import { useApp } from "../../store/app";
import { remoteSource } from "../../transport/files";
import { useVoicePlayer } from "../../media/player";
import { colors, fontSize, radius, space, weight } from "../../theme/tokens";

const WAVE_HEIGHT = 34;
const BAR_W = 3;
const BAR_GAP = 2;

function fmt(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * VoiceBlock — waveform (react-native-svg), play/pause, scrub, speed, duration,
 * and an optional transcript. Played bars fill with the lime accent.
 */
export default function VoiceBlock({ block, mine }: { block: VoiceBlockT; mine: boolean }) {
  const pairing = useApp((s) => s.pairing);
  const setError = useApp((s) => s.setError);
  const source = useMemo(
    () => (pairing ? remoteSource(block.fileId, pairing) : { uri: "" }),
    [pairing, block.fileId],
  );
  const player = useVoicePlayer(source);

  // Bubble playback failures up to the chat-level banner.
  useEffect(() => {
    if (player.error) setError(player.error);
  }, [player.error, setError]);

  const peaks = block.peaks && block.peaks.length ? block.peaks : defaultPeaks();
  const totalSec = player.duration || (block.durationMs ?? 0) / 1000;
  const progress = totalSec > 0 ? player.position / totalSec : 0;
  const width = peaks.length * (BAR_W + BAR_GAP);

  const tint = mine ? colors.accentInk : colors.text;
  const playedColor = mine ? colors.accentInk : colors.accent;
  const idleColor = mine ? "rgba(10,12,0,0.35)" : colors.border;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          style={[styles.play, { borderColor: tint }]}
          onPress={player.toggle}
          hitSlop={8}
        >
          <Text style={[styles.playGlyph, { color: tint }]}>
            {player.playing ? "❚❚" : "▶"}
          </Text>
        </Pressable>

        <Pressable
          style={styles.waveTouch}
          onPress={(e) => {
            const x = e.nativeEvent.locationX;
            player.seekFraction(width ? x / width : 0);
          }}
        >
          <Svg width={width} height={WAVE_HEIGHT}>
            {peaks.map((p, i) => {
              const h = Math.max(2, p * WAVE_HEIGHT);
              const played = i / peaks.length <= progress;
              return (
                <Rect
                  key={i}
                  x={i * (BAR_W + BAR_GAP)}
                  y={(WAVE_HEIGHT - h) / 2}
                  width={BAR_W}
                  height={h}
                  rx={1.5}
                  fill={played ? playedColor : idleColor}
                />
              );
            })}
          </Svg>
        </Pressable>

        <View style={styles.meta}>
          <Text style={[styles.time, { color: tint }]}>
            {fmt(player.playing || player.position > 0 ? player.position : totalSec)}
          </Text>
          <Pressable onPress={player.setRate} hitSlop={8}>
            <Text style={[styles.rate, { color: tint }]}>{player.rate}×</Text>
          </Pressable>
        </View>
      </View>

      {block.transcript ? (
        <Text style={[styles.transcript, mine && styles.transcriptMine]}>
          {block.transcript}
        </Text>
      ) : null}
    </View>
  );
}

function defaultPeaks(): number[] {
  // Flat placeholder waveform when the sender didn't precompute peaks.
  return Array.from({ length: 40 }, (_, i) => 0.3 + 0.25 * Math.abs(Math.sin(i / 3)));
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  play: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  playGlyph: { fontSize: 13, fontWeight: weight.bold },
  waveTouch: { flexShrink: 1 },
  meta: { alignItems: "flex-end", gap: 2 },
  time: { fontSize: fontSize.xs, fontVariant: ["tabular-nums"] },
  rate: { fontSize: fontSize.xs, fontWeight: weight.semibold },
  transcript: { color: colors.text2, fontSize: fontSize.sm, lineHeight: 19 },
  transcriptMine: { color: "rgba(10,12,0,0.7)" },
});
