/**
 * recorder.ts — voice note recording (expo-audio).
 *
 * Records to m4a (RecordingPresets.HIGH_QUALITY) and, while recording, samples
 * the metering level (~dBFS) to build a normalized waveform of <=64 peaks for
 * the VoiceBlock to render without decoding the file.
 *
 * NOTE: expo-audio replaces expo-av (removed from Expo Go in SDK 54+).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";

const MAX_PEAKS = 64;
const SAMPLE_INTERVAL_MS = 80;

export interface RecordingResult {
  uri: string;
  durationMs: number;
  peaks: number[]; // normalized 0..1, <=64 samples
}

/** Map a metering value in dBFS (≈ -160..0) to a 0..1 amplitude. */
function dbToAmp(db: number | undefined): number {
  if (db == null || !isFinite(db)) return 0;
  const floor = -60;
  if (db < floor) return 0;
  return Math.min(1, (db - floor) / -floor);
}

/** Downsample a raw peak series to <=MAX_PEAKS, normalized to its own max. */
function normalizePeaks(raw: number[]): number[] {
  if (raw.length === 0) return [];
  const n = Math.min(MAX_PEAKS, raw.length);
  const step = raw.length / n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const slice = raw.slice(Math.floor(i * step), Math.floor((i + 1) * step) || 1);
    out.push(slice.length ? Math.max(...slice) : 0);
  }
  const peak = Math.max(...out, 0.0001);
  return out.map((v) => Math.round((v / peak) * 1000) / 1000);
}

export function useVoiceRecorder() {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  });
  const [isRecording, setIsRecording] = useState(false);
  const rawPeaks = useRef<number[]>([]);
  const startedAt = useRef(0);
  const meterTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopMeter = useCallback(() => {
    if (meterTimer.current) clearInterval(meterTimer.current);
    meterTimer.current = null;
  }, []);

  useEffect(() => stopMeter, [stopMeter]);

  const start = useCallback(async (): Promise<boolean> => {
    const perm = await AudioModule.requestRecordingPermissionsAsync();
    if (!perm.granted) return false;

    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    rawPeaks.current = [];
    await recorder.prepareToRecordAsync();
    recorder.record();
    startedAt.current = Date.now();
    setIsRecording(true);

    meterTimer.current = setInterval(() => {
      const status = recorder.getStatus();
      rawPeaks.current.push(dbToAmp(status.metering));
    }, SAMPLE_INTERVAL_MS);
    return true;
  }, [recorder]);

  const stop = useCallback(async (): Promise<RecordingResult | null> => {
    stopMeter();
    if (!isRecording) return null;
    await recorder.stop();
    setIsRecording(false);
    await setAudioModeAsync({ allowsRecording: false });

    const uri = recorder.uri;
    if (!uri) return null;
    return {
      uri,
      durationMs: Date.now() - startedAt.current,
      peaks: normalizePeaks(rawPeaks.current),
    };
  }, [recorder, isRecording, stopMeter]);

  const cancel = useCallback(async () => {
    stopMeter();
    if (isRecording) {
      try {
        await recorder.stop();
      } catch {
        /* ignore */
      }
      setIsRecording(false);
      await setAudioModeAsync({ allowsRecording: false });
    }
  }, [recorder, isRecording, stopMeter]);

  return { isRecording, start, stop, cancel };
}
