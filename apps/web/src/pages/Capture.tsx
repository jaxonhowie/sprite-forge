import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Timeline from '../components/Timeline';

interface Frame {
  ts_ms: number;
  thumb_dataurl: string;
}

export default function Capture() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    if (videoId) {
      setVideoUrl(`/files/uploads/${videoId}/source.mp4`);
    }
  }, [videoId]);

  const captureFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (!video || !canvas || !video.videoWidth) return null;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL('image/png');
  }, []);

  const getVideoDurationMs = useCallback(() => {
    const v = videoRef.current;
    if (v && v.duration && isFinite(v.duration)) {
      return v.duration * 1000;
    }
    return duration;
  }, [duration]);

  const handleTimeUpdate = useCallback(() => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime * 1000);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration * 1000);
    }
  }, []);

  const handleDurationChange = useCallback(() => {
    if (videoRef.current && videoRef.current.duration && isFinite(videoRef.current.duration)) {
      setDuration(videoRef.current.duration * 1000);
    }
  }, []);

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);

  const handleSeek = useCallback((timeMs: number) => {
    const video = videoRef.current;
    if (!video) return;
    const dur = getVideoDurationMs();
    if (dur <= 0) return;
    const clamped = Math.max(0, Math.min(timeMs, dur));
    video.currentTime = clamped / 1000;
    setCurrentTime(clamped);
  }, [getVideoDurationMs]);

  const handleStepForward = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const dur = getVideoDurationMs();
    if (dur <= 0) return;
    const step = 1000 / 30;
    const newTime = Math.min(currentTime + step, dur);
    video.currentTime = newTime / 1000;
    setCurrentTime(newTime);
  }, [currentTime, getVideoDurationMs]);

  const handleStepBackward = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const step = 1000 / 30;
    const newTime = Math.max(currentTime - step, 0);
    video.currentTime = newTime / 1000;
    setCurrentTime(newTime);
  }, [currentTime]);

  const handlePlayPause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setIsPlaying(true);
    } else {
      video.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleMarkFrame = useCallback(() => {
    const dataUrl = captureFrame();
    if (dataUrl) {
      setFrames(prev => [...prev, { ts_ms: currentTime, thumb_dataurl: dataUrl }]);
    }
  }, [currentTime, captureFrame]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        handleStepBackward();
        break;
      case 'ArrowRight':
        e.preventDefault();
        handleStepForward();
        break;
      case ' ':
        e.preventDefault();
        handleMarkFrame();
        break;
    }
  }, [handleStepBackward, handleStepForward, handleMarkFrame]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleContinue = useCallback(() => {
    if (frames.length === 0) {
      setError('请至少标记一个关键帧');
      return;
    }

    const timestamps = frames.map(f => f.ts_ms);
    sessionStorage.setItem(`frames_${videoId}`, JSON.stringify(timestamps));
    navigate(`/frames/${videoId}`);
  }, [frames, videoId, navigate]);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const millis = Math.floor(ms % 1000);
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
  };

  return (
    <div className="max-w-6xl mx-auto">
      <h2 className="text-3xl font-bold mb-8">截取关键帧</h2>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="bg-gray-800 rounded-lg overflow-hidden mb-4">
            {videoUrl && (
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full"
                preload="auto"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onDurationChange={handleDurationChange}
                onPlay={handlePlay}
                onPause={handlePause}
                onError={() => setError('视频加载失败')}
              />
            )}
          </div>

          <Timeline
            currentTime={currentTime}
            duration={getVideoDurationMs()}
            onSeek={handleSeek}
          />

          <div className="flex justify-center gap-4 mt-4">
            <button
              onClick={handleStepBackward}
              className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
            >
              ← 前一帧
            </button>
            <button
              onClick={handlePlayPause}
              className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
            >
              {isPlaying ? '⏸ 暂停' : '▶ 播放'}
            </button>
            <button
              onClick={handleMarkFrame}
              className="px-6 py-2 bg-blue-600 rounded hover:bg-blue-500 font-bold"
            >
              标记帧 (Space)
            </button>
            <button
              onClick={handleStepForward}
              className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
            >
              后一帧 →
            </button>
          </div>

          <div className="text-center mt-2 text-gray-400">
            当前时间: {formatTime(currentTime)}
          </div>
        </div>

        <div>
          <div className="bg-gray-800 rounded-lg p-4">
            <h3 className="text-xl font-bold mb-4">
              已标记帧 ({frames.length})
            </h3>
            
            <div className="grid grid-cols-2 gap-2 max-h-[60vh] overflow-y-auto">
              {frames.map((frame, index) => (
                <div key={index} className="relative group">
                  <img
                    src={frame.thumb_dataurl}
                    alt={`帧 ${index + 1}`}
                    className="w-full rounded"
                  />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-xs p-1 text-center">
                    {formatTime(frame.ts_ms)}
                  </div>
                  <button
                    onClick={() => setFrames(prev => prev.filter((_, i) => i !== index))}
                    className="absolute top-1 right-1 bg-red-500 rounded-full w-5 h-5 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {frames.length > 0 && (
              <button
                onClick={() => setFrames([])}
                className="w-full mt-4 py-2 bg-red-600 rounded hover:bg-red-500"
              >
                清空所有帧
              </button>
            )}

            <button
              onClick={handleContinue}
              className="w-full mt-4 py-2 bg-green-600 rounded hover:bg-green-500 font-bold"
            >
              继续处理 →
            </button>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {error && (
        <div className="mt-4 p-4 bg-red-500/20 border border-red-500 rounded text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
