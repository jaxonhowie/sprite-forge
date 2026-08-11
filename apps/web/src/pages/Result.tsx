import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import {
  ApiError,
  clearRuntimeData,
  deleteVideo,
  downloadBlobWithTimeout,
  getJobExportUrl,
  normalizeJobLighting,
  repackJobFrames,
  type EngineExportTarget,
  type FrameOffset,
  type JobStatus,
} from '../api/client';
import { fetcher } from '../api/fetcher';
import PageShell from '../components/PageShell';
import Badge, { type BadgeTone } from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Icon from '../components/ui/Icon';
import ProgressBar from '../components/ui/ProgressBar';
import Steps from '../components/ui/Steps';
import { videoStageLabels as stageLabels } from '../utils/stageLabels';
import {
  clearWorkflow,
  createWorkflowRouteState,
  getWorkflowState,
  mergeWorkflowState,
  type WorkflowRouteState,
  clearAllWorkflowState,
} from '../utils/workflowState';
import { clearAllImageWorkflowState } from '../utils/imageWorkflowState';

type JobResult = JobStatus;

interface FrameSize {
  w: number;
  h: number;
}

const WORKFLOW_STEPS = ['上传视频', '截取帧', '确认帧', '处理设置', '导出结果'];

const exportMenuItemClass =
  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700';

function jobStatusBadge(status: string): { tone: BadgeTone; label: string } {
  switch (status) {
    case 'running':
      return { tone: 'brand', label: '处理中' };
    case 'done':
      return { tone: 'green', label: '已完成' };
    case 'failed':
      return { tone: 'red', label: '已失败' };
    default:
      return { tone: 'gray', label: '排队中' };
  }
}

