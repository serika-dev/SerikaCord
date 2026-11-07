/**
 * The voice channel header's Pop Out button and the (lazily loaded) call
 * stage that does it, without the header importing the stage: the button
 * calls popOutCall() from its click (so the window request keeps the user's
 * gesture) and the mounted stage listens with onPopOutRequest.
 */
const requests = new EventTarget();

/** Whether the call can pop out into its own window (Document Picture-in-Picture). */
export function canPopOutCall(): boolean {
  if (typeof window === "undefined") return false;
  const pip = (window as unknown as { documentPictureInPicture?: { requestWindow?: unknown } }).documentPictureInPicture;
  return typeof pip?.requestWindow === "function";
}

export function popOutCall() {
  requests.dispatchEvent(new Event("popout"));
}

export function onPopOutRequest(listener: () => void): () => void {
  requests.addEventListener("popout", listener);
  return () => requests.removeEventListener("popout", listener);
}
