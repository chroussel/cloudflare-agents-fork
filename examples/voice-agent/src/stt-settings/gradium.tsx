import type { SettingsUpdate, SttSettings } from "./types";

export function getGradiumQuery(settings: SttSettings): Record<string, string> {
  const query: Record<string, string> = { stt: "gradium" };

  if (settings.language) query.language = settings.language;
  query.vadHorizonSeconds = String(settings.gradiumVadHorizonSeconds);
  query.vadThreshold = String(settings.gradiumVadThreshold);
  query.minSpeechWords = String(settings.gradiumMinSpeechWords);

  return query;
}

export function GradiumSettings({
  settings,
  disabled,
  update
}: {
  settings: SttSettings;
  disabled: boolean;
  update: SettingsUpdate;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-xs text-kumo-secondary">
        Language
        <input
          value={settings.language}
          disabled={disabled}
          placeholder="auto"
          onChange={(event) => update({ language: event.target.value })}
          className="rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-kumo-secondary">
        VAD horizon (seconds)
        <input
          type="number"
          min={0.5}
          max={5}
          step={0.5}
          value={settings.gradiumVadHorizonSeconds}
          disabled={disabled}
          onChange={(event) =>
            update({ gradiumVadHorizonSeconds: Number(event.target.value) })
          }
          className="rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-kumo-secondary">
        VAD threshold
        <input
          type="number"
          min={0.1}
          max={0.95}
          step={0.05}
          value={settings.gradiumVadThreshold}
          disabled={disabled}
          onChange={(event) =>
            update({ gradiumVadThreshold: Number(event.target.value) })
          }
          className="rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-kumo-secondary">
        Min speech words before barge-in
        <input
          type="number"
          min={0}
          max={5}
          step={1}
          value={settings.gradiumMinSpeechWords}
          disabled={disabled}
          onChange={(event) =>
            update({ gradiumMinSpeechWords: Number(event.target.value) })
          }
          className="rounded-lg border border-kumo-line bg-kumo-base px-3 py-2 text-sm text-kumo-default"
        />
      </label>
    </div>
  );
}
