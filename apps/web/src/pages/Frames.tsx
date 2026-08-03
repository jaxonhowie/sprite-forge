import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import PageShell from '../components/PageShell';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Icon from '../components/ui/Icon';
import Steps from '../components/ui/Steps';
import { deleteVideo, getVideoMeta } from '../api/client';
import useVideoFrame from '../hooks/useVideoFrame';
import { formatTime } from '../utils/format';
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


  return (
    <PageShell
      title="确认关键帧"
      description="拖拽调整顺序或删除多余帧，确认无误后继续处理"
      back={{ to: `/capture/${videoId ?? ''}`, label: '返回截取' }}
      actions={
        <Button variant="secondary" onClick={handleReupload}>
          <Icon name="refresh" size={16} />
          重新上传视频
        </Button>
      }
      contentClassName="space-y-6"
    >
      <Steps steps={['上传视频', '截取帧', '确认帧', '处理设置', '导出结果']} current={2} />

      <video
        ref={videoRef}
        src={videoUrl}
        preload="auto"
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300">
          <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
          <Icon name="loader" size={32} className="mb-4 animate-spin" />
          <div className="text-sm">正在生成缩略图...</div>
        </div>
      ) : frames.length === 0 ? (
        <EmptyState
          icon="image"
          title="暂无关键帧"
          description="返回截取页面标记关键帧，或重新上传视频"
          action={
            <div className="flex justify-center gap-3">
              <Button onClick={handleBack}>返回截取</Button>
              <Button variant="secondary" onClick={handleReupload}>重新上传视频</Button>
            </div>
          }
        />
      ) : (
        <Card title="关键帧列表" description="拖拽缩略图调整顺序，悬浮可删除单帧">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {frames.map((frame, index) => (
              <div
                key={frame.ts_ms}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
                className={`group relative cursor-grab overflow-hidden rounded-lg border bg-white transition-all hover:shadow-md active:cursor-grabbing dark:bg-gray-800 ${
                  dragOverIndex === index
                    ? 'border-brand-500 ring-2 ring-brand-500/40 dark:border-brand-400 dark:ring-brand-400/40'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                {frame.thumb_dataurl ? (
                  <img
                    src={frame.thumb_dataurl}
                    alt={`帧 ${index + 1}`}
                    className="w-full object-contain"
                  />
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-gray-50 text-xs text-gray-400 dark:bg-gray-800 dark:text-gray-500">
                    预览失败
                  </div>
                )}
                <div className="px-2 py-1.5 text-center text-xs text-gray-400 dark:text-gray-500">
                  {formatTime(frame.ts_ms)}
                </div>
                <span className="absolute left-1.5 top-1.5 rounded-md bg-white/90 p-1 text-gray-400 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 dark:bg-gray-900/80 dark:text-gray-500">
                  <Icon name="grip-vertical" size={13} />
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(index);
                  }}
                  title="删除该帧"
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-red-500 opacity-0 shadow-sm transition-opacity hover:text-red-600 group-hover:opacity-100 dark:bg-gray-900/80 dark:text-red-400 dark:hover:text-red-300"
                >
                  <Icon name="x" size={13} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-gray-100 pt-5 dark:border-gray-800">
            <Badge tone="brand">共 {frames.length} 帧</Badge>
            <span className="text-xs text-gray-400 dark:text-gray-500">
              帧将按当前顺序拼入精灵表
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="secondary" onClick={handleBack}>
                <Icon name="arrow-left" size={16} />
                返回截取
              </Button>
              <Button variant="dangerSoft" onClick={handleClear}>
                <Icon name="trash" size={16} />
                清空所有
              </Button>
              <Button onClick={handleContinue}>
                确认并继续
                <Icon name="arrow-right" size={16} />
              </Button>
            </div>
          </div>
        </Card>
      )}
    </PageShell>
  );
}
