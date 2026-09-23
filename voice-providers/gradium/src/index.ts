import type {
  StreamingTTSProvider,
  Transcriber,
  TranscriberSession,
  TranscriberSessionOptions,
  TTSProvider
} from "agents/voice";
import {
  logVoiceError,
  toVoiceError,
  VoiceProviderError
} from "agents/voice/errors";

const DEFAULT_MODEL_NAME = "default";
const DEFAULT_VOICE_ID = "4SZHfMpw-p46Ywgs";
// Gradium's native rate. Resampling every 80 ms frame to 16 kHz costs latency
// and can leave audible seams, so prefer the native rate by default.
const DEFAULT_TTS_OUTPUT_FORMAT = "pcm";
const DEFAULT_TTS_BASE_URL = "wss://api.gradium.ai/api/speech/tts";
const DEFAULT_STT_INPUT_FORMAT = "pcm_16000";
const DEFAULT_STT_BASE_URL = "wss://api.gradium.ai/api/speech/asr";
const DEFAULT_STT_LANGUAGE = "any";
const DEFAULT_VAD_HORIZON_SECONDS = 2;
const DEFAULT_VAD_THRESHOLD = 0.5;
const DEFAULT_MIN_SPEECH_WORDS = 2;
// About 30 seconds of 16 kHz mono PCM16 audio while the socket connects.
const MAX_PENDING_BYTES = 960_000;

export interface GradiumTTSOptions {
  /** Gradium API key. */
  apiKey: string;
  /** Voice ID from the Gradium voice library. @default Harper */
  voiceId?: string;
  /** Gradium TTS model. @default "default" */
  modelName?: string;
  /**
   * Audio output format. `"pcm"` is Gradium's native 48 kHz mono PCM16;
   * `"pcm_16000"` resamples to 16 kHz. Whichever you pick, `sampleRate` on
   * `withVoice()` must match its rate or playback is pitch-shifted.
   * @default "pcm"
   */
  outputFormat?: string;
  /** Additional model configuration passed to Gradium. */
  jsonConfig?: Record<string, unknown>;
  /** Override the Gradium TTS WebSocket URL. */
  baseUrl?: string;
}

export interface GradiumSTTOptions {
  /** Gradium API key. */
  apiKey: string;
  /** Gradium STT model. @default "default" */
  modelName?: string;
  /** Audio format sent by the voice pipeline. @default "pcm_16000" */
  inputFormat?: string;
  /**
   * Recognition language: "en", "fr", "de", "es", "pt", or "any" to detect it.
   * @default "any"
   */
  language?: string;
  /** Decoder temperature included in Gradium's json_config. */
  temperature?: number;
  /** ASR streaming delay in 80 ms frames. */
  delayInFrames?: number;
  /** Decoder padding bonus included in Gradium's json_config. */
  paddingBonus?: number;
  /** Additional model configuration passed to Gradium. */
  jsonConfig?: Record<string, unknown>;
  /** Semantic VAD horizon used to end a turn, in seconds. @default 2 */
  vadHorizonSeconds?: number;
  /** Semantic VAD inactivity probability used to end a turn. @default 0.5 */
  vadThreshold?: number;
  /**
   * Words required before reporting speech start, which the pipeline uses for
   * barge-in. The microphone stays open while the agent speaks, so a single
   * echoed word can otherwise cut the agent off mid-sentence. @default 2
   */
  minSpeechWords?: number;
  /** Override the Gradium STT WebSocket URL. */
  baseUrl?: string;
}

/**
 * Streaming Gradium text-to-speech for the Agents voice pipeline.
 *
 * The default output is Gradium's native 48 kHz mono PCM16, so configure
 * `withVoice()` with `{ audioFormat: "pcm16", sampleRate: 48_000 }`. If you
 * override `outputFormat` to `"pcm_16000"`, change `sampleRate` to match — a
 * mismatch plays back pitch-shifted with no error.
 */
export class GradiumTTS implements TTSProvider, StreamingTTSProvider {
  #options: GradiumTTSOptions;

