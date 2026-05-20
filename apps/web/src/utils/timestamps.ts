export type CaptureMode = 'count' | 'step';

/**
 * Generate evenly-spaced frame timestamps over a duration.
 * - count mode: divide into N frames (max 120)
 * - step mode: every stepMs milliseconds (max 120 frames)
 */
export function generateFrameTimestamps(
  durationMs: number,
  mode: CaptureMode = 'count',
  frameCount: number = 12,
  stepMsInput: number = 1000,
  maxFrames: number = 120,
): number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];

  if (mode === 'count') {
    const count = Math.max(1, Math.min(maxFrames, Math.floor(frameCount)));
    if (count === 1) return [0];
    return Array.from({ length: count }, (_, index) => Math.round((durationMs * index) / (count - 1)));
  }

  const stepMs = Math.max(1, Math.floor(stepMsInput));
  const timestamps: number[] = [];
  for (let ts = 0; ts <= durationMs; ts += stepMs) {
    timestamps.push(Math.round(ts));
    if (timestamps.length >= maxFrames) break;
  }

  const last = timestamps[timestamps.length - 1] ?? 0;
  if (timestamps.length < maxFrames && durationMs - last > 100) {
    timestamps.push(Math.round(durationMs));
  }

  return timestamps;
}

/** Deduplicate, clamp to [0, durationMs], and sort timestamps */
export function uniqueSortedTimestamps(timestamps: number[], durationMs: number): number[] {
  const seen = new Set<number>();
  return timestamps
    .map((timestamp) => Math.max(0, Math.min(durationMs, Math.round(timestamp))))
    .filter((timestamp) => {
      if (seen.has(timestamp)) return false;
      seen.add(timestamp);
      return true;
    })
    .sort((a, b) => a - b);
}
