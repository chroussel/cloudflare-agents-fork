# Gradium × Cloudflare Agents

Three demos of [Gradium](https://gradium.ai) realtime speech models on the
Agents SDK: a continuous voice agent, live speech-to-speech translation, and an
agent that designs its own voice.

## Quick start

```bash
pnpm install
cp .env.example .env
pnpm run start
```

Add your Gradium API key to `.env` — create one at [gradium.ai](https://gradium.ai):

```bash
GRADIUM_API_KEY=your-gradium-api-key
```

No OpenAI key is required. Both voice agents use `@cf/google/gemma-4-26b-a4b-it`
on Workers AI, through the binding in `wrangler.jsonc`, with thinking disabled
for low latency.

## Demos

### Voice Chat

A continuous, interruptible voice agent built on
[`agents/voice`](../../docs/agents/voice.md) and
[`@cloudflare/voice-gradium`](../../voice-providers/gradium). Click **Start call**
once — the microphone stays open, Gradium's semantic VAD detects each turn, and
talking over the assistant interrupts playback. Ask it to "speak French" to hear
the voice switch mid-conversation.

`GradiumTTS` streams raw PCM audio back as it is synthesized, and defaults to
Gradium's native 48 kHz output — matching the browser's `AudioContext` rate
avoids resampling every streamed frame, which can otherwise cause audible seams.

### Live Translation

Speak in one language and hear another. A single Gradium speech-to-speech socket
transcribes, translates, and re-synthesizes — there is no LLM in this path. The
browser captures 24 kHz PCM in; output comes back at the rate the session's
`ready` message reports (48 kHz), scheduled back-to-back on the Web Audio clock
so chunks play without seams.

### Voice Design

The agent starts in Gradium's default voice (Harper) and asks what it should
sound like. Describe a voice — "a calm, older British man with a deep voice" —
and a `design_voice` tool call runs
[Gradium Voice Design](https://docs.gradium.ai): it generates a candidate from
the description, saves it as a library voice, and swaps the agent's TTS to it,
so the question "how does that sound?" is already spoken in the new voice. Ask
for changes ("a bit more energetic") and it revises the description; one seed
per call keeps the speaker recognisable across revisions.

Drafts are deleted from your Gradium library when they are replaced or the call
ends. Press **Keep voice** to save the current one, then reuse its `voiceId`
with `GradiumTTS`.

## Project structure

```
src/
  agents/   one Agent per demo (voice-chat, translate, voice-design)
  lib/      Gradium Voice Design REST client, per-browser session ID
  tabs/     one UI surface per demo
```

## Agents SDK features used

- **`withVoice()`** — the full voice pipeline: continuous STT, streaming TTS,
  barge-in, and conversation persistence (Voice Chat, Voice Design).
- **Tool calling** — the AI SDK `tool()` that designs a voice and switches
  to it mid-reply (Voice Design).
- **`@callable()`** — typed RPC from the browser to an Agent, keeping the API
  key server-side (Live Translation's start/stop).
- **`onMessage`** — intercepting raw WebSocket frames to forward microphone
  audio to a provider socket (Live Translation), and receiving the Keep voice
  button's `sendJSON()` message (Voice Design).
- **Durable Object per session** — each demo is its own Agent class with its own
  namespace.

## Hackathon ideas

- Wire the Live Translation tab into a phone call with the
  [Telnyx phone transport](../telnyx-voice-agent) for realtime interpreting.
- Swap the Voice Chat agent's `voiceId` for another voice from the
  [Gradium voice library](https://gradium.ai) to change its personality.
- Give the Voice Chat agent a web-search tool so it can answer questions about
  current events.
- Build a voice-controlled lightweight 3D game: render the scene with Three.js
  and let the agent drive it through tool calling — "move left", "jump", "spawn
  an enemy" become tools the LLM invokes from your speech.

## Deploy

```bash
npx wrangler secret put GRADIUM_API_KEY
pnpm run deploy
```

## Links

- [`voice-providers/gradium`](../../voice-providers/gradium) — the reusable provider
- [`examples/voice-agent`](../voice-agent) — the same pipeline with other STT providers
- [Gradium API reference](https://docs.gradium.ai)
