import { useRef, useState, useCallback } from 'react';

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

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="relative inline-block cursor-crosshair"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={imageUrl}
          alt="选择水印区域"
          className="max-w-full h-auto select-none pointer-events-none"
          draggable={false}
        />
        
        {box && (
          <div
            className="absolute border-2 border-red-500 bg-red-500/30"
            style={{
              left: box.x,
              top: box.y,
              width: box.w,
              height: box.h,
            }}
          >
            <div className="absolute -top-6 left-0 text-xs text-red-400 bg-black/70 px-1">
              水印区域
            </div>
          </div>
        )}
      </div>

      {box && (
        <div className="mt-2 flex items-center gap-4">
          <span className="text-sm text-gray-400">
            区域: {Math.round(box.x)}, {Math.round(box.y)} - {Math.round(box.w)}×{Math.round(box.h)}
          </span>
          <button
            onClick={handleClear}
            className="text-sm text-red-400 hover:text-red-300"
          >
            清除选区
          </button>
        </div>
      )}
    </div>
  );
}
