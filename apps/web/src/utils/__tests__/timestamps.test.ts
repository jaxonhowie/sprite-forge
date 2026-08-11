import { describe, it, expect } from 'vitest';
import {
  generateFrameTimestamps,
  uniqueSortedTimestamps,
} from '../timestamps';

describe('generateFrameTimestamps', () => {
  describe('count mode', () => {
    it('generates evenly spaced timestamps', () => {
      const ts = generateFrameTimestamps(10000, 'count', 5);
      expect(ts).toEqual([0, 2500, 5000, 7500, 10000]);
    });

    it('returns [0] for a single frame', () => {
      expect(generateFrameTimestamps(10000, 'count', 1)).toEqual([0]);
    });

    it('caps frame count at maxFrames', () => {
      const ts = generateFrameTimestamps(100000, 'count', 500, 1000, 120);
      expect(ts.length).toBe(120);
    });

    it('returns empty for non-positive duration', () => {
      expect(generateFrameTimestamps(0, 'count', 5)).toEqual([]);
      expect(generateFrameTimestamps(-100, 'count', 5)).toEqual([]);
      expect(generateFrameTimestamps(NaN, 'count', 5)).toEqual([]);
    });
  });

  describe('step mode', () => {
    it('generates timestamps at fixed intervals', () => {
      const ts = generateFrameTimestamps(5000, 'step', 12, 1000);
      expect(ts).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
    });

    it('caps at maxFrames', () => {
      const ts = generateFrameTimestamps(100000, 'step', 12, 100, 10);
      expect(ts.length).toBeLessThanOrEqual(11); // may include the final duration
    });

    it('appends final duration when gap from last step > 100ms', () => {
      // step=500, duration=1800: steps at 0,500,1000,1500; 1800-1500=300>100 → append
      const ts = generateFrameTimestamps(1800, 'step', 12, 500);
      expect(ts).toContain(1800);
    });

    it('does not append final duration when gap <= 100ms', () => {
      // step=500, duration=1050: steps at 0,500,1000; 1050-1000=50<100 → no append
      const ts = generateFrameTimestamps(1050, 'step', 12, 500);
      expect(ts).toEqual([0, 500, 1000]);
    });
  });
});

describe('uniqueSortedTimestamps', () => {
  it('deduplicates and sorts', () => {
    expect(uniqueSortedTimestamps([3000, 1000, 2000, 1000], 10000)).toEqual([1000, 2000, 3000]);
  });

  it('clamps to [0, durationMs]', () => {
    expect(uniqueSortedTimestamps([-100, 5000, 20000], 10000)).toEqual([0, 5000, 10000]);
  });

  it('rounds to integers', () => {
    expect(uniqueSortedTimestamps([100.4, 200.6], 10000)).toEqual([100, 201]);
  });

  it('handles empty input', () => {
    expect(uniqueSortedTimestamps([], 10000)).toEqual([]);
  });
});
