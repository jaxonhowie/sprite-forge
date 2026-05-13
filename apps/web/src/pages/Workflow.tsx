import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BoxSelector from '../components/BoxSelector';
import {
  ApiError,
  createJob,
  deleteJob,
  deleteVideo,
  extractVideoFrames,
  getJobExportUrl,
  getJobStatus,
  uploadVideo,
  type EngineExportTarget,
  type JobStatus,
  type VideoMeta,
} from '../api/client';
import useVideoFrame from '../hooks/useVideoFrame';
import {
  clearWorkflow,
  createInitialWorkflowState,
  getWorkflowState,
  setFrameTimestamps,
  setWorkflowState,
  type WorkflowSettings,
  type WorkflowState,
  type WorkflowStep,
} from '../utils/workflowState';

type CaptureMode = 'count' | 'step';
type EnginePackageTarget = Exclude<EngineExportTarget, 'generic'>;

const engineExportOptions: Array<{ target: EnginePackageTarget; label: string; button: string }> = [
  { target: 'cocos', label: 'Cocos Creator', button: '下载 Cocos Creator 包' },
  { target: 'unity', label: 'Unity3D', button: '下载 Unity3D 包' },
];

interface StepItem {
  id: WorkflowStep;
  label: string;
  description: string;
}

const steps: StepItem[] = [
  { id: 'upload', label: '上传视频', description: '选择 MP4 或 WebM 文件' },
  { id: 'capture', label: '自动截帧', description: '按帧数或步长生成关键帧' },
  { id: 'frames', label: '确认帧列表', description: '删除不需要的关键帧' },
  { id: 'settings', label: '处理设置', description: '配置去背景、水印和布局' },
  { id: 'result', label: '导出结果', description: '查看并下载精灵表' },
];

