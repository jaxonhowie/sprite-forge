import { useState, useEffect, useCallback } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import Timeline from '../components/Timeline';
import { deleteVideo, extractVideoFrames, getVideoMeta, type VideoMeta } from '../api/client';
import useVideoFrame from '../hooks/useVideoFrame';
import {
  clearWorkflow,
  createWorkflowRouteState,
  getWorkflowState,
  mergeWorkflowState,
  setFrameTimestamps,
  type WorkflowRouteState,
} from '../utils/workflowState';

interface Frame {
  ts_ms: number;
  thumb_dataurl: string;
}

type CaptureMode = 'count' | 'step';

function generateFrameTimestamps(
  durationMs: number,
  mode: CaptureMode,
  frameCount: number,
  stepMsInput: number
) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];

  if (mode === 'count') {
    const count = Math.max(1, Math.min(120, Math.floor(frameCount)));
    if (count === 1) return [0];
    return Array.from({ length: count }, (_, i) => Math.round((durationMs * i) / (count - 1)));
  }

  const stepMs = Math.max(1, Math.floor(stepMsInput));
  const timestamps: number[] = [];
  for (let ts = 0; ts <= durationMs; ts += stepMs) {
    timestamps.push(Math.round(ts));
    if (timestamps.length >= 120) break;
  }

  const last = timestamps[timestamps.length - 1] ?? 0;
  if (timestamps.length < 120 && durationMs - last > 100) {
    timestamps.push(Math.round(durationMs));
  }

  return timestamps;
}

