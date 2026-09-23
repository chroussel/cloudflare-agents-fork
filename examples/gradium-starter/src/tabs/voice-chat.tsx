import { useVoiceAgent, type VoiceStatus } from "agents/voice/react";
import { Button, Input, Surface, Text } from "@cloudflare/kumo";
import {
  CircleIcon,
  MicrophoneIcon,
  MicrophoneSlashIcon,
  PaperPlaneRightIcon,
  PhoneDisconnectIcon,
  PhoneIcon,
  SpeakerHighIcon,
  SpinnerGapIcon,
  WaveformIcon
} from "@phosphor-icons/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { getSessionId } from "../lib/session-id";

function statusDisplay(status: VoiceStatus) {
  switch (status) {
    case "listening":
      return {
        label: "Listening",
        icon: WaveformIcon,
        color: "text-kumo-success"
      };
    case "thinking":
      return {
        label: "Thinking",
        icon: SpinnerGapIcon,
        color: "text-kumo-warning"
      };
    case "speaking":
      return {
        label: "Speaking",
        icon: SpeakerHighIcon,
        color: "text-kumo-info"
      };
    default:
      return { label: "Ready", icon: PhoneIcon, color: "text-kumo-secondary" };
  }
}

interface VoiceChatTabProps {
  agent?: string;
  idleHint?: string;
  /** Renders app-specific call state from the agent's custom messages. */
  panel?: (agent: {
    lastCustomMessage: unknown;
    sendJSON: (data: Record<string, unknown>) => void;
  }) => ReactNode;
}

export function VoiceChatTab({
  agent = "voice-chat-agent",
  idleHint = "Start a call for a continuous, hands-free voice conversation.",
  panel
}: VoiceChatTabProps) {
  const sessionId = useRef(getSessionId()).current;
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const {
    status,
    transcript,
    interimTranscript,
    metrics,
    audioLevel,
    isMuted,
    connected,
    error,
    startCall,
    endCall,
    toggleMute,
    sendText,
    sendJSON,
    lastCustomMessage
  } = useVoiceAgent({
    agent,
    name: sessionId
  });

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [interimTranscript, transcript]);

  const inCall = status !== "idle";
  const display = statusDisplay(status);
  const StatusIcon = display.icon;

  return (
    <div className="mx-auto flex h-full max-w-4xl flex-col gap-4 px-5 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-kumo-secondary">
          <CircleIcon
            size={9}
            weight="fill"
            className={connected ? "text-kumo-success" : "text-kumo-danger"}
          />
          {connected ? "Agent connected" : "Connecting to agent"}
        </div>
        <span className="text-xs text-kumo-secondary">
          Gradium STT · Gradium TTS · Workers AI
        </span>
      </div>

      {error && (
        <Surface className="rounded-xl px-4 py-3 text-sm text-kumo-danger ring ring-kumo-danger">
          {error}
        </Surface>
      )}

      <Surface className="rounded-xl px-4 py-3 text-center ring ring-kumo-line">
        <div
          className={`flex items-center justify-center gap-2 ${display.color}`}
        >
          <StatusIcon
            size={20}
            weight="bold"
            className={status === "thinking" ? "animate-spin" : ""}
          />
          <span className="text-lg font-medium">{display.label}</span>
        </div>
        {inCall && status === "listening" && (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-kumo-fill">
            <div
              className="h-full rounded-full bg-kumo-success transition-all duration-75"
              style={{ width: `${Math.min(audioLevel * 500, 100)}%` }}
            />
          </div>
        )}
      </Surface>

      {panel?.({ lastCustomMessage, sendJSON })}

      {metrics && (
        <div className="flex justify-center gap-3 font-mono text-[11px] text-kumo-secondary">
          <span>LLM {metrics.llm_ms}ms</span>
          <span>TTS {metrics.tts_ms}ms</span>
          <span>First audio {metrics.first_audio_ms}ms</span>
        </div>
      )}

      <Surface className="min-h-0 flex-1 overflow-y-auto rounded-xl ring ring-kumo-line">
        {transcript.length === 0 && !interimTranscript ? (
          <div className="flex h-full min-h-64 items-center justify-center px-6 text-center">
            <Text size="sm" variant="secondary">
              {inCall
                ? "The microphone stays open. Speak naturally and pause when your turn is finished."
                : idleHint}
            </Text>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {transcript.map((message, index) => (
              <div
                key={`${message.timestamp}-${index}`}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm ${
                    message.role === "user"
                      ? "rounded-br-md bg-kumo-contrast text-kumo-inverse"
                      : "rounded-bl-md bg-kumo-fill text-kumo-default"
                  }`}
                >
                  {message.text}
                </div>
              </div>
            ))}
            {interimTranscript && (
              <div className="flex justify-end">
                <div className="max-w-[82%] rounded-2xl rounded-br-md border border-dashed border-kumo-line bg-kumo-base px-4 py-2.5 text-sm italic text-kumo-secondary">
                  {interimTranscript}
                </div>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </Surface>

      <div className="flex justify-center gap-3">
        {!inCall ? (
          <Button
            variant="primary"
            disabled={!connected}
            onClick={() => void startCall()}
            icon={<PhoneIcon size={19} weight="fill" />}
          >
            Start call
          </Button>
        ) : (
          <>
            <Button
              variant={isMuted ? "destructive" : "secondary"}
              onClick={toggleMute}
              icon={
                isMuted ? (
                  <MicrophoneSlashIcon size={19} weight="fill" />
                ) : (
                  <MicrophoneIcon size={19} weight="fill" />
                )
              }
            >
              {isMuted ? "Unmute" : "Mute"}
            </Button>
            <Button
              variant="destructive"
              onClick={endCall}
              icon={<PhoneDisconnectIcon size={19} weight="fill" />}
            >
              End call
            </Button>
          </>
        )}
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = text.trim();
          if (!value || !connected) return;
          sendText(value);
          setText("");
        }}
      >
        <Input
          aria-label="Text message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Or type a message"
          disabled={!connected || status === "thinking"}
          className="flex-1"
        />
        <Button
          type="submit"
          variant="secondary"
          disabled={!connected || !text.trim() || status === "thinking"}
          icon={<PaperPlaneRightIcon size={16} weight="fill" />}
        >
          Send
        </Button>
      </form>
    </div>
  );
}
