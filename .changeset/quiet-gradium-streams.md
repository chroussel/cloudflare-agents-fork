---
"@cloudflare/voice-gradium": patch
---

Replace the custom TTS audio queue with a ReadableStream and a configurable
`maxBufferedAudioBytes` limit (2,880,000 bytes by default). Fail and discard
queued audio on overflow or provider failure, unblock reads immediately on
cancellation, and release WebSocket listeners on termination.

Attach TTS listeners before accepting the upgraded WebSocket and release the
connection if acceptance fails. Treat aborts consistently across connection
and streaming, and return `null` instead of partial audio when collected
synthesis is cancelled.

Give STT sessions named socket handlers and centralized teardown. Install
listeners before socket acceptance, abort pending upgrades on close, and make
provider/socket/send failures terminal before notifying the caller. Release
buffered audio and listeners on termination, and reject readiness if startup
audio cannot be sent.
