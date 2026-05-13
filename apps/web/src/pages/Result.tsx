import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { ApiError, deleteVideo, getJobExportUrl, normalizeJobLighting, type EngineExportTarget } from '../api/client';
import {
  clearWorkflow,
  createWorkflowRouteState,
  getWorkflowState,
  mergeWorkflowState,
  type WorkflowRouteState,
} from '../utils/workflowState';

interface JobResult {
  id: string;
  video_id: string;
  status: string;
  progress: number;
  stage: string;
  error: string | null;
  result: {
    spritesheet_url: string;
    json_url: string;
    frame_urls?: string[];
  } | null;
}

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.text().catch(() => response.statusText);
    throw new ApiError(response.status, `请求失败 (${response.status}): ${error}`);
  }
  return response.json() as Promise<JobResult>;
};

export default function Result() {
  const { jobId } = useParams<{ jobId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [workflowState] = useState(() => getWorkflowState());
  const [missingJob, setMissingJob] = useState(false);
  const [isPlayingFrames, setIsPlayingFrames] = useState(false);
  const [playingFrameIndex, setPlayingFrameIndex] = useState(0);
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
    const frameCount = job?.result?.frame_urls?.length ?? 0;
    if (!isPlayingFrames || frameCount === 0) return;

    const timer = window.setInterval(() => {
      setPlayingFrameIndex((current) => (current + 1) % frameCount);
    }, 160);

    return () => window.clearInterval(timer);
  }, [isPlayingFrames, job?.result?.frame_urls?.length]);

  useEffect(() => {
    setPlayingFrameIndex(0);
    setIsPlayingFrames(false);
  }, [job?.result?.frame_urls?.[0]]);

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

  const handleExport = useCallback(async (target: EngineExportTarget | 'png') => {
    setExportOpen(false);
    if (!resolvedJobId) return;

    if (target === 'png' && job?.result?.spritesheet_url) {
      window.open(job.result.spritesheet_url, '_blank');
      return;
    }

    try {
      const url = getJobExportUrl(resolvedJobId, target as EngineExportTarget);
      const response = await fetch(url);
      if (!response.ok) throw new Error('导出失败');

      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `spritesheet_${resolvedJobId}_${target}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('导出失败:', err);
    }
  }, [resolvedJobId, job]);

  const handleNormalizeLighting = useCallback(async () => {
    if (!resolvedJobId) return;

    try {
      const nextJob = await normalizeJobLighting(resolvedJobId);
      await mutate(nextJob as unknown as JobResult, false);
    } catch (err) {
      console.error('统一灯光失败:', err);
    }
  }, [mutate, resolvedJobId]);

  const handleNewProject = useCallback(async () => {
    const videoIdToClear = job?.video_id ?? workflowState?.videoMeta?.video_id;

    if (videoIdToClear) {
      clearWorkflow(videoIdToClear);
      try {
        await deleteVideo(videoIdToClear);
      } catch {
        // Finished result cleanup should not block returning to upload.
      }
    }
    navigate('/', {
      state: createWorkflowRouteState(),
    });
  }, [job?.video_id, navigate, workflowState?.videoMeta?.video_id]);

  const processedFrameUrls = job?.result?.frame_urls ?? [];
  const playingFrameUrl = processedFrameUrls[playingFrameIndex] ?? processedFrameUrls[0];
  const isLightingInProgress = job?.stage === 'light' && job.status === 'running' && Boolean(job.result);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl py-20 text-center">
        <div className="text-lg text-gray-500">加载中...</div>
      </div>
    );
  }

  if (missingJob) {
    return (
      <div className="mx-auto max-w-4xl py-20 text-center">
        <div className="mb-4 text-lg font-bold text-red-500">任务不存在或已失效</div>
        <div className="mb-6 text-sm text-gray-500">请返回处理设置页重新创建任务。</div>
        <button
          onClick={() => navigate('/', {
            state: createWorkflowRouteState({
              videoMeta: workflowState?.videoMeta,
              frameTimestamps: workflowState?.frameTimestamps,
            }),
          })}
          className="rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        >
          返回首页
        </button>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="mx-auto max-w-4xl py-20 text-center">
        <div className="mb-4 text-lg font-bold text-red-500">加载失败</div>
        <button
          onClick={handleNewProject}
          className="rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        >
          返回首页
        </button>
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="mx-auto max-w-4xl py-20 text-center">
        <div className="mb-4 text-5xl">&cross;</div>
        <div className="mb-2 text-lg font-bold text-red-500">处理失败</div>
        <div className="mb-8 text-gray-500">{job.error || '未知错误'}</div>
        <button
          onClick={handleNewProject}
          className="rounded-lg bg-gray-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-gray-800"
        >
          重新开始
        </button>
      </div>
    );
  }

  if (job.status !== 'done') {
    const stageLabels: Record<string, string> = {
      extract: '截帧',
      inpaint: '去水印',
      light: '统一灯光',
      rembg: '去背景',
      pack: '打包精灵表',
    };

    if (isLightingInProgress) {
      return (
        <div className="mx-auto max-w-4xl">
          <h2 className="mb-8 text-center text-2xl font-bold text-gray-900">处理完成</h2>

          <div className="mb-8 rounded-xl border border-gray-200 p-6">
            <h3 className="mb-4 text-lg font-bold text-gray-900">精灵表预览</h3>
            {job.result?.spritesheet_url && (
              <div className="transparent-preview-bg max-h-[60vh] overflow-auto rounded-lg border border-gray-100">
                <img
                  src={job.result.spritesheet_url}
                  alt="精灵表"
                  className="h-auto max-w-full"
                />
              </div>
            )}
          </div>

          <div className="mb-8 rounded-xl border border-gray-200 p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-lg font-bold text-gray-900">统一灯光</h3>
              <span className="text-sm text-gray-500">{Math.round(job.progress * 100)}%</span>
            </div>
            <div className="mb-3 h-3 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-gray-900 transition-all"
                style={{ width: `${Math.round(job.progress * 100)}%` }}
              />
            </div>
            <div className="text-sm text-gray-600">
              {stageLabels[job.stage] || job.stage} - 正在处理亮度和对比度
            </div>
          </div>

          <div className="mb-8 rounded-xl border border-gray-200 p-6">
            <div className="mb-4 flex items-center justify-between gap-4">
              <h3 className="text-lg font-bold text-gray-900">逐帧播放</h3>
              <button
                disabled
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                逐帧播放
              </button>
            </div>
            <div className="transparent-preview-bg flex h-64 items-center justify-center rounded-lg border border-gray-100">
              {playingFrameUrl ? (
                <img
                  src={playingFrameUrl}
                  alt="处理后逐帧播放预览"
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <div className="text-sm text-gray-400">暂无处理后帧，请重新开始处理生成逐帧预览</div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-4xl py-20 text-center">
        <div className="mb-6 text-xl font-bold text-gray-900">正在处理...</div>
        <div className="mx-auto mb-4 h-3 max-w-md overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-gray-900 transition-all"
            style={{ width: `${Math.round(job.progress * 100)}%` }}
          />
        </div>
        <div className="text-base text-gray-600">
          {stageLabels[job.stage] || job.stage} - {Math.round(job.progress * 100)}%
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl">
      <h2 className="mb-8 text-center text-2xl font-bold text-gray-900">处理完成</h2>

      <div className="mb-8 rounded-xl border border-gray-200 p-6">
        <h3 className="mb-4 text-lg font-bold text-gray-900">精灵表预览</h3>
        {processedFrameUrls.length > 0 ? (
          <div className="rounded-lg border border-gray-100 bg-white p-3">
            <div className="overflow-x-auto pb-3">
              <div className="flex w-max gap-3">
                {processedFrameUrls.map((frameUrl, index) => (
                              <div key={frameUrl} className="w-32 flex-none">
                                <div className="mb-2 text-center text-xs text-gray-500">#{index + 1}</div>
                                <div className="transparent-preview-bg flex h-32 w-32 items-center justify-center rounded-lg border border-gray-200 p-2">
                                  <img
                                    src={frameUrl}
                                    alt={`精灵帧 ${index + 1}`}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="text-xs text-gray-400">帧数较多时可拖动下方滚动条横向查看。</div>
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

      <div className="mb-8 rounded-xl border border-gray-200 p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-gray-900">统一灯光</h3>
          <button
            onClick={() => void handleNormalizeLighting()}
            disabled={!resolvedJobId}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            统一灯光
          </button>
        </div>
        <p className="text-sm text-gray-500">对处理后关键帧统一亮度和对比度，减少首尾帧色差。</p>
      </div>

      <div className="mb-8 rounded-xl border border-gray-200 p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <h3 className="text-lg font-bold text-gray-900">逐帧播放</h3>
          <button
            onClick={() => setIsPlayingFrames((current) => !current)}
            disabled={!playingFrameUrl}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPlayingFrames ? '暂停播放' : '逐帧播放'}
          </button>
        </div>
        <div className="transparent-preview-bg flex h-64 items-center justify-center rounded-lg border border-gray-100">
          {playingFrameUrl ? (
            <img
              src={playingFrameUrl}
              alt="处理后逐帧播放预览"
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <div className="text-sm text-gray-400">暂无处理后帧，请重新开始处理生成逐帧预览</div>
          )}
        </div>
      </div>

      <div className="flex flex-col justify-center gap-3 sm:flex-row">
        <div ref={exportRef} className="relative">
          <button
            onClick={() => setExportOpen(!exportOpen)}
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-gray-800"
          >
            导出
            <svg className={`h-4 w-4 transition-transform ${exportOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {exportOpen && (
            <div className="absolute left-1/2 z-10 mt-2 w-56 -translate-x-1/2 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg">
              <button
                onClick={() => void handleExport('png')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <span className="text-base">🖼</span>
                <div>
                  <div className="font-medium">下载 PNG</div>
                  <div className="text-xs text-gray-400">仅精灵表图片</div>
                </div>
              </button>
              <button
                onClick={() => void handleExport('generic')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <span className="text-base">📦</span>
                <div>
                  <div className="font-medium">下载 ZIP</div>
                  <div className="text-xs text-gray-400">PNG + JSON 元数据</div>
                </div>
              </button>
              <div className="border-t border-gray-100" />
              <button
                onClick={() => void handleExport('godot')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <span className="text-base">🎮</span>
                <div>
                  <div className="font-medium">Godot 4</div>
                  <div className="text-xs text-gray-400">SpriteFrames + AtlasTexture</div>
                </div>
              </button>
              <button
                onClick={() => void handleExport('unity')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <span className="text-base">🎯</span>
                <div>
                  <div className="font-medium">Unity</div>
                  <div className="text-xs text-gray-400">Sprite Sheet + Importer</div>
                </div>
              </button>
              <button
                onClick={() => void handleExport('cocos')}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                <span className="text-base">🔧</span>
                <div>
                  <div className="font-medium">Cocos Creator</div>
                  <div className="text-xs text-gray-400">plist + animation.json</div>
                </div>
              </button>
            </div>
          )}
        </div>
        <button
          onClick={handleNewProject}
          className="rounded-lg border border-gray-200 bg-white px-8 py-3 text-sm text-gray-700 transition-colors hover:bg-gray-50"
        >
          新项目
        </button>
      </div>
    </div>
  );
}
