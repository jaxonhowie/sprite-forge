import React, { useRef, useCallback, useEffect, useState } from 'react';

interface UseVideoFrameOptions {
  videoSrc: string;
  onFrameCapture?: (dataUrl: string) => void;
}

interface UseVideoFrameReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isReady: boolean;
  currentTime: number;
  duration: number;
  seek: (timeMs: number) => void;
  captureFrame: () => string | null;
  stepForward: () => void;
  stepBackward: () => void;
}

export function useVideoFrame({
  onFrameCapture,
}: UseVideoFrameOptions): UseVideoFrameReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration * 1000);
      setIsReady(true);
    }
  }, []);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime * 1000);
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [handleLoadedMetadata, handleTimeUpdate]);

  const seek = useCallback((timeMs: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = timeMs / 1000;
      setCurrentTime(timeMs);
    }
  }, []);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || !video.videoWidth) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    
    if (onFrameCapture) {
      onFrameCapture(dataUrl);
    }

    return dataUrl;
  }, [onFrameCapture]);

  const stepForward = useCallback(() => {
    if (videoRef.current) {
      const step = 1000 / 30;
      const newTime = Math.min(currentTime + step, duration);
      videoRef.current.currentTime = newTime / 1000;
      setCurrentTime(newTime);
    }
  }, [currentTime, duration]);

  const stepBackward = useCallback(() => {
    if (videoRef.current) {
      const step = 1000 / 30;
      const newTime = Math.max(currentTime - step, 0);
      videoRef.current.currentTime = newTime / 1000;
      setCurrentTime(newTime);
    }
  }, [currentTime]);

  return {
    videoRef,
    canvasRef,
    isReady,
    currentTime,
    duration,
    seek,
    captureFrame,
    stepForward,
    stepBackward,
  };
}

export default useVideoFrame;
