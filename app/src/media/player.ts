/**
 * player.ts — voice note playback (expo-audio).
 *
 * Thin hook over useAudioPlayer + useAudioPlayerStatus exposing play/pause/
 * stop, seek, playback-rate control, and live position/duration for the
 * VoiceBlock's scrub bar.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";

export interface VoicePlayer {
  playing: boolean;
  /** Current position in seconds. */
  position: number;
  /** Total duration in seconds (0 until known). */
  duration: number;
  rate: number;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  /** Seek to an absolute position in seconds. */
  seek: (seconds: number) => void;
  /** Seek by fraction 0..1 of the duration (scrub bar). */
  seekFraction: (fraction: number) => void;
  /** Cycle to the next playback speed (1 → 1.5 → 2 → 0.75 → …). */
  setRate: () => void;
  /** Set when playback fails (bad/missing audio, decode error). */
  error: string | null;
}

const RATES = [1, 1.5, 2, 0.75];

export function useVoicePlayer(source: string | { uri: string }): VoicePlayer {
  const src = useMemo(() => (typeof source === "string" ? { uri: source } : source), [source]);
  const player = useAudioPlayer(src);
  const status = useAudioPlayerStatus(player);
  const [rate, setRateState] = useState(1);
  const [error, setError] = useState<string | null>(null);

  // Reset to the start when playback finishes so the next tap replays.
  useEffect(() => {
    if (status?.didJustFinish) {
      player.pause();
      player.seekTo(0);
    }
  }, [status?.didJustFinish, player]);

  // Surface a load/decode failure reported by the player status.
  useEffect(() => {
    const reason = (status as { error?: unknown } | null)?.error;
    if (reason) setError("This voice note couldn't be played.");
  }, [status]);

  const guard = useCallback((fn: () => void) => {
    try {
      fn();
    } catch {
      setError("This voice note couldn't be played.");
    }
  }, []);

  const play = useCallback(() => guard(() => player.play()), [player, guard]);
  const pause = useCallback(() => guard(() => player.pause()), [player, guard]);
  const toggle = useCallback(() => {
    guard(() => (status?.playing ? player.pause() : player.play()));
  }, [player, status?.playing, guard]);

  const stop = useCallback(() => {
    player.pause();
    player.seekTo(0);
  }, [player]);

  const seek = useCallback((seconds: number) => player.seekTo(seconds), [player]);

  const duration = status?.duration ?? 0;
  const seekFraction = useCallback(
    (fraction: number) => {
      const clamped = Math.max(0, Math.min(1, fraction));
      player.seekTo(clamped * (duration || 0));
    },
    [player, duration],
  );

  const setRate = useCallback(
    (r: number) => {
      setRateState(r);
      player.setPlaybackRate(r);
    },
    [player],
  );

  const cycleRate = useCallback(() => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
  }, [rate, setRate]);

  return {
    playing: status?.playing ?? false,
    position: status?.currentTime ?? 0,
    duration,
    rate,
    toggle,
    play,
    pause,
    stop,
    seek,
    seekFraction,
    setRate: cycleRate,
    error,
  };
}
