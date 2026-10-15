export type MothKeyStatus = "empty" | "unverified" | "checking" | "accepted" | "rejected" | "unavailable";

export interface MothKeyState {
  readonly value: string;
  readonly status: MothKeyStatus;
  readonly message?: string;
}

const EMPTY_STATE: MothKeyState = Object.freeze({ value: "", status: "empty" });
let state: MothKeyState = EMPTY_STATE;
let requestGeneration = 0;
let activeRequest: AbortController | undefined;
const listeners = new Set<() => void>();

function publish(next: MothKeyState) {
  state = Object.freeze(next);
  for (const listener of listeners) listener();
}

function invalidateCheck() {
  requestGeneration++;
  activeRequest?.abort();
  activeRequest = undefined;
}

export function getMothKeyState(): MothKeyState {
  return state;
}

export function subscribeMothKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Stable empty snapshot for server rendering; user keys never cross the server-component boundary. */
export function getServerMothKeyState(): MothKeyState {
  return EMPTY_STATE;
}

export function setMothKey(value: string): void {
  invalidateCheck();
  const trimmed = value.trim();
  publish(trimmed ? { value, status: "unverified" } : EMPTY_STATE);
}

export function clearMothKey(): void {
  setMothKey("");
}

export async function checkMothKey(): Promise<void> {
  const value = state.value.trim();
  invalidateCheck();
  const generation = requestGeneration;
  if (!value) {
    publish(EMPTY_STATE);
    return;
  }

  const controller = new AbortController();
  activeRequest = controller;
  const timeout = window.setTimeout(() => controller.abort(), 15_000);
  publish({ value: state.value, status: "checking" });

  try {
    const response = await fetch("/api/moth/key/check", {
      method: "POST",
      headers: { Authorization: `Bearer ${value}` },
      cache: "no-store",
      signal: controller.signal,
    });

    if (generation !== requestGeneration) return;
    if (response.status === 400 || response.status === 401 || response.status === 403) {
      publish({ value: state.value, status: "rejected", message: "Key rejected. Check it and try again." });
      return;
    }
    if (!response.ok) {
      publish({ value: state.value, status: "unavailable", message: "Couldn’t check the key. Try again." });
      return;
    }

    try {
      const result: unknown = await response.json();
      if (generation !== requestGeneration) return;
      if (typeof result === "object" && result !== null && "accepted" in result && result.accepted === true) {
        publish({ value: state.value, status: "accepted" });
      } else {
        publish({ value: state.value, status: "unavailable", message: "Couldn’t confirm the key. Try again." });
      }
    } catch {
      if (generation === requestGeneration) {
        publish({ value: state.value, status: "unavailable", message: "Couldn’t confirm the key. Try again." });
      }
    }
  } catch {
    if (generation === requestGeneration) {
      publish({
        value: state.value,
        status: "unavailable",
        message: controller.signal.aborted ? "Key check timed out. Try again." : "Couldn’t reach the key check. Try again.",
      });
    }
  } finally {
    window.clearTimeout(timeout);
    if (activeRequest === controller) activeRequest = undefined;
  }
}

/** Return the checked session key for a run, or defer to the server-configured key when the field is empty. */
export function getRunApiKey(): string | undefined {
  const value = state.value.trim();
  if (!value) return undefined;
  if (state.status !== "accepted") {
    throw new Error("Check your Moth API key in Parameters before starting Create or Evolve.");
  }
  return value;
}
