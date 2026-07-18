const DEFAULT_DEBOUNCE_MS = 200;

export function createModeToggleGuard(
  debounceMs = DEFAULT_DEBOUNCE_MS,
  now: () => number = Date.now,
): () => boolean {
  let lastToggleAt = Number.NEGATIVE_INFINITY;

  return () => {
    const current = now();
    if (current - lastToggleAt < debounceMs) return false;
    lastToggleAt = current;
    return true;
  };
}
