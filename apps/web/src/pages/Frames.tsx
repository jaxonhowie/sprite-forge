import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { deleteVideo, getVideoMeta } from '../api/client';
import useVideoFrame from '../hooks/useVideoFrame';
import { clearWorkflow, getFrameTimestamps, setFrameTimestamps } from '../utils/workflowState';

interface Frame {
  ts_ms: number;
  thumb_dataurl: string;
}

export default function Frames() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const [frames, setFrames] = useState<Frame[]>([]);
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [metadataDuration, setMetadataDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { videoRef, canvasRef, isReady, captureFrameAt } = useVideoFrame({
    videoSrc: videoUrl,
    metadataDurationMs: metadataDuration,
  });

  useEffect(() => {
    if (!videoId) return;

    const stored = getFrameTimestamps(videoId);
    if (!stored) {
      setError('未找到帧数据，请返回重新截取');
      setLoading(false);
      return;
    }

    setTimestamps(stored);
    getVideoMeta(videoId)
      .then((meta) => {
        setVideoUrl(meta.url);
        setMetadataDuration(meta.duration_ms);
      })
      .catch(() => {
        setError('视频元数据加载失败');
        setLoading(false);
      });
  }, [videoId]);

  const generateThumbnails = useCallback(async () => {
    if (timestamps.length === 0) return;

    const generated: Frame[] = [];
    for (const ts of timestamps) {
      try {
        const dataUrl = await captureFrameAt(ts);
        generated.push({ ts_ms: ts, thumb_dataurl: dataUrl ?? '' });
      } catch {
        generated.push({ ts_ms: ts, thumb_dataurl: '' });
      }
    }
    setFrames(generated);
    setLoading(false);
  }, [timestamps, captureFrameAt]);

  useEffect(() => {
    if (timestamps.length > 0 && isReady) {
      void generateThumbnails();
    }
  }, [timestamps, isReady, generateThumbnails]);

  const handleDelete = useCallback((index: number) => {
    setFrames(prev => prev.filter((_, i) => i !== index));
    setTimestamps(prev => {
      const next = prev.filter((_, i) => i !== index);
      if (videoId) setFrameTimestamps(videoId, next);
      return next;
    });
  }, [videoId]);

  const handleClear = useCallback(() => {
    setFrames([]);
    setTimestamps([]);
    if (videoId) setFrameTimestamps(videoId, []);
  }, [videoId]);

  const handleContinue = useCallback(() => {
    if (frames.length === 0) {
      setError('请至少保留一个关键帧');
      return;
    }

    if (!videoId) return;

    setFrameTimestamps(videoId, timestamps);
    navigate(`/process/${videoId}`);
  }, [frames, timestamps, videoId, navigate]);

  const handleBack = useCallback(() => {
    navigate(`/capture/${videoId}`);
  }, [videoId, navigate]);

  const handleReupload = useCallback(async () => {
    if (videoId) {
      clearWorkflow(videoId);
      try {
        await deleteVideo(videoId);
      } catch {
        // The server upload may already be gone; navigating home still resets the UI.
      }
    }
    navigate('/');
  }, [videoId, navigate]);

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
        <h2 className="text-3xl font-bold">关键帧列表</h2>
        <button
          onClick={handleReupload}
          className="self-start rounded bg-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-600 sm:self-auto"
        >
          重新上传视频
        </button>
      </div>

      <video
        ref={videoRef}
        src={videoUrl}
        preload="auto"
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />

      {error && (
        <div className="mb-6 p-4 bg-red-500/20 border border-red-500 rounded text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-6xl mb-4 animate-pulse">⏳</div>
          <div className="text-xl">正在生成缩略图...</div>
        </div>
      ) : frames.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-6xl mb-4">📷</div>
          <div className="text-xl">暂无关键帧</div>
          <button
            onClick={handleBack}
            className="mt-4 px-6 py-2 bg-blue-600 rounded hover:bg-blue-500"
          >
            返回截取
          </button>
          <button
            onClick={handleReupload}
            className="ml-4 mt-4 px-6 py-2 bg-gray-700 rounded hover:bg-gray-600"
          >
            重新上传视频
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {frames.map((frame, index) => (
              <div
                key={frame.ts_ms}
                className="relative group bg-gray-800 rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all"
              >
                {frame.thumb_dataurl ? (
                  <img
                    src={frame.thumb_dataurl}
                    alt={`帧 ${index + 1}`}
                    className="w-full aspect-video object-cover"
                  />
                ) : (
                  <div className="w-full aspect-video bg-gray-700 flex items-center justify-center text-gray-400 text-sm">
                    预览失败
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 bg-black/80 p-2">
                  <div className="text-xs text-gray-300 text-center">
                    {formatTime(frame.ts_ms)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(index);
                  }}
                  className="absolute top-2 right-2 bg-red-500 rounded-full w-6 h-6 text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className="flex justify-between mt-8">
            <button
              onClick={handleBack}
              className="px-6 py-3 bg-gray-700 rounded hover:bg-gray-600"
            >
              ← 返回截取
            </button>
            
            <div className="flex gap-4">
              <button
                onClick={handleClear}
                className="px-6 py-3 bg-red-600 rounded hover:bg-red-500"
              >
                清空所有
              </button>
              <button
                onClick={handleContinue}
                className="px-8 py-3 bg-green-600 rounded hover:bg-green-500 font-bold"
              >
                继续处理 →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
