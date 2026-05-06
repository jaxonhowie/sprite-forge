import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

interface Frame {
  ts_ms: number;
  thumb_dataurl: string;
}

export default function Frames() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frames, setFrames] = useState<Frame[]>([]);
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const videoUrl = videoId ? `/files/uploads/${videoId}/source.mp4` : '';

  const captureThumbnail = useCallback((timeMs: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        reject(new Error('视频元素不可用'));
        return;
      }

      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法获取 canvas 上下文'));
          return;
        }
        ctx.drawImage(video, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };

      video.addEventListener('seeked', onSeeked);
      video.currentTime = timeMs / 1000;
    });
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem(`frames_${videoId}`);
    if (!stored) {
      setError('未找到帧数据，请返回重新截取');
      setLoading(false);
      return;
    }

    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (typeof parsed[0] === 'number') {
          setTimestamps(parsed);
        } else {
          setTimestamps(parsed.map((f: Frame) => f.ts_ms));
        }
      } else {
        setError('帧数据为空');
        setLoading(false);
      }
    } catch {
      setError('帧数据解析失败');
      setLoading(false);
    }
  }, [videoId]);

  const generateThumbnails = useCallback(async () => {
    if (timestamps.length === 0) return;

    const video = videoRef.current;
    if (!video || !video.duration) return;

    const generated: Frame[] = [];
    for (const ts of timestamps) {
      try {
        const dataUrl = await captureThumbnail(ts);
        generated.push({ ts_ms: ts, thumb_dataurl: dataUrl });
      } catch {
        generated.push({ ts_ms: ts, thumb_dataurl: '' });
      }
    }
    setFrames(generated);
    setLoading(false);
  }, [timestamps, captureThumbnail]);

  useEffect(() => {
    if (timestamps.length > 0 && videoRef.current) {
      const video = videoRef.current;
      const onReady = () => {
        generateThumbnails();
      };
      if (video.readyState >= 1) {
        generateThumbnails();
      } else {
        video.addEventListener('loadedmetadata', onReady, { once: true });
      }
    }
  }, [timestamps, generateThumbnails]);

  const handleDelete = useCallback((index: number) => {
    setFrames(prev => prev.filter((_, i) => i !== index));
    setTimestamps(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleClear = useCallback(() => {
    setFrames([]);
    setTimestamps([]);
  }, []);

  const handleContinue = useCallback(() => {
    if (frames.length === 0) {
      setError('请至少保留一个关键帧');
      return;
    }

    sessionStorage.setItem(`frames_${videoId}`, JSON.stringify(timestamps));
    navigate(`/process/${videoId}`);
  }, [frames, timestamps, videoId, navigate]);

  const handleBack = useCallback(() => {
    navigate(`/capture/${videoId}`);
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
      <h2 className="text-3xl font-bold mb-8">关键帧列表</h2>

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
