"""
whisper.py — voice STT + TTS utilities for the Bridge (§4.2).

STT: we reuse Hermes' built-in faster-whisper rather than shipping our own ASR.
     Hermes installs faster-whisper in its own venv, so we invoke
     ``tools.voice_mode.transcribe_recording`` as a subprocess using that venv's
     interpreter (cwd = the agent dir so its ``tools`` package imports).

TTS: free synthesis via edge-tts (installed in the Bridge venv). Produces mp3.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from .config import Settings


class TranscriptionError(RuntimeError):
    pass


_STT_SNIPPET = """
import json, sys
from tools.voice_mode import transcribe_recording
path = sys.argv[1]
model = sys.argv[2] or None
try:
    res = transcribe_recording(path, model=model)
except Exception as e:  # noqa: BLE001
    res = {"success": False, "error": repr(e), "transcript": ""}
sys.stdout.write(json.dumps(res))
"""


async def transcribe(audio_path: str | Path, settings: Settings) -> str:
    """
    Transcribe an audio file to text using Hermes' faster-whisper pipeline.

    Returns the transcript (possibly empty for silence). Raises
    TranscriptionError if the Hermes venv/tooling is unavailable or fails.
    """
    audio_path = str(audio_path)
    py = settings.hermes_agent_python
    if not py.exists():
        raise TranscriptionError(f"Hermes agent python not found at {py}")

    proc = await asyncio.create_subprocess_exec(
        str(py),
        "-c",
        _STT_SNIPPET,
        audio_path,
        settings.stt_model or "",
        cwd=str(settings.hermes_agent_dir),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=settings.stt_timeout_s)
    except asyncio.TimeoutError:
        proc.kill()
        raise TranscriptionError("transcription timed out")

    if proc.returncode != 0:
        raise TranscriptionError(
            f"transcription subprocess failed ({proc.returncode}): {err.decode('utf-8', 'replace')[:500]}"
        )
    try:
        res = json.loads(out.decode("utf-8", "replace") or "{}")
    except json.JSONDecodeError:
        raise TranscriptionError(f"unparseable STT output: {out[:200]!r}")

    if not res.get("success"):
        raise TranscriptionError(res.get("error", "unknown transcription error"))
    return (res.get("transcript") or "").strip()


async def synthesize(
    text: str,
    out_path: str | Path,
    settings: Settings,
    voice: str | None = None,
) -> Path:
    """
    Synthesize speech for `text` to an mp3 at `out_path` via edge-tts.

    Returns the written path. Raises on failure.
    """
    import edge_tts  # lazy: only needed for outbound voice

    out_path = Path(out_path)
    communicate = edge_tts.Communicate(text, voice or settings.tts_voice)
    await communicate.save(str(out_path))
    return out_path


def compute_peaks(samples: list[float], buckets: int = 64) -> list[float]:
    """
    Downsample raw audio amplitudes to <=`buckets` normalized peaks (0..1).

    Used when the Bridge synthesizes audio so the app can render a waveform
    without decoding the file. (Inbound voice carries app-computed peaks.)
    """
    if not samples:
        return []
    n = min(buckets, len(samples))
    step = len(samples) / n
    peaks: list[float] = []
    for i in range(n):
        start = int(i * step)
        end = int((i + 1) * step) or start + 1
        window = samples[start:end] or [0.0]
        peaks.append(max(abs(s) for s in window))
    peak = max(peaks) or 1.0
    return [round(p / peak, 3) for p in peaks]
