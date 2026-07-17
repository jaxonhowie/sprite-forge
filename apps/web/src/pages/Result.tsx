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
      const ext = target === 'gif' ? 'gif' : 'zip';
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
      <div className="py-20 text-center">
        <div className="text-lg text-gray-500 dark:text-gray-400">加载中...</div>
      </div>
    );
  }

  if (missingJob) {
    return (
      <div className="py-20 text-center">
        <div className="mb-4 text-lg font-bold text-red-500">任务不存在或已失效</div>
        <div className="mb-6 text-sm text-gray-500 dark:text-gray-400">请返回处理设置页重新创建任务。</div>
        <button
          onClick={() => navigate('/', {
            state: createWorkflowRouteState({
              videoMeta: workflowState?.videoMeta,
              frameTimestamps: workflowState?.frameTimestamps,
            }),
          })}
          className="rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 dark:hover:text-gray-900"
        >
          返回首页
        </button>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="py-20 text-center">
        <div className="mb-4 text-lg font-bold text-red-500">加载失败</div>
        <button
          onClick={handleNewProject}
          className="rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 dark:hover:text-gray-900"
        >
          返回首页
        </button>
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="py-20 text-center">
        <div className="mb-4 text-5xl">&cross;</div>
        <div className="mb-2 text-lg font-bold text-red-500">处理失败</div>
        <div className="mb-8 text-gray-500 dark:text-gray-400">{job.error || '未知错误'}</div>
        <button
          onClick={handleNewProject}
          className="rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 dark:hover:text-gray-900"
        >
          重新开始
        </button>
      </div>
    );
  }

  if (job.status !== 'done') {
    if (isLightingInProgress) {
      return (
        <div className="mx-auto">
          <h2 className="mb-8 text-center text-2xl font-bold text-gray-900 dark:text-gray-100">处理完成</h2>

          <div className="mb-8 rounded-xl border border-gray-200 p-6 dark:border-gray-700">
            <h3 className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">精灵表预览</h3>
            {job.result?.spritesheet_url && (
              <div className="transparent-preview-bg max-h-[60vh] overflow-auto rounded-lg border border-gray-100 dark:border-gray-800">
                <img
                  src={job.result.spritesheet_url}
                  alt="精灵表"
                  className="h-auto max-w-full"
                />
              </div>
            )}
          </div>

          <div className="mb-8 rounded-xl border border-gray-200 p-6 dark:border-gray-700">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">统一灯光</h3>
              <span className="text-sm text-gray-500 dark:text-gray-400">{Math.round(job.progress * 100)}%</span>
            </div>
            <div className="mb-3 h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
              <div
                className="h-full rounded-full bg-gray-900 transition-all"
                style={{ width: `${Math.round(job.progress * 100)}%` }}
              />
            </div>
            <div className="text-sm text-gray-600 dark:text-gray-400">
              {stageLabels[job.stage] || job.stage} - 正在处理亮度和对比度
            </div>
          </div>

          <div className="mb-8 rounded-xl border border-gray-200 p-6 dark:border-gray-700">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">逐帧播放</h3>
              <button
                disabled
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-400 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500"
              >
                逐帧播放
              </button>
            </div>
            <div className="transparent-preview-bg flex h-64 items-center justify-center rounded-lg border border-gray-100 dark:border-gray-800">
              {playingFrameUrl ? (
                <img
                  src={playingFrameUrl}
                  alt="处理后逐帧播放预览"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="text-sm text-gray-400 dark:text-gray-500">暂无处理后帧，请重新开始处理生成逐帧预览</div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="py-20 text-center">
        <div className="mb-6 text-xl font-bold text-gray-900 dark:text-gray-100">正在处理...</div>
        <div className="mx-auto mb-4 h-3 max-w-md overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-full rounded-full bg-gray-900 transition-all"
            style={{ width: `${Math.round(job.progress * 100)}%` }}
          />
        </div>
        <div className="text-base text-gray-600 dark:text-gray-400">
          {stageLabels[job.stage] || job.stage} - {Math.round(job.progress * 100)}%
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto">
      <h2 className="mb-8 text-center text-2xl font-bold text-gray-900 dark:text-gray-100">处理完成</h2>

      {actionError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {actionError}
        </div>
      )}

      <div className="mb-8 rounded-xl border border-gray-200 p-6 dark:border-gray-700">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">精灵表预览</h3>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {processedFrameUrls.length} 帧 · {layoutCols} 列 · {layoutPadding}px 间距
          </div>
        </div>
        {processedFrameUrls.length > 0 ? (
          <div className="rounded-lg border border-gray-100 bg-white p-3 dark:border-gray-800 dark:bg-gray-800">
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
                    className={`group relative min-w-32 cursor-grab rounded border bg-gray-50 p-2 transition-all active:cursor-grabbing dark:bg-gray-800 ${
                      dragOverFrameIndex === index
                        ? 'border-gray-900 ring-2 ring-gray-900 dark:border-gray-100 dark:ring-gray-100'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  >
                    <div className="mb-1 text-center text-xs text-gray-500 dark:text-gray-400">#{index + 1}</div>
                    <div className="transparent-preview-bg flex aspect-square items-center justify-center overflow-hidden rounded border border-gray-200 dark:border-gray-700">
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
                          className="mt-1 w-full rounded border border-gray-200 bg-white px-1 py-1 text-center text-xs text-gray-700 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:focus:border-gray-500 dark:focus:ring-gray-500"
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
                          className="mt-1 w-full rounded border border-gray-200 bg-white px-1 py-1 text-center text-xs text-gray-700 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:focus:border-gray-500 dark:focus:ring-gray-500"
                        />
                      </label>
                    </div>
                    <div className="mt-1 grid grid-cols-5 gap-1">
                      <button
                        type="button"
                        onClick={() => nudgeFrameOffset(frameUrl, -1, 0)}
                        disabled={isSyncingFrames}
                        aria-label={`左移第 ${index + 1} 帧`}
                        className="rounded border border-gray-200 bg-white py-1 text-xs text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeFrameOffset(frameUrl, 0, -1)}
                        disabled={isSyncingFrames}
                        aria-label={`上移第 ${index + 1} 帧`}
                        className="rounded border border-gray-200 bg-white py-1 text-xs text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => updateFrameOffset(frameUrl, { x: 0, y: 0 })}
                        disabled={isSyncingFrames || !hasFrameOffset}
                        className="rounded border border-gray-200 bg-white py-1 text-xs text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      >
                        归零
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeFrameOffset(frameUrl, 0, 1)}
                        disabled={isSyncingFrames}
                        aria-label={`下移第 ${index + 1} 帧`}
                        className="rounded border border-gray-200 bg-white py-1 text-xs text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeFrameOffset(frameUrl, 1, 0)}
                        disabled={isSyncingFrames}
                        aria-label={`右移第 ${index + 1} 帧`}
                        className="rounded border border-gray-200 bg-white py-1 text-xs text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      >
                        →
                      </button>
                    </div>
                    <div className="mt-2 flex gap-1">
                      <button
                        onClick={() => moveFrame(index, index - 1)}
                        disabled={isSyncingFrames || index === 0}
                        className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      >
                        上移
                      </button>
                      <button
                        onClick={() => moveFrame(index, index + 1)}
                        disabled={isSyncingFrames || index === processedFrameUrls.length - 1}
                        className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                      >
                        下移
                      </button>
                    </div>
	                    <button
	                      onClick={() => handleDeleteFrame(index)}
	                      disabled={isSyncingFrames || processedFrameUrls.length <= 1}
	                      aria-label={`删除第 ${index + 1} 帧`}
	                      className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs text-red-500 shadow-sm opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800"
	                    >
                      &times;
                    </button>
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
        ) : null}
      </div>

      <div className="mb-8 rounded-xl border border-gray-200 p-6 dark:border-gray-700">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">统一灯光</h3>
          <button
            onClick={() => void handleNormalizeLighting()}
            disabled={!resolvedJobId || isSyncingFrames || processedFrameUrls.length === 0}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {isSyncingFrames ? '同步中...' : '统一灯光'}
          </button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">对处理后关键帧统一亮度和对比度，减少首尾帧色差。</p>
      </div>

      <div className="mb-8 rounded-xl border border-gray-200 p-6 dark:border-gray-700">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">逐帧播放</h3>
          <button
            onClick={() => setIsPlayingFrames((current) => !current)}
            disabled={!playingFrameUrl}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {isPlayingFrames ? '暂停播放' : '逐帧播放'}
          </button>
        </div>
        <div className="transparent-preview-bg flex h-64 items-center justify-center rounded-lg border border-gray-100">
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
      </div>

      <div className="flex flex-col justify-center gap-3 sm:flex-row">
        <div ref={exportRef} className="relative">
          <button
            onClick={() => setExportOpen(!exportOpen)}
            disabled={isSyncingFrames || processedFrameUrls.length === 0}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 dark:hover:text-gray-900"
          >
            {isSyncingFrames ? '同步中...' : framesDirty ? '同步并导出' : '导出'}
            <svg className={`h-4 w-4 transition-transform ${exportOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {exportOpen && (
            <div className="absolute left-1/2 z-10 mt-2 w-56 -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:shadow-2xl dark:shadow-black/30">
              <button
                onClick={() => void handleExport('png')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <span className="text-base">🖼</span>
                <div>
                  <div className="font-medium">下载 PNG</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">仅精灵表图片</div>
                </div>
              </button>
              <button
                onClick={() => void handleExport('generic')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <span className="text-base">📦</span>
                <div>
                  <div className="font-medium">下载 ZIP</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">PNG + JSON 元数据</div>
                </div>
              </button>
              <button
                onClick={() => void handleExport('frames')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <span className="text-base">🧩</span>
                <div>
                  <div className="font-medium">逐帧 PNG ZIP</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">每帧单独 PNG 文件</div>
                </div>
              </button>
              <button
                onClick={() => void handleExport('gif')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <span className="text-base">🎞</span>
                <div>
                  <div className="font-medium">导出 GIF</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">生成动画 GIF 动图</div>
                </div>
              </button>
              <div className="border-t border-gray-100 dark:border-gray-800" />
              <button
                onClick={() => void handleExport('godot')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <span className="text-base">🎮</span>
                <div>
                  <div className="font-medium">Godot 4</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">SpriteFrames + AtlasTexture</div>
                </div>
              </button>
              <button
                onClick={() => void handleExport('unity')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <span className="text-base">🎯</span>
                <div>
                  <div className="font-medium">Unity</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">Sprite Sheet + Importer</div>
                </div>
              </button>
              <button
                onClick={() => void handleExport('cocos')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <span className="text-base">🔧</span>
                <div>
                  <div className="font-medium">Cocos Creator</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">plist + animation.json</div>
                </div>
              </button>
            </div>
          )}
        </div>
        <button
          onClick={handleNewProject}
          className="rounded-lg border border-gray-200 bg-white px-8 py-3 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          新项目
        </button>
      </div>
    </div>
  );
}
