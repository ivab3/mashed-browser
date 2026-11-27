/** Resolves after a complete production shell can serve the next navigation. */
export async function prepareOfflineLaunch(): Promise<void> {
  if (!window.isSecureContext || !("serviceWorker" in navigator)) {
    throw new Error("Open the game over HTTPS or localhost in a browser with service worker support.");
  }
  const registration = await navigator.serviceWorker.register("./sw.js");
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (!worker) throw new Error("Reload while online to prepare the game.");
  await new Promise<void>((resolve, reject) => {
    const check = (): void => {
      if (worker.state === "activated" || worker.state === "redundant") {
        worker.removeEventListener("statechange", check);
        if (worker.state === "activated") resolve();
        else reject(new Error("Check your connection and available storage, then reload."));
      }
    };
    worker.addEventListener("statechange", check);
    check();
  });
}
