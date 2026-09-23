import type { Transcriber } from "agents/voice";
import { GradiumSTT } from "@cloudflare/voice-gradium";
import { getEnvString, optionalNumber } from "./utils";

export function createGradiumTranscriber(env: Env, url: URL): Transcriber {
  const apiKey = getEnvString(env, "GRADIUM_API_KEY");
  if (!apiKey) throw new Error("GRADIUM_API_KEY is not configured.");

  return new GradiumSTT({
    apiKey,
    language: url.searchParams.get("language") ?? undefined,
    vadHorizonSeconds: optionalNumber(
      url.searchParams.get("vadHorizonSeconds")
    ),
    vadThreshold: optionalNumber(url.searchParams.get("vadThreshold")),
    minSpeechWords: optionalNumber(url.searchParams.get("minSpeechWords"))
  });
}