function uniqueSortedTimestamps(timestamps: number[], durationMs: number) {
  const seen = new Set<number>();
  return timestamps
    .map((t) => Math.max(0, Math.min(durationMs, Math.round(t))))
    .filter((t) => {
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .sort((a, b) => a - b);
}

export default function Capture() {
  const { videoId } = useParams<{ videoId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [frames, setFrames] = useState<Frame[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [metadataDuration, setMetadataDuration] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [workflowState] = useState(() => getWorkflowState());
  const locationState = location.state as WorkflowRouteState | null;
  const seededMeta = locationState?.videoMeta ?? workflowState?.videoMeta;

  const [captureMode, setCaptureMode] = useState<CaptureMode>('count');
  const [frameCount, setFrameCount] = useState(12);
  const [stepMs, setStepMs] = useState(100);
  const [isAutoCapturing, setIsAutoCapturing] = useState(false);
  const [autoCaptureProgress, setAutoCaptureProgress] = useState(0);

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
    let active = true;

    const applyMeta = (meta: VideoMeta) => {
      if (!active) return;
      setVideoUrl(meta.url);
      setMetadataDuration(meta.duration_ms);
      setError(null);
      mergeWorkflowState({
        currentStep: 'capture',
        videoMeta: meta,
      });
    };

    if (videoId && seededMeta?.video_id === videoId) {
      applyMeta(seededMeta);
      return () => { active = false; };
    }

    if (!videoId) return () => { active = false; };

    getVideoMeta(videoId)
      .then(applyMeta)
      .catch(() => {
        if (active) setError('视频元数据加载失败');
      });

    return () => { active = false; };
  }, [seededMeta, videoId]);

  const updateFramesState = useCallback((nextFrames: Frame[]) => {
    const resolvedVideoId = videoId ?? seededMeta?.video_id;
    const nextTimestamps = nextFrames.map((f) => f.ts_ms);
    const thumbs: Record<string, string> = {};
    for (const f of nextFrames) {
      thumbs[String(f.ts_ms)] = f.thumb_dataurl;
    }
    if (resolvedVideoId) {
      setFrameTimestamps(resolvedVideoId, nextTimestamps);
      mergeWorkflowState({
        currentStep: 'capture',
        frameTimestamps: nextTimestamps,
        frameThumbs: thumbs,
        videoMeta: seededMeta ?? workflowState?.videoMeta,
      });
    }
  }, [seededMeta, videoId, workflowState?.videoMeta]);

  const handleMarkFrame = useCallback(() => {
    pause();
    const dataUrl = captureFrame();
    if (!dataUrl) return;

    setFrames((prev) => {
      const next = [...prev, { ts_ms: currentTime, thumb_dataurl: dataUrl }];
      updateFramesState(next);
      return next;
    });
  }, [captureFrame, currentTime, pause, updateFramesState]);

  const handleAutoCapture = useCallback(async () => {
    const resolvedVideoId = videoId ?? seededMeta?.video_id;
    if (!seededMeta || !resolvedVideoId) {
      setError('视频信息缺失');
      return;
    }

    // 必须先暂停，否则播放中的 seek 会被浏览器忽略
    pause();

    const timestamps = uniqueSortedTimestamps(
      generateFrameTimestamps(seededMeta.duration_ms, captureMode, frameCount, stepMs),
      seededMeta.duration_ms
    );

    if (timestamps.length === 0) {
      setError('没有可截取的时间点');
      return;
    }

    setError(null);
    setIsAutoCapturing(true);
    setAutoCaptureProgress(5);

    try {
      const response = await extractVideoFrames(resolvedVideoId, timestamps);
      setAutoCaptureProgress(100);

      const captured: Frame[] = response.frames.map((frame) => ({
        ts_ms: frame.ts_ms,
        thumb_dataurl: frame.url,
      }));

      setFrames(captured);
      updateFramesState(captured);
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动截取关键帧失败');
    } finally {
      setIsAutoCapturing(false);
    }
  }, [captureMode, frameCount, pause, seededMeta, stepMs, updateFramesState, videoId]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (isAutoCapturing) return;
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
  }, [stepBackward, stepForward, handleMarkFrame, isAutoCapturing]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleReupload = useCallback(async () => {
    pause();
    const resolvedVideoId = videoId ?? seededMeta?.video_id;
    if (resolvedVideoId) {
      clearWorkflow(resolvedVideoId);
      try {
        await deleteVideo(resolvedVideoId);
      } catch {
        // Local workflow cleanup should still complete if the upload was already gone.
      }
    }
    navigate('/');
  }, [pause, seededMeta?.video_id, videoId, navigate]);

  const handleContinue = useCallback(() => {
    if (frames.length === 0) {
      setError('请至少标记一个关键帧');
      return;
    }

    const resolvedVideoId = videoId ?? seededMeta?.video_id;
    if (!resolvedVideoId) return;

    const timestamps = frames.map(f => f.ts_ms);
    setFrameTimestamps(resolvedVideoId, timestamps);
    mergeWorkflowState({
      currentStep: 'frames',
      frameTimestamps: timestamps,
      videoMeta: seededMeta ?? workflowState?.videoMeta,
    });
    navigate(`/frames/${resolvedVideoId}`, {
      state: createWorkflowRouteState({
        videoMeta: seededMeta ?? workflowState?.videoMeta,
        frameTimestamps: timestamps,
      }),
    });
  }, [frames, seededMeta, videoId, navigate, workflowState?.videoMeta]);

  const handleSeekToFrame = useCallback(async (timeMs: number) => {
    pause();
    await seek(timeMs);
  }, [pause, seek]);

  const handleDeleteFrame = useCallback((index: number) => {
    setFrames((prev) => {
      const next = prev.filter((_, i) => i !== index);
      updateFramesState(next);
      return next;
    });
  }, [updateFramesState]);

  const handleClearFrames = useCallback(() => {
    setFrames([]);
    const resolvedVideoId = videoId ?? seededMeta?.video_id;
    if (resolvedVideoId) {
      setFrameTimestamps(resolvedVideoId, []);
      mergeWorkflowState({
        currentStep: 'capture',
        frameTimestamps: [],
        videoMeta: seededMeta ?? workflowState?.videoMeta,
      });
    }
  }, [seededMeta, videoId, workflowState?.videoMeta]);

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
        <h2 className="text-2xl font-bold text-gray-900">截取关键帧</h2>
        <button
          onClick={handleReupload}
          disabled={isAutoCapturing}
          className="self-start rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 sm:self-auto"
        >
          重新上传视频
        </button>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="mb-4 mx-auto flex h-[256px] w-[256px] items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-900">
            {videoUrl && (
              <video
                ref={videoRef}
                src={videoUrl}
                className="max-h-full max-w-full object-contain"
                preload="auto"
                onError={() => setError('视频加载失败')}
              />
            )}
          </div>

          <Timeline
            currentTime={currentTime}
            duration={duration}
            onSeek={(timeMs) => void seek(timeMs)}
            markers={frames.map((frame) => frame.ts_ms)}
          />

          <div className="mt-4 flex justify-center gap-3">
            <button
              onClick={() => void stepBackward()}
              disabled={isAutoCapturing}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              &larr; 前一帧
            </button>
            <button
              onClick={togglePlay}
              disabled={isAutoCapturing}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              {isPlaying ? '暂停' : '播放'}
            </button>
            <button
              onClick={handleMarkFrame}
              disabled={isAutoCapturing}
              className="rounded-lg border border-gray-200 bg-white px-6 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              标记帧 (Space)
            </button>
            <button
              onClick={() => void stepForward()}
              disabled={isAutoCapturing}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
            >
              后一帧 &rarr;
            </button>
          </div>

          <div className="mt-3 text-center text-sm text-gray-400">
            当前时间: {formatTime(currentTime)}
          </div>
        </div>

        <div>
          <div className="rounded-xl border border-gray-200 p-4">
            <h3 className="mb-4 text-lg font-bold text-gray-900">
              已标记帧 ({frames.length})
            </h3>

            <div className="max-h-[60vh] space-y-3 overflow-y-auto">
              {frames.map((frame, index) => (
                <div key={index} className="group relative">
                  <button
                    type="button"
                    onClick={() => void handleSeekToFrame(frame.ts_ms)}
                    className="block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-left transition-shadow hover:shadow-md"
                    title="回到该帧时间点"
                  >
                    <img
                      src={frame.thumb_dataurl}
                      alt={`帧 ${index + 1}`}
                      className="w-full"
                    />
                  </button>
                  <div className="mt-1 flex items-center justify-between px-1">
                    <span className="text-xs text-gray-400">{formatTime(frame.ts_ms)}</span>
                    <button
                      onClick={() => handleDeleteFrame(index)}
                      disabled={isAutoCapturing}
                      className="text-xs text-red-400 opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100 disabled:opacity-0"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {frames.length > 0 && (
              <button
                onClick={handleClearFrames}
                disabled={isAutoCapturing}
                className="mt-4 w-full rounded-lg border border-red-200 bg-white py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
              >
                清空所有帧
              </button>
            )}

            {/* 自动截帧控制 */}
            <div className="mt-4 rounded-lg border border-gray-100 bg-gray-50 p-3">
              <div className="mb-2 text-xs font-semibold text-gray-600">自动截帧</div>
              <div className="mb-3 grid grid-cols-2 rounded-lg border border-gray-200 bg-white p-0.5">
                <button
                  onClick={() => setCaptureMode('count')}
                  disabled={isAutoCapturing}
                  className={`rounded-md px-2 py-1.5 text-xs transition-colors ${captureMode === 'count' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  按帧数
                </button>
                <button
                  onClick={() => setCaptureMode('step')}
                  disabled={isAutoCapturing}
                  className={`rounded-md px-2 py-1.5 text-xs transition-colors ${captureMode === 'step' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  按步长
                </button>
              </div>

              {captureMode === 'count' ? (
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500">截取帧数</span>
                  <input
                    type="number"
                    min="1"
                    max="120"
                    value={frameCount}
                    disabled={isAutoCapturing}
                    onChange={(e) => setFrameCount(Number(e.target.value) || 1)}
                    className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-gray-400"
                  />
                </label>
              ) : (
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500">步长 (毫秒)</span>
                  <input
                    type="number"
                    min="1"
                    value={stepMs}
                    disabled={isAutoCapturing}
                    onChange={(e) => {
                      const v = Math.floor(Number(e.target.value));
                      setStepMs(Number.isFinite(v) && v > 0 ? v : 1);
                    }}
                    className="w-full rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-gray-400"
                  />
                </label>
              )}

              {isAutoCapturing && (
                <div className="mt-3">
                  <div className="h-1.5 overflow-hidden rounded-full bg-gray-200">
                    <div
                      className="h-full rounded-full bg-gray-900 transition-all"
                      style={{ width: `${autoCaptureProgress}%` }}
                    />
                  </div>
                  <div className="mt-1 text-center text-xs text-gray-500">正在截取 {autoCaptureProgress}%</div>
                </div>
              )}

              <button
                onClick={() => void handleAutoCapture()}
                disabled={!seededMeta || isAutoCapturing}
                className="mt-3 w-full rounded-lg bg-gray-900 py-2 text-xs font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isAutoCapturing ? '截取中...' : '自动截取关键帧'}
              </button>
            </div>

            <button
              onClick={handleContinue}
              disabled={isAutoCapturing}
              className="mt-3 w-full rounded-lg bg-gray-900 py-2.5 text-sm font-bold text-white transition-colors hover:bg-gray-800 disabled:opacity-50"
            >
              继续处理 &rarr;
            </button>
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {error && (
        <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
