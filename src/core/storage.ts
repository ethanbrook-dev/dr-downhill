const BEST_KEY = 'dr-downhill.best';

export function loadBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

export function saveBest(score: number): void {
  try {
    localStorage.setItem(BEST_KEY, String(Math.floor(score)));
  } catch {
    // Storage unavailable (private mode); best score just won't persist.
  }
}
