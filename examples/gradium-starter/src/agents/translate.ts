import { Agent, callable, type Connection } from "agents";

// Workers can't open wss:// with fetch — use https:// plus an Upgrade header.
const S2S_URL = "https://api.gradium.ai/api/speech/s2s";

/**
 * Live speech translation over a single Gradium speech-to-speech socket.
 *
 * Audio goes in, translated audio comes back — transcription, translation and
 * re-synthesis all happen inside Gradium, so there is no LLM in this path.
 */
export class TranslateAgent extends Agent<Env> {
  /** Outbound socket to Gradium, open only while the user is recording. */
  #socket: WebSocket | null = null;

  /**
   * Opens a Gradium session that translates into `targetLanguage`, speaking
   * with `voiceId` — a library voice for that language.
   */
  @callable()
  async startTranslation(targetLanguage: string, voiceId: string) {
    this.#closeSocket();

    const response = await fetch(S2S_URL, {
      headers: { Upgrade: "websocket", "x-api-key": this.env.GRADIUM_API_KEY }
    });
    const socket = response.webSocket;
    if (!socket) throw new Error("Gradium s2s WebSocket upgrade failed.");
    socket.accept();
    this.#socket = socket;

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = JSON.parse(event.data) as Record<string, unknown>;

      switch (message.type) {
        case "ready":
          // Input is 24 kHz PCM; the output rate (48 kHz for "pcm") is reported
          // here, and the browser schedules playback with it.
          this.#send({
            type: "translation-ready",
            sampleRate: message.sample_rate
          });
          break;
        case "text":
          this.#send({ type: "translation-text", text: message.text });
          break;
        case "audio":
          this.#send({ type: "translation-audio", audio: message.audio });
          break;
        case "error":
          console.error("Gradium translation error:", message.message);
          this.#send({ type: "translation-error" });
          break;
      }
    });
    socket.addEventListener("close", () => {
      this.#socket = null;
    });

    socket.send(
      JSON.stringify({
        type: "setup",
        model_name: "s2s-translate",
        stt_model_name: "stt-translate",
        tts_model_name: "default",
        input_format: "pcm",
        output_format: "pcm",
        voice_id: voiceId,
        json_config: { target_language: targetLanguage }
      })
    );
  }

  @callable()
  async stopTranslation() {
    this.#socket?.send(JSON.stringify({ type: "end_of_stream" }));
    this.#closeSocket();
  }

  /** Forwards microphone frames from the browser to Gradium. */
  onMessage(_connection: Connection, message: string | ArrayBuffer) {
    if (typeof message !== "string" || !this.#socket) return;
    const { type, data } = JSON.parse(message) as {
      type?: string;
      data?: string;
    };
    if (type === "audio-chunk" && data) {
      this.#socket.send(JSON.stringify({ type: "audio", audio: data }));
    }
  }

  #send(message: Record<string, unknown>) {
    this.broadcast(JSON.stringify(message));
  }

  #closeSocket() {
    this.#socket?.close();
    this.#socket = null;
  }
}
