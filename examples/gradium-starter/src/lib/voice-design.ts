const API_URL = "https://api.gradium.ai/api";
const POLL_INTERVAL_MS = 1000;
const POLL_TIMEOUT_MS = 60_000;

export const VOICE_LANGUAGES = ["en", "fr", "es", "de", "pt"] as const;
export type VoiceLanguage = (typeof VOICE_LANGUAGES)[number];

export interface DesignedVoice {
  voiceId: string;
  description: string;
  language: VoiceLanguage;
}

async function gradium<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: { "x-api-key": apiKey, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`Gradium ${method} ${path} failed (${response.status})`);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

/**
 * Designs a voice from a text description using Gradium Voice Design.
 *
 * A generated candidate can be previewed over REST, but the streaming TTS
 * socket needs a library voice, so the candidate is saved to the account's
 * voice library before it is returned. Reusing a seed across revisions keeps
 * the speaker recognisable while its traits change.
 */
export async function designVoice(
  apiKey: string,
  {
    description,
    language,
    seed
  }: {
    description: string;
    language: VoiceLanguage;
    seed: number;
  }
): Promise<DesignedVoice> {
  const { embeddings } = await gradium<{
    embeddings: { embedding_id: string }[];
  }>(apiKey, "POST", "/voice-generator/generate", {
    prompt: description,
    language,
    n_samples: 1,
    json_config: { cfg_scale: 10, seed }
  });
  const embeddingId = embeddings[0].embedding_id;

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (true) {
    const status = await gradium<{ embeddings: { ready: boolean }[] }>(
      apiKey,
      "GET",
      `/voice-generator/embeddings?embedding_id=${embeddingId}`
    );
    if (status.embeddings[0]?.ready) break;
    if (Date.now() > deadline) throw new Error("Voice design timed out");
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const voice = await gradium<{ uid: string }>(
    apiKey,
    "POST",
    "/voices/from-embedding",
    {
      voxium_embedding_id: embeddingId,
      name: "Designed voice (draft)",
      description
    }
  );
  return { voiceId: voice.uid, description, language };
}

export function renameVoice(
  apiKey: string,
  voice: DesignedVoice,
  name: string
): Promise<void> {
  return gradium(apiKey, "PUT", `/voices/${voice.voiceId}`, {
    name,
    description: voice.description
  });
}

export function deleteVoice(apiKey: string, voiceId: string): Promise<void> {
  return gradium(apiKey, "DELETE", `/voices/${voiceId}`);
}
