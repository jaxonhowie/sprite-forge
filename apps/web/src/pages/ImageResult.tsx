import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import useSWR from 'swr';
import {
  ApiError,
  clearRuntimeData,
  deleteImage,
  getImageJobExportUrl,
  repackImageJobItems,
  type ImageJobStatus,
} from '../api/client';
import {
  clearImageWorkflow,
  clearAllImageWorkflowState,
  createImageWorkflowRouteState,
  getImageWorkflowState,
  mergeImageWorkflowState,
  type ImageWorkflowRouteState,
} from '../utils/imageWorkflowState';
import { clearAllWorkflowState } from '../utils/workflowState';

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.text().catch(() => response.statusText);
    throw new ApiError(response.status, `请求失败 (${response.status}): ${error}`);
  }
  return response.json() as Promise<ImageJobStatus>;
};

const stageLabels: Record<string, string> = {
  crop: '裁切图块',
  rembg: '去背景',
  pack: '生成精灵表',
  done: '处理完成',
};

export default function ImageResult() {
  const { jobId } = useParams<{ jobId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as ImageWorkflowRouteState | null;
  const workflowState = useMemo(() => getImageWorkflowState(), []);
  const resolvedJobId = jobId ?? locationState?.jobId ?? workflowState?.jobId ?? null;
  const [exporting, setExporting] = useState(false);
  const [previewItem, setPreviewItem] = useState<{ src: string; label: string } | null>(null);
  const [isRepacking, setIsRepacking] = useState(false);

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

  const handleExport = useCallback(async () => {
    if (!resolvedJobId) return;

    setExporting(true);
    try {
      const response = await fetch(getImageJobExportUrl(resolvedJobId));
      if (!response.ok) throw new Error('导出失败');

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = blobUrl;
      anchor.download = `image_segments_${resolvedJobId}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error(err);
    } finally {
      setExporting(false);
    }
  }, [resolvedJobId]);

  const handleRestart = useCallback(async () => {
    const imageId = job?.image_id ?? workflowState?.imageMeta?.image_id;

    try {
      await clearRuntimeData();
    } catch {
      clearImageWorkflow();
      if (imageId) {
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
  }, [job?.image_id, navigate, workflowState?.imageMeta?.image_id]);

  const getItemName = useCallback((itemUrl: string) => {
    const url = new URL(itemUrl, window.location.origin);
    const segments = url.pathname.split('/');
    return segments[segments.length - 1] ?? '';
  }, []);

  const handleDeleteItem = useCallback(async (itemUrl: string) => {
    if (!resolvedJobId || !job?.result?.item_urls || isRepacking) return;

    const nextUrls = job.result.item_urls.filter((currentItemUrl) => currentItemUrl !== itemUrl);
    if (nextUrls.length === 0) return;

    const nextItemNames = nextUrls.map(getItemName).filter(Boolean);
    if (nextItemNames.length !== nextUrls.length) return;

    setIsRepacking(true);
    try {
      const updatedJob = await repackImageJobItems(resolvedJobId, nextItemNames);
      await mutate(updatedJob, false);
      if (previewItem?.src === itemUrl) {
        setPreviewItem(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRepacking(false);
    }
  }, [getItemName, isRepacking, job?.result?.item_urls, mutate, previewItem?.src, resolvedJobId]);

  if (isLoading) {
    return <div className="py-20 text-center text-gray-500">加载中...</div>;
  }

  if (error || !job) {
    return (
      <div className="py-20 text-center">
        <div className="mb-4 text-lg font-bold text-red-500">加载失败</div>
        <button
          type="button"
          onClick={() => navigate('/image')}
          className="rounded bg-gray-900 px-5 py-2 text-sm font-medium text-white"
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
        <div className="mb-6 text-sm text-gray-500">{job.error || '未知错误'}</div>
        <button
          type="button"
          onClick={handleRestart}
          className="rounded bg-gray-900 px-5 py-2 text-sm font-medium text-white"
        >
          返回首页
        </button>
      </div>
    );
  }

  const progress = Math.round(job.progress * 100);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">切图结果</h1>
          <p className="mt-2 text-sm text-gray-500">导出包含透明 PNG、spritesheet、metadata 的 ZIP。</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleRestart}
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            返回首页
          </button>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={job.status !== 'done' || exporting || isRepacking}
            className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-green-300"
          >
            {exporting ? '导出中...' : '下载 ZIP'}
          </button>
        </div>
      </div>

      {job.status !== 'done' && (
        <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between text-sm text-gray-600">
            <span>{stageLabels[job.stage] || job.stage || '处理中'}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-gray-900">单图预览</h2>
            {isRepacking ? <span className="text-xs text-gray-500">正在更新结果...</span> : null}
          </div>
          <div className="mt-4 grid max-h-[70vh] gap-3 overflow-auto pr-1">
            {(job.result?.item_urls ?? []).map((itemUrl, index) => (
              <div key={itemUrl} className="rounded border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="text-xs text-gray-500">#{index + 1}</div>
                  <button
                    type="button"
                    onClick={() => void handleDeleteItem(itemUrl)}
                    disabled={isRepacking || (job.result?.item_urls.length ?? 0) <= 1}
                    className="rounded border border-red-200 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-red-100 disabled:text-red-300"
                  >
                    删除
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewItem({ src: itemUrl, label: `切图 ${index + 1}` })}
                  className="transparent-preview-bg flex w-full items-center justify-center rounded border border-dashed border-gray-200 p-2 transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                  title="点击放大预览"
                >
                  <img src={itemUrl} alt={`切图 ${index + 1}`} className="max-h-32 max-w-full object-contain" />
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-gray-900">Spritesheet 预览</h2>
            {job.result?.spritesheet_url ? (
              <div className="mt-4 overflow-auto rounded border border-gray-200 bg-gray-50 p-3">
                <img src={job.result.spritesheet_url} alt="Spritesheet 预览" className="h-auto max-w-full" />
              </div>
            ) : (
              <div className="mt-4 text-sm text-gray-500">正在生成 spritesheet...</div>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-lg font-semibold text-gray-900">结果说明</h2>
            <div className="mt-4 space-y-2 text-sm text-gray-600">
              <div>图块数量: {job.result?.item_urls.length ?? 0}</div>
              <div>导出内容: 透明 PNG、spritesheet、spritesheet.json、manifest.json</div>
              <div>排序规则: 自上而下，自左而右</div>
            </div>
          </div>
        </div>
      </div>

      {previewItem && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setPreviewItem(null)}
        >
          <div
            className="max-h-full w-[min(90vw,960px)] rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="text-sm font-medium text-gray-700">{previewItem.label}</div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
            <div className="transparent-preview-bg flex h-[min(78vh,720px)] w-full items-center justify-center overflow-auto rounded-xl bg-gray-50 p-6">
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
