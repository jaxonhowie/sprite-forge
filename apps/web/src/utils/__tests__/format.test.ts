import { describe, it, expect } from 'vitest';
import { formatTime, formatTimeShort } from '../format';

describe('formatTime', () => {
  it('formats milliseconds as MM:SS.mmm', () => {
    expect(formatTime(0)).toBe('00:00.000');
    expect(formatTime(1500)).toBe('00:01.500');
    expect(formatTime(65000)).toBe('01:05.000');
    expect(formatTime(3723500)).toBe('62:03.500');
  });

  it('does not clamp negative input (caller responsibility)', () => {
    // formatTime does not clamp; it formats the raw millisecond value.
    // Callers (Timeline) clamp before calling.
    expect(formatTime(-100)).toBe('-1:-1.-100');
  });
});

describe('formatTimeShort', () => {
  it('formats milliseconds as MM:SS without millis', () => {
    expect(formatTimeShort(0)).toBe('00:00');
    expect(formatTimeShort(1500)).toBe('00:01');
    expect(formatTimeShort(65000)).toBe('01:05');
  });
});