export default function Result() {
  const { jobId } = useParams<{ jobId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [workflowState] = useState(() => getWorkflowState());
  const [missingJob, setMissingJob] = useState(false);
  const [isPlayingFrames, setIsPlayingFrames] = useState(false);
  const [playingFrameIndex, setPlayingFrameIndex] = useState(0);
  const [arrangedFrameUrls, setArrangedFrameUrls] = useState<string[]>([]);
  const [frameOffsets, setFrameOffsets] = useState<Record<string, FrameOffset>>({});
  const [frameSizes, setFrameSizes] = useState<Record<string, FrameSize>>({});
  const [framesDirty, setFramesDirty] = useState(false);
  const [isSyncingFrames, setIsSyncingFrames] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const dragFrameIndexRef = useRef<number | null>(null);
  const [dragOverFrameIndex, setDragOverFrameIndex] = useState<number | null>(null);
  const locationState = location.state as WorkflowRouteState | null;
  const resolvedJobId = jobId ?? locationState?.jobId ?? workflowState?.jobId ?? null;

  const { data: job, error, isLoading, mutate } = useSWR<JobResult>(
    resolvedJobId && !missingJob ? `/api/jobs/${resolvedJobId}` : null,
    fetcher,
    {
      refreshInterval: (currentJob) => currentJob?.status === 'running' ? 1000 : 0,
    }
  );

  useEffect(() => {
    if (!(error instanceof ApiError) || error.status !== 404 || !resolvedJobId) return;

    setMissingJob(true);
    mergeWorkflowState({
      currentStep: 'settings',
      jobId: undefined,
    });
  }, [error, resolvedJobId]);

  useEffect(() => {
    if (!job?.id) return;

    mergeWorkflowState({
      currentStep: job.status === 'done' ? 'result' : 'settings',
      jobId: job.id,
    });
  }, [job?.id, job?.status]);

  useEffect(() => {
    const frameCount = arrangedFrameUrls.length;
    if (!isPlayingFrames || frameCount === 0) return;

    const timer = window.setInterval(() => {
      setPlayingFrameIndex((current) => (current + 1) % frameCount);
    }, 160);

    return () => window.clearInterval(timer);
  }, [arrangedFrameUrls.length, isPlayingFrames]);

  useEffect(() => {
    setArrangedFrameUrls(job?.result?.frame_urls ?? []);
    setFrameOffsets({});
    setFrameSizes({});
    setFramesDirty(false);
    setActionError(null);
  }, [job?.result?.frame_urls]);

  useEffect(() => {
    setPlayingFrameIndex(0);
    setIsPlayingFrames(false);
  }, [arrangedFrameUrls[0]]);

  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportOpen]);

  const getFrameName = useCallback((frameUrl: string) => {
    const url = new URL(frameUrl, window.location.origin);
    return url.pathname.split('/').pop() ?? '';
  }, []);

  const getFrameOffset = useCallback((frameUrl: string): FrameOffset => {
    return frameOffsets[getFrameName(frameUrl)] ?? { x: 0, y: 0 };
  }, [frameOffsets, getFrameName]);

  const getFrameTransform = useCallback((frameUrl: string, offset: FrameOffset) => {
    if (offset.x === 0 && offset.y === 0) return undefined;

    const size = frameSizes[getFrameName(frameUrl)];
    if (!size) return `translate(${offset.x}px, ${offset.y}px)`;

    return `translate(${(offset.x / Math.max(1, size.w)) * 100}%, ${(offset.y / Math.max(1, size.h)) * 100}%)`;
  }, [frameSizes, getFrameName]);

  const handleFrameImageLoad = useCallback((frameUrl: string, image: HTMLImageElement) => {
    const frameName = getFrameName(frameUrl);
    if (!frameName || image.naturalWidth <= 0 || image.naturalHeight <= 0) return;

    setFrameSizes((current) => {
      const currentSize = current[frameName];
      if (currentSize?.w === image.naturalWidth && currentSize.h === image.naturalHeight) {
        return current;
      }

      return {
        ...current,
        [frameName]: {
          w: image.naturalWidth,
          h: image.naturalHeight,
        },
      };
    });
  }, [getFrameName]);

  const updateFrameOffset = useCallback((frameUrl: string, nextOffset: FrameOffset) => {
    const frameName = getFrameName(frameUrl);
    if (!frameName) return;

    setFrameOffsets((current) => {
      const next = { ...current };
      if (nextOffset.x === 0 && nextOffset.y === 0) {
        delete next[frameName];
      } else {
        next[frameName] = nextOffset;
      }
      return next;
    });
    setFramesDirty(true);
    setActionError(null);
  }, [getFrameName]);

  const setFrameOffsetAxis = useCallback((frameUrl: string, axis: keyof FrameOffset, value: number) => {
    const current = getFrameOffset(frameUrl);
    updateFrameOffset(frameUrl, {
      ...current,
      [axis]: value,
    });
  }, [getFrameOffset, updateFrameOffset]);

  const nudgeFrameOffset = useCallback((frameUrl: string, dx: number, dy: number) => {
    const current = getFrameOffset(frameUrl);
    updateFrameOffset(frameUrl, {
      x: current.x + dx,
      y: current.y + dy,
    });
  }, [getFrameOffset, updateFrameOffset]);

  const syncArrangedFrames = useCallback(async () => {
    if (!resolvedJobId || !framesDirty) return job;
    if (arrangedFrameUrls.length === 0) {
      throw new Error('请至少保留一个关键帧');
    }

    const frameNames = arrangedFrameUrls.map(getFrameName);
    const offsetsToSync = frameNames.reduce<Record<string, FrameOffset>>((offsets, frameName) => {
      const offset = frameOffsets[frameName];
      if (offset && (offset.x !== 0 || offset.y !== 0)) {
        offsets[frameName] = offset;
      }
      return offsets;
    }, {});

    setIsSyncingFrames(true);
    setActionError(null);
    try {
      const nextJob = await repackJobFrames(
        resolvedJobId,
        frameNames,
        offsetsToSync
      );
      setFrameOffsets({});
      setFramesDirty(false);
      await mutate(nextJob as unknown as JobResult, false);
      return nextJob as unknown as JobResult;
    } finally {
      setIsSyncingFrames(false);
    }
  }, [arrangedFrameUrls, frameOffsets, framesDirty, getFrameName, job, mutate, resolvedJobId]);

  const handleExport = useCallback(async (target: EngineExportTarget | 'png') => {
    setExportOpen(false);
    if (!resolvedJobId) return;

    try {
      const syncedJob = await syncArrangedFrames();

      if (target === 'png' && syncedJob?.result?.spritesheet_url) {
        window.open(syncedJob.result.spritesheet_url, '_blank');
        return;
      }

      const url = getJobExportUrl(resolvedJobId, target as EngineExportTarget);
      const ext = target === 'gif' ? 'gif' : target === 'lottie' ? 'json' : 'zip';
      const blob = await downloadBlobWithTimeout(url);
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `spritesheet_${resolvedJobId}_${target}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('导出失败:', err);
      setActionError(err instanceof Error ? err.message : '导出失败');
    }
  }, [resolvedJobId, syncArrangedFrames]);

  const handleNormalizeLighting = useCallback(async () => {
    if (!resolvedJobId) return;

    try {
      await syncArrangedFrames();
      const nextJob = await normalizeJobLighting(resolvedJobId);
      await mutate(nextJob as unknown as JobResult, false);
    } catch (err) {
      console.error('统一灯光失败:', err);
      setActionError(err instanceof Error ? err.message : '统一灯光失败');
    }
  }, [mutate, resolvedJobId, syncArrangedFrames]);

  const handleNewProject = useCallback(async () => {
    try {
      await clearRuntimeData();
    } catch {
      const videoIdsToClear = Array.from(new Set(
        job?.result?.video_ids ?? [job?.video_id ?? workflowState?.videoMeta?.video_id]
      )).filter((videoId): videoId is string => Boolean(videoId));

      if (videoIdsToClear.length > 0) {
        clearWorkflow(videoIdsToClear[0]);
        try {
          await Promise.all(videoIdsToClear.map((videoId) => deleteVideo(videoId)));
        } catch {
          // Finished result cleanup should not block returning to upload.
        }
      }
    }

    clearAllWorkflowState();
    clearAllImageWorkflowState();
    navigate('/', {
      state: createWorkflowRouteState(),
    });
  }, [job?.result?.video_ids, job?.video_id, navigate, workflowState?.videoMeta?.video_id]);

  const moveFrame = useCallback((fromIndex: number, toIndex: number) => {
    setArrangedFrameUrls((current) => {
      if (toIndex < 0 || toIndex >= current.length || fromIndex === toIndex) return current;

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setFramesDirty(true);
      setActionError(null);
      return next;
    });
  }, []);

  const handleFrameDragStart = useCallback((index: number) => {
    dragFrameIndexRef.current = index;
  }, []);

  const handleFrameDragOver = useCallback((event: React.DragEvent, index: number) => {
    event.preventDefault();
    setDragOverFrameIndex(index);
  }, []);

  const handleFrameDrop = useCallback((dropIndex: number) => {
    const fromIndex = dragFrameIndexRef.current;
    dragFrameIndexRef.current = null;
    setDragOverFrameIndex(null);
    if (fromIndex === null) return;

    moveFrame(fromIndex, dropIndex);
  }, [moveFrame]);

  const handleFrameDragEnd = useCallback(() => {
    dragFrameIndexRef.current = null;
    setDragOverFrameIndex(null);
  }, []);

  const handleDeleteFrame = useCallback((index: number) => {
    setArrangedFrameUrls((current) => {
      const next = current.filter((_, frameIndex) => frameIndex !== index);
      setFramesDirty(true);
      setActionError(null);
      setPlayingFrameIndex((currentIndex) => Math.min(currentIndex, Math.max(0, next.length - 1)));
      if (next.length === 0) setIsPlayingFrames(false);
      return next;
    });
  }, []);

  const processedFrameUrls = arrangedFrameUrls;
  const playingFrameUrl = processedFrameUrls[playingFrameIndex] ?? processedFrameUrls[0];
  const playingFrameOffset = playingFrameUrl ? getFrameOffset(playingFrameUrl) : { x: 0, y: 0 };
  const playingFrameTransform = playingFrameUrl ? getFrameTransform(playingFrameUrl, playingFrameOffset) : undefined;
  const layoutCols = Math.max(1, job?.params.layout.cols || 4);
  const layoutPadding = Math.max(0, job?.params.layout.padding || 0);
  const isLightingInProgress = job?.stage === 'light' && job.status === 'running' && Boolean(job.result);

  if (isLoading) {
    return (
      <PageShell title="导出结果" description="正在加载任务数据">
        <Steps steps={WORKFLOW_STEPS} current={4} className="mb-6" />
        <div className="flex flex-col items-center py-20 text-center">
          <Icon name="loader" size={32} className="animate-spin text-gray-400 dark:text-gray-500" />
          <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">加载中...</div>
        </div>
      </PageShell>
    );
  }

  if (missingJob) {
    return (
      <PageShell title="导出结果">
        <Steps steps={WORKFLOW_STEPS} current={4} className="mb-6" />
        <EmptyState
          icon="alert-circle"
          title="任务不存在或已失效"
          description="请返回处理设置页重新创建任务。"
          action={
            <Button
              onClick={() => navigate('/', {
                state: createWorkflowRouteState({
                  videoMeta: workflowState?.videoMeta,
                  frameTimestamps: workflowState?.frameTimestamps,
                }),
              })}
            >
              返回首页
            </Button>
          }
        />
      </PageShell>
    );
  }

  if (error || !job) {
    return (
      <PageShell title="导出结果">
        <Steps steps={WORKFLOW_STEPS} current={4} className="mb-6" />
        <EmptyState
          icon="alert-circle"
          title="加载失败"
          description="任务数据加载失败，请返回首页重新开始。"
          action={<Button onClick={handleNewProject}>返回首页</Button>}
        />
      </PageShell>
    );
  }

  if (job.status === 'failed') {
    return (
      <PageShell title="导出结果">
        <Steps steps={WORKFLOW_STEPS} current={4} className="mb-6" />
        <EmptyState
          icon="alert-circle"
          title="处理失败"
          description={job.error || '未知错误'}
          action={<Button onClick={handleNewProject}>重新开始</Button>}
        />
      </PageShell>
    );
  }

  if (job.status !== 'done') {
    if (isLightingInProgress) {
      return (
        <PageShell title="处理完成" description="精灵表已生成，正在进行光照归一化">
          <Steps steps={WORKFLOW_STEPS} current={4} className="mb-6" />

          <div className="space-y-6">
            <Card title="精灵表预览">
              {job.result?.spritesheet_url && (
                <div className="transparent-preview-bg max-h-[60vh] overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  <img
                    src={job.result.spritesheet_url}
                    alt="精灵表"
                    className="h-auto max-w-full"
                  />
                </div>
              )}
            </Card>

            <Card title="统一灯光" actions={<Badge tone="brand" dot>处理中</Badge>}>
              <div className="flex flex-col items-center py-2 text-center">
                <div className="text-3xl font-semibold text-gray-900 dark:text-gray-100">
                  {Math.round(job.progress * 100)}%
                </div>
                <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {stageLabels[job.stage] || job.stage} · 正在处理亮度和对比度
                </div>
                <div className="mt-5 w-full max-w-md">
                  <ProgressBar value={job.progress} />
                </div>
              </div>
            </Card>

            <Card
              title="逐帧播放"
              actions={
                <Button variant="secondary" size="sm" disabled>
                  <Icon name="play" size={16} />
                  逐帧播放
                </Button>
              }
            >
              <div className="transparent-preview-bg flex h-64 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700">
                {playingFrameUrl ? (
                  <img
                    src={playingFrameUrl}
                    alt="处理后逐帧播放预览"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <div className="text-sm text-gray-400 dark:text-gray-500">
                    暂无处理后帧，请重新开始处理生成逐帧预览
                  </div>
                )}
              </div>
            </Card>
          </div>
        </PageShell>
      );
    }

    const statusMeta = jobStatusBadge(job.status);

    return (
      <PageShell title="处理中" description="任务正在处理，完成后会自动展示结果">
        <Steps steps={WORKFLOW_STEPS} current={4} className="mb-6" />
        <Card>
          <div className="flex flex-col items-center py-6 text-center">
            <Badge tone={statusMeta.tone} dot>
              {statusMeta.label}
            </Badge>
            <div className="mt-4 text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {Math.round(job.progress * 100)}%
            </div>
            <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {stageLabels[job.stage] || job.stage}
            </div>
            <div className="mt-5 w-full max-w-md">
              <ProgressBar value={job.progress} />
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }

  const statusMeta = jobStatusBadge(job.status);

  return (
    <PageShell
      title="处理完成"
      description="预览并微调精灵帧，然后导出为所需格式"
      actions={
        <>
          <div ref={exportRef} className="relative">
            <Button
              variant="secondary"
              onClick={() => setExportOpen(!exportOpen)}
              disabled={isSyncingFrames || processedFrameUrls.length === 0}
            >
              {isSyncingFrames ? '同步中...' : framesDirty ? '同步并导出' : '导出'}
              <Icon
                name="chevron-down"
                size={16}
                className={`transition-transform ${exportOpen ? 'rotate-180' : ''}`}
              />
            </Button>
            {exportOpen && (
              <div className="absolute right-0 z-20 mt-2 w-56 animate-fade-in rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                <button onClick={() => void handleExport('png')} className={exportMenuItemClass}>
                  <Icon name="image" size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="min-w-0">
                    <span className="block font-medium">下载 PNG</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500">仅精灵表图片</span>
                  </span>
                </button>
                <button onClick={() => void handleExport('generic')} className={exportMenuItemClass}>
                  <Icon name="download" size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="min-w-0">
                    <span className="block font-medium">下载 ZIP</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500">PNG + JSON 元数据</span>
                  </span>
                </button>
                <button onClick={() => void handleExport('frames')} className={exportMenuItemClass}>
                  <Icon name="images" size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="min-w-0">
                    <span className="block font-medium">逐帧 PNG ZIP</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500">每帧单独 PNG 文件</span>
                  </span>
                </button>
                <button onClick={() => void handleExport('gif')} className={exportMenuItemClass}>
                  <Icon name="film" size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="min-w-0">
                    <span className="block font-medium">导出 GIF</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500">生成动画 GIF 动图</span>
                  </span>
                </button>
                <button onClick={() => void handleExport('lottie')} className={exportMenuItemClass}>
                  <Icon name="sparkles" size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="min-w-0">
                    <span className="block font-medium">导出 Lottie</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500">Lottie 动画 JSON</span>
                  </span>
                </button>
                <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                <button onClick={() => void handleExport('godot')} className={exportMenuItemClass}>
                  <Icon name="grid" size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="min-w-0">
                    <span className="block font-medium">Godot 4</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500">SpriteFrames + AtlasTexture</span>
                  </span>
                </button>
                <button onClick={() => void handleExport('unity')} className={exportMenuItemClass}>
                  <Icon name="layers" size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="min-w-0">
                    <span className="block font-medium">Unity</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500">Sprite Sheet + Importer</span>
                  </span>
                </button>
                <button onClick={() => void handleExport('cocos')} className={exportMenuItemClass}>
                  <Icon name="file" size={16} className="shrink-0 text-gray-400 dark:text-gray-500" />
                  <span className="min-w-0">
                    <span className="block font-medium">Cocos Creator</span>
                    <span className="block text-xs text-gray-400 dark:text-gray-500">plist + animation.json</span>
                  </span>
                </button>
              </div>
            )}
          </div>
          <Button variant="secondary" onClick={handleNewProject}>
            新项目
          </Button>
        </>
      }
    >
      <Steps steps={WORKFLOW_STEPS} current={4} className="mb-6" />

      {actionError && (
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300">
          <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      <div className="space-y-6">
        <Card
          title="精灵表预览"
          actions={
            <>
              <Badge tone={statusMeta.tone} dot>
                {statusMeta.label}
              </Badge>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {processedFrameUrls.length} 帧 · {layoutCols} 列 · {layoutPadding}px 间距
              </span>
            </>
          }
        >
        {processedFrameUrls.length > 0 ? (
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800/60">
            <div
              className="grid overflow-x-auto"
              style={{
                gridTemplateColumns: `repeat(${layoutCols}, minmax(132px, 1fr))`,
                gap: `${layoutPadding}px`,
              }}
            >
              {processedFrameUrls.map((frameUrl, index) => {
                const frameOffset = getFrameOffset(frameUrl);
                const frameTransform = getFrameTransform(frameUrl, frameOffset);
                const hasFrameOffset = Boolean(frameTransform);

                return (
                  <div
                    key={`${frameUrl}-${index}`}
                    draggable={!isSyncingFrames}
                    onDragStart={() => handleFrameDragStart(index)}
                    onDragOver={(event) => handleFrameDragOver(event, index)}
                    onDrop={() => handleFrameDrop(index)}
                    onDragEnd={handleFrameDragEnd}
                    className={`group relative min-w-32 cursor-grab rounded-lg border bg-white p-2 transition-all active:cursor-grabbing dark:bg-gray-800 ${
                      dragOverFrameIndex === index
                        ? 'border-brand-500 ring-2 ring-brand-500 dark:border-brand-400 dark:ring-brand-400'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="mb-1 text-center text-xs text-gray-500 dark:text-gray-400">#{index + 1}</div>
                    <div className="transparent-preview-bg flex aspect-square items-center justify-center overflow-hidden rounded-md border border-gray-200 dark:border-gray-700">
                      <img
                        src={frameUrl}
                        alt={`精灵帧 ${index + 1}`}
                        className="max-h-full max-w-full object-contain transition-transform"
                        onLoad={(event) => handleFrameImageLoad(frameUrl, event.currentTarget)}
                        style={frameTransform ? { transform: frameTransform } : undefined}
                      />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1">
                      <label className="min-w-0 text-xs text-gray-500 dark:text-gray-400">
                        X
                        <input
                          type="number"
                          value={frameOffset.x}
                          disabled={isSyncingFrames}
                          onChange={(event) => setFrameOffsetAxis(
                            frameUrl,
                            'x',
                            Number.parseInt(event.target.value, 10) || 0
                          )}
                          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-1.5 py-1 text-center text-xs text-gray-700 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                        />
                      </label>
                      <label className="min-w-0 text-xs text-gray-500 dark:text-gray-400">
                        Y
                        <input
                          type="number"
                          value={frameOffset.y}
                          disabled={isSyncingFrames}
                          onChange={(event) => setFrameOffsetAxis(
                            frameUrl,
                            'y',
                            Number.parseInt(event.target.value, 10) || 0
                          )}
                          className="mt-1 w-full rounded-md border border-gray-300 bg-white px-1.5 py-1 text-center text-xs text-gray-700 shadow-sm transition-colors focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                        />
                      </label>
                    </div>
                    <div className="mt-1 grid grid-cols-5 gap-1">
                      <button
                        type="button"
                        onClick={() => nudgeFrameOffset(frameUrl, -1, 0)}
                        disabled={isSyncingFrames}
                        aria-label={`左移第 ${index + 1} 帧`}
                        className="flex h-7 items-center justify-center rounded-md border border-gray-300 bg-white text-xs text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeFrameOffset(frameUrl, 0, -1)}
                        disabled={isSyncingFrames}
                        aria-label={`上移第 ${index + 1} 帧`}
                        className="flex h-7 items-center justify-center rounded-md border border-gray-300 bg-white text-xs text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => updateFrameOffset(frameUrl, { x: 0, y: 0 })}
                        disabled={isSyncingFrames || !hasFrameOffset}
                        className="flex h-7 items-center justify-center rounded-md border border-gray-300 bg-white text-xs text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      >
                        归零
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeFrameOffset(frameUrl, 0, 1)}
                        disabled={isSyncingFrames}
                        aria-label={`下移第 ${index + 1} 帧`}
                        className="flex h-7 items-center justify-center rounded-md border border-gray-300 bg-white text-xs text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeFrameOffset(frameUrl, 1, 0)}
                        disabled={isSyncingFrames}
                        aria-label={`右移第 ${index + 1} 帧`}
                        className="flex h-7 items-center justify-center rounded-md border border-gray-300 bg-white text-xs text-gray-600 shadow-sm transition-colors hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                      >
                        →
                      </button>
                    </div>
                    <div className="mt-2 flex gap-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1 !px-1"
                        onClick={() => moveFrame(index, index - 1)}
                        disabled={isSyncingFrames || index === 0}
                      >
                        上移
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1 !px-1"
                        onClick={() => moveFrame(index, index + 1)}
                        disabled={isSyncingFrames || index === processedFrameUrls.length - 1}
                      >
                        下移
                      </Button>
                    </div>
                    <Button
                      variant="dangerSoft"
                      size="sm"
                      onClick={() => handleDeleteFrame(index)}
                      disabled={isSyncingFrames || processedFrameUrls.length <= 1}
                      aria-label={`删除第 ${index + 1} 帧`}
                      className="absolute right-1.5 top-1.5 w-8 !p-0 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Icon name="x" size={14} />
                    </Button>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">
              拖拽或使用上移、下移调整顺序；X/Y 只校准当前帧，导出前会自动按当前设置重新打包。
            </div>
          </div>
        ) : job.result?.spritesheet_url ? (
          <div className="transparent-preview-bg max-h-[60vh] overflow-auto rounded-lg border border-gray-100">
            <img
              src={job.result.spritesheet_url}
              alt="精灵表"
              className="h-auto max-w-full"
            />
          </div>
        ) : (
          <EmptyState
            icon="image"
            title="暂无精灵表"
            description="任务结果中没有可预览的内容。"
          />
        )}
        </Card>

        <Card
          title="统一灯光"
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleNormalizeLighting()}
              disabled={!resolvedJobId || isSyncingFrames || processedFrameUrls.length === 0}
            >
              {isSyncingFrames ? '同步中...' : '统一灯光'}
            </Button>
          }
        >
          <p className="text-sm text-gray-500 dark:text-gray-400">对处理后关键帧统一亮度和对比度，减少首尾帧色差。</p>
        </Card>

        <Card title="逐帧播放">
          <div className="transparent-preview-bg flex h-64 items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700">
            {playingFrameUrl ? (
              <img
                src={playingFrameUrl}
                alt="处理后逐帧播放预览"
                className="max-h-full max-w-full object-contain transition-transform"
                onLoad={(event) => handleFrameImageLoad(playingFrameUrl, event.currentTarget)}
                style={playingFrameTransform ? { transform: playingFrameTransform } : undefined}
              />
            ) : (
              <div className="text-sm text-gray-400 dark:text-gray-500">暂无处理后帧，请重新开始处理生成逐帧预览</div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {playingFrameUrl
                ? `第 ${Math.min(playingFrameIndex + 1, processedFrameUrls.length)} / ${processedFrameUrls.length} 帧`
                : '暂无可播放帧'}
            </span>
            <Button
              variant="secondary"
              size="sm"
              className="ml-auto"
              onClick={() => setIsPlayingFrames((current) => !current)}
              disabled={!playingFrameUrl}
            >
              <Icon name={isPlayingFrames ? 'pause' : 'play'} size={16} />
              {isPlayingFrames ? '暂停播放' : '逐帧播放'}
            </Button>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
