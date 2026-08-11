import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import BoxSelector from '../components/BoxSelector';
import PageShell from '../components/PageShell';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Icon from '../components/ui/Icon';
import Input from '../components/ui/Input';
import ProgressBar from '../components/ui/ProgressBar';
import Steps from '../components/ui/Steps';
import { createJob, deleteVideo, getVideoMeta, type WsJobUpdate } from '../api/client';
import useVideoFrame from '../hooks/useVideoFrame';
import { videoStageLabels as stageLabels } from '../utils/stageLabels';
import {
  clearWorkflow,
  createWorkflowRouteState,
  getFrameTimestamps,
  getWorkflowState,
  mergeWorkflowState,
  type WorkflowRouteState,
} from '../utils/workflowState';

interface WatermarkBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  cols: number;
  padding: number;
}

type RemoveBgMode = 'standard' | 'conservative' | 'white';

export default function Process() {
  const { videoId } = useParams<{ videoId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const [workflowState] = useState(() => getWorkflowState());

  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
  const [videoUrl, setVideoUrl] = useState('');
  const [metadataDuration, setMetadataDuration] = useState(0);
  const [videoFps, setVideoFps] = useState(30);
  const [removeBg, setRemoveBg] = useState(() => workflowState?.processSettings.removeBg ?? true);
  const [removeBgMode, setRemoveBgMode] = useState<RemoveBgMode>(() => workflowState?.processSettings.removeBgMode ?? 'standard');
  const [enableWatermark, setEnableWatermark] = useState(() => workflowState?.processSettings.enableWatermark ?? false);
  const [watermarkBox, setWatermarkBox] = useState<WatermarkBox | null>(() => workflowState?.processSettings.watermarkBox ?? null);
  const [layout, setLayout] = useState<Layout>(() => workflowState?.processSettings.layout ?? { cols: 4, padding: 2 });
  const [, setColsTouched] = useState(() => workflowState?.processSettings.layoutColsTouched ?? false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const settledRef = useRef(false);
  const locationState = location.state as WorkflowRouteState | null;
  const seededMeta = locationState?.videoMeta ?? workflowState?.videoMeta;
  const seededTimestamps = locationState?.frameTimestamps ?? workflowState?.frameTimestamps;
  const resolvedVideoId = videoId ?? seededMeta?.video_id;

  const { videoRef, canvasRef, isReady, captureFrameAt } = useVideoFrame({
    videoSrc: videoUrl,
    metadataDurationMs: metadataDuration,
    fps: videoFps,
  });

  useEffect(() => {
    let active = true;

    if (!resolvedVideoId) {
      setError('缺少视频信息，请重新返回上一页');
      setLoading(false);
      return () => {
        active = false;
      };
    }

    const stored =
      (workflowState?.videoMeta?.video_id === resolvedVideoId ? workflowState.frameTimestamps : null) ??
      seededTimestamps ??
      getFrameTimestamps(resolvedVideoId);

    if (!stored || stored.length === 0) {
      setError('未找到帧数据，请返回重新截取');
      setLoading(false);
    }

    setTimestamps(stored ?? []);

    const applyMeta = (meta: { url: string; duration_ms: number; fps?: number }) => {
      if (!active) return;
      setVideoUrl(meta.url);
      setMetadataDuration(meta.duration_ms);
      if (meta.fps) setVideoFps(meta.fps);
      mergeWorkflowState({
        currentStep: 'settings',
        videoMeta: seededMeta?.video_id === resolvedVideoId ? seededMeta : workflowState?.videoMeta,
        frameTimestamps: stored ?? [],
      });
    };

    if (seededMeta?.video_id === resolvedVideoId) {
      applyMeta(seededMeta);
      return () => {
        active = false;
      };
    }

    getVideoMeta(resolvedVideoId)
      .then(applyMeta)
      .catch(() => {
        if (active) {
          setError('视频元数据加载失败');
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [resolvedVideoId, seededMeta, seededTimestamps, workflowState]);

  const generateThumbnails = useCallback(async () => {
    if (timestamps.length === 0) return;

    const savedThumbs = workflowState?.frameThumbs ?? {};
    const map = new Map<number, string>();
    for (const ts of timestamps) {
      const key = String(ts);
      if (savedThumbs[key]) {
        map.set(ts, savedThumbs[key]);
        continue;
      }
      try {
        const dataUrl = await captureFrameAt(ts);
        if (dataUrl) map.set(ts, dataUrl);
      } catch {
        // skip failed thumbnails
      }
    }
    setThumbnails(map);
    setLoading(false);
  }, [timestamps, captureFrameAt, workflowState?.frameThumbs]);

  useEffect(() => {
    if (timestamps.length > 0 && isReady) {
      void generateThumbnails();
    }
  }, [timestamps, isReady, generateThumbnails]);

  const handleStartProcess = useCallback(async () => {
    if (timestamps.length === 0) {
      setError('没有可处理的帧');
      return;
    }

    setIsProcessing(true);
    setError(null);
    settledRef.current = false;

    try {
      if (!resolvedVideoId) {
        throw new Error('视频 ID 缺失');
      }

      const { job_id } = await createJob({
        video_id: resolvedVideoId,
        timestamps_ms: timestamps,
        remove_bg: removeBg,
        remove_bg_mode: removeBgMode,
        watermark_box: enableWatermark ? watermarkBox : null,
        layout,
      });
      mergeWorkflowState({
        currentStep: 'result',
        jobId: job_id,
        frameTimestamps: timestamps,
        videoMeta: seededMeta ?? workflowState?.videoMeta,
        processSettings: {
          removeBg,
          removeBgMode,
          enableWatermark,
          watermarkBox,
          layout,
          layoutColsTouched: true,
        },
      });

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws/jobs/${job_id}`;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        let data: WsJobUpdate;
        try {
          data = JSON.parse(event.data) as WsJobUpdate;
        } catch {
          return;
        }
        setProgress(data.progress || 0);
        setStage(data.stage || '');

        if (data.status === 'done') {
          settledRef.current = true;
          ws.close();
          navigate(`/result/${job_id}`, {
            state: createWorkflowRouteState({
              jobId: job_id,
              videoMeta: seededMeta ?? workflowState?.videoMeta,
              frameTimestamps: timestamps,
            }),
          });
        } else if (data.status === 'failed') {
          settledRef.current = true;
          ws.close();
          setError(data.error || '处理失败');
          setIsProcessing(false);
        }
      };

      ws.onerror = () => {
        if (!settledRef.current) {
          setError('WebSocket 连接失败');
          setIsProcessing(false);
        }
      };

      ws.onclose = () => {
        if (settledRef.current) return;
        setError('连接断开');
        setIsProcessing(false);
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理失败');
      setIsProcessing(false);
    }
  }, [enableWatermark, layout, navigate, removeBg, removeBgMode, resolvedVideoId, seededMeta, timestamps, watermarkBox, workflowState?.videoMeta]);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleReupload = useCallback(async () => {
    if (isProcessing) return;

    if (resolvedVideoId) {
      clearWorkflow(resolvedVideoId);
      try {
        await deleteVideo(resolvedVideoId);
      } catch {
        // The upload may already be gone; navigating home still clears the local workflow.
      }
    }
    navigate('/');
  }, [isProcessing, navigate, resolvedVideoId]);

  const firstThumbnail = timestamps.length > 0 ? thumbnails.get(timestamps[0]) : undefined;

  return (
    <PageShell
      title="处理设置"
      description="确认帧序列并调整去背景与排版参数，然后开始生成精灵表"
      back={{ to: resolvedVideoId ? `/frames/${resolvedVideoId}` : '/', label: '返回帧审查' }}
      actions={
        <Button variant="secondary" onClick={handleReupload} disabled={isProcessing}>
          重新上传视频
        </Button>
      }
    >
      <Steps
        steps={['上传视频', '截取帧', '确认帧', '处理设置', '导出结果']}
        current={3}
        className="mb-6"
      />

      <video
        ref={videoRef}
        src={videoUrl}
        preload="auto"
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />

      {isProcessing ? (
        <Card>
          <div className="flex flex-col items-center py-6 text-center">
            <Badge tone="brand" dot>
              处理中
            </Badge>
            <div className="mt-4 text-3xl font-semibold text-gray-900 dark:text-gray-100">
              {Math.round(progress * 100)}%
            </div>
            <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              {stageLabels[stage] || stage || '正在处理'}
            </div>
            <div className="mt-5 w-full max-w-md">
              <ProgressBar value={progress} />
            </div>
            <div className="mt-4 text-xs text-gray-400 dark:text-gray-500">
              处理中请勿关闭页面
            </div>
          </div>
        </Card>
      ) : error ? (
        <EmptyState
          icon="alert-circle"
          title={timestamps.length > 0 ? '处理失败' : '加载失败'}
          description={error}
          action={
            timestamps.length > 0 ? (
              <Button onClick={handleStartProcess}>重试</Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => navigate(resolvedVideoId ? `/frames/${resolvedVideoId}` : '/')}
              >
                返回帧审查
              </Button>
            )
          }
        />
      ) : loading ? (
        <div className="flex flex-col items-center py-20 text-center">
          <Icon name="loader" size={32} className="animate-spin text-gray-400 dark:text-gray-500" />
          <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">正在加载帧数据...</div>
        </div>
      ) : (
        <div className="space-y-6">
          <Card title="帧预览" actions={<Badge tone="gray">{timestamps.length} 帧</Badge>}>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {timestamps.map((ts, i) => {
                const thumb = thumbnails.get(ts);
                return thumb ? (
                  <img
                    key={ts}
                    src={thumb}
                    alt={`帧 ${i + 1}`}
                    className="h-20 w-auto flex-shrink-0 rounded-lg border border-gray-200 object-contain dark:border-gray-700"
                  />
                ) : (
                  <div
                    key={ts}
                    className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-500"
                  >
                    {Math.floor(ts / 1000)}s
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="处理选项" description="选择去背景与水印处理方式">
            <div className="space-y-5">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={removeBg}
                  onChange={(e) => setRemoveBg(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">去除背景</span>
              </label>

              {removeBg && (
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/60">
                  <div className="mb-3 text-xs font-medium text-gray-700 dark:text-gray-300">
                    去背景模式
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="remove-bg-mode"
                        checked={removeBgMode === 'standard'}
                        onChange={() => setRemoveBgMode('standard')}
                        className="peer sr-only"
                      />
                      <div className="h-full rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-gray-300 peer-checked:border-brand-500 peer-checked:bg-brand-50/50 peer-checked:ring-1 peer-checked:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600 dark:peer-checked:bg-brand-500/10">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">标准</div>
                        <div className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                          边缘更干净，适合普通角色和道具。
                        </div>
                      </div>
                    </label>
                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="remove-bg-mode"
                        checked={removeBgMode === 'conservative'}
                        onChange={() => setRemoveBgMode('conservative')}
                        className="peer sr-only"
                      />
                      <div className="h-full rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-gray-300 peer-checked:border-brand-500 peer-checked:bg-brand-50/50 peer-checked:ring-1 peer-checked:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600 dark:peer-checked:bg-brand-500/10">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">保守</div>
                        <div className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                          输出更宽松的透明边缘，优先保留弧光、残影和发光特效。
                        </div>
                      </div>
                    </label>
                    <label className="cursor-pointer">
                      <input
                        type="radio"
                        name="remove-bg-mode"
                        checked={removeBgMode === 'white'}
                        onChange={() => setRemoveBgMode('white')}
                        className="peer sr-only"
                      />
                      <div className="h-full rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-gray-300 peer-checked:border-brand-500 peer-checked:bg-brand-50/50 peer-checked:ring-1 peer-checked:ring-brand-500 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600 dark:peer-checked:bg-brand-500/10">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          单一背景
                        </div>
                        <div className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
                          仅去除纯白或近纯白背景，尽量保留彩色发光和特效边缘。
                        </div>
                      </div>
                    </label>
                  </div>
                </div>
              )}

              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={enableWatermark}
                  onChange={(e) => setEnableWatermark(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">去除水印</span>
              </label>

              {enableWatermark && firstThumbnail && (
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/60">
                  <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                    在下方图片上框选水印区域
                  </p>
                  <BoxSelector
                    imageUrl={firstThumbnail}
                    onBoxChange={setWatermarkBox}
                  />
                </div>
              )}
            </div>
          </Card>

          <Card title="精灵表布局" description="设置导出精灵表的列数与帧间距">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  列数
                </label>
                <Input
                  type="number"
                  min="1"
                  max="32"
                  value={layout.cols}
                  onChange={(e) => { setColsTouched(true); setLayout(prev => ({ ...prev, cols: parseInt(e.target.value) || 8 })); }}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  间距 (px)
                </label>
                <Input
                  type="number"
                  min="0"
                  max="20"
                  value={layout.padding}
                  onChange={(e) => setLayout(prev => ({ ...prev, padding: parseInt(e.target.value) || 2 }))}
                />
              </div>
            </div>
          </Card>

          <div className="flex justify-end">
            <Button size="lg" loading={isProcessing} onClick={handleStartProcess}>
              开始处理
            </Button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