const stageLabels: Record<string, string> = {
  extract: '截帧',
  inpaint: '去水印',
  light: '统一灯光',
  rembg: '去背景',
  pack: '打包精灵表',
  done: '完成',
};

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  const millis = Math.floor(ms % 1000);
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`;
}

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
    return Array.from({ length: count }, (_, index) => Math.round((durationMs * index) / (count - 1)));
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
    .map((timestamp) => Math.max(0, Math.min(durationMs, Math.round(timestamp))))
    .filter((timestamp) => {
      if (seen.has(timestamp)) return false;
      seen.add(timestamp);
      return true;
    })
    .sort((a, b) => a - b);
}

function asVideoMeta(response: VideoMeta): VideoMeta {
  return {
    video_id: response.video_id,
    duration_ms: response.duration_ms,
    fps: response.fps,
    width: response.width,
    height: response.height,
    url: response.url,
  };
}

export default function Workflow() {
  const [workflow, setWorkflow] = useState<WorkflowState>(() => getWorkflowState() ?? createInitialWorkflowState());
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>('count');
  const [frameCount, setFrameCount] = useState(12);
  const [stepMs, setStepMs] = useState(100);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isRestoringThumbs, setIsRestoringThumbs] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [previewFrame, setPreviewFrame] = useState<{ src: string; label: string } | null>(null);
  const [isPlayingFrames, setIsPlayingFrames] = useState(false);
  const [playingFrameIndex, setPlayingFrameIndex] = useState(0);
  const [engineExportTarget, setEngineExportTarget] = useState<EnginePackageTarget>('cocos');
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const videoMeta = workflow.videoMeta;
  const settings = workflow.processSettings;
  const frameEntries = workflow.frameTimestamps.map((timestamp) => ({
    timestamp,
    thumb: workflow.frameThumbs[String(timestamp)],
  }));
  const selectedExportOption =
    engineExportOptions.find((option) => option.target === engineExportTarget) ?? engineExportOptions[0];

  const {
    videoRef,
    canvasRef,
    isReady,
    captureFrameAt,
  } = useVideoFrame({
    videoSrc: videoMeta?.url ?? '',
    metadataDurationMs: videoMeta?.duration_ms ?? 0,
  });

  const updateWorkflow = useCallback((updater: (current: WorkflowState) => WorkflowState) => {
    setWorkflow((current) => updater(current));
  }, []);

  useEffect(() => {
    setWorkflowState(workflow);
  }, [workflow]);

  useEffect(() => {
    if (!videoMeta || !isReady || isCapturing || isRestoringThumbs) return;
    if (!['frames', 'settings', 'result'].includes(workflow.currentStep)) return;
    if (workflow.frameTimestamps.length === 0) return;

    const missingTimestamps = workflow.frameTimestamps.filter(
      (timestamp) => !workflow.frameThumbs[String(timestamp)]
    );
    if (missingTimestamps.length === 0) return;

    let cancelled = false;
    setIsRestoringThumbs(true);

    void (async () => {
      const restoredThumbs: Record<string, string> = {};
      for (const timestamp of missingTimestamps) {
        if (cancelled) return;
        const dataUrl = await captureFrameAt(timestamp);
        if (dataUrl) {
          restoredThumbs[String(timestamp)] = dataUrl;
        }
      }

      if (!cancelled) {
        updateWorkflow((current) => ({
          ...current,
          frameThumbs: {
            ...current.frameThumbs,
            ...restoredThumbs,
          },
        }));
      }
    })()
      .catch(() => {
        if (!cancelled) setError('关键帧预览恢复失败');
      })
      .finally(() => {
        if (!cancelled) setIsRestoringThumbs(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    captureFrameAt,
    isCapturing,
    isReady,
    isRestoringThumbs,
    updateWorkflow,
    videoMeta,
    workflow.currentStep,
    workflow.frameThumbs,
    workflow.frameTimestamps,
  ]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const frameCount = jobStatus?.result?.frame_urls?.length ?? 0;
    if (!isPlayingFrames || frameCount === 0) return;

    const timer = window.setInterval(() => {
      setPlayingFrameIndex((current) => (current + 1) % frameCount);
    }, 160);

    return () => window.clearInterval(timer);
  }, [isPlayingFrames, jobStatus?.result?.frame_urls?.length]);

  const resetJob = useCallback((jobId?: string) => {
    if (jobId) {
      void deleteJob(jobId).catch(() => undefined);
    }
    setJobStatus(null);
    setIsProcessing(false);
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const openJobSocket = useCallback((jobId: string) => {
    wsRef.current?.close();

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/jobs/${jobId}`);
    wsRef.current = ws;
    setIsProcessing(true);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setJobStatus((current) => ({
        id: jobId,
        video_id: workflow.videoMeta?.video_id ?? current?.video_id ?? '',
        status: data.status ?? current?.status ?? 'running',
        progress: data.progress ?? current?.progress ?? 0,
        stage: data.stage ?? current?.stage ?? '',
        params: current?.params ?? {
          video_id: workflow.videoMeta?.video_id ?? '',
          timestamps_ms: workflow.frameTimestamps,
          remove_bg: settings.removeBg,
          remove_bg_mode: settings.removeBgMode,
          watermark_box: settings.enableWatermark ? settings.watermarkBox : null,
          layout: settings.layout,
        },
        error: data.error ?? current?.error ?? null,
        created_at: current?.created_at ?? new Date().toISOString(),
        finished_at: current?.finished_at ?? null,
        result: current?.result,
      }));

      if (data.status === 'done') {
        ws.close();
        wsRef.current = null;
        setIsProcessing(false);
        void getJobStatus(jobId).then(setJobStatus).catch(() => undefined);
      } else if (data.status === 'failed') {
        ws.close();
        wsRef.current = null;
        setIsProcessing(false);
      }
    };

    ws.onerror = () => {
      if (wsRef.current === ws) {
        setError('WebSocket 连接失败');
      }
      setIsProcessing(false);
    };
  }, [settings, workflow.frameTimestamps, workflow.videoMeta?.video_id]);

  useEffect(() => {
    if (!workflow.jobId || workflow.currentStep !== 'result') return;

    getJobStatus(workflow.jobId)
      .then((status) => {
        setJobStatus(status);
        if (
          status.status !== 'done' &&
          status.status !== 'failed' &&
          !isProcessing &&
          !wsRef.current
        ) {
          openJobSocket(workflow.jobId as string);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) {
          updateWorkflow((current) => ({
            ...current,
            currentStep: 'settings',
            jobId: undefined,
          }));
          setJobStatus(null);
          setIsProcessing(false);
          return;
        }

        setError('任务状态加载失败');
      });
  }, [isProcessing, openJobSocket, workflow.currentStep, workflow.jobId]);

  const canOpenStep = useCallback((step: WorkflowStep) => {
    if (step === 'upload') return true;
    if (!videoMeta) return false;
    if (step === 'capture') return true;
    if (step === 'frames') return workflow.frameTimestamps.length > 0;
    if (step === 'settings') return workflow.frameTimestamps.length > 0;
    return Boolean(workflow.jobId);
  }, [videoMeta, workflow.frameTimestamps.length, workflow.jobId]);

  const handleStepClick = useCallback((step: WorkflowStep) => {
    if (!canOpenStep(step) || isUploading || isCapturing || isProcessing) return;
    updateWorkflow((current) => ({ ...current, currentStep: step }));
  }, [canOpenStep, isCapturing, isProcessing, isUploading, updateWorkflow]);

  const resetDownstreamFromCapture = useCallback(() => {
    resetJob(workflow.jobId);
    setJobStatus(null);
  }, [resetJob, workflow.jobId]);

  const handleUpload = useCallback(async (file: File) => {
    if (!file.type.match(/^video\/(mp4|webm)$/)) {
      setError('只支持 MP4 和 WebM 格式');
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      setError('文件大小不能超过 500MB');
      return;
    }

    const oldVideoId = workflow.videoMeta?.video_id;
    if (oldVideoId) {
      void deleteVideo(oldVideoId).catch(() => undefined);
    }

    wsRef.current?.close();
    setError(null);
    setIsUploading(true);
    setUploadProgress(0);
    setJobStatus(null);

    try {
      const response = await uploadVideo(file, setUploadProgress);
      const meta = asVideoMeta(response);
      clearWorkflow(oldVideoId);
      setWorkflow({
        ...createInitialWorkflowState(),
        currentStep: 'capture',
        videoMeta: meta,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setIsUploading(false);
    }
  }, [workflow.videoMeta?.video_id]);

  const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleUpload(file);
    }
    event.target.value = '';
  }, [handleUpload]);

  const handleDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) {
      void handleUpload(file);
    }
  }, [handleUpload]);

  const handleCaptureFrames = useCallback(async () => {
    if (!videoMeta) {
      setError('请先上传视频');
      return;
    }

    const timestamps = uniqueSortedTimestamps(
      generateFrameTimestamps(videoMeta.duration_ms, captureMode, frameCount, stepMs),
      videoMeta.duration_ms
    );

    if (timestamps.length === 0) {
      setError('没有可截取的时间点');
      return;
    }

    resetDownstreamFromCapture();
    setError(null);
    setIsCapturing(true);
    setCaptureProgress(5);

    try {
      const response = await extractVideoFrames(videoMeta.video_id, timestamps);
      setCaptureProgress(100);

      const thumbs = response.frames.reduce<Record<string, string>>((result, frame) => {
        result[String(frame.ts_ms)] = frame.url;
        return result;
      }, {});

      setFrameTimestamps(videoMeta.video_id, timestamps);
      updateWorkflow((current) => ({
        ...current,
        currentStep: 'frames',
        frameTimestamps: timestamps,
        frameThumbs: thumbs,
        jobId: undefined,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '截取关键帧失败');
    } finally {
      setIsCapturing(false);
    }
  }, [
    captureMode,
    frameCount,
    resetDownstreamFromCapture,
    stepMs,
    updateWorkflow,
    videoMeta,
  ]);

  const updateFrames = useCallback((timestamps: number[], thumbs: Record<string, string>) => {
    if (videoMeta) {
      setFrameTimestamps(videoMeta.video_id, timestamps);
    }
    resetJob(workflow.jobId);
    updateWorkflow((current) => ({
      ...current,
      frameTimestamps: timestamps,
      frameThumbs: thumbs,
      jobId: undefined,
    }));
  }, [resetJob, updateWorkflow, videoMeta, workflow.jobId]);

  const handleDeleteFrame = useCallback((timestamp: number) => {
    const timestamps = workflow.frameTimestamps.filter((item) => item !== timestamp);
    const thumbs = { ...workflow.frameThumbs };
    delete thumbs[String(timestamp)];
    updateFrames(timestamps, thumbs);
  }, [updateFrames, workflow.frameThumbs, workflow.frameTimestamps]);

  const handleClearFrames = useCallback(() => {
    updateFrames([], {});
  }, [updateFrames]);

  const updateSettings = useCallback((nextSettings: WorkflowSettings) => {
    updateWorkflow((current) => ({
      ...current,
      processSettings: nextSettings,
    }));
  }, [updateWorkflow]);

  const handleStartProcess = useCallback(async () => {
    if (!videoMeta) {
      setError('请先上传视频');
      return;
    }

    if (workflow.frameTimestamps.length === 0) {
      setError('请先截取关键帧');
      return;
    }

    setError(null);
    setIsProcessing(true);

    try {
      if (workflow.jobId) {
        await deleteJob(workflow.jobId).catch(() => undefined);
        setJobStatus(null);
      }

      const response = await createJob({
        video_id: videoMeta.video_id,
        timestamps_ms: workflow.frameTimestamps,
        remove_bg: settings.removeBg,
        remove_bg_mode: settings.removeBgMode,
        watermark_box: settings.enableWatermark ? settings.watermarkBox : null,
        layout: settings.layout,
      });

      updateWorkflow((current) => ({
        ...current,
        currentStep: 'result',
        jobId: response.job_id,
      }));
      setPlayingFrameIndex(0);
      setIsPlayingFrames(false);
      openJobSocket(response.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建任务失败');
      setIsProcessing(false);
    }
  }, [openJobSocket, settings, updateWorkflow, videoMeta, workflow.frameTimestamps]);

  const handleDownloadZip = useCallback(async (target: EngineExportTarget) => {
    if (!workflow.jobId) return;

    try {
      const response = await fetch(getJobExportUrl(workflow.jobId, target));
      if (!response.ok) throw new Error('下载失败');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spritesheet_${workflow.jobId}_${target}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败');
    }
  }, [workflow.jobId]);

  const handleNewProject = useCallback(async () => {
    wsRef.current?.close();
    wsRef.current = null;
    const videoId = workflow.videoMeta?.video_id;
    if (videoId) {
      try {
        await deleteVideo(videoId);
      } catch {
        // The upload may already be gone.
      }
    }
    clearWorkflow(videoId);
    setJobStatus(null);
    setWorkflow(createInitialWorkflowState());
    setError(null);
    setUploadProgress(0);
    setCaptureProgress(0);
    setIsProcessing(false);
    setIsPlayingFrames(false);
    setPlayingFrameIndex(0);
  }, [workflow.videoMeta?.video_id]);

  const firstThumbnail = workflow.frameTimestamps.length > 0
    ? workflow.frameThumbs[String(workflow.frameTimestamps[0])]
    : undefined;

  const resultStatus = jobStatus;
  const progressPercent = Math.round((resultStatus?.progress ?? 0) * 100);
  const processedFrameUrls = resultStatus?.result?.frame_urls ?? [];
  const playingFrameUrl = processedFrameUrls[playingFrameIndex] ?? processedFrameUrls[0];
  const activeStepIndex = useMemo(
    () => steps.findIndex((step) => step.id === workflow.currentStep),
    [workflow.currentStep]
  );

  return (
    <div className="mx-auto w-full">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">视频转精灵表工作台</h2>
          <p className="mt-1 text-sm text-gray-500">上传、截帧、处理和导出都在当前页面完成。</p>
        </div>
        <button
          onClick={() => void handleNewProject()}
          disabled={!videoMeta || isUploading || isCapturing || isProcessing}
          className="self-start rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          新项目
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="grid items-start justify-center gap-6 lg:grid-cols-[220px_936px]">
        <aside className="h-auto rounded-xl border border-gray-200 bg-white p-4 lg:h-[760px]">
          <div className="flex gap-2 overflow-x-auto lg:block lg:space-y-2">
            {steps.map((step, index) => {
              const isActive = step.id === workflow.currentStep;
              const isDone = index < activeStepIndex;
              const isEnabled = canOpenStep(step.id);

              return (
                <button
                  key={step.id}
                  onClick={() => handleStepClick(step.id)}
                  disabled={!isEnabled || isUploading || isCapturing || isProcessing}
                  className={`min-w-44 rounded-lg p-3 text-left transition-all lg:w-full ${
                    isActive
                      ? 'bg-gray-900 text-white shadow-sm'
                      : isDone
                        ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        : 'bg-gray-50 text-gray-400'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{index + 1}. {step.label}</span>
                    {isDone && <span className="text-xs text-green-600">完成</span>}
                  </div>
                  <div className="mt-1 text-xs opacity-70">{step.description}</div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0 rounded-xl border border-gray-200 bg-white p-6 lg:h-[760px] lg:overflow-y-auto">
          {videoMeta && workflow.currentStep !== 'capture' && (
            <>
              <video
                ref={videoRef}
                src={videoMeta.url}
                preload="auto"
                className="hidden"
              />
              <canvas ref={canvasRef} className="hidden" />
            </>
          )}

          {workflow.currentStep === 'upload' && (
            <div>
              <h3 className="mb-4 text-xl font-bold text-gray-900">上传视频</h3>
              <div
                className={`mx-auto flex h-[480px] w-full max-w-[720px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                  isDragging
                    ? 'border-gray-900 bg-gray-50'
                    : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                }`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={(event) => {
                  event.preventDefault();
                  setIsDragging(false);
                }}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/mp4,video/webm"
                  className="hidden"
                  disabled={isUploading}
                  onChange={handleFileSelect}
                />

                {isUploading ? (
                  <div>
                    <div className="mb-4 text-xl text-gray-700">上传中...</div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                      <div
                        className="h-full rounded-full bg-gray-900 transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <div className="mt-2 text-sm text-gray-500">{uploadProgress}%</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-xl font-semibold text-gray-700">拖放视频文件到此处</div>
                    <div className="mt-2 text-gray-400">或点击选择文件</div>
                    <div className="mt-4 text-sm text-gray-400">支持 MP4、WebM 格式，最大 500MB</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {workflow.currentStep === 'capture' && videoMeta && (
            <div>
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">自动截取关键帧</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    原视频时长 {formatTime(videoMeta.duration_ms)}，尺寸 {videoMeta.width} × {videoMeta.height}
                  </p>
                </div>
                <button
                  onClick={() => void handleNewProject()}
                  disabled={isCapturing}
                  className="self-start rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50"
                >
                  重新上传视频
                </button>
              </div>

              <div className="grid items-start justify-center gap-6 xl:grid-cols-[632px_280px]">
                <div className="mx-auto flex h-[356px] w-full max-w-[632px] items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
                  <video
                    ref={videoRef}
                    src={videoMeta.url}
                    className="h-full w-full object-contain"
                    preload="auto"
                    controls
                    onError={() => setError('视频加载失败')}
                  />
                </div>

                <div className="w-full rounded-xl border border-gray-200 bg-gray-50 p-4 xl:w-[280px]">
                  <div className="mb-4 text-sm font-semibold text-gray-700">截取方式</div>
                  <div className="mb-4 grid grid-cols-2 rounded-lg border border-gray-200 bg-white p-1">
                    <button
                      onClick={() => setCaptureMode('count')}
                      disabled={isCapturing}
                      className={`rounded-md px-3 py-2 text-sm transition-colors ${captureMode === 'count' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                      按帧数
                    </button>
                    <button
                      onClick={() => setCaptureMode('step')}
                      disabled={isCapturing}
                      className={`rounded-md px-3 py-2 text-sm transition-colors ${captureMode === 'step' ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
                    >
                      按步长
                    </button>
                  </div>

                  {captureMode === 'count' ? (
                    <label className="block">
                      <span className="mb-1 block text-sm text-gray-500">截取帧数</span>
                      <input
                        type="number"
                        min="1"
                        max="120"
                        value={frameCount}
                        disabled={isCapturing}
                        onChange={(event) => setFrameCount(Number(event.target.value) || 1)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                      />
                    </label>
                  ) : (
                    <label className="block">
                      <span className="mb-1 block text-sm text-gray-500">截取步长（毫秒）</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={stepMs}
                        disabled={isCapturing}
                        onChange={(event) => {
                          const value = Math.floor(Number(event.target.value));
                          setStepMs(Number.isFinite(value) && value > 0 ? value : 1);
                        }}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                      />
                    </label>
                  )}

                  {isCapturing && (
                    <div className="mt-4">
                      <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="h-full rounded-full bg-gray-900 transition-all"
                          style={{ width: `${captureProgress}%` }}
                        />
                      </div>
                      <div className="mt-2 text-sm text-gray-500">正在截取 {captureProgress}%</div>
                    </div>
                  )}

                  <button
                    onClick={() => void handleCaptureFrames()}
                    disabled={!videoMeta || isCapturing}
                    className="mt-6 w-full rounded-lg bg-gray-900 px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    截取关键帧
                  </button>
                </div>
              </div>

              <canvas ref={canvasRef} className="hidden" />
            </div>
          )}

          {workflow.currentStep === 'frames' && (
            <div>
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">确认关键帧</h3>
                  <p className="mt-1 text-sm text-gray-500">当前共 {workflow.frameTimestamps.length} 帧</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => updateWorkflow((current) => ({ ...current, currentStep: 'capture' }))}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                  >
                    重新截取
                  </button>
                  <button
                    onClick={handleClearFrames}
                    disabled={workflow.frameTimestamps.length === 0}
                    className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50"
                  >
                    清空所有
                  </button>
                </div>
              </div>

              {frameEntries.length === 0 ? (
                <div className="rounded-xl border border-gray-200 bg-gray-50 py-20 text-center text-gray-400">暂无关键帧</div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {frameEntries.map(({ timestamp, thumb }, index) => (
                    <div key={timestamp} className="group relative rounded-xl border border-gray-200 bg-white p-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-gray-500">
                          {formatTime(timestamp)}
                        </span>
                        <button
                          onClick={() => handleDeleteFrame(timestamp)}
                          className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-xs text-red-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                          title="删除该帧"
                        >
                          &times;
                        </button>
                      </div>
                      {thumb ? (
                        <button
                          type="button"
                          onClick={() => setPreviewFrame({ src: thumb, label: `帧 ${index + 1} · ${formatTime(timestamp)}` })}
                          className="flex h-28 w-full items-center justify-center overflow-hidden rounded-lg bg-gray-50 p-0 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gray-900"
                          title="点击放大预览"
                        >
                          <img
                            src={thumb}
                            alt={`帧 ${index + 1}`}
                            className="h-full w-full object-contain"
                          />
                        </button>
                      ) : (
                        <div className="flex h-28 items-center justify-center rounded-lg bg-gray-50 text-sm text-gray-400">预览失败</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-8 flex justify-end">
                <button
                  onClick={() => updateWorkflow((current) => ({ ...current, currentStep: 'settings' }))}
                  disabled={workflow.frameTimestamps.length === 0}
                  className="rounded-lg bg-gray-900 px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  继续处理
                </button>
              </div>
            </div>
          )}

          {workflow.currentStep === 'settings' && (
            <div>
              <h3 className="mb-6 text-xl font-bold text-gray-900">处理设置</h3>

              <div className="mb-6 min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-4">
                <h4 className="mb-4 font-semibold text-gray-900">帧预览 ({workflow.frameTimestamps.length} 帧)</h4>
                <div className="max-w-full overflow-x-auto pb-2">
                  <div className="flex w-max gap-3">
                  {workflow.frameTimestamps.map((timestamp, index) => {
                    const thumb = workflow.frameThumbs[String(timestamp)];
                    return thumb ? (
                      <button
                        key={timestamp}
                        type="button"
                        onClick={() => setPreviewFrame({ src: thumb, label: `帧 ${index + 1} · ${formatTime(timestamp)}` })}
                        className="h-28 w-20 flex-none overflow-hidden rounded-lg border border-gray-200 bg-white p-0 transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-gray-900"
                        title="点击放大预览"
                      >
                        <img
                          src={thumb}
                          alt={`帧 ${index + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ) : (
                      <div key={timestamp} className="flex h-28 w-20 flex-none items-center justify-center rounded-lg border border-gray-200 bg-white text-xs text-gray-400">
                        {Math.floor(timestamp / 1000)}s
                      </div>
                    );
                  })}
                  </div>
                </div>
              </div>

              <div className="mb-6 rounded-xl border border-gray-200 p-6">
                <h4 className="mb-4 font-semibold text-gray-900">处理选项</h4>
                <div className="space-y-4">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.removeBg}
                      onChange={(event) => updateSettings({ ...settings, removeBg: event.target.checked })}
                      className="h-5 w-5 rounded border-gray-300"
                    />
                    <span className="text-gray-700">去除背景</span>
                  </label>

                  {settings.removeBg && (
                    <div className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="mb-3 text-sm font-medium text-gray-700">去背景模式</div>
                      <div className="space-y-3">
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="radio"
                            name="workflow-remove-bg-mode"
                            checked={settings.removeBgMode === 'standard'}
                            onChange={() => updateSettings({ ...settings, removeBgMode: 'standard' })}
                            className="mt-0.5 h-4 w-4 border-gray-300"
                          />
                          <span className="text-sm text-gray-600">
                            标准：边缘更干净，适合普通角色和道具。
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="radio"
                            name="workflow-remove-bg-mode"
                            checked={settings.removeBgMode === 'conservative'}
                            onChange={() => updateSettings({ ...settings, removeBgMode: 'conservative' })}
                            className="mt-0.5 h-4 w-4 border-gray-300"
                          />
                          <span className="text-sm text-gray-600">
                            保守：输出更宽松的透明边缘，优先保留弧光、残影和发光特效。
                          </span>
                        </label>
                        <label className="flex cursor-pointer items-start gap-3">
                          <input
                            type="radio"
                            name="workflow-remove-bg-mode"
                            checked={settings.removeBgMode === 'white'}
                            onChange={() => updateSettings({ ...settings, removeBgMode: 'white' })}
                            className="mt-0.5 h-4 w-4 border-gray-300"
                          />
                          <span className="text-sm text-gray-600">
                            单一背景：仅去除纯白或近纯白背景，尽量保留彩色发光和特效边缘。
                          </span>
                        </label>
                      </div>
                    </div>
                  )}

                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.enableWatermark}
                      onChange={(event) => updateSettings({ ...settings, enableWatermark: event.target.checked })}
                      className="h-5 w-5 rounded border-gray-300"
                    />
                    <span className="text-gray-700">去除水印</span>
                  </label>

                  {settings.enableWatermark && firstThumbnail && (
                    <div className="pt-2">
                      <p className="mb-2 text-sm text-gray-500">在下方图片上框选水印区域</p>
                      <BoxSelector
                        imageUrl={firstThumbnail}
                        onBoxChange={(watermarkBox) => updateSettings({ ...settings, watermarkBox })}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-6 rounded-xl border border-gray-200 p-6">
                <h4 className="mb-4 font-semibold text-gray-900">精灵表布局</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-sm text-gray-500">列数</span>
                    <input
                      type="number"
                      min="1"
                      max="32"
                      value={settings.layout.cols}
                      onChange={(event) => updateSettings({
                        ...settings,
                        layoutColsTouched: true,
                        layout: { ...settings.layout, cols: parseInt(event.target.value, 10) || 1 },
                      })}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-sm text-gray-500">间距 (px)</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={settings.layout.padding}
                      onChange={(event) => updateSettings({
                        ...settings,
                        layout: { ...settings.layout, padding: parseInt(event.target.value, 10) || 0 },
                      })}
                      className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                    />
                  </label>
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => updateWorkflow((current) => ({ ...current, currentStep: 'frames' }))}
                  className="rounded-lg border border-gray-200 bg-white px-6 py-3 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                >
                  返回帧列表
                </button>
                <button
                  onClick={() => void handleStartProcess()}
                  disabled={isProcessing || workflow.frameTimestamps.length === 0}
                  className="rounded-lg bg-gray-900 px-8 py-3 text-base font-bold text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  开始处理
                </button>
              </div>
            </div>
          )}

          {workflow.currentStep === 'result' && (
            <div>
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">导出结果</h3>
                  <p className="mt-1 text-sm text-gray-500">任务 ID：{workflow.jobId ?? '未创建'}</p>
                </div>
                <button
                  onClick={() => updateWorkflow((current) => ({ ...current, currentStep: 'settings' }))}
                  disabled={isProcessing}
                  className="self-start rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 sm:self-auto"
                >
                  返回设置
                </button>
              </div>

              {!resultStatus || resultStatus.status !== 'done' ? (
                <div className="rounded-xl border border-gray-200 p-8 text-center">
                  {resultStatus?.status === 'failed' ? (
                    <>
                      <div className="mb-2 text-2xl font-bold text-red-500">处理失败</div>
                      <div className="text-gray-500">{resultStatus.error || '未知错误'}</div>
                    </>
                  ) : (
                    <>
                      <div className="mb-6 text-2xl font-bold text-gray-900">正在处理...</div>
                      <div className="mx-auto mb-4 h-3 max-w-xl overflow-hidden rounded-full bg-gray-200">
                        <div
                          className="h-full rounded-full bg-gray-900 transition-all"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="text-base text-gray-600">
                        {stageLabels[resultStatus?.stage ?? ''] || resultStatus?.stage || '等待任务'} - {progressPercent}%
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-8 rounded-xl border border-gray-200 p-6">
                    <h4 className="mb-4 font-semibold text-gray-900">精灵表预览</h4>
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
                    ) : resultStatus.result?.spritesheet_url ? (
                      <div className="transparent-preview-bg max-h-[60vh] overflow-auto rounded-lg border border-gray-100">
                        <img
                          src={resultStatus.result.spritesheet_url}
                          alt="精灵表"
                          className="h-auto max-w-full"
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="mb-8 rounded-xl border border-gray-200 p-6">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <h4 className="font-semibold text-gray-900">逐帧播放</h4>
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

                  <div className="rounded-xl border border-gray-200 p-6">
                    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto_auto] lg:items-end">
                      <label className="block">
                        <span className="mb-2 block text-sm font-semibold text-gray-700">导出到引擎</span>
                        <select
                          value={engineExportTarget}
                          onChange={(event) => setEngineExportTarget(event.target.value as EnginePackageTarget)}
                          className="w-full rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                        >
                          {engineExportOptions.map((option) => (
                            <option key={option.target} value={option.target}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        onClick={() => {
                          if (resultStatus.result?.spritesheet_url) {
                            window.open(resultStatus.result.spritesheet_url, '_blank');
                          }
                        }}
                        className="rounded-lg bg-gray-900 px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-gray-800"
                      >
                        下载 PNG
                      </button>
                      <button
                        onClick={() => void handleDownloadZip(engineExportTarget)}
                        className="rounded-lg border border-gray-200 bg-white px-8 py-3 text-sm font-bold text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        {selectedExportOption.button}
                      </button>
                      <button
                        onClick={() => void handleDownloadZip('generic')}
                        className="rounded-lg border border-gray-200 bg-white px-8 py-3 text-sm text-gray-700 transition-colors hover:bg-gray-50"
                      >
                        下载通用 ZIP
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {previewFrame && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
          onClick={() => setPreviewFrame(null)}
        >
          <div
            className="max-h-full max-w-4xl rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="text-sm font-medium text-gray-700">{previewFrame.label}</div>
              <button
                onClick={() => setPreviewFrame(null)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 transition-colors hover:bg-gray-50"
              >
                关闭
              </button>
            </div>
            <div className="flex max-h-[78vh] items-center justify-center overflow-auto rounded-xl bg-gray-50">
              <img
                src={previewFrame.src}
                alt={previewFrame.label}
                className="h-auto max-h-[78vh] max-w-full"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
