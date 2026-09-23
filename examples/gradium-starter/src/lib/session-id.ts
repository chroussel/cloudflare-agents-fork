/** A per-browser ID, so each visitor gets their own agent instances. */
export function getSessionId(): string {
  const key = "gradium-voice-session-id";
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}