  constructor(options: GradiumTTSOptions) {
    this.#options = options;
  }

  async synthesize(
    text: string,
    signal?: AbortSignal
  ): Promise<ArrayBuffer | null> {
    try {
      const chunks: ArrayBuffer[] = [];
      for await (const chunk of this.synthesizeStream(text, signal)) {
        chunks.push(chunk);
      }
      return concatenateBuffers(chunks);
    } catch (error) {
      if (!signal?.aborted) {
        logVoiceError({
          component: "GradiumTTS",
          stage: "synthesize",
          message: "Gradium TTS request failed",
          error: toVoiceError(error, "Gradium TTS request failed")
        });
      }
      return null;
    }
  }

  async *synthesizeStream(
    text: string,
    signal?: AbortSignal
  ): AsyncGenerator<ArrayBuffer> {
    if (!text.trim() || signal?.aborted) return;

    const socket = await connectWebSocket(
      this.#options.baseUrl ?? DEFAULT_TTS_BASE_URL,
      this.#options.apiKey,
      signal,
      "GradiumTTS"
    );
    const audioChunks = new AsyncQueue<ArrayBuffer>();
    const abort = () => socket.close();
    signal?.addEventListener("abort", abort, { once: true });

    let inputSent = false;
    let completed = false;

    const onMessage = (event: MessageEvent) => {
      const message = parseMessage(event.data);
      if (!message) return;

      if (message.type === "ready") {
        if (inputSent || signal?.aborted) return;
        inputSent = true;
        socket.send(JSON.stringify({ type: "text", text }));
        socket.send(JSON.stringify({ type: "end_of_stream" }));
      } else if (message.type === "audio") {
        const audio = stringProp(message, "audio");
        if (audio) audioChunks.push(base64ToArrayBuffer(audio));
      } else if (message.type === "end_of_stream") {
        completed = true;
        audioChunks.finish();
      } else if (message.type === "error") {
        // Provider message text stays out of errors, per agents/voice/errors.
        audioChunks.fail(
          new VoiceProviderError("Gradium TTS server error", { code: "error" })
        );
      }
      // "text" messages carry word-aligned timestamps; unused here.
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("error", (event: Event) => {
      audioChunks.fail(
        new Error("GradiumTTS: WebSocket error.", { cause: event })
      );
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      if (completed || signal?.aborted) audioChunks.finish();
      else {
        audioChunks.fail(
          new VoiceProviderError(
            "GradiumTTS: WebSocket closed before end_of_stream.",
            {
              closeCode: event.code,
              closeReason: event.reason,
              wasClean: event.wasClean
            }
          )
        );
      }
    });

    socket.send(
      JSON.stringify({
        type: "setup",
        model_name: this.#options.modelName ?? DEFAULT_MODEL_NAME,
        voice_id: this.#options.voiceId ?? DEFAULT_VOICE_ID,
        output_format: this.#options.outputFormat ?? DEFAULT_TTS_OUTPUT_FORMAT,
        json_config: this.#options.jsonConfig ?? {}
      })
    );

    try {
      while (true) {
        const next = await audioChunks.next();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      signal?.removeEventListener("abort", abort);
      socket.removeEventListener("message", onMessage);
      socket.close();
    }
  }
}

/**
 * Continuous Gradium speech-to-text for the Agents voice pipeline.
 *
 * Gradium semantic VAD selects a turn boundary. The provider flushes pending
 * recognition at that boundary and emits one stable utterance without closing
 * the per-call transcription socket.
 */
export class GradiumSTT implements Transcriber {
  #options: GradiumSTTOptions;

  constructor(options: GradiumSTTOptions) {
    this.#options = options;
  }

  createSession(options?: TranscriberSessionOptions): TranscriberSession {
    return new GradiumSTTSession(this.#options, options);
  }
}

class GradiumSTTSession implements TranscriberSession {
  #providerOptions: GradiumSTTOptions;
  #sessionOptions: TranscriberSessionOptions | undefined;
  #ws: WebSocket | null = null;
  #closed = false;
  #fatalReported = false;
  #socketReady = false;
  #ready: Promise<void>;
  #readyResolve!: () => void;
  #readyReject!: (error: Error) => void;
  #readySettled = false;
  #pendingChunks: ArrayBuffer[] = [];
  #pendingBytes = 0;
  #pendingOverflowLogged = false;
  #transcript = "";
  #speechReported = false;
  #flushSequence = 0;
  #pendingFlushId: number | null = null;

  constructor(
    providerOptions: GradiumSTTOptions,
    sessionOptions?: TranscriberSessionOptions
  ) {
    this.#providerOptions = providerOptions;
    this.#sessionOptions = sessionOptions;
    this.#ready = new Promise((resolve, reject) => {
      this.#readyResolve = resolve;
      this.#readyReject = reject;
    });
    this.#ready.catch(() => {});
    void this.#connect();
  }

  waitUntilReady(): Promise<void> {
    return this.#ready;
  }

  feed(chunk: ArrayBuffer): void {
    if (this.#closed) return;
    if (!this.#ws || !this.#socketReady) {
      if (this.#pendingBytes + chunk.byteLength > MAX_PENDING_BYTES) {
        if (!this.#pendingOverflowLogged) {
          this.#pendingOverflowLogged = true;
          logVoiceError({
            component: "GradiumSTT",
            stage: "audio_buffer",
            message: "Gradium pending audio buffer full",
            error: new Error("Dropping audio until the socket is ready")
          });
        }
        return;
      }
      this.#pendingBytes += chunk.byteLength;
      this.#pendingChunks.push(chunk);
      return;
    }
    this.#sendAudioChunk(chunk);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#rejectReady(
      new Error("GradiumSTT: WebSocket closed before session start.")
    );
    this.#pendingChunks = [];
    this.#pendingBytes = 0;
    if (this.#ws && this.#socketReady) {
      this.#sendJSON({ type: "end_of_stream" });
    }
    this.#ws?.close();
    this.#ws = null;
  }

  async #connect(): Promise<void> {
    try {
      const socket = await connectWebSocket(
        this.#providerOptions.baseUrl ?? DEFAULT_STT_BASE_URL,
        this.#providerOptions.apiKey,
        undefined,
        "GradiumSTT"
      );

      socket.addEventListener("message", (event: MessageEvent) => {
        this.#handleMessage(event);
      });
      socket.addEventListener("error", (event: Event) => {
        this.#fail(new Error("GradiumSTT: WebSocket error.", { cause: event }));
        this.#closed = true;
      });
      socket.addEventListener("close", (event: CloseEvent) => {
        // A close after close() is our own teardown, not a failure.
        if (this.#closed) return;
        this.#fail(
          new VoiceProviderError("GradiumSTT: WebSocket closed unexpectedly.", {
            closeCode: event.code,
            closeReason: event.reason,
            wasClean: event.wasClean
          })
        );
        this.#closed = true;
      });

      if (this.#closed) {
        socket.close();
        return;
      }

      this.#ws = socket;
      this.#sendJSON({
        type: "setup",
        model_name: this.#providerOptions.modelName ?? DEFAULT_MODEL_NAME,
        input_format:
          this.#providerOptions.inputFormat ?? DEFAULT_STT_INPUT_FORMAT,
        json_config: this.#jsonConfig()
      });
    } catch (error) {
      const voiceError = toVoiceError(error, "Gradium STT connection failed");
      logVoiceError({
        component: "GradiumSTT",
        stage: "connection",
        message: "Gradium STT connection failed",
        error: voiceError
      });
      this.#fail(voiceError);
      this.#closed = true;
    }
  }

  #jsonConfig(): Record<string, unknown> {
    const config = { ...this.#providerOptions.jsonConfig };
    // Gradium requires a language to start an ASR session.
    config.language =
      this.#providerOptions.language ?? config.language ?? DEFAULT_STT_LANGUAGE;
    if (this.#providerOptions.temperature !== undefined) {
      config.temp = this.#providerOptions.temperature;
    }
    if (this.#providerOptions.delayInFrames !== undefined) {
      config.delay_in_frames = this.#providerOptions.delayInFrames;
    }
    if (this.#providerOptions.paddingBonus !== undefined) {
      config.padding_bonus = this.#providerOptions.paddingBonus;
    }
    return config;
  }

  #handleMessage(event: MessageEvent): void {
    if (this.#closed) return;
    const message = parseMessage(event.data);
    if (!message) return;

    if (message.type === "ready") {
      this.#socketReady = true;
      this.#resolveReady();
      for (const chunk of this.#pendingChunks) this.#sendAudioChunk(chunk);
      this.#pendingChunks = [];
      this.#pendingBytes = 0;
      return;
    }

    if (message.type === "text") {
      const text = stringProp(message, "text");
      if (!text) return;
      this.#transcript = appendTranscript(this.#transcript, text);
      // Barge-in waits for a few words, so room noise or the agent's own audio
      // echoing back doesn't interrupt it.
      if (
        !this.#speechReported &&
        countWords(this.#transcript) >=
          (this.#providerOptions.minSpeechWords ?? DEFAULT_MIN_SPEECH_WORDS)
      ) {
        this.#speechReported = true;
        this.#sessionOptions?.onSpeechStart?.(this.#transcript);
      }
      this.#sessionOptions?.onInterim?.(this.#transcript);
      return;
    }

    if (message.type === "step" || message.type === "vad") {
      this.#handleVad(message);
      return;
    }

    if (message.type === "flushed") {
      const flushId = numberProp(message, "flush_id");
      if (
        this.#pendingFlushId !== null &&
        (flushId === undefined || flushId === this.#pendingFlushId)
      ) {
        this.#commitUtterance();
      }
      return;
    }

    if (message.type === "end_of_stream") {
      this.#commitUtterance();
      return;
    }

    if (message.type === "error") {
      // Provider message text stays out of errors, per agents/voice/errors.
      const error = new VoiceProviderError("Gradium STT server error", {
        code: "error"
      });
      logVoiceError({
        component: "GradiumSTT",
        stage: "provider_message",
        message: "Gradium STT server error",
        error
      });
      this.#fail(error);
    }
  }

  #handleVad(message: Record<string, unknown>): void {
    if (!this.#transcript || this.#pendingFlushId !== null) return;

    const predictions = message.vad;
    if (!Array.isArray(predictions)) return;
    const prediction = closestVadPrediction(
      predictions,
      this.#providerOptions.vadHorizonSeconds ?? DEFAULT_VAD_HORIZON_SECONDS
    );
    if (
      !prediction ||
      prediction.inactivityProbability <
        (this.#providerOptions.vadThreshold ?? DEFAULT_VAD_THRESHOLD)
    ) {
      return;
    }

    const flushId = ++this.#flushSequence;
    if (this.#sendJSON({ type: "flush", flush_id: flushId })) {
      this.#pendingFlushId = flushId;
    }
  }

  #commitUtterance(): void {
    const transcript = this.#transcript.trim();
    this.#transcript = "";
    this.#speechReported = false;
    this.#pendingFlushId = null;
    if (transcript) this.#sessionOptions?.onUtterance?.(transcript);
  }

  #sendAudioChunk(chunk: ArrayBuffer): void {
    this.#sendJSON({ type: "audio", audio: arrayBufferToBase64(chunk) });
  }

  #sendJSON(message: Record<string, unknown>): boolean {
    if (!this.#ws) return false;
    try {
      this.#ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      if (!this.#closed) {
        logVoiceError({
          component: "GradiumSTT",
          stage: "websocket_send",
          message: "Gradium WebSocket send failed",
          error: toVoiceError(error, "Gradium WebSocket send failed")
        });
      }
      return false;
    }
  }

  /** Reports an unrecoverable failure once, unless close() already ran. */
  #fail(error: Error): void {
    if (!this.#closed && !this.#fatalReported) {
      this.#fatalReported = true;
      this.#sessionOptions?.onFatalError?.(error);
    }
    this.#rejectReady(error);
  }

  #resolveReady(): void {
    if (this.#readySettled) return;
    this.#readySettled = true;
    this.#readyResolve();
  }

  #rejectReady(error: Error): void {
    if (this.#readySettled) return;
    this.#readySettled = true;
    this.#readyReject(error);
  }
}

