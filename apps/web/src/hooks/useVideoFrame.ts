import React, { useRef, useCallback, useEffect, useState } from 'react';

interface UseVideoFrameOptions {
  videoSrc: string;
  metadataDurationMs?: number;
  onFrameCapture?: (dataUrl: string) => void;
}

interface UseVideoFrameReturn {
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isReady: boolean;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  seek: (timeMs: number) => Promise<number>;
  captureFrame: () => string | null;
  captureFrameAt: (timeMs: number) => Promise<string | null>;
  stepForward: () => Promise<number>;
  stepBackward: () => Promise<number>;
  togglePlay: () => void;
  pause: () => void;
}

export function useVideoFrame({
  videoSrc,
  metadataDurationMs = 0,
  onFrameCapture,
}: UseVideoFrameOptions): UseVideoFrameReturn {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isReady, setIsReady] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(metadataDurationMs);
  const currentTimeRef = useRef(0);

  useEffect(() => {
    setIsReady(false);
    setIsPlaying(false);
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setDuration(metadataDurationMs);
  }, [videoSrc, metadataDurationMs]);

  useEffect(() => {
    if (metadataDurationMs > 0) {
      setDuration((prev) => (prev > 0 ? prev : metadataDurationMs));
    }
  }, [metadataDurationMs]);

  const syncDuration = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (Number.isFinite(video.duration) && video.duration > 0) {
      setDuration(video.duration * 1000);
    } else if (metadataDurationMs > 0) {
      setDuration(metadataDurationMs);
    }
  }, [metadataDurationMs]);

  const handleLoadedMetadata = useCallback(() => {
    syncDuration();
    setIsReady(true);
  }, [syncDuration]);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      const actualMs = videoRef.current.currentTime * 1000;
      currentTimeRef.current = actualMs;
      setCurrentTime(actualMs);
    }
  }, []);

  const handlePlay = useCallback(() => {
    setIsPlaying(true);
  }, []);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('durationchange', syncDuration);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('seeked', handleTimeUpdate);
    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);

    if (video.readyState >= 1) {
      handleLoadedMetadata();
    }

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('durationchange', syncDuration);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('seeked', handleTimeUpdate);
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
    };
  }, [handleLoadedMetadata, handlePause, handlePlay, handleTimeUpdate, syncDuration]);

  const getDurationMs = useCallback(() => {
    const video = videoRef.current;
    if (video && Number.isFinite(video.duration) && video.duration > 0) {
      return video.duration * 1000;
    }
    return duration;
  }, [duration]);

  const waitForPaint = useCallback(() => {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => resolve());
      });
    });
  }, []);

  const seek = useCallback((timeMs: number): Promise<number> => {
    const video = videoRef.current;
    if (!video || video.readyState < 1) {
      return Promise.resolve(currentTimeRef.current);
    }

    const dur = getDurationMs();
    const clamped = dur > 0 ? Math.max(0, Math.min(timeMs, dur)) : Math.max(0, timeMs);
    const targetSec = clamped / 1000;

    return new Promise((resolve) => {
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        const actualMs = video.currentTime * 1000;
        currentTimeRef.current = actualMs;
        setCurrentTime(actualMs);
        resolve(actualMs);
      };

      const onSeeked = () => {
        void waitForPaint().then(finish);
      };

      if (Math.abs(video.currentTime - targetSec) < 0.001) {
        void waitForPaint().then(finish);
      } else {
        video.addEventListener('seeked', onSeeked, { once: true });
        video.currentTime = targetSec;
      }
    });
  }, [getDurationMs, waitForPaint]);

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

  const captureFrameAt = useCallback(async (timeMs: number): Promise<string | null> => {
    await seek(timeMs);
    return captureFrame();
  }, [captureFrame, seek]);

  const stepForward = useCallback(() => {
    const step = 1000 / 30;
    const dur = getDurationMs();
    return seek(Math.min(currentTime + step, dur || currentTime + step));
  }, [currentTime, getDurationMs, seek]);

  const stepBackward = useCallback(() => {
    const step = 1000 / 30;
    return seek(Math.max(currentTime - step, 0));
  }, [currentTime, seek]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  return {
    videoRef,
    canvasRef,
    isReady,
    isPlaying,
    currentTime,
    duration,
    seek,
    captureFrame,
    captureFrameAt,
    stepForward,
    stepBackward,
    togglePlay,
    pause,
  };
}

export default useVideoFrame;
