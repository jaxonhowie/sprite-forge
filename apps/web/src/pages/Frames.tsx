import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import { deleteVideo, getVideoMeta } from '../api/client';
import useVideoFrame from '../hooks/useVideoFrame';
import {
  clearWorkflow,
  createWorkflowRouteState,
  getFrameTimestamps,
  getWorkflowState,
  mergeWorkflowState,
  setFrameTimestamps,
  type WorkflowRouteState,
} from '../utils/workflowState';

interface Frame {
  ts_ms: number;
  thumb_dataurl: string;
}

export default function Frames() {
  const { videoId } = useParams<{ videoId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [frames, setFrames] = useState<Frame[]>([]);
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [videoUrl, setVideoUrl] = useState('');
  const [metadataDuration, setMetadataDuration] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workflowState] = useState(() => getWorkflowState());
  const dragIndexRef = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const locationState = location.state as WorkflowRouteState | null;
  const seededMeta = locationState?.videoMeta ?? workflowState?.videoMeta;

  const { videoRef, canvasRef, isReady, captureFrameAt } = useVideoFrame({
    videoSrc: videoUrl,
    metadataDurationMs: metadataDuration,
  });

  useEffect(() => {
    let active = true;
    const resolvedVideoId = videoId ?? seededMeta?.video_id;

    if (!resolvedVideoId) {
      setError('缺少视频信息，请重新上传');
      setLoading(false);
      return () => {
        active = false;
      };
    }

    const stored =
      (workflowState?.videoMeta?.video_id === resolvedVideoId ? workflowState.frameTimestamps : null) ??
      getFrameTimestamps(resolvedVideoId);

    if (stored && stored.length > 0) {
      setTimestamps(stored);
    } else {
      setError('未找到帧数据，请返回重新截取');
      setLoading(false);
    }

    if (seededMeta?.video_id === resolvedVideoId) {
      setVideoUrl(seededMeta.url);
      setMetadataDuration(seededMeta.duration_ms);
      mergeWorkflowState({
        currentStep: 'frames',
        videoMeta: seededMeta,
        frameTimestamps: stored ?? [],
      });
      return () => {
        active = false;
      };
    }

    getVideoMeta(resolvedVideoId)
      .then((meta) => {
        if (!active) return;
        setVideoUrl(meta.url);
        setMetadataDuration(meta.duration_ms);
        mergeWorkflowState({
          currentStep: 'frames',
          videoMeta: meta,
          frameTimestamps: stored ?? [],
        });
        if (!stored || stored.length === 0) {
          setError('未找到帧数据，请返回重新截取');
        }
      })
      .catch(() => {
        if (active) {
          setError('视频元数据加载失败');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [seededMeta, videoId]);

  const generateThumbnails = useCallback(async () => {
    if (timestamps.length === 0) return;

    const savedThumbs = workflowState?.frameThumbs ?? {};
    const generated: Frame[] = [];

    for (const ts of timestamps) {
      const key = String(ts);
      if (savedThumbs[key]) {
        generated.push({ ts_ms: ts, thumb_dataurl: savedThumbs[key] });
        continue;
      }
      try {
        const dataUrl = await captureFrameAt(ts);
        generated.push({ ts_ms: ts, thumb_dataurl: dataUrl ?? '' });
      } catch {
        generated.push({ ts_ms: ts, thumb_dataurl: '' });
      }
    }
    setFrames(generated);
    setLoading(false);
  }, [timestamps, captureFrameAt, workflowState?.frameThumbs]);

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
    const resolvedVideoId = videoId ?? seededMeta?.video_id;
    if (resolvedVideoId) {
      setFrameTimestamps(resolvedVideoId, []);
      mergeWorkflowState({
        frameTimestamps: [],
        currentStep: 'frames',
      });
    }
  }, [seededMeta?.video_id, videoId]);

  const handleDragStart = useCallback((index: number) => {
    dragIndexRef.current = index;
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  }, []);

  const handleDrop = useCallback((dropIndex: number) => {
    const fromIndex = dragIndexRef.current;
    dragIndexRef.current = null;
    setDragOverIndex(null);
    if (fromIndex === null || fromIndex === dropIndex) return;

    setFrames(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(dropIndex, 0, moved);
      return next;
    });
    setTimestamps(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(dropIndex, 0, moved);
      const resolvedVideoId = videoId ?? seededMeta?.video_id;
      if (resolvedVideoId) setFrameTimestamps(resolvedVideoId, next);
      return next;
    });
  }, [videoId, seededMeta?.video_id]);

  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }, []);

  const handleContinue = useCallback(() => {
    if (frames.length === 0) {
      setError('请至少保留一个关键帧');
      return;
    }

    const resolvedVideoId = videoId ?? seededMeta?.video_id;
    if (!resolvedVideoId) return;

    setFrameTimestamps(resolvedVideoId, timestamps);
    mergeWorkflowState({
      currentStep: 'settings',
      frameTimestamps: timestamps,
    });
    navigate(`/process/${resolvedVideoId}`, {
      state: createWorkflowRouteState({
        videoMeta: seededMeta,
        frameTimestamps: timestamps,
      }),
    });
  }, [frames, seededMeta, timestamps, videoId, navigate]);

  const handleBack = useCallback(() => {
    const resolvedVideoId = videoId ?? seededMeta?.video_id;
    if (resolvedVideoId) {
      navigate(`/capture/${resolvedVideoId}`, {
        state: createWorkflowRouteState({
          videoMeta: seededMeta,
          frameTimestamps: timestamps,
        }),
      });
    }
  }, [seededMeta, timestamps, videoId, navigate]);

  const handleReupload = useCallback(async () => {
    const resolvedVideoId = videoId ?? seededMeta?.video_id;
    if (resolvedVideoId) {
      clearWorkflow(resolvedVideoId);
      try {
        await deleteVideo(resolvedVideoId);
      } catch {
        // The server upload may already be gone; navigating home still resets the UI.
      }
    }
    navigate('/');
  }, [seededMeta, videoId, navigate]);

  const formatTime = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    const millis = Math.floor(ms % 1000);
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">关键帧列表</h2>
        <button
          onClick={handleReupload}
          className="self-start rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 sm:self-auto"
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
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-gray-400">
          <div className="mb-4 flex justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-gray-500" />
          </div>
          <div className="text-lg">正在生成缩略图...</div>
        </div>
      ) : frames.length === 0 ? (
        <div className="py-20 text-center text-gray-400">
          <div className="mb-4 flex justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-dashed border-gray-300">
              <div className="h-6 w-8 rounded border-2 border-gray-300" />
            </div>
          </div>
          <div className="text-lg">暂无关键帧</div>
          <div className="mt-6 flex justify-center gap-3">
            <button
              onClick={handleBack}
              className="rounded-lg bg-gray-900 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800"
            >
              返回截取
            </button>
            <button
              onClick={handleReupload}
              className="rounded-lg border border-gray-200 bg-white px-6 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              重新上传视频
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {frames.map((frame, index) => (
              <div
                key={frame.ts_ms}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
                className={`group relative cursor-grab overflow-hidden rounded-xl border bg-gray-50 transition-all hover:shadow-md active:cursor-grabbing ${
                  dragOverIndex === index
                    ? 'border-gray-900 ring-2 ring-gray-900'
                    : 'border-gray-200'
                }`}
              >
                {frame.thumb_dataurl ? (
                  <img
                    src={frame.thumb_dataurl}
                    alt={`帧 ${index + 1}`}
                    className="w-full object-contain"
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center text-sm text-gray-400">
                    预览失败
                  </div>
                )}
                <div className="px-2 py-1.5">
                  <div className="text-center text-xs text-gray-400">
                    {formatTime(frame.ts_ms)}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(index);
                  }}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs text-red-500 shadow-sm opacity-0 transition-opacity group-hover:opacity-100"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          <div className="mt-8 flex justify-between">
            <button
              onClick={handleBack}
              className="rounded-lg border border-gray-200 bg-white px-6 py-3 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              &larr; 返回截取
            </button>

            <div className="flex gap-3">
              <button
                onClick={handleClear}
                className="rounded-lg border border-red-200 bg-white px-6 py-3 text-sm text-red-600 transition-colors hover:bg-red-50"
              >
                清空所有
              </button>
              <button
                onClick={handleContinue}
                className="rounded-lg bg-gray-900 px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-gray-800"
              >
                继续处理 &rarr;
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
