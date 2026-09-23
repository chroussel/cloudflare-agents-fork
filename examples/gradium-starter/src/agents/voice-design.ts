import { Agent, type Connection } from "agents";
import {
  withVoice,
  type StreamingTTSProvider,
  type TTSProvider,
  type VoiceTurnContext
} from "agents/voice";
import { GradiumSTT, GradiumTTS } from "@cloudflare/voice-gradium";
import { isStepCount, streamText, tool } from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { z } from "zod";
import {
  deleteVoice,
  designVoice,
  renameVoice,
  VOICE_LANGUAGES,
  type DesignedVoice
} from "../lib/voice-design";

const VoiceAgent = withVoice(Agent, {
  audioFormat: "pcm16",
  sampleRate: 48_000,
  historyLimit: 10
});

/** Harper, the library voice the agent starts with. */
const DEFAULT_VOICE_ID = "4SZHfMpw-p46Ywgs";

function systemPrompt(voice: DesignedVoice | null) {
  return `You are a friendly voice assistant who can design your own voice.

Current voice: ${voice ? `"${voice.description}"` : "the default voice; nothing designed yet"}.

First find out what voice the user would like you to have. As soon as they give any usable trait (gender, age, accent, tone, pitch, pace, energy, or mood), call design_voice right away without asking for more detail. Describe the voice in English: gender and age, accent, emotion, then sound qualities.

For a change, call design_voice with the current voice description edited to apply it, keeping every other trait as it is. After design_voice succeeds you are already speaking in the new voice: ask in one short sentence how it sounds. If the user wants to keep the voice, tell them to press "Keep voice".

Once the user is happy, carry on as a helpful assistant. Keep every response to one or two short sentences suitable for speech, and never mention tool names.`;
}

export type VoiceDesignMessage =
  | { type: "voice-design"; status: "default" }
  | { type: "voice-design"; status: "designing"; description: string }
  | {
      type: "voice-design";
      status: "ready";
      voice: DesignedVoice;
      revision: number;
      kept: boolean;
    }
  | { type: "voice-design"; status: "failed"; description: string };

/**
 * The pipeline resolves `tts` once per turn, so the agent swaps voices behind
 * this wrapper; each sentence is spoken with whichever voice is current.
 */
class SwitchableTTS implements TTSProvider, StreamingTTSProvider {
  constructor(public voice: GradiumTTS) {}

  synthesize(text: string, signal?: AbortSignal) {
    return this.voice.synthesize(text, signal);
  }

  synthesizeStream(text: string, signal?: AbortSignal) {
    return this.voice.synthesizeStream(text, signal);
  }
}

export class VoiceDesignAgent extends VoiceAgent<Env> {
  transcriber = new GradiumSTT({
    apiKey: this.env.GRADIUM_API_KEY,
    delayInFrames: 8,
    vadHorizonSeconds: 2,
    vadThreshold: 0.5
  });

  tts = new SwitchableTTS(this.#gradiumVoice(DEFAULT_VOICE_ID));

  /** One seed per call keeps the same speaker across revisions. */
  #seed = 0;
  #voice: DesignedVoice | null = null;
  #revision = 0;
  #kept = false;

  async onTurn(transcript: string, context: VoiceTurnContext) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/google/gemma-4-26b-a4b-it", {
        sessionAffinity: this.sessionAffinity,
        chat_template_kwargs: { enable_thinking: false }
      }),
      instructions: systemPrompt(this.#voice),
      messages: [
        ...context.messages.map((message) => ({
          role: message.role,
          content: message.content
        })),
        { role: "user" as const, content: transcript }
      ],
      tools: {
        design_voice: tool({
          description:
            "Create a new voice for yourself from a description and start speaking with it.",
          inputSchema: z.object({
            description: z
              .string()
              .max(500)
              .describe("Complete English description of the voice"),
            language: z
              .enum(VOICE_LANGUAGES)
              .describe("Language the voice will speak")
          }),
          execute: ({ description, language }) =>
            this.#design(description, language)
        })
      },
      // Until a voice exists every reply to the greeting is a voice request,
      // so the first step must design one rather than just talk about it.
      prepareStep: ({ stepNumber }) =>
        stepNumber === 0 && !this.#voice ? { toolChoice: "required" } : {},
      stopWhen: isStepCount(3),
      abortSignal: context.signal
    });

    return result.stream;
  }

  async onCallStart(connection: Connection) {
    this.#seed = Math.floor(Math.random() * 2 ** 31);
    this.#revision = 0;
    this.#send({ type: "voice-design", status: "default" });
    await this.speak(
      connection,
      "Hi! Before we chat, what kind of voice would you like me to have?"
    );
  }

  async onCallEnd() {
    await this.#reset();
  }

  /** A closed tab skips onCallEnd, so drafts are cleaned up here too. */
  async onClose() {
    await this.#reset();
  }

  /** The "Keep voice" button sends `{ type: "keep-voice" }`. */
  async onMessage(_connection: Connection, message: string | ArrayBuffer) {
    if (typeof message !== "string" || !this.#voice || this.#kept) return;
    if (JSON.parse(message).type !== "keep-voice") return;
    await renameVoice(this.env.GRADIUM_API_KEY, this.#voice, "Designed voice");
    this.#kept = true;
    this.#sendReady();
  }

  async #design(description: string, language: DesignedVoice["language"]) {
    this.#send({ type: "voice-design", status: "designing", description });
    try {
      const voice = await designVoice(this.env.GRADIUM_API_KEY, {
        description,
        language,
        seed: this.#seed
      });
      this.tts.voice = this.#gradiumVoice(voice.voiceId);
      await this.#discardDraft();
      this.#voice = voice;
      this.#revision += 1;
      this.#kept = false;
      this.#sendReady();
      return { ok: true };
    } catch (error) {
      console.error("Voice design failed", error);
      this.#send({ type: "voice-design", status: "failed", description });
      return { ok: false, error: "Voice design failed. Try again." };
    }
  }

  #gradiumVoice(voiceId: string) {
    return new GradiumTTS({ apiKey: this.env.GRADIUM_API_KEY, voiceId });
  }

  /** Returns to the default voice, discarding an unkept draft. */
  async #reset() {
    await this.#discardDraft();
    this.#voice = null;
    this.tts.voice = this.#gradiumVoice(DEFAULT_VOICE_ID);
  }

  /** Removes the current voice from the library unless the user kept it. */
  async #discardDraft() {
    if (!this.#voice || this.#kept) return;
    await deleteVoice(this.env.GRADIUM_API_KEY, this.#voice.voiceId).catch(
      (error) => console.warn("Could not delete draft voice", error)
    );
  }

  #sendReady() {
    if (!this.#voice) return;
    this.#send({
      type: "voice-design",
      status: "ready",
      voice: this.#voice,
      revision: this.#revision,
      kept: this.#kept
    });
  }

  #send(message: VoiceDesignMessage) {
    this.broadcast(JSON.stringify(message));
  }
}
