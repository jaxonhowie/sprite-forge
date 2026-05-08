import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BoxSelector from '../components/BoxSelector';
import {
  createJob,
  deleteJob,
  deleteVideo,
  getJobExportUrl,
  getJobStatus,
  uploadVideo,
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
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const videoMeta = workflow.videoMeta;
  const settings = workflow.processSettings;
  const frameEntries = workflow.frameTimestamps.map((timestamp) => ({
    timestamp,
    thumb: workflow.frameThumbs[String(timestamp)],
  }));

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
      .catch(() => setError('任务状态加载失败'));
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
    if (!videoMeta || !isReady) {
      setError('视频尚未加载完成');
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
    setCaptureProgress(0);

    try {
      const thumbs: Record<string, string> = {};
      for (let index = 0; index < timestamps.length; index += 1) {
        const timestamp = timestamps[index];
        const dataUrl = await captureFrameAt(timestamp);
        if (dataUrl) {
          thumbs[String(timestamp)] = dataUrl;
        }
        setCaptureProgress(Math.round(((index + 1) / timestamps.length) * 100));
      }

      setFrameTimestamps(videoMeta.video_id, timestamps);
      updateWorkflow((current) => ({
        ...current,
        currentStep: 'frames',
        frameTimestamps: timestamps,
        frameThumbs: thumbs,
        processSettings: {
          ...current.processSettings,
          layout: {
            ...current.processSettings.layout,
            cols: current.processSettings.layoutColsTouched
              ? current.processSettings.layout.cols
              : Math.max(1, Math.min(32, timestamps.length)),
          },
        },
        jobId: undefined,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '截取关键帧失败');
    } finally {
      setIsCapturing(false);
    }
  }, [
    captureFrameAt,
    captureMode,
    frameCount,
    isReady,
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
      processSettings: {
        ...current.processSettings,
        layout: {
          ...current.processSettings.layout,
          cols: current.processSettings.layoutColsTouched
            ? current.processSettings.layout.cols
            : Math.max(1, Math.min(32, timestamps.length)),
        },
      },
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

  const handleDownloadZip = useCallback(async () => {
    if (!workflow.jobId) return;

    try {
      const response = await fetch(getJobExportUrl(workflow.jobId));
      if (!response.ok) throw new Error('下载失败');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `spritesheet_${workflow.jobId}.zip`;
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
          <h2 className="text-2xl font-bold">视频转精灵表工作台</h2>
          <p className="mt-1 text-sm text-gray-400">上传、截帧、处理和导出都在当前页面完成。</p>
        </div>
        <button
          onClick={() => void handleNewProject()}
          disabled={!videoMeta || isUploading || isCapturing || isProcessing}
          className="self-start rounded bg-gray-700 px-4 py-2 text-sm font-medium hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          新项目
        </button>
      </div>

      {error && (
        <div className="mb-6 rounded border border-red-500 bg-red-500/20 p-4 text-red-300">
          {error}
        </div>
      )}

      <div className="grid items-start justify-center gap-6 lg:grid-cols-[220px_936px]">
        <aside className="h-auto rounded-lg bg-gray-800 p-4 lg:h-[760px]">
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
                  className={`min-w-44 rounded p-3 text-left transition-colors lg:w-full ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : isDone
                        ? 'bg-gray-700 text-gray-100 hover:bg-gray-600'
                        : 'bg-gray-900 text-gray-400'
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{index + 1}. {step.label}</span>
                    {isDone && <span className="text-xs text-green-300">完成</span>}
                  </div>
                  <div className="mt-1 text-xs opacity-80">{step.description}</div>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="min-w-0 rounded-lg bg-gray-800 p-6 lg:h-[760px] lg:overflow-y-auto">
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
              <h3 className="mb-4 text-xl font-bold">上传视频</h3>
              <div
                className={`mx-auto flex h-[480px] w-full max-w-[720px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
                  isDragging
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-gray-600 hover:border-gray-500'
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
                    <div className="mb-4 text-xl">上传中...</div>
                    <div className="h-4 w-full rounded-full bg-gray-700">
                      <div
                        className="h-4 rounded-full bg-blue-500 transition-all"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <div className="mt-2 text-sm text-gray-300">{uploadProgress}%</div>
                  </div>
                ) : (
                  <div>
                    <div className="text-xl font-semibold">拖放视频文件到此处</div>
                    <div className="mt-2 text-gray-400">或点击选择文件</div>
                    <div className="mt-4 text-sm text-gray-500">支持 MP4、WebM 格式，最大 500MB</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {workflow.currentStep === 'capture' && videoMeta && (
            <div>
              <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h3 className="text-xl font-bold">自动截取关键帧</h3>
                  <p className="mt-1 text-sm text-gray-400">
                    原视频时长 {formatTime(videoMeta.duration_ms)}，尺寸 {videoMeta.width} × {videoMeta.height}
                  </p>
                </div>
                <button
                  onClick={() => void handleNewProject()}
                  disabled={isCapturing}
                  className="self-start rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600 disabled:opacity-50"
                >
                  重新上传视频
                </button>
              </div>

              <div className="grid items-start justify-center gap-6 xl:grid-cols-[632px_280px]">
                <div className="mx-auto flex h-[356px] w-full max-w-[632px] items-center justify-center overflow-hidden rounded-lg bg-gray-900">
                  <video
                    ref={videoRef}
                    src={videoMeta.url}
                    className="h-full w-full object-contain"
                    preload="auto"
                    controls
                    onError={() => setError('视频加载失败')}
                  />
                </div>

                <div className="w-full rounded bg-gray-900 p-4 xl:w-[280px]">
                  <div className="mb-4 text-sm font-semibold text-gray-200">截取方式</div>
                  <div className="mb-4 grid grid-cols-2 rounded bg-gray-800 p-1">
                    <button
                      onClick={() => setCaptureMode('count')}
                      disabled={isCapturing}
                      className={`rounded px-3 py-2 text-sm ${captureMode === 'count' ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
                    >
                      按帧数
                    </button>
                    <button
                      onClick={() => setCaptureMode('step')}
                      disabled={isCapturing}
                      className={`rounded px-3 py-2 text-sm ${captureMode === 'step' ? 'bg-blue-600' : 'hover:bg-gray-700'}`}
                    >
                      按步长
                    </button>
                  </div>

                  {captureMode === 'count' ? (
                    <label className="block">
                      <span className="mb-1 block text-sm text-gray-400">截取帧数</span>
                      <input
                        type="number"
                        min="1"
                        max="120"
                        value={frameCount}
                        disabled={isCapturing}
                        onChange={(event) => setFrameCount(Number(event.target.value) || 1)}
                        className="w-full rounded bg-gray-700 px-3 py-2"
                      />
                    </label>
                  ) : (
                    <label className="block">
                      <span className="mb-1 block text-sm text-gray-400">截取步长（毫秒）</span>
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
                        className="w-full rounded bg-gray-700 px-3 py-2"
                      />
                    </label>
                  )}

                  {isCapturing && (
                    <div className="mt-4">
                      <div className="h-3 rounded-full bg-gray-700">
                        <div
                          className="h-3 rounded-full bg-blue-500 transition-all"
                          style={{ width: `${captureProgress}%` }}
                        />
                      </div>
                      <div className="mt-2 text-sm text-gray-400">正在截取 {captureProgress}%</div>
                    </div>
                  )}

                  <button
                    onClick={() => void handleCaptureFrames()}
                    disabled={!isReady || isCapturing}
                    className="mt-6 w-full rounded bg-blue-600 px-4 py-3 font-bold hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
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
                  <h3 className="text-xl font-bold">确认关键帧</h3>
                  <p className="mt-1 text-sm text-gray-400">当前共 {workflow.frameTimestamps.length} 帧</p>
                </div>
                <div className="flex gap-3">
                  <button
                    onClick={() => updateWorkflow((current) => ({ ...current, currentStep: 'capture' }))}
                    className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600"
                  >
                    重新截取
                  </button>
                  <button
                    onClick={handleClearFrames}
                    disabled={workflow.frameTimestamps.length === 0}
                    className="rounded bg-red-600 px-4 py-2 text-sm hover:bg-red-500 disabled:opacity-50"
                  >
                    清空所有
                  </button>
                </div>
              </div>

              {frameEntries.length === 0 ? (
                <div className="rounded bg-gray-900 py-20 text-center text-gray-400">暂无关键帧</div>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {frameEntries.map(({ timestamp, thumb }, index) => (
                    <div key={timestamp} className="group relative rounded-lg bg-gray-900 p-2">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-gray-300">
                          {formatTime(timestamp)}
                        </span>
                        <button
                          onClick={() => handleDeleteFrame(timestamp)}
                          className="flex h-6 w-6 flex-none items-center justify-center rounded bg-red-600 text-xs opacity-80 transition-opacity hover:bg-red-500 group-hover:opacity-100"
                          title="删除该帧"
                        >
                          ×
                        </button>
                      </div>
                      {thumb ? (
                        <button
                          type="button"
                          onClick={() => setPreviewFrame({ src: thumb, label: `帧 ${index + 1} · ${formatTime(timestamp)}` })}
                          className="flex h-28 w-full items-center justify-center overflow-hidden rounded bg-gray-950 p-0 hover:ring-2 hover:ring-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          title="点击放大预览"
                        >
                          <img
                            src={thumb}
                            alt={`帧 ${index + 1}`}
                            className="h-full w-full object-contain"
                          />
                        </button>
                      ) : (
                        <div className="flex h-28 items-center justify-center rounded bg-gray-950 text-sm text-gray-500">预览失败</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-8 flex justify-end">
                <button
                  onClick={() => updateWorkflow((current) => ({ ...current, currentStep: 'settings' }))}
                  disabled={workflow.frameTimestamps.length === 0}
                  className="rounded bg-green-600 px-8 py-3 font-bold hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  继续处理
                </button>
              </div>
            </div>
          )}

          {workflow.currentStep === 'settings' && (
            <div>
              <h3 className="mb-6 text-xl font-bold">处理设置</h3>

              <div className="mb-6 min-w-0 rounded bg-gray-900 p-4">
                <h4 className="mb-4 font-semibold">帧预览 ({workflow.frameTimestamps.length} 帧)</h4>
                <div className="max-w-full overflow-x-auto pb-2">
                  <div className="flex w-max gap-3">
                  {workflow.frameTimestamps.map((timestamp, index) => {
                    const thumb = workflow.frameThumbs[String(timestamp)];
                    return thumb ? (
                      <button
                        key={timestamp}
                        type="button"
                        onClick={() => setPreviewFrame({ src: thumb, label: `帧 ${index + 1} · ${formatTime(timestamp)}` })}
                        className="h-28 w-20 flex-none overflow-hidden rounded bg-gray-800 p-0 hover:ring-2 hover:ring-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        title="点击放大预览"
                      >
                        <img
                          src={thumb}
                          alt={`帧 ${index + 1}`}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ) : (
                      <div key={timestamp} className="flex h-28 w-20 flex-none items-center justify-center rounded bg-gray-700 text-xs text-gray-400">
                        {Math.floor(timestamp / 1000)}s
                      </div>
                    );
                  })}
                  </div>
                </div>
              </div>

              <div className="mb-6 rounded bg-gray-900 p-6">
                <h4 className="mb-4 font-semibold">处理选项</h4>
                <div className="space-y-4">
                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.removeBg}
                      onChange={(event) => updateSettings({ ...settings, removeBg: event.target.checked })}
                      className="h-5 w-5"
                    />
                    <span>去除背景 (rembg)</span>
                  </label>

                  <label className="flex cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      checked={settings.enableWatermark}
                      onChange={(event) => updateSettings({ ...settings, enableWatermark: event.target.checked })}
                      className="h-5 w-5"
                    />
                    <span>去除水印</span>
                  </label>

                  {settings.enableWatermark && firstThumbnail && (
                    <div className="pt-2">
                      <p className="mb-2 text-sm text-gray-400">在下方图片上框选水印区域</p>
                      <BoxSelector
                        imageUrl={firstThumbnail}
                        onBoxChange={(watermarkBox) => updateSettings({ ...settings, watermarkBox })}
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-6 rounded bg-gray-900 p-6">
                <h4 className="mb-4 font-semibold">精灵表布局</h4>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-sm text-gray-400">列数</span>
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
                      className="w-full rounded bg-gray-700 px-3 py-2"
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-sm text-gray-400">间距 (px)</span>
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={settings.layout.padding}
                      onChange={(event) => updateSettings({
                        ...settings,
                        layout: { ...settings.layout, padding: parseInt(event.target.value, 10) || 0 },
                      })}
                      className="w-full rounded bg-gray-700 px-3 py-2"
                    />
                  </label>
                </div>
              </div>

              <div className="flex justify-between">
                <button
                  onClick={() => updateWorkflow((current) => ({ ...current, currentStep: 'frames' }))}
                  className="rounded bg-gray-700 px-6 py-3 hover:bg-gray-600"
                >
                  返回帧列表
                </button>
                <button
                  onClick={() => void handleStartProcess()}
                  disabled={isProcessing || workflow.frameTimestamps.length === 0}
                  className="rounded bg-green-600 px-8 py-3 text-lg font-bold hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
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
                  <h3 className="text-xl font-bold">导出结果</h3>
                  <p className="mt-1 text-sm text-gray-400">任务 ID：{workflow.jobId ?? '未创建'}</p>
                </div>
                <button
                  onClick={() => updateWorkflow((current) => ({ ...current, currentStep: 'settings' }))}
                  disabled={isProcessing}
                  className="self-start rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600 disabled:opacity-50 sm:self-auto"
                >
                  返回设置
                </button>
              </div>

              {!resultStatus || resultStatus.status !== 'done' ? (
                <div className="rounded-lg bg-gray-900 p-8 text-center">
                  {resultStatus?.status === 'failed' ? (
                    <>
                      <div className="mb-2 text-2xl font-bold text-red-400">处理失败</div>
                      <div className="text-gray-400">{resultStatus.error || '未知错误'}</div>
                    </>
                  ) : (
                    <>
                      <div className="mb-6 text-2xl font-bold">正在处理...</div>
                      <div className="mx-auto mb-4 h-6 max-w-xl rounded-full bg-gray-700">
                        <div
                          className="h-6 rounded-full bg-blue-500 transition-all"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                      <div className="text-lg text-gray-300">
                        {stageLabels[resultStatus?.stage ?? ''] || resultStatus?.stage || '等待任务'} - {progressPercent}%
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <>
                  <div className="mb-8 rounded-lg bg-gray-900 p-6">
                    <h4 className="mb-4 font-semibold">精灵表预览</h4>
                    {resultStatus.result?.spritesheet_url && (
                      <div className="max-h-[60vh] overflow-auto rounded bg-gray-950">
                        <img
                          src={resultStatus.result.spritesheet_url}
                          alt="精灵表"
                          className="h-auto max-w-full"
                        />
                      </div>
                    )}
                  </div>

                  <div className="mb-8 rounded-lg bg-gray-900 p-6">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <h4 className="font-semibold">逐帧播放</h4>
                      <button
                        onClick={() => setIsPlayingFrames((current) => !current)}
                        disabled={!playingFrameUrl}
                        className="rounded bg-gray-700 px-4 py-2 text-sm hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isPlayingFrames ? '暂停播放' : '逐帧播放'}
                      </button>
                    </div>
                    <div className="flex h-64 items-center justify-center rounded bg-gray-950">
                      {playingFrameUrl ? (
                        <img
                          src={playingFrameUrl}
                          alt="处理后逐帧播放预览"
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <div className="text-sm text-gray-500">暂无处理后帧，请重新开始处理生成逐帧预览</div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col justify-center gap-4 sm:flex-row">
                    <button
                      onClick={() => {
                        if (resultStatus.result?.spritesheet_url) {
                          window.open(resultStatus.result.spritesheet_url, '_blank');
                        }
                      }}
                      className="rounded bg-blue-600 px-8 py-3 font-bold hover:bg-blue-500"
                    >
                      下载 PNG
                    </button>
                    <button
                      onClick={() => void handleDownloadZip()}
                      className="rounded bg-green-600 px-8 py-3 font-bold hover:bg-green-500"
                    >
                      下载 ZIP (PNG + JSON)
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {previewFrame && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
          onClick={() => setPreviewFrame(null)}
        >
          <div
            className="max-h-full max-w-4xl rounded-lg bg-gray-900 p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="text-sm font-medium text-gray-200">{previewFrame.label}</div>
              <button
                onClick={() => setPreviewFrame(null)}
                className="rounded bg-gray-700 px-3 py-1 text-sm hover:bg-gray-600"
              >
                关闭
              </button>
            </div>
            <div className="flex max-h-[78vh] items-center justify-center overflow-auto rounded bg-gray-950">
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
