import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import {
  clearRuntimeData,
  deleteImage,
  downloadBlobWithTimeout,
  getImageJobExportUrl,
  repackImageJobItems,
  type ImageExportTarget,
  type ImageJobStatus,
} from '../api/client';
import { fetcher } from '../api/fetcher';
import useSortableList from '../hooks/useSortableList';
import { imageStageLabels as stageLabels } from '../utils/stageLabels';
import {
  clearImageWorkflow,
  clearAllImageWorkflowState,
  createImageWorkflowRouteState,
  getImageWorkflowState,
  mergeImageWorkflowState,
  type ImageWorkflowRouteState,
} from '../utils/imageWorkflowState';
import { clearAllWorkflowState } from '../utils/workflowState';

export default function ImageResult() {
  const { jobId } = useParams<{ jobId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as ImageWorkflowRouteState | null;
  const workflowState = useMemo(() => getImageWorkflowState(), []);
  const resolvedJobId = jobId ?? locationState?.jobId ?? workflowState?.jobId ?? null;
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [previewItem, setPreviewItem] = useState<{ src: string; label: string } | null>(null);
  const [isRepacking, setIsRepacking] = useState(false);
  const [arrangedItemUrls, setArrangedItemUrls] = useState<string[]>([]);
  const [itemsDirty, setItemsDirty] = useState(false);
  const [isPlayingItems, setIsPlayingItems] = useState(false);
  const [playingItemIndex, setPlayingItemIndex] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

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

  const { data: job, error, isLoading, mutate } = useSWR<ImageJobStatus>(
    resolvedJobId ? `/api/image-jobs/${resolvedJobId}` : null,
    fetcher,
    {
      refreshInterval: (currentJob) => currentJob?.status === 'running' ? 1000 : 0,
    }
  );

  useEffect(() => {
    if (!job) return;
    mergeImageWorkflowState({
      currentStep: job.status === 'done' ? 'result' : 'segments',
      jobId: job.id,
    });
  }, [job]);

  useEffect(() => {
    setArrangedItemUrls(job?.result?.item_urls ?? []);
    setItemsDirty(false);
    setIsPlayingItems(false);
    setPlayingItemIndex(0);
  }, [job?.result?.item_urls]);

  useEffect(() => {
    if (!isPlayingItems || arrangedItemUrls.length === 0) return;
    const timer = setInterval(() => {
      setPlayingItemIndex((current) => (current + 1) % arrangedItemUrls.length);
    }, 160);
    return () => clearInterval(timer);
  }, [isPlayingItems, arrangedItemUrls.length]);

  const getItemName = useCallback((itemUrl: string) => {
    const url = new URL(itemUrl, window.location.origin);
    const segments = url.pathname.split('/');
    return segments[segments.length - 1] ?? '';
  }, []);

  const syncArrangedItems = useCallback(async () => {
    if (!resolvedJobId || !itemsDirty) return;
    const itemNames = arrangedItemUrls.map(getItemName).filter(Boolean);
    if (itemNames.length !== arrangedItemUrls.length) return;
    const updatedJob = await repackImageJobItems(resolvedJobId, itemNames);
    await mutate(updatedJob, false);
    setItemsDirty(false);
  }, [arrangedItemUrls, getItemName, itemsDirty, mutate, resolvedJobId]);

  const handleExport = useCallback(async (target: ImageExportTarget | 'png') => {
    setExportOpen(false);
    if (!resolvedJobId) return;

    try {
      await syncArrangedItems();
    } catch (err) {
      console.error('同步顺序失败:', err);
      setActionError(err instanceof Error ? err.message : '同步顺序失败');
      return;
    }

    setExporting(true);
    setActionError(null);
    try {
      const exportTarget = target === 'png' ? 'items' : target;
      const url = getImageJobExportUrl(resolvedJobId, exportTarget as ImageExportTarget);
      const blob = await downloadBlobWithTimeout(url);
      const blobUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      const ext = exportTarget === 'gif' ? 'gif' : 'zip';
      anchor.download = `image_segments_${resolvedJobId}.${ext}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error(err);
      setActionError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }, [resolvedJobId, syncArrangedItems]);

  const handleRestart = useCallback(async () => {
    const imageIds = job?.image_ids ?? workflowState?.imageMetas?.map((m) => m.image_id) ?? [];

    try {
      await clearRuntimeData();
    } catch {
      clearImageWorkflow();
      for (const imageId of imageIds) {
        try {
          await deleteImage(imageId);
        } catch {
          // Ignore cleanup failure and return home.
        }
      }
    }

    clearAllWorkflowState();
    clearAllImageWorkflowState();
    navigate('/', { state: createImageWorkflowRouteState() });
  }, [job?.image_ids, navigate, workflowState?.imageMetas]);

  const handleDeleteItem = useCallback(async (itemUrl: string) => {
    if (!resolvedJobId || isRepacking) return;

    const nextUrls = arrangedItemUrls.filter((u) => u !== itemUrl);
    if (nextUrls.length === 0) return;

    setArrangedItemUrls(nextUrls);
    setItemsDirty(true);

    const nextItemNames = nextUrls.map(getItemName).filter(Boolean);
    if (nextItemNames.length !== nextUrls.length) return;

    setIsRepacking(true);
    try {
      const updatedJob = await repackImageJobItems(resolvedJobId, nextItemNames);
      await mutate(updatedJob, false);
      setItemsDirty(false);
      if (previewItem?.src === itemUrl) {
        setPreviewItem(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRepacking(false);
    }
  }, [arrangedItemUrls, getItemName, isRepacking, mutate, previewItem?.src, resolvedJobId]);

  const moveItem = useCallback((fromIndex: number, toIndex: number) => {
    setArrangedItemUrls((current) => {
      if (toIndex < 0 || toIndex >= current.length || fromIndex === toIndex) return current;
      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      setItemsDirty(true);
      return next;
    });
  }, []);

  const {
    dragOverIndex,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  } = useSortableList(moveItem);

  if (isLoading) {
    return <div className="py-20 text-center text-gray-500 dark:text-gray-400">加载中...</div>;
  }

  if (error || !job) {
    return (
      <div className="py-20 text-center">
        <div className="mb-4 text-lg font-bold text-red-500">加载失败</div>
        <button
          type="button"
          onClick={() => navigate('/image')}
          className="rounded bg-gray-900 px-5 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
        >
          返回切图入口
        </button>
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="py-20 text-center">
        <div className="mb-2 text-lg font-bold text-red-500">处理失败</div>
        <div className="mb-6 text-sm text-gray-500 dark:text-gray-400">{job.error || '未知错误'}</div>
        <button
          type="button"
          onClick={handleRestart}
          className="rounded bg-gray-900 px-5 py-2 text-sm font-medium text-white dark:bg-gray-100 dark:text-gray-900"
        >
          返回首页
        </button>
      </div>
    );
  }

  const progress = Math.round(job.progress * 100);

  return (
    <div className="mx-auto">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">切图结果</h1>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">导出包含透明 PNG、spritesheet、metadata 的 ZIP。</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleRestart}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            返回首页
          </button>
          <div ref={exportRef} className="relative">
            <button
              type="button"
              onClick={() => setExportOpen(!exportOpen)}
              disabled={job.status !== 'done' || exporting || isRepacking}
              className="flex items-center gap-2 rounded bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-green-300 dark:bg-green-500 dark:hover:bg-green-400 dark:disabled:bg-green-800"
            >
              {exporting ? '导出中...' : '导出'}
              <svg className={`h-4 w-4 transition-transform ${exportOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {exportOpen && (
              <div className="absolute right-0 z-10 mt-2 w-56 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                <button
                  type="button"
                  onClick={() => void handleExport('png')}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <span className="text-base">🖼</span>
                  <div>
                    <div className="font-medium">下载 PNG</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">每帧 PNG 打包 ZIP</div>
                  </div>
                </button>
                <button
                  type="button"
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
                  type="button"
                  onClick={() => void handleExport('items')}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <span className="text-base">🧩</span>
                  <div>
                    <div className="font-medium">逐项 PNG ZIP</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">每项单独 PNG 文件</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => void handleExport('gif')}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <span className="text-base">🎞</span>
                  <div>
                    <div className="font-medium">导出 GIF</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">逐帧动画 GIF</div>
                  </div>
                </button>
                <div className="border-t border-gray-100 dark:border-gray-800" />
                <button
                  type="button"
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
                  type="button"
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
                  type="button"
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
        </div>
      </div>

      {actionError && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {actionError}
        </div>
      )}

      {job.status !== 'done' && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <div className="mb-3 flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
            <span>{stageLabels[job.stage] || job.stage || '处理中'}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="mb-8 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">切图预览</h2>
          {isRepacking ? <span className="text-xs text-gray-500 dark:text-gray-400">正在更新结果...</span> : null}
        </div>
        <div className="mt-4 rounded-lg border border-gray-100 bg-white p-3 dark:border-gray-800 dark:bg-gray-800">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            {arrangedItemUrls.map((itemUrl, index) => (
              <div
                key={`${itemUrl}-${index}`}
                draggable={!isRepacking}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(event) => handleDragOver(event, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
                className={`group relative min-w-32 cursor-grab rounded border bg-gray-50 p-2 transition-all active:cursor-grabbing dark:bg-gray-800 ${
                  dragOverIndex === index
                    ? 'border-gray-900 ring-2 ring-gray-900 dark:border-gray-100 dark:ring-gray-100'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="mb-1 text-center text-xs text-gray-500 dark:text-gray-400">#{index + 1}</div>
                <button
                  type="button"
                  onClick={() => setPreviewItem({ src: itemUrl, label: `切图 ${index + 1}` })}
                  className="transparent-preview-bg flex aspect-square w-full items-center justify-center overflow-hidden rounded border border-gray-200 transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-900 dark:border-gray-700 dark:focus:ring-gray-100"
                  title="点击放大预览"
                >
                  <img src={itemUrl} alt={`切图 ${index + 1}`} className="max-h-full max-w-full object-contain" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteItem(itemUrl)}
                  disabled={isRepacking || arrangedItemUrls.length <= 1}
                  aria-label={`删除第 ${index + 1} 个切图`}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs text-red-500 shadow-sm opacity-0 transition-opacity group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-800"
                >
                  &times;
                </button>
                <div className="mt-2 flex gap-1">
                  <button
                    type="button"
                    onClick={() => moveItem(index, index - 1)}
                    disabled={isRepacking || index === 0}
                    className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(index, index + 1)}
                    disabled={isRepacking || index === arrangedItemUrls.length - 1}
                    className="flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
                  >
                    下移
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">
            拖拽调整顺序，导出前会自动按当前顺序重新打包。
          </div>
        </div>
      </div>

      {arrangedItemUrls.length > 1 && (
        <div className="mb-8 rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">逐帧播放</h2>
          <div className="mt-4 flex flex-col items-center gap-4">
            <div className="transparent-preview-bg flex h-64 w-full items-center justify-center rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
              <img
                src={arrangedItemUrls[playingItemIndex]}
                alt={`切图 ${playingItemIndex + 1}`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setIsPlayingItems((prev) => !prev)}
                className="rounded bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 dark:hover:text-gray-900"
              >
                {isPlayingItems ? '暂停播放' : '逐帧播放'}
              </button>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {playingItemIndex + 1} / {arrangedItemUrls.length}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Spritesheet 预览</h2>
          {job.result?.spritesheet_url ? (
            <div className="mt-4 overflow-auto rounded border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800">
              <img src={job.result.spritesheet_url} alt="Spritesheet 预览" className="h-auto max-w-full" />
            </div>
          ) : (
            <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">正在生成 spritesheet...</div>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">结果说明</h2>
          <div className="mt-4 space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <div>图块数量: {arrangedItemUrls.length}</div>
            <div>导出内容: 透明 PNG、spritesheet、spritesheet.json、manifest.json</div>
            <div>排序规则: 自上而下，自左而右</div>
          </div>
        </div>
      </div>

      {previewItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setPreviewItem(null)}
        >
          <div
            className="max-h-full w-[min(90vw,960px)] rounded-2xl bg-white p-4 shadow-2xl dark:bg-gray-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{previewItem.label}</div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                关闭
              </button>
            </div>
            <div className="transparent-preview-bg flex h-[min(78vh,720px)] w-full items-center justify-center overflow-auto rounded-xl bg-gray-50 p-6 dark:bg-gray-800">
              <img
                src={previewItem.src}
                alt={previewItem.label}
                className="max-h-full w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
