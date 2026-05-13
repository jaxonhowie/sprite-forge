import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useParams, useNavigate } from 'react-router-dom';
import BoxSelector from '../components/BoxSelector';
import { createJob, deleteVideo, getVideoMeta } from '../api/client';
import useVideoFrame from '../hooks/useVideoFrame';
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

export default function Process() {
  const { videoId } = useParams<{ videoId: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
  const [videoUrl, setVideoUrl] = useState('');
  const [metadataDuration, setMetadataDuration] = useState(0);
  const [removeBg, setRemoveBg] = useState(true);
  const [enableWatermark, setEnableWatermark] = useState(false);
  const [watermarkBox, setWatermarkBox] = useState<WatermarkBox | null>(null);
  const [layout, setLayout] = useState<Layout>({ cols: 8, padding: 2 });
  const [colsTouched, setColsTouched] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [workflowState] = useState(() => getWorkflowState());

  const wsRef = useRef<WebSocket | null>(null);
  const locationState = location.state as WorkflowRouteState | null;
  const seededMeta = locationState?.videoMeta ?? workflowState?.videoMeta;
  const seededTimestamps = locationState?.frameTimestamps ?? workflowState?.frameTimestamps;
  const resolvedVideoId = videoId ?? seededMeta?.video_id;

  const { videoRef, canvasRef, isReady, captureFrameAt } = useVideoFrame({
    videoSrc: videoUrl,
    metadataDurationMs: metadataDuration,
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
    if (!colsTouched && stored && stored.length > 0) {
      setLayout(prev => ({ ...prev, cols: stored.length }));
    }

    const applyMeta = (meta: { url: string; duration_ms: number }) => {
      if (!active) return;
      setVideoUrl(meta.url);
      setMetadataDuration(meta.duration_ms);
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

    try {
      if (!resolvedVideoId) {
        throw new Error('视频 ID 缺失');
      }

      const { job_id } = await createJob({
        video_id: resolvedVideoId,
        timestamps_ms: timestamps,
        remove_bg: removeBg,
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
        const data = JSON.parse(event.data);
        setProgress(data.progress || 0);
        setStage(data.stage || '');

        if (data.status === 'done') {
          ws.close();
          navigate(`/result/${job_id}`, {
            state: createWorkflowRouteState({
              jobId: job_id,
              videoMeta: seededMeta ?? workflowState?.videoMeta,
              frameTimestamps: timestamps,
            }),
          });
        } else if (data.status === 'failed') {
          ws.close();
          setError(data.error || '处理失败');
          setIsProcessing(false);
        }
      };

      ws.onerror = () => {
        setError('WebSocket 连接失败');
        setIsProcessing(false);
      };

      ws.onclose = () => {
        if (isProcessing) {
          setError('连接断开');
          setIsProcessing(false);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理失败');
      setIsProcessing(false);
    }
  }, [enableWatermark, isProcessing, layout, navigate, removeBg, resolvedVideoId, timestamps, watermarkBox]);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleBack = useCallback(() => {
    const targetVideoId = resolvedVideoId;
    if (targetVideoId) {
      navigate(`/frames/${targetVideoId}`, {
        state: createWorkflowRouteState({
          videoMeta: seededMeta ?? workflowState?.videoMeta,
          frameTimestamps: timestamps,
        }),
      });
    }
  }, [navigate, resolvedVideoId, seededMeta, timestamps, workflowState?.videoMeta]);

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

  const stageLabels: Record<string, string> = {
    extract: '截帧',
    inpaint: '去水印',
    rembg: '去背景',
    pack: '打包精灵表',
  };

  const firstThumbnail = timestamps.length > 0 ? thumbnails.get(timestamps[0]) : undefined;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-2xl font-bold text-gray-900">处理设置</h2>
        <button
          onClick={handleReupload}
          disabled={isProcessing}
          className="self-start rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
        >
          重新上传视频
        </button>
      </div>

      <video
        ref={videoRef}
        src={videoUrl}
        preload="auto"
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {isProcessing ? (
        <div className="rounded-xl border border-gray-200 p-8 text-center">
          <div className="mb-6 text-xl font-bold text-gray-900">正在处理...</div>

          <div className="mx-auto mb-4 h-3 max-w-md overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-gray-900 transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>

          <div className="text-base text-gray-600">
            {stageLabels[stage] || stage} - {Math.round(progress * 100)}%
          </div>

          <div className="mt-4 text-sm text-gray-400">
            处理中请勿关闭页面
          </div>
        </div>
      ) : loading ? (
        <div className="py-20 text-center text-gray-400">
          <div className="mb-4 flex justify-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-200 border-t-gray-500" />
          </div>
          <div className="text-lg">正在加载帧数据...</div>
        </div>
      ) : (
        <>
          <div className="mb-6 rounded-xl border border-gray-200 p-6">
            <h3 className="mb-4 text-lg font-bold text-gray-900">帧预览 ({timestamps.length} 帧)</h3>
            <div className="flex gap-2 overflow-x-auto pb-2">
              {timestamps.map((ts, i) => {
                const thumb = thumbnails.get(ts);
                return thumb ? (
                  <img
                    key={ts}
                    src={thumb}
                    alt={`帧 ${i + 1}`}
                    className="h-20 w-auto flex-shrink-0 rounded-lg border border-gray-200 object-contain"
                  />
                ) : (
                  <div key={ts} className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-xs text-gray-400">
                    {Math.floor(ts / 1000)}s
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mb-6 rounded-xl border border-gray-200 p-6">
            <h3 className="mb-4 text-lg font-bold text-gray-900">处理选项</h3>

            <div className="space-y-4">
              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={removeBg}
                  onChange={(e) => setRemoveBg(e.target.checked)}
                  className="h-5 w-5 rounded border-gray-300"
                />
                <span className="text-base text-gray-700">去除背景 (rembg)</span>
              </label>

              <label className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={enableWatermark}
                  onChange={(e) => setEnableWatermark(e.target.checked)}
                  className="h-5 w-5 rounded border-gray-300"
                />
                <span className="text-base text-gray-700">去除水印</span>
              </label>

              {enableWatermark && firstThumbnail && (
                <div className="ml-8 mt-4">
                  <p className="mb-2 text-sm text-gray-500">
                    在下方图片上框选水印区域
                  </p>
                  <BoxSelector
                    imageUrl={firstThumbnail}
                    onBoxChange={setWatermarkBox}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="mb-6 rounded-xl border border-gray-200 p-6">
            <h3 className="mb-4 text-lg font-bold text-gray-900">精灵表布局</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm text-gray-500">列数</label>
                <input
                  type="number"
                  min="1"
                  max="32"
                  value={layout.cols}
                  onChange={(e) => { setColsTouched(true); setLayout(prev => ({ ...prev, cols: parseInt(e.target.value) || 8 })); }}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-500">间距 (px)</label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={layout.padding}
                  onChange={(e) => setLayout(prev => ({ ...prev, padding: parseInt(e.target.value) || 2 }))}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={handleBack}
              className="rounded-lg border border-gray-200 bg-white px-6 py-3 text-sm text-gray-700 transition-colors hover:bg-gray-50"
            >
              &larr; 返回帧列表
            </button>
            <button
              onClick={handleStartProcess}
              className="rounded-lg bg-gray-900 px-8 py-3 text-base font-bold text-white transition-colors hover:bg-gray-800"
            >
              开始处理
            </button>
          </div>
        </>
      )}
    </div>
  );
}
