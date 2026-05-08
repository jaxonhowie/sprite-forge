import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Timeline from '../components/Timeline';
import { deleteVideo, getVideoMeta } from '../api/client';
import useVideoFrame from '../hooks/useVideoFrame';
import { clearWorkflow, setFrameTimestamps } from '../utils/workflowState';

interface Frame {
  ts_ms: number;
  thumb_dataurl: string;
}

export default function Capture() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const [frames, setFrames] = useState<Frame[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [metadataDuration, setMetadataDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const {
    videoRef,
    canvasRef,
    isPlaying,
    currentTime,
    duration,
    seek,
    captureFrame,
    stepForward,
    stepBackward,
    togglePlay,
    pause,
  } = useVideoFrame({
    videoSrc: videoUrl ?? '',
    metadataDurationMs: metadataDuration,
  });

  useEffect(() => {
    if (videoId) {
      getVideoMeta(videoId)
        .then((meta) => {
          setVideoUrl(meta.url);
          setMetadataDuration(meta.duration_ms);
        })
        .catch(() => setError('视频元数据加载失败'));
    }
  }, [videoId]);

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
        void stepBackward();
        break;
      case 'ArrowRight':
        e.preventDefault();
        void stepForward();
        break;
      case ' ':
        e.preventDefault();
        handleMarkFrame();
        break;
    }
  }, [stepBackward, stepForward, handleMarkFrame]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleReupload = useCallback(async () => {
    pause();
    if (videoId) {
      clearWorkflow(videoId);
      try {
        await deleteVideo(videoId);
      } catch {
        // Local workflow cleanup should still complete if the upload was already gone.
      }
    }
    navigate('/');
  }, [pause, videoId, navigate]);

  const handleContinue = useCallback(() => {
    if (frames.length === 0) {
      setError('请至少标记一个关键帧');
      return;
    }

    if (!videoId) return;

    const timestamps = frames.map(f => f.ts_ms);
    setFrameTimestamps(videoId, timestamps);
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
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-3xl font-bold">截取关键帧</h2>
        <button
          onClick={handleReupload}
          className="self-start rounded bg-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-600 sm:self-auto"
        >
          重新上传视频
        </button>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <div className="bg-gray-800 rounded-lg overflow-hidden mb-4">
            {videoUrl && (
              <video
                ref={videoRef}
                src={videoUrl}
                className="w-full"
                preload="auto"
                onError={() => setError('视频加载失败')}
              />
            )}
          </div>

          <Timeline
            currentTime={currentTime}
            duration={duration}
            onSeek={(timeMs) => void seek(timeMs)}
          />

          <div className="flex justify-center gap-4 mt-4">
            <button
              onClick={() => void stepBackward()}
              className="px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
            >
              ← 前一帧
            </button>
            <button
              onClick={togglePlay}
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
              onClick={() => void stepForward()}
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
