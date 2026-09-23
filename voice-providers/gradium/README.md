# @cloudflare/voice-gradium

Gradium realtime speech-to-text and streaming text-to-speech providers for the [Cloudflare Agents](https://github.com/cloudflare/agents) voice pipeline.

## Install

```bash
npm install agents @cloudflare/voice-gradium
```

## Voice agent

```typescript
import { Agent } from "agents";
import { withVoice, type VoiceTurnContext } from "agents/voice";
import { GradiumSTT, GradiumTTS } from "@cloudflare/voice-gradium";

const VoiceAgent = withVoice(Agent, {
  audioFormat: "pcm16",
  sampleRate: 48_000
});

export class MyAgent extends VoiceAgent<Env> {
  transcriber = new GradiumSTT({
    apiKey: this.env.GRADIUM_API_KEY,
    language: "en"
  });

  tts = new GradiumTTS({ apiKey: this.env.GRADIUM_API_KEY });

  async onTurn(transcript: string, context: VoiceTurnContext) {
    // Return your LLM's text stream.
  }
}
```

`GradiumSTT` keeps one WebSocket alive for the call. Semantic VAD detects turn
boundaries and flushes pending recognition.

`GradiumTTS` streams raw PCM audio back as it is synthesized. Output defaults
to Gradium's native 48 kHz, which avoids resampling individual audio frames.

## STT options

| Option              | Default       | Description                                      |
| ------------------- | ------------- | ------------------------------------------------ |
| `apiKey`            | required      | Gradium API key                                  |
| `modelName`         | `"default"`   | Gradium STT model                                |
| `inputFormat`       | `"pcm_16000"` | Input audio format                               |
| `language`          | `"any"`       | `en`, `fr`, `de`, `es`, `pt`, or `any` to detect |
| `temperature`       | provider      | Decoder temperature                              |
| `delayInFrames`     | provider      | Streaming delay in 80 ms frames                  |
| `paddingBonus`      | provider      | Decoder padding bonus                            |
| `jsonConfig`        | `{}`          | Additional Gradium model configuration           |
| `vadHorizonSeconds` | `2`           | Semantic VAD horizon used for turn detection     |
| `vadThreshold`      | `0.5`         | Inactivity probability that ends a turn          |
| `minSpeechWords`    | `2`           | Words needed before barge-in is reported         |
| `baseUrl`           | Gradium API   | Override the realtime STT WebSocket URL          |

## TTS options

| Option         | Default                     | Description                              |
| -------------- | --------------------------- | ---------------------------------------- |
| `apiKey`       | required                    | Gradium API key                          |
| `voiceId`      | Harper (`4SZHfMpw-p46Ywgs`) | Voice from the Gradium voice library     |
| `modelName`    | `"default"`                 | Gradium TTS model                        |
| `outputFormat` | `"pcm"`                     | `"pcm"` (native 48 kHz) or `"pcm_16000"` |
| `jsonConfig`   | `{}`                        | Additional Gradium model configuration   |
| `baseUrl`      | Gradium API                 | Override the realtime TTS WebSocket URL  |

`sampleRate` on `withVoice()` must match the rate of your `outputFormat` — `48_000` for the default `"pcm"`, `16000` for `"pcm_16000"`. A mismatch plays back pitch-shifted with no error.

## Gradium documentation

- [API reference](https://docs.gradium.ai) — realtime ASR and TTS WebSocket protocols
- [Dashboard](https://gradium.ai) — create an API key and browse the voice library

See [`examples/gradium-starter`](../../examples/gradium-starter) for a complete Workers AI voice agent.
