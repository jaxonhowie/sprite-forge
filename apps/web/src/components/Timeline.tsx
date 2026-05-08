import { useRef, useCallback, useEffect, useState } from 'react';

interface TimelineProps {
  currentTime: number;
  duration: number;
  onSeek: (timeMs: number) => void;
}

export default function Timeline({ currentTime, duration, onSeek }: TimelineProps) {
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

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="relative py-4 select-none">
      <div className="flex justify-between text-sm text-gray-400 mb-2">
        <span>{formatTime(currentTime)}</span>
        <span>{formatTime(duration)}</span>
      </div>
      
      <div
        ref={trackRef}
        className={`relative h-3 rounded-full touch-none ${
          canSeek ? 'cursor-pointer bg-gray-700' : 'cursor-not-allowed bg-gray-800'
        }`}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      >
        <div
          className="absolute h-full bg-blue-500 rounded-full pointer-events-none"
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-1/2 w-4 h-4 bg-white rounded-full shadow-lg pointer-events-none"
          style={{ left: `${progress}%`, transform: `translate(-50%, -50%)` }}
        />
      </div>

      <div className="absolute left-0 right-0 bottom-0 flex justify-between px-1">
        {Array.from({ length: 11 }).map((_, i) => (
          <div
            key={i}
            className="w-0.5 h-2 bg-gray-600"
          />
        ))}
      </div>
    </div>
  );
}
