import { useRef, useCallback, useEffect, useState } from 'react';

interface TimelineProps {
  currentTime: number;
  duration: number;
  onSeek: (timeMs: number) => void;
  markers?: number[];
}

export default function Timeline({ currentTime, duration, onSeek, markers = [] }: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const canSeek = duration > 0 && Number.isFinite(duration);

  const calcTimeFromClientX = useCallback((clientX: number) => {
    const track = trackRef.current;
    if (!track || !canSeek) return null;

    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return null;

    const x = clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    return percentage * duration;
  }, [canSeek, duration]);

  const handleStart = useCallback((clientX: number) => {
    const timeMs = calcTimeFromClientX(clientX);
    if (timeMs === null) return;
    setIsDragging(true);
    onSeek(timeMs);
  }, [calcTimeFromClientX, onSeek]);

  const handleMove = useCallback((clientX: number) => {
    if (!isDragging) return;
    const timeMs = calcTimeFromClientX(clientX);
    if (timeMs === null) return;
    onSeek(timeMs);
  }, [isDragging, calcTimeFromClientX, onSeek]);

  const handleEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    handleStart(e.clientX);
  }, [handleStart]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    handleStart(e.touches[0].clientX);
  }, [handleStart]);

  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX);
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      handleMove(e.touches[0].clientX);
    };
    const onMouseUp = () => handleEnd();
    const onTouchEnd = () => handleEnd();

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [isDragging, handleMove, handleEnd]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const normalizedMarkers = markers
    .filter((timeMs) => Number.isFinite(timeMs) && timeMs >= 0 && timeMs <= duration)
    .map((timeMs, index) => ({
      id: `${timeMs}-${index}`,
      left: duration > 0 ? (timeMs / duration) * 100 : 0,
      timeMs,
    }));

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative select-none py-4">
      <div className="mb-2 flex justify-between text-sm text-gray-400">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      <div
        ref={trackRef}
        className={`relative h-2 rounded-full touch-none ${
          canSeek ? 'cursor-pointer bg-gray-200' : 'cursor-not-allowed bg-gray-100'
        }`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div
          className="absolute h-full rounded-full bg-gray-900"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-1/2 h-4 w-4 rounded-full bg-gray-900 shadow-sm"
          style={{ left: `${progress}%`, transform: `translate(-50%, -50%)` }}
        />
        {normalizedMarkers.map((marker) => (
          <button
            key={marker.id}
            type="button"
            title={formatTime(marker.timeMs)}
            aria-label={`跳转到 ${formatTime(marker.timeMs)}`}
            onClick={(e) => {
              e.stopPropagation();
              onSeek(marker.timeMs);
            }}
            className="absolute top-1/2 h-3 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-yellow-400 shadow-sm"
            style={{ left: `${marker.left}%` }}
          />
        ))}
      </div>

      <div className="absolute bottom-0 left-0 right-0 flex justify-between px-1">
        {Array.from({ length: 11 }).map((_, i) => (
          <div
            key={i}
            className="h-1.5 w-0.5 rounded-full bg-gray-200"
          />
        ))}
      </div>
    </div>
  );
}
