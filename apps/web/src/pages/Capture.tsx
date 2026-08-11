import { useState, useEffect, useCallback } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import PageShell from '../components/PageShell';
import Timeline from '../components/Timeline';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import EmptyState from '../components/ui/EmptyState';
import Icon from '../components/ui/Icon';
import Input from '../components/ui/Input';
import ProgressBar from '../components/ui/ProgressBar';
import Steps from '../components/ui/Steps';
import { deleteVideo, extractVideoFrames, getVideoMeta, type VideoMeta } from '../api/client';
import useVideoFrame from '../hooks/useVideoFrame';
import { formatTime } from '../utils/format';
import { generateFrameTimestamps, uniqueSortedTimestamps, type CaptureMode } from '../utils/timestamps';
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

const THUMB_MAX_WIDTH = 240;

function scaleToThumb(fullDataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      if (img.width <= THUMB_MAX_WIDTH) {
        resolve(fullDataUrl);
        return;
      }
      const scale = THUMB_MAX_WIDTH / img.width;
      const canvas = document.createElement('canvas');
      canvas.width = THUMB_MAX_WIDTH;
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(fullDataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => resolve(fullDataUrl);
    img.src = fullDataUrl;
  });
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
  const [videoFps, setVideoFps] = useState(30);

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
    fps: videoFps,
  });

  useEffect(() => {
    let active = true;

    const applyMeta = (meta: VideoMeta) => {
      if (!active) return;
      setVideoUrl(meta.url);
      setMetadataDuration(meta.duration_ms);
      setVideoFps(meta.fps || 30);
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

    void scaleToThumb(dataUrl).then((thumb) => {
      setFrames((prev) => {
        const next = [...prev, { ts_ms: currentTime, thumb_dataurl: thumb }];
        updateFramesState(next);
        return next;
      });
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
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }
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

  return (
    <PageShell
      title="截取关键帧"
      description="播放视频并手动标记关键帧，或按参数自动批量截取"
      back={{ to: '/video', label: '返回上传' }}
      actions={
        <Button variant="secondary" onClick={handleReupload} disabled={isAutoCapturing}>
          <Icon name="refresh" size={16} />
          重新上传视频
        </Button>
      }
      contentClassName="space-y-6"
    >
      <Steps steps={['上传视频', '截取帧', '确认帧', '处理设置', '导出结果']} current={1} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="视频预览" bodyClassName="flex justify-center">
            <div className="flex h-[256px] w-[256px] items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-black dark:border-gray-800">
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
          </Card>

          <Card title="时间轴" description="拖动进度条定位画面，逐帧微调后标记关键帧">
            <Timeline
              currentTime={currentTime}
              duration={duration}
              onSeek={(timeMs) => void seek(timeMs)}
              markers={frames.map((frame) => frame.ts_ms)}
            />

            <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void stepBackward()}
                disabled={isAutoCapturing}
              >
                <Icon name="chevron-left" size={16} />
                前一帧
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={togglePlay}
                disabled={isAutoCapturing}
              >
                <Icon name={isPlaying ? 'pause' : 'play'} size={16} />
                {isPlaying ? '暂停' : '播放'}
              </Button>
              <Button
                size="sm"
                onClick={handleMarkFrame}
                disabled={isAutoCapturing}
              >
                <Icon name="plus" size={16} />
                标记帧
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void stepForward()}
                disabled={isAutoCapturing}
              >
                后一帧
                <Icon name="chevron-right" size={16} />
              </Button>
            </div>

            <div className="mt-3 text-center text-xs text-gray-500 dark:text-gray-400">
              当前时间：{formatTime(currentTime)}
            </div>
            <p className="mt-1 text-center text-xs text-gray-400 dark:text-gray-500">
              快捷键：← 前一帧 · → 后一帧 · 空格 标记当前帧
            </p>
          </Card>
        </div>

        <div className="space-y-6">
          <Card
            title="已标记帧"
            actions={<Badge tone="brand">{frames.length} 帧</Badge>}
          >
            {frames.length === 0 ? (
              <EmptyState
                icon="image"
                title="暂无标记帧"
                description="标记或自动截取后，关键帧会显示在这里"
              />
            ) : (
              <div className="max-h-[50vh] overflow-y-auto pr-1">
                <div className="grid grid-cols-2 gap-3">
                  {frames.map((frame, index) => (
                    <div key={`${frame.ts_ms}-${index}`} className="group relative">
                      <button
                        type="button"
                        onClick={() => void handleSeekToFrame(frame.ts_ms)}
                        className="block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50 text-left transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                        title="回到该帧时间点"
                      >
                        <img
                          src={frame.thumb_dataurl}
                          alt={`帧 ${index + 1}`}
                          className="w-full"
                        />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteFrame(index)}
                        disabled={isAutoCapturing}
                        title="删除该帧"
                        className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-red-500 opacity-0 shadow-sm transition-opacity hover:text-red-600 group-hover:opacity-100 disabled:opacity-0 dark:bg-gray-900/80 dark:text-red-400 dark:hover:text-red-300"
                      >
                        <Icon name="trash" size={13} />
                      </button>
                      <div className="mt-1 text-center text-xs text-gray-400 dark:text-gray-500">
                        {formatTime(frame.ts_ms)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {frames.length > 0 && (
              <Button
                variant="dangerSoft"
                size="sm"
                className="mt-4 w-full"
                onClick={handleClearFrames}
                disabled={isAutoCapturing}
              >
                <Icon name="trash" size={14} />
                清空所有帧
              </Button>
            )}
          </Card>

          <Card title="自动截帧" description="按帧数或步长批量截取关键帧">
            <div className="mb-3 grid grid-cols-2 rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800">
              <button
                type="button"
                onClick={() => setCaptureMode('count')}
                disabled={isAutoCapturing}
                className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${captureMode === 'count' ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'}`}
              >
                按帧数
              </button>
              <button
                type="button"
                onClick={() => setCaptureMode('step')}
                disabled={isAutoCapturing}
                className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${captureMode === 'step' ? 'bg-brand-600 text-white shadow-sm dark:bg-brand-500' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700'}`}
              >
                按步长
              </button>
            </div>

            {captureMode === 'count' ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">截取帧数</span>
                <Input
                  type="number"
                  min="1"
                  max="120"
                  value={frameCount}
                  disabled={isAutoCapturing}
                  onChange={(e) => setFrameCount(Number(e.target.value) || 1)}
                />
              </label>
            ) : (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">步长 (毫秒)</span>
                <Input
                  type="number"
                  min="1"
                  value={stepMs}
                  disabled={isAutoCapturing}
                  onChange={(e) => {
                    const v = Math.floor(Number(e.target.value));
                    setStepMs(Number.isFinite(v) && v > 0 ? v : 1);
                  }}
                />
              </label>
            )}

            {isAutoCapturing && (
              <div className="mt-3">
                <ProgressBar value={autoCaptureProgress / 100} />
                <div className="mt-1.5 text-center text-xs text-gray-500 dark:text-gray-400">
                  正在截取 {autoCaptureProgress}%
                </div>
              </div>
            )}

            <Button
              className="mt-3 w-full"
              onClick={() => void handleAutoCapture()}
              disabled={!seededMeta || isAutoCapturing}
              loading={isAutoCapturing}
            >
              {isAutoCapturing ? '截取中...' : '自动截取关键帧'}
            </Button>
          </Card>

          <Button
            size="lg"
            className="w-full"
            onClick={handleContinue}
            disabled={isAutoCapturing}
          >
            继续处理
            <Icon name="arrow-right" size={16} />
          </Button>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300">
          <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </PageShell>
  );
}
