import { afterEach, expect, it, vi } from "vitest";
import { GradiumSTT, GradiumTTS } from "../src/index";

class MockWebSocket extends EventTarget {
  accept = vi.fn();
  send = vi.fn();
  close = vi.fn();
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function connectWith(socket = new MockWebSocket()) {
  const fetchMock = vi.fn(
    async () => ({ webSocket: socket, status: 101 }) as unknown as Response
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, socket };
}

function message(socket: MockWebSocket, data: Record<string, unknown>) {
  socket.dispatchEvent(
    new MessageEvent("message", { data: JSON.stringify(data) })
  );
}

function sentMessages(socket: MockWebSocket): Array<Record<string, unknown>> {
  return socket.send.mock.calls.map(([value]) => JSON.parse(String(value)));
}

function closeSocket(socket: MockWebSocket, code = 1006, reason = "") {
  const event = new Event("close");
  Object.assign(event, { code, reason });
  socket.dispatchEvent(event);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("streams Gradium TTS audio after the ready message", async () => {
  const { fetchMock, socket } = connectWith();
  const tts = new GradiumTTS({
    apiKey: "test-key",
    voiceId: "voice-123"
  });
  const iterator = tts.synthesizeStream("Hello world");
  const firstChunk = iterator.next();
  await flush();

  expect(fetchMock).toHaveBeenCalledWith(
    "https://api.gradium.ai/api/speech/tts",
    expect.objectContaining({
      headers: { Upgrade: "websocket", "x-api-key": "test-key" }
    })
  );
  expect(sentMessages(socket)[0]).toEqual({
    type: "setup",
    model_name: "default",
    voice_id: "voice-123",
    output_format: "pcm",
    json_config: {}
  });

  message(socket, { type: "ready" });
  await flush();
  expect(sentMessages(socket).slice(1)).toEqual([
    { type: "text", text: "Hello world" },
    { type: "end_of_stream" }
  ]);

  message(socket, {
    type: "audio",
    audio: btoa(String.fromCharCode(1, 2, 3, 4))
  });
  expect(new Uint8Array((await firstChunk).value)).toEqual(
    new Uint8Array([1, 2, 3, 4])
  );

  const done = iterator.next();
  message(socket, { type: "end_of_stream" });
  await expect(done).resolves.toEqual({ done: true, value: undefined });
  expect(socket.close).toHaveBeenCalled();
});

it("ignores word-timestamp messages in the TTS audio stream", async () => {
  const { socket } = connectWith();
  const tts = new GradiumTTS({ apiKey: "test-key" });
  const iterator = tts.synthesizeStream("Hello world");
  const first = iterator.next();
  await flush();
  message(socket, { type: "ready" });
  await flush();

  // Gradium interleaves word-aligned text with audio; only audio is yielded.
  message(socket, { type: "text", text: "Hello", start_s: 0.24, stop_s: 0.48 });
  message(socket, { type: "audio", audio: btoa("ab") });
  expect(new TextDecoder().decode((await first).value)).toBe("ab");

  const done = iterator.next();
  message(socket, { type: "end_of_stream" });
  await expect(done).resolves.toEqual({ done: true, value: undefined });
});

it("fails the TTS stream when the socket closes before end_of_stream", async () => {
  const { socket } = connectWith();
  const tts = new GradiumTTS({ apiKey: "test-key" });
  const iterator = tts.synthesizeStream("Hello");
  const first = iterator.next();
  await flush();

  message(socket, { type: "ready" });
  closeSocket(socket, 1008, "invalid api key");

  await expect(first).rejects.toThrow(
    "GradiumTTS: WebSocket closed before end_of_stream."
  );
});

it("combines streamed TTS chunks for synthesize", async () => {
  const { socket } = connectWith();
  const tts = new GradiumTTS({ apiKey: "test-key" });
  const audio = tts.synthesize("Hello");
  await flush();

  message(socket, { type: "ready" });
  message(socket, { type: "audio", audio: btoa("ab") });
  message(socket, { type: "audio", audio: btoa("cd") });
  message(socket, { type: "end_of_stream" });

  expect(new TextDecoder().decode((await audio) ?? undefined)).toBe("abcd");
});

it("defaults the STT language to automatic detection", async () => {
  const { socket } = connectWith();
  new GradiumSTT({ apiKey: "test-key" }).createSession();
  await flush();

  expect(sentMessages(socket)[0]).toMatchObject({
    type: "setup",
    json_config: { language: "any" }
  });
});

it("sends STT setup and holds audio until Gradium is ready", async () => {
  const { socket } = connectWith();
  const session = new GradiumSTT({
    apiKey: "test-key",
    language: "fr",
    temperature: 0.2,
    delayInFrames: 6,
    paddingBonus: 1.5
  }).createSession();
  session.feed(new Uint8Array([1, 2]).buffer);
  await flush();

  expect(sentMessages(socket)).toEqual([
    {
      type: "setup",
      model_name: "default",
      input_format: "pcm_16000",
      json_config: {
        language: "fr",
        temp: 0.2,
        delay_in_frames: 6,
        padding_bonus: 1.5
      }
    }
  ]);

  message(socket, { type: "ready" });
  await expect(session.waitUntilReady?.()).resolves.toBeUndefined();
  expect(sentMessages(socket)[1]).toEqual({
    type: "audio",
    audio: btoa(String.fromCharCode(1, 2))
  });
  session.close();
});

it("uses semantic VAD and flushes one complete utterance", async () => {
  const { socket } = connectWith();
  const onSpeechStart = vi.fn();
  const onInterim = vi.fn();
  const onUtterance = vi.fn();
  const session = new GradiumSTT({ apiKey: "test-key" }).createSession({
    onSpeechStart,
    onInterim,
    onUtterance
  });
  await flush();
  message(socket, { type: "ready" });

  message(socket, { type: "text", text: "Hello" });
  message(socket, { type: "text", text: "," });
  message(socket, { type: "text", text: "world" });
  message(socket, {
    type: "step",
    vad: [
      { horizon_s: 1, inactivity_prob: 0.9 },
      { horizon_s: 2, inactivity_prob: 0.6 },
      { horizon_s: 3, inactivity_prob: 0.2 }
    ]
  });

  expect(onSpeechStart).toHaveBeenCalledTimes(1);
  expect(onInterim).toHaveBeenLastCalledWith("Hello, world");
  expect(sentMessages(socket).at(-1)).toEqual({ type: "flush", flush_id: 1 });

  message(socket, { type: "text", text: "today" });
  message(socket, { type: "flushed", flush_id: 1 });
  expect(onUtterance).toHaveBeenCalledWith("Hello, world today");

  // Speech start re-arms for the next utterance, once it clears minSpeechWords.
  message(socket, { type: "text", text: "Next" });
  expect(onSpeechStart).toHaveBeenCalledTimes(1);
  message(socket, { type: "text", text: "question" });
  expect(onSpeechStart).toHaveBeenCalledTimes(2);
  session.close();
});

it("commits the utterance when the flush ack omits flush_id", async () => {
  const { socket } = connectWith();
  const onUtterance = vi.fn();
  const session = new GradiumSTT({ apiKey: "test-key" }).createSession({
    onUtterance
  });
  await flush();
  message(socket, { type: "ready" });
  message(socket, { type: "text", text: "Hello" });
  message(socket, {
    type: "vad",
    vad: [{ horizon_s: 2, inactivity_prob: 0.9 }]
  });
  message(socket, { type: "flushed" });

  expect(onUtterance).toHaveBeenCalledWith("Hello");
  session.close();
});

it("rejects readiness and reports a fatal error when Gradium reports an error", async () => {
  const { socket } = connectWith();
  vi.spyOn(console, "error").mockImplementation(() => {});
  const onFatalError = vi.fn();
  const session = new GradiumSTT({ apiKey: "test-key" }).createSession({
    onFatalError
  });
  const readiness = expect(session.waitUntilReady?.()).rejects.toThrow(
    "Gradium STT server error"
  );
  await flush();

  message(socket, { type: "error", message: "unknown model" });
  await readiness;
  expect(onFatalError).toHaveBeenCalledTimes(1);
  // Provider message text must not leak into the error.
  expect(onFatalError.mock.calls[0][0].message).not.toContain("unknown model");
  session.close();
});

it("reports an unsolicited STT socket close as a fatal error", async () => {
  const { socket } = connectWith();
  const onFatalError = vi.fn();
  new GradiumSTT({ apiKey: "test-key" }).createSession({ onFatalError });
  await flush();
  message(socket, { type: "ready" });
  closeSocket(socket, 1011, "upstream failure");

  expect(onFatalError).toHaveBeenCalledTimes(1);
  expect(onFatalError.mock.calls[0][0]).toMatchObject({
    closeCode: 1011,
    closeReason: "upstream failure"
  });
});

it("does not report a fatal error for teardown initiated by close()", async () => {
  const { socket } = connectWith();
  const onFatalError = vi.fn();
  const session = new GradiumSTT({ apiKey: "test-key" }).createSession({
    onFatalError
  });
  await flush();
  message(socket, { type: "ready" });
  session.close();
  closeSocket(socket, 1000, "");

  expect(onFatalError).not.toHaveBeenCalled();
});

it("waits for enough words before reporting speech start", async () => {
  const { socket } = connectWith();
  const onSpeechStart = vi.fn();
  const onInterim = vi.fn();
  const session = new GradiumSTT({
    apiKey: "test-key",
    minSpeechWords: 3
  }).createSession({ onSpeechStart, onInterim });
  await flush();
  message(socket, { type: "ready" });

  message(socket, { type: "text", text: "Okay" });
  expect(onInterim).toHaveBeenLastCalledWith("Okay");
  expect(onSpeechStart).not.toHaveBeenCalled();

  message(socket, { type: "text", text: "so" });
  expect(onSpeechStart).not.toHaveBeenCalled();

  message(socket, { type: "text", text: "anyway" });
  expect(onSpeechStart).toHaveBeenCalledTimes(1);
  expect(onSpeechStart).toHaveBeenCalledWith("Okay so anyway");
  session.close();
});

it("still flushes a short utterance that never reported speech start", async () => {
  const { socket } = connectWith();
  const onUtterance = vi.fn();
  const session = new GradiumSTT({
    apiKey: "test-key",
    minSpeechWords: 5
  }).createSession({ onUtterance });
  await flush();
  message(socket, { type: "ready" });

  message(socket, { type: "text", text: "Yes" });
  message(socket, {
    type: "vad",
    vad: [{ horizon_s: 2, inactivity_prob: 0.9 }]
  });
  message(socket, { type: "flushed", flush_id: 1 });

  expect(onUtterance).toHaveBeenCalledWith("Yes");
  session.close();
});

it("does not flush below the configured VAD threshold", async () => {
  const { socket } = connectWith();
  const session = new GradiumSTT({
    apiKey: "test-key",
    vadHorizonSeconds: 1,
    vadThreshold: 0.8
  }).createSession();
  await flush();
  message(socket, { type: "ready" });
  message(socket, { type: "text", text: "Still speaking" });
  message(socket, {
    type: "vad",
    vad: [{ horizon_s: 1, inactivity_prob: 0.79 }]
  });

  expect(sentMessages(socket).some((value) => value.type === "flush")).toBe(
    false
  );
  session.close();
});

it("caps audio buffered while the STT connection is pending", async () => {
  const socket = new MockWebSocket();
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  let resolveFetch!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    )
  );

  const session = new GradiumSTT({ apiKey: "test-key" }).createSession();
  for (let index = 0; index < 31; index++) {
    session.feed(new ArrayBuffer(32_000));
  }
  resolveFetch({ webSocket: socket, status: 101 } as unknown as Response);
  await flush();
  message(socket, { type: "ready" });

  expect(
    sentMessages(socket).filter((value) => value.type === "audio")
  ).toHaveLength(30);
  expect(errorSpy).toHaveBeenCalledTimes(1);
  expect(errorSpy).toHaveBeenCalledWith(
    expect.objectContaining({ component: "GradiumSTT", stage: "audio_buffer" })
  );
  session.close();
});

it("rejects readiness when closed while the STT connection is pending", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise<Response>(() => {}))
  );
  const session = new GradiumSTT({ apiKey: "test-key" }).createSession();
  const readiness = expect(session.waitUntilReady?.()).rejects.toThrow(
    "GradiumSTT: WebSocket closed before session start."
  );
  session.close();
  await readiness;
});

it("converts a local ws URL for the WebSocket fetch upgrade", async () => {
  const { fetchMock, socket } = connectWith();
  const session = new GradiumSTT({
    apiKey: "test-key",
    baseUrl: "ws://localhost:8787/speech/asr"
  }).createSession();
  await flush();

  expect(fetchMock).toHaveBeenCalledWith(
    "http://localhost:8787/speech/asr",
    expect.any(Object)
  );
  message(socket, { type: "ready" });
  session.close();
});
