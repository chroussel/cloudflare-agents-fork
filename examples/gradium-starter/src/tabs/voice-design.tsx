import { Badge, Button, Surface, Text } from "@cloudflare/kumo";
import {
  BookmarkSimpleIcon,
  SpinnerGapIcon,
  UserSoundIcon
} from "@phosphor-icons/react";
import type { VoiceDesignMessage } from "../agents/voice-design";
import { VoiceChatTab } from "./voice-chat";

function isVoiceDesignMessage(message: unknown): message is VoiceDesignMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "voice-design"
  );
}

function DesignPanel({
  message,
  onKeep
}: {
  message: unknown;
  onKeep: () => void;
}) {
  const design = isVoiceDesignMessage(message)
    ? message
    : { type: "voice-design", status: "default" as const };

  return (
    <Surface className="flex items-start gap-3 rounded-xl px-4 py-3 ring ring-kumo-line">
      {design.status === "designing" ? (
        <SpinnerGapIcon
          size={20}
          className="mt-0.5 shrink-0 animate-spin text-kumo-warning"
        />
      ) : (
        <UserSoundIcon size={20} className="mt-0.5 shrink-0 text-kumo-accent" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {design.status === "default" && (
          <>
            <Text size="sm" bold>
              Harper (default voice)
            </Text>
            <Text size="xs" variant="secondary">
              Describe the voice you want, e.g. “a calm, older British man with
              a deep voice”.
            </Text>
          </>
        )}
        {design.status === "designing" && (
          <>
            <Text size="sm" bold>
              Designing voice…
            </Text>
            <Text size="xs" variant="secondary">
              {design.description}
            </Text>
          </>
        )}
        {design.status === "failed" && (
          <>
            <span className="text-sm font-medium text-kumo-danger">
              Voice design failed
            </span>
            <Text size="xs" variant="secondary">
              {design.description}
            </Text>
          </>
        )}
        {design.status === "ready" && (
          <>
            <div className="flex items-center gap-2">
              <Text size="sm" bold>
                Designed voice · v{design.revision}
              </Text>
              <Badge variant={design.kept ? "primary" : "secondary"}>
                {design.kept ? "Kept" : "Draft"}
              </Badge>
            </div>
            <Text size="xs" variant="secondary">
              {design.voice.description}
            </Text>
            <span className="font-mono text-[11px] text-kumo-secondary">
              voiceId: {design.voice.voiceId}
              {!design.kept && " · deleted when the call ends"}
            </span>
          </>
        )}
      </div>
      {design.status === "ready" && !design.kept && (
        <Button
          size="sm"
          variant="secondary"
          onClick={onKeep}
          icon={<BookmarkSimpleIcon size={14} />}
        >
          Keep voice
        </Button>
      )}
    </Surface>
  );
}

export function VoiceDesignTab() {
  return (
    <VoiceChatTab
      agent="voice-design-agent"
      idleHint="Start a call and describe the voice you want the agent to have."
      panel={({ lastCustomMessage, sendJSON }) => (
        <DesignPanel
          message={lastCustomMessage}
          onKeep={() => sendJSON({ type: "keep-voice" })}
        />
      )}
    />
  );
}
