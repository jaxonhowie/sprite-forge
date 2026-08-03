import { useRef, useState, useCallback, useEffect } from 'react';
import Button from './ui/Button';
import Icon from './ui/Icon';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BoxSelectorProps {
  imageUrl: string;
  onBoxChange: (box: Box | null) => void;
}

export default function BoxSelector({ imageUrl, onBoxChange }: BoxSelectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  // Touch drawing state lives in refs so the native listeners always see fresh values
  // without interfering with the mouse path (which uses startPoint state).
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const touchBoxRef = useRef<Box | null>(null);

  const getRelativePosition = useCallback((clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    return {
      x: Math.max(0, Math.min(x, rect.width)),
      y: Math.max(0, Math.min(y, rect.height)),
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pos = getRelativePosition(e.clientX, e.clientY);
    if (!pos) return;

    setStartPoint(pos);
    setIsDrawing(true);
    setBox(null);
    onBoxChange(null);
  }, [getRelativePosition, onBoxChange]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || !startPoint) return;

    const pos = getRelativePosition(e.clientX, e.clientY);
    if (!pos) return;

    const newBox: Box = {
      x: Math.min(startPoint.x, pos.x),
      y: Math.min(startPoint.y, pos.y),
      w: Math.abs(pos.x - startPoint.x),
      h: Math.abs(pos.y - startPoint.y),
    };

    setBox(newBox);
  }, [isDrawing, startPoint, getRelativePosition]);

  const handleMouseUp = useCallback(() => {
    if (isDrawing && box) {
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const normalizedBox: Box = {
          x: box.x / rect.width,
          y: box.y / rect.height,
          w: box.w / rect.width,
          h: box.h / rect.height,
        };
        onBoxChange(normalizedBox);
      }
    }
    setIsDrawing(false);
    setStartPoint(null);
  }, [isDrawing, box, onBoxChange]);

  const handleClear = useCallback(() => {
    setBox(null);
    onBoxChange(null);
  }, [onBoxChange]);

  // Touch start must be a native passive:false listener: preventDefault here blocks
  // page scrolling and the synthesized mouse events that would otherwise clear the box.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      const pos = {
        x: Math.max(0, Math.min(touch.clientX - rect.left, rect.width)),
        y: Math.max(0, Math.min(touch.clientY - rect.top, rect.height)),
      };

      touchStartRef.current = pos;
      touchBoxRef.current = null;
      setIsDrawing(true);
      setBox(null);
      onBoxChange(null);
    };

    container.addEventListener('touchstart', onTouchStart, { passive: false });
    return () => container.removeEventListener('touchstart', onTouchStart);
  }, [onBoxChange]);

  // While a touch draw is active, track the finger on window (same pattern as Timeline).
  useEffect(() => {
    if (!isDrawing || !touchStartRef.current) return;

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const touch = e.touches[0];
      const start = touchStartRef.current;
      const container = containerRef.current;
      if (!touch || !start || !container) return;

      const rect = container.getBoundingClientRect();
      const pos = {
        x: Math.max(0, Math.min(touch.clientX - rect.left, rect.width)),
        y: Math.max(0, Math.min(touch.clientY - rect.top, rect.height)),
      };

      const newBox: Box = {
        x: Math.min(start.x, pos.x),
        y: Math.min(start.y, pos.y),
        w: Math.abs(pos.x - start.x),
        h: Math.abs(pos.y - start.y),
      };

      touchBoxRef.current = newBox;
      setBox(newBox);
    };

    const onTouchEnd = () => {
      const drawnBox = touchBoxRef.current;
      const container = containerRef.current;
      if (drawnBox && container) {
        const rect = container.getBoundingClientRect();
        onBoxChange({
          x: drawnBox.x / rect.width,
          y: drawnBox.y / rect.height,
          w: drawnBox.w / rect.width,
          h: drawnBox.h / rect.height,
        });
      }
      touchStartRef.current = null;
      touchBoxRef.current = null;
      setIsDrawing(false);
    };

    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);

    return () => {
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [isDrawing, onBoxChange]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="relative inline-block cursor-crosshair touch-none overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={imageUrl}
          alt="选择水印区域"
          className="pointer-events-none h-auto max-w-full select-none"
          draggable={false}
        />

        {box && (
          <div
            className="absolute border-2 border-brand-500 bg-brand-500/10 dark:border-brand-400 dark:bg-brand-400/10"
            style={{
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
            }}
          >
            <div className="absolute -top-6 left-0 rounded bg-white px-1.5 py-0.5 text-xs text-brand-600 shadow-sm dark:bg-gray-800 dark:text-brand-400">
              水印区域
            </div>
          </div>
        )}
      </div>

      {box && (
        <div className="mt-2 flex items-center gap-4">
          <span className="text-xs text-gray-400 dark:text-gray-500">
            区域: {Math.round(box.x)}, {Math.round(box.y)} - {Math.round(box.w)}&times;{Math.round(box.h)}
          </span>
          <Button variant="dangerSoft" size="sm" onClick={handleClear}>
            <Icon name="x" size={14} />
            清除选区
          </Button>
        </div>
      )}
    </div>
  );
}
