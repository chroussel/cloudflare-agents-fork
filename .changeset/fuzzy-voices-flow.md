---
"@cloudflare/voice-gradium": minor
---

Add Gradium STT and TTS providers for the Cloudflare Agents voice pipeline.

`GradiumSTT` is a continuous transcriber that keeps one WebSocket per call and
uses Gradium's semantic VAD to detect turn boundaries, with configurable
horizon, threshold, and barge-in word count. `GradiumTTS` streams raw PCM audio
over Gradium's realtime TTS WebSocket, defaulting to the native 48 kHz output
so browser playback avoids per-frame resampling.