/**
 * Single-consumer queue bridging WebSocket events to an async generator.
 */
class AsyncQueue<T> {
  #items: T[] = [];
  #waiters: Array<(result: IteratorResult<T, undefined>) => void> = [];
  #done = false;
  #error: Error | null = null;

  push(item: T): void {
    if (this.#done) return;
    const waiter = this.#waiters.shift();
    if (waiter) waiter({ done: false, value: item });
    else this.#items.push(item);
  }

  finish(): void {
    if (this.#done) return;
    this.#done = true;
    for (const waiter of this.#waiters) {
      waiter({ done: true, value: undefined });
    }
    this.#waiters = [];
  }

  fail(error: Error): void {
    if (this.#done) return;
    this.#error = error;
    this.finish();
  }

  async next(): Promise<IteratorResult<T, undefined>> {
    if (this.#items.length > 0) {
      return { done: false, value: this.#items.shift() as T };
    }
    if (this.#error) throw this.#error;
    if (this.#done) return { done: true, value: undefined };

    const result = await new Promise<IteratorResult<T, undefined>>((resolve) =>
      this.#waiters.push(resolve)
    );
    if (this.#error) throw this.#error;
    return result;
  }
}

async function connectWebSocket(
  baseUrl: string,
  apiKey: string,
  signal: AbortSignal | undefined,
  providerName: string
): Promise<WebSocket> {
  const url = baseUrl
    .replace(/^wss:\/\//, "https://")
    .replace(/^ws:\/\//, "http://");
  const response = await fetch(url, {
    headers: { Upgrade: "websocket", "x-api-key": apiKey },
    signal
  });
  const socket = (response as unknown as { webSocket?: WebSocket }).webSocket;
  if (!socket) {
    throw new VoiceProviderError(`${providerName} WebSocket upgrade failed`, {
      status: response.status
    });
  }
  (socket as unknown as { accept: () => void }).accept();
  return socket;
}

function closestVadPrediction(
  predictions: unknown[],
  horizonSeconds: number
): { inactivityProbability: number } | null {
  let closest: { distance: number; inactivityProbability: number } | null =
    null;
  for (const value of predictions) {
    if (!isObject(value)) continue;
    const horizon = numberProp(value, "horizon_s");
    const probability = numberProp(value, "inactivity_prob");
    if (horizon === undefined || probability === undefined) continue;
    const distance = Math.abs(horizon - horizonSeconds);
    if (!closest || distance < closest.distance) {
      closest = { distance, inactivityProbability: probability };
    }
  }
  return closest;
}

function countWords(text: string): number {
  return (text.match(/\S+/g) ?? []).length;
}

function appendTranscript(current: string, next: string): string {
  if (!current) return next.trimStart();
  if (/\s$/.test(current) || /^\s|^[.,!?;:]/.test(next)) {
    return current + next;
  }
  return `${current} ${next}`;
}

function parseMessage(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringProp(
  value: Record<string, unknown>,
  key: string
): string | undefined {
  const prop = value[key];
  return typeof prop === "string" ? prop : undefined;
}

function numberProp(
  value: Record<string, unknown>,
  key: string
): number | undefined {
  const prop = value[key];
  return typeof prop === "number" ? prop : undefined;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function concatenateBuffers(chunks: ArrayBuffer[]): ArrayBuffer | null {
  if (chunks.length === 0) return null;
  const totalLength = chunks.reduce(
    (total, chunk) => total + chunk.byteLength,
    0
  );
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(new Uint8Array(chunk), offset);
    offset += chunk.byteLength;
  }
  return result.buffer;
}
