import { routeAgentRequest } from "agents";

export { VoiceChatAgent } from "./agents/voice-chat";
export { TranslateAgent } from "./agents/translate";
export { VoiceDesignAgent } from "./agents/voice-design";

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
