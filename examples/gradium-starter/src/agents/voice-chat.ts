import { Agent, type Connection } from "agents";
import { withVoice, type VoiceTurnContext } from "agents/voice";
import { GradiumSTT, GradiumTTS } from "@cloudflare/voice-gradium";
import { streamText } from "ai";
import { createWorkersAI } from "workers-ai-provider";

// Gradium TTS output is native 48 kHz, so the pipeline runs at that rate rather
// than resampling every streamed frame.
const VoiceAgent = withVoice(Agent, {
  audioFormat: "pcm16",
  sampleRate: 48_000,
  historyLimit: 10
});

/** Voices from the Gradium library, with the words that select each language. */
const VOICES = {
  en: { id: "4SZHfMpw-p46Ywgs", match: /\b(english|anglais)\b/ },
  fr: { id: "ZeSg853xFACESHHI", match: /\b(french|francais)\b/ }
} as const;

type Language = keyof typeof VOICES;

/** Verbs that turn naming a language into a request to switch to it. */
const SWITCH_INTENT =
  /\b(speak|say|talk|reply|respond|switch|change|use|parle|parlez|reponds|repondez|passe|passez|utilise|utilisez)\b/;

const SYSTEM_PROMPT = `You are a helpful, friendly multilingual voice assistant. Begin in English. If the user asks you to switch languages, reply in the requested language and continue using it until they ask to switch again. Keep every response concise, natural, and suitable for speech, usually one to three sentences.`;

/**
 * Detects "answer me in French" so the voice follows the model's language.
 *
 * The system prompt already tells the model to switch on request; this only has
 * to keep the spoken voice in step with it.
 */
function requestedLanguage(transcript: string): Language | null {
  const normalized = transcript
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

  if (!SWITCH_INTENT.test(normalized)) return null;
  const languages = Object.keys(VOICES) as Language[];
  return (
    languages.find((language) => VOICES[language].match.test(normalized)) ??
    null
  );
}

export class VoiceChatAgent extends VoiceAgent<Env> {
  transcriber = new GradiumSTT({
    apiKey: this.env.GRADIUM_API_KEY,
    delayInFrames: 8,
    vadHorizonSeconds: 2,
    vadThreshold: 0.5
  });

  tts = this.#voiceFor("en");

  #voiceFor(language: Language) {
    return new GradiumTTS({
      apiKey: this.env.GRADIUM_API_KEY,
      voiceId: VOICES[language].id
    });
  }

  async onTurn(transcript: string, context: VoiceTurnContext) {
    const language = requestedLanguage(transcript);
    if (language) this.tts = this.#voiceFor(language);

    const workersai = createWorkersAI({ binding: this.env.AI });
    const result = streamText({
      model: workersai("@cf/google/gemma-4-26b-a4b-it", {
        sessionAffinity: this.sessionAffinity,
        chat_template_kwargs: { enable_thinking: false }
      }),
      instructions: SYSTEM_PROMPT,
      // context.messages is prior history only; the current turn is `transcript`.
      messages: [
        ...context.messages.map((message) => ({
          role: message.role,
          content: message.content
        })),
        { role: "user" as const, content: transcript }
      ],
      abortSignal: context.signal
    });

    return result.stream;
  }

  async onCallStart(connection: Connection) {
    this.tts = this.#voiceFor("en");
    await this.speak(
      connection,
      "Hi! I'm ready. Start speaking whenever you like."
    );
  }
}
