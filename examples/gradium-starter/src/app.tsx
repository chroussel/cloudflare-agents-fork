import { useCallback, useState } from "react";
import {
  Button,
  CloudflareLogo,
  PoweredByCloudflare,
  Surface,
  Tabs,
  Text
} from "@cloudflare/kumo";
import {
  ChatCircleDotsIcon,
  InfoIcon,
  MoonIcon,
  SunIcon,
  TranslateIcon,
  UserSoundIcon,
  WaveformIcon
} from "@phosphor-icons/react";
import { Toasty } from "@cloudflare/kumo/components/toast";
import { VoiceChatTab } from "./tabs/voice-chat";
import { TranslateTab } from "./tabs/translate";
import { VoiceDesignTab } from "./tabs/voice-design";

type TabId = "voice-chat" | "translate" | "voice-design";

const TAB_COPY: Record<TabId, { title: string; blurb: string }> = {
  "voice-chat": {
    title: "Voice Chat",
    blurb:
      "A continuous, interruptible voice agent. Microphone audio streams to Gradium STT, which uses semantic VAD to detect each turn; Gemma on Workers AI replies, and Gradium TTS speaks it. Talk over the assistant to interrupt it."
  },
  translate: {
    title: "Live Translation",
    blurb:
      "Speak in one language and hear another. Gradium's speech-to-speech socket transcribes, translates, and re-synthesizes in a single round trip — no LLM in the path."
  },
  "voice-design": {
    title: "Voice Design",
    blurb:
      "The agent starts with a default voice and asks what it should sound like. Describe a voice and a Workers AI tool call runs Gradium Voice Design, then the agent switches to the new voice mid-conversation. Ask for changes, then press Keep voice to save it to your Gradium library."
  }
};

function ModeToggle() {
  const [dark, setDark] = useState(
    () => document.documentElement.getAttribute("data-mode") === "dark"
  );

  const toggle = useCallback(() => {
    const next = !dark;
    const mode = next ? "dark" : "light";
    setDark(next);
    document.documentElement.setAttribute("data-mode", mode);
    document.documentElement.style.colorScheme = mode;
    localStorage.setItem("theme", mode);
  }, [dark]);

  return (
    <Button
      variant="secondary"
      shape="square"
      icon={dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
      onClick={toggle}
      aria-label="Toggle theme"
    />
  );
}

export default function App() {
  const [tab, setTab] = useState<TabId>("voice-chat");
  const copy = TAB_COPY[tab];

  return (
    <Toasty>
      <div className="flex h-screen flex-col bg-kumo-elevated">
        <header className="border-b border-kumo-line bg-kumo-base px-5 pt-4 pb-0">
          <div className="mx-auto max-w-4xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-kumo-contrast text-kumo-inverse">
                  <WaveformIcon size={18} weight="bold" />
                </div>
                <span className="text-base font-semibold text-kumo-default">
                  Gradium
                </span>
                <span className="mx-1 text-lg font-light text-kumo-inactive">
                  ×
                </span>
                <CloudflareLogo variant="glyph" color="color" className="h-4" />
                <span className="text-base font-semibold text-kumo-default">
                  Cloudflare
                </span>
              </div>
              <ModeToggle />
            </div>

            <Tabs
              variant="segmented"
              value={tab}
              onValueChange={(value) => setTab(value as TabId)}
              tabs={[
                {
                  value: "voice-chat",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <ChatCircleDotsIcon size={14} /> Voice Chat
                    </span>
                  )
                },
                {
                  value: "translate",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <TranslateIcon size={14} /> Translate
                    </span>
                  )
                },
                {
                  value: "voice-design",
                  label: (
                    <span className="flex items-center gap-1.5">
                      <UserSoundIcon size={14} /> Voice Design
                    </span>
                  )
                }
              ]}
            />
          </div>
        </header>

        <div className="bg-kumo-elevated px-5 pt-4">
          <div className="mx-auto max-w-4xl">
            <Surface className="rounded-xl p-4 ring ring-kumo-line">
              <div className="flex gap-3">
                <InfoIcon
                  size={20}
                  weight="bold"
                  className="mt-0.5 shrink-0 text-kumo-accent"
                />
                <div className="flex flex-col gap-1">
                  <Text size="sm" bold>
                    {copy.title}
                  </Text>
                  <Text size="xs" variant="secondary">
                    {copy.blurb}
                  </Text>
                </div>
              </div>
            </Surface>
          </div>
        </div>

        <main className="min-h-0 flex-1 overflow-hidden">
          {tab === "voice-chat" && <VoiceChatTab />}
          {tab === "translate" && <TranslateTab />}
          {tab === "voice-design" && <VoiceDesignTab />}
        </main>

        <footer className="flex justify-center border-t border-kumo-line bg-kumo-base py-2">
          <PoweredByCloudflare href="https://developers.cloudflare.com/agents/" />
        </footer>
      </div>
    </Toasty>
  );
}
