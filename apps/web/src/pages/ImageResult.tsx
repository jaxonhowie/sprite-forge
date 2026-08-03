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
import PageShell from '../components/PageShell';
import Badge, { type BadgeTone } from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Icon from '../components/ui/Icon';
import ProgressBar from '../components/ui/ProgressBar';
import Steps from '../components/ui/Steps';
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

const statusMeta: Record<string, { tone: BadgeTone; label: string }> = {
  pending: { tone: 'gray', label: '排队中' },
  running: { tone: 'brand', label: '处理中' },
  done: { tone: 'green', label: '已完成' },
  failed: { tone: 'red', label: '处理失败' },
};

const exportMenuItemClass =
  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700';

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
    return (
      <PageShell title="切图结果" back={{ to: '/image', label: '返回上传' }}>
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-sm text-gray-500 dark:text-gray-400">
          <Icon name="loader" size={24} className="animate-spin" />
          加载中...
        </div>
      </PageShell>
    );
  }

  if (error || !job) {
    return (
      <PageShell title="切图结果" back={{ to: '/image', label: '返回上传' }}>
        <EmptyState
          icon="alert-circle"
          title="加载失败"
          description="任务不存在或已被清理，请返回提取要素入口重新上传图片。"
          action={<Button onClick={() => navigate('/image')}>返回提取要素入口</Button>}
        />
      </PageShell>
    );
  }

  if (job.status === 'failed') {
    return (
      <PageShell title="切图结果" back={{ to: '/image', label: '返回上传' }}>
        <EmptyState
          icon="alert-circle"
          title="处理失败"
          description={job.error || '未知错误'}
          action={<Button onClick={handleRestart}>返回首页</Button>}
        />
      </PageShell>
    );
  }

  const progress = Math.round(job.progress * 100);
  const statusInfo: { tone: BadgeTone; label: string } =
    statusMeta[job.status] ?? { tone: 'gray', label: job.status };

  return (
    <PageShell
      title="切图结果"
      description="导出包含透明 PNG、spritesheet、metadata 的 ZIP。"
      back={{ to: '/image', label: '返回上传' }}
      actions={(
        <>
          <Button variant="secondary" onClick={handleRestart}>
            返回首页
          </Button>
          <div ref={exportRef} className="relative">
            <Button
              onClick={() => setExportOpen(!exportOpen)}
              disabled={job.status !== 'done' || exporting || isRepacking}
              loading={exporting}
            >
              {exporting ? '导出中...' : '导出'}
              <Icon
                name="chevron-down"
                size={16}
                className={`transition-transform ${exportOpen ? 'rotate-180' : ''}`}
              />
            </Button>
            {exportOpen && (
              <div className="absolute right-0 z-20 mt-2 w-56 animate-fade-in rounded-lg border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                <button
                  type="button"
                  onClick={() => void handleExport('png')}
                  className={exportMenuItemClass}
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
                  className={exportMenuItemClass}
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
                  className={exportMenuItemClass}
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
                  className={exportMenuItemClass}
                >
                  <span className="text-base">🎞</span>
                  <div>
                    <div className="font-medium">导出 GIF</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">逐帧动画 GIF</div>
                  </div>
                </button>
                <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                <button
                  type="button"
                  onClick={() => void handleExport('godot')}
                  className={exportMenuItemClass}
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
                  className={exportMenuItemClass}
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
                  className={exportMenuItemClass}
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
        </>
      )}
      contentClassName="space-y-6"
    >
      <Steps steps={['上传图片', '确认切块', '导出结果']} current={2} />

      {actionError && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300">
          <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {job.status !== 'done' && (
        <Card>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                <Badge tone={statusInfo.tone} dot>
                  {statusInfo.label}
                </Badge>
                <span className="truncate text-gray-600 dark:text-gray-400">
                  {stageLabels[job.stage] || job.stage || '处理中'}
                </span>
              </div>
              <span className="shrink-0 text-gray-500 dark:text-gray-400">{progress}%</span>
            </div>
            <ProgressBar value={job.progress} tone="brand" />
          </div>
        </Card>
      )}

      <Card
        title="切图预览"
        actions={(
          <>
            {isRepacking ? (
              <span className="text-xs text-gray-500 dark:text-gray-400">正在更新结果...</span>
            ) : null}
            <Badge tone={statusInfo.tone} dot>
              {statusInfo.label}
            </Badge>
          </>
        )}
      >
        <div className="rounded-lg border border-gray-100 p-3 dark:border-gray-800">
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {arrangedItemUrls.map((itemUrl, index) => (
              <div
                key={`${itemUrl}-${index}`}
                draggable={!isRepacking}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(event) => handleDragOver(event, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
                className={`group relative min-w-0 cursor-grab overflow-hidden rounded-lg border bg-white p-2 transition-all active:cursor-grabbing dark:bg-gray-800 ${
                  dragOverIndex === index
                    ? 'border-brand-500 ring-2 ring-brand-500 dark:border-brand-400 dark:ring-brand-400'
                    : 'border-gray-200 dark:border-gray-700'
                }`}
              >
                <div className="mb-1 text-center text-xs text-gray-500 dark:text-gray-400">#{index + 1}</div>
                <button
                  type="button"
                  onClick={() => setPreviewItem({ src: itemUrl, label: `切图 ${index + 1}` })}
                  className="transparent-preview-bg flex aspect-square w-full items-center justify-center overflow-hidden rounded-md border border-gray-200 transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:border-gray-700"
                  title="点击放大预览"
                >
                  <img src={itemUrl} alt={`切图 ${index + 1}`} className="max-h-full max-w-full object-contain" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteItem(itemUrl)}
                  disabled={isRepacking || arrangedItemUrls.length <= 1}
                  aria-label={`删除第 ${index + 1} 个切图`}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-red-500 opacity-0 shadow-sm transition-opacity hover:bg-red-50 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-gray-800"
                >
                  <Icon name="x" size={12} />
                </button>
                <div className="mt-2 flex gap-1">
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => moveItem(index, index - 1)}
                    disabled={isRepacking || index === 0}
                  >
                    上移
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="flex-1"
                    onClick={() => moveItem(index, index + 1)}
                    disabled={isRepacking || index === arrangedItemUrls.length - 1}
                  >
                    下移
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">
            拖拽调整顺序，导出前会自动按当前顺序重新打包。
          </div>
        </div>
      </Card>

      {arrangedItemUrls.length > 1 && (
        <Card title="逐帧播放">
          <div className="flex flex-col items-center gap-4">
            <div className="transparent-preview-bg flex h-64 w-full items-center justify-center overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
              <img
                src={arrangedItemUrls[playingItemIndex]}
                alt={`切图 ${playingItemIndex + 1}`}
                className="max-h-full max-w-full object-contain"
              />
            </div>
            <div className="flex w-full flex-wrap items-center gap-2">
              <Badge tone="gray">
                {playingItemIndex + 1} / {arrangedItemUrls.length}
              </Badge>
              <div className="ml-auto">
                <Button onClick={() => setIsPlayingItems((prev) => !prev)}>
                  <Icon name={isPlayingItems ? 'pause' : 'play'} size={16} />
                  {isPlayingItems ? '暂停播放' : '逐帧播放'}
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Spritesheet 预览">
          {job.result?.spritesheet_url ? (
            <div className="transparent-preview-bg max-h-[420px] overflow-auto rounded-lg border border-gray-100 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-800">
              <img src={job.result.spritesheet_url} alt="Spritesheet 预览" className="h-auto max-w-full" />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Icon name="loader" size={16} className="animate-spin" />
              正在生成 spritesheet...
            </div>
          )}
        </Card>

        <Card title="结果说明">
          <div className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
            <div>图块数量: {arrangedItemUrls.length}</div>
            <div>导出内容: 透明 PNG、spritesheet、spritesheet.json、manifest.json</div>
            <div>排序规则: 自上而下，自左而右</div>
          </div>
        </Card>
      </div>

      {previewItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setPreviewItem(null)}
        >
          <div
            className="max-h-full w-[min(90vw,960px)] rounded-xl bg-white p-4 shadow-lg dark:bg-gray-900"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300">{previewItem.label}</div>
              <Button variant="secondary" size="sm" onClick={() => setPreviewItem(null)}>
                关闭
              </Button>
            </div>
            <div className="transparent-preview-bg flex h-[min(78vh,720px)] w-full items-center justify-center overflow-auto rounded-lg bg-gray-50 p-6 dark:bg-gray-800">
              <img
                src={previewItem.src}
                alt={previewItem.label}
                className="max-h-full w-full object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
