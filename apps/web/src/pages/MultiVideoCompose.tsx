import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  createFrameAssemblyJob,
  deleteVideo,
  extractVideoFrames,
  uploadVideo,
  type VideoUploadResponse,
} from '../api/client';
import PageShell from '../components/PageShell';
import useSortableList from '../hooks/useSortableList';
import { formatTime } from '../utils/format';
import { generateFrameTimestamps } from '../utils/timestamps';

type RemoveBgMode = 'standard' | 'conservative' | 'white';

interface SourceVideo extends VideoUploadResponse {
  filename: string;
}

interface FrameItem {
  id: string;
  video_id: string;
  video_label: string;
  ts_ms: number;
  thumb_url: string;
}

interface Layout {
  cols: number;
  padding: number;
}

interface AlignmentOffset {
  x: number;
  y: number;
}

export default function MultiVideoCompose() {
  const navigate = useNavigate();
  const [videos, setVideos] = useState<SourceVideo[]>([]);
  const [frames, setFrames] = useState<FrameItem[]>([]);
  const [frameCount, setFrameCount] = useState(8);
  const [removeBg, setRemoveBg] = useState(true);
  const [removeBgMode, setRemoveBgMode] = useState<RemoveBgMode>('standard');
  const [layout, setLayout] = useState<Layout>({ cols: 4, padding: 2 });
  const [baseVideoId, setBaseVideoId] = useState('');
  const [alignTargetVideoId, setAlignTargetVideoId] = useState('');
  const [alignmentOffsets, setAlignmentOffsets] = useState<Record<string, AlignmentOffset>>({});
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureProgress, setCaptureProgress] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processProgress, setProcessProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (videos.length === 0) {
      setAlignmentOffsets({});
      setBaseVideoId('');
      setAlignTargetVideoId('');
      return;
    }

    const videoIds = new Set(videos.map((video) => video.video_id));
    setAlignmentOffsets((current) => {
      const next: Record<string, AlignmentOffset> = {};
      let changed = Object.keys(current).length !== videos.length;

      for (const video of videos) {
        next[video.video_id] = current[video.video_id] ?? { x: 0, y: 0 };
        if (!current[video.video_id]) changed = true;
      }

      return changed ? next : current;
    });

    setBaseVideoId((current) => (videoIds.has(current) ? current : videos[0].video_id));
    setAlignTargetVideoId((current) => {
      if (videos.length < 2) return '';
      const currentBaseId = videoIds.has(baseVideoId) ? baseVideoId : videos[0].video_id;
      if (videoIds.has(current) && current !== currentBaseId) return current;
      return videos.find((video) => video.video_id !== currentBaseId)?.video_id ?? '';
    });
  }, [baseVideoId, videos]);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    const selected = Array.from(fileList ?? []);
    if (selected.length === 0) return;

    const invalidFile = selected.find((file) => !file.type.match(/^video\/(mp4|webm)$/));
    if (invalidFile) {
      setError('只支持 MP4 和 WebM 格式');
      return;
    }

    const oversizedFile = selected.find((file) => file.size > 500 * 1024 * 1024);
    if (oversizedFile) {
      setError('单个文件大小不能超过 500MB');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setError(null);

    try {
      const uploaded: SourceVideo[] = [];
      for (let index = 0; index < selected.length; index += 1) {
        const file = selected[index];
        const response = await uploadVideo(file, (progress) => {
          setUploadProgress(Math.round(((index + progress / 100) / selected.length) * 100));
        });
        uploaded.push({
          ...response,
          filename: file.name,
        });
      }
      setVideos((current) => [...current, ...uploaded]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleClearVideos = useCallback(async () => {
    if (isUploading || isCapturing || isProcessing) return;

    const uploadedVideoIds = videos.map((video) => video.video_id);
    setVideos([]);
    setFrames([]);
    setError(null);

    for (const videoId of uploadedVideoIds) {
      try {
        await deleteVideo(videoId);
      } catch {
        // Local reset should still finish if a temporary upload was already removed.
      }
    }
  }, [isCapturing, isProcessing, isUploading, videos]);

  const handleAutoCapture = useCallback(async () => {
    if (videos.length === 0) {
      setError('请先上传视频');
      return;
    }

    setIsCapturing(true);
    setCaptureProgress(0);
    setError(null);

    try {
      const capturedFrames: FrameItem[] = [];
      for (let videoIndex = 0; videoIndex < videos.length; videoIndex += 1) {
        const video = videos[videoIndex];
        const timestamps = generateFrameTimestamps(video.duration_ms, 'count', frameCount, 1000, 60);
        const response = await extractVideoFrames(video.video_id, timestamps);

        for (const [frameIndex, frame] of response.frames.entries()) {
          capturedFrames.push({
            id: `${video.video_id}:${frame.ts_ms}:${frameIndex}`,
            video_id: video.video_id,
            video_label: video.filename,
            ts_ms: frame.ts_ms,
            thumb_url: frame.url,
          });
        }
        setCaptureProgress(Math.round(((videoIndex + 1) / videos.length) * 100));
      }
      setFrames(capturedFrames);
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动截取关键帧失败');
    } finally {
      setIsCapturing(false);
    }
  }, [frameCount, videos]);

  const moveFrame = useCallback((fromIndex: number, toIndex: number) => {
    setFrames((current) => {
      if (toIndex < 0 || toIndex >= current.length || fromIndex === toIndex) return current;

      const next = [...current];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const {
    dragOverIndex,
    handleDragStart,
    handleDragOver,
    handleDrop,
    handleDragEnd,
  } = useSortableList(moveFrame);

  const handleDeleteFrame = useCallback((index: number) => {
    setFrames((current) => current.filter((_, frameIndex) => frameIndex !== index));
  }, []);

  const setAlignmentOffsetValue = useCallback((videoId: string, axis: keyof AlignmentOffset, value: number) => {
    setAlignmentOffsets((current) => {
      const offset = current[videoId] ?? { x: 0, y: 0 };
      return {
        ...current,
        [videoId]: {
          ...offset,
          [axis]: value,
        },
      };
    });
  }, []);

  const nudgeAlignmentOffset = useCallback((videoId: string, dx: number, dy: number) => {
    setAlignmentOffsets((current) => {
      const offset = current[videoId] ?? { x: 0, y: 0 };
      return {
        ...current,
        [videoId]: {
          x: offset.x + dx,
          y: offset.y + dy,
        },
      };
    });
  }, []);

  const resetAlignmentOffset = useCallback((videoId: string) => {
    setAlignmentOffsets((current) => ({
      ...current,
      [videoId]: { x: 0, y: 0 },
    }));
  }, []);

  const handleStartProcess = useCallback(async () => {
    if (frames.length === 0) {
      setError('请先生成并保留至少一个关键帧');
      return;
    }

    setIsProcessing(true);
    setProcessProgress(0);
    setStage('');
    setError(null);

    try {
      const { job_id } = await createFrameAssemblyJob({
        frames: frames.map((frame) => ({
          video_id: frame.video_id,
          ts_ms: frame.ts_ms,
          x_offset: alignmentOffsets[frame.video_id]?.x ?? 0,
          y_offset: alignmentOffsets[frame.video_id]?.y ?? 0,
        })),
        remove_bg: removeBg,
        remove_bg_mode: removeBgMode,
        layout,
      });

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${wsProtocol}//${window.location.host}/ws/jobs/${job_id}`);
      wsRef.current = ws;
      let settled = false;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setProcessProgress(data.progress || 0);
        setStage(data.stage || '');

        if (data.status === 'done') {
          settled = true;
          ws.close();
          navigate(`/result/${job_id}`, {
            state: { jobId: job_id },
          });
        } else if (data.status === 'failed') {
          settled = true;
          ws.close();
          setError(data.error || '处理失败');
          setIsProcessing(false);
        }
      };

      ws.onerror = () => {
        settled = true;
        setError('WebSocket 连接失败');
        setIsProcessing(false);
      };

      ws.onclose = () => {
        if (settled) return;
        setError('连接断开，请重试');
        setIsProcessing(false);
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理失败');
      setIsProcessing(false);
    }
  }, [alignmentOffsets, frames, layout, navigate, removeBg, removeBgMode]);

  const stageLabels: Record<string, string> = {
    extract: '截帧',
    rembg: '去背景',
    pack: '打包精灵表',
    done: '完成',
  };

  const busy = isUploading || isCapturing || isProcessing;
  const baseVideo = videos.find((video) => video.video_id === baseVideoId) ?? videos[0] ?? null;
  const targetVideos = videos.filter((video) => video.video_id !== baseVideo?.video_id);
  const alignTargetVideo = targetVideos.find((video) => video.video_id === alignTargetVideoId) ?? targetVideos[0] ?? null;
  const basePreviewFrame = baseVideo ? frames.find((frame) => frame.video_id === baseVideo.video_id) : undefined;
  const targetPreviewFrame = alignTargetVideo ? frames.find((frame) => frame.video_id === alignTargetVideo.video_id) : undefined;
  const targetOffset = alignTargetVideo ? alignmentOffsets[alignTargetVideo.video_id] ?? { x: 0, y: 0 } : { x: 0, y: 0 };
  const targetTransform = alignTargetVideo
    ? `translate(${(targetOffset.x / Math.max(1, alignTargetVideo.width)) * 100}%, ${(targetOffset.y / Math.max(1, alignTargetVideo.height)) * 100}%)`
    : undefined;

  return (
    <PageShell
      title="多视频拼帧"
      description="把多个视频的关键帧编排成同一个精灵表。"
      align="center"
    >
      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">视频素材</h3>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => void handleClearVideos()}
                disabled={busy || videos.length === 0}
                className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                清空视频
              </button>
              <label className="inline-flex cursor-pointer items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 dark:hover:text-gray-900">
                选择视频
                <input
                  type="file"
                  multiple
                  accept="video/mp4,video/webm"
                  className="hidden"
                  disabled={busy}
                  onChange={(event) => {
                    void handleFiles(event.target.files);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
            </div>
          </div>

          {isUploading && (
            <div className="mb-4">
              <div className="mb-2 text-sm text-gray-500 dark:text-gray-400">上传中 {uploadProgress}%</div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div className="h-full rounded-full bg-gray-900 dark:bg-gray-100 transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}

          {videos.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 py-12 text-center text-sm text-gray-400 dark:text-gray-500">
              暂无视频
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {videos.map((video, index) => (
                <div key={video.video_id} className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4">
                  <div className="mb-2 truncate text-sm font-medium text-gray-900 dark:text-gray-100">{video.filename}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    #{index + 1} · {Math.round(video.duration_ms / 1000)} 秒 · {video.width}×{video.height}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">截帧设置</h3>
          <label className="mb-1 block text-sm text-gray-500 dark:text-gray-400">每个视频截取帧数</label>
          <input
            type="number"
            min="1"
            max="60"
            value={frameCount}
            disabled={busy}
            onChange={(event) => setFrameCount(parseInt(event.target.value) || 1)}
            className="mb-4 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 dark:focus:border-gray-500 dark:focus:ring-gray-500 disabled:opacity-50"
          />
          <button
            onClick={() => void handleAutoCapture()}
            disabled={busy || videos.length === 0}
            className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 dark:hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            自动截取关键帧
          </button>

          {isCapturing && (
            <div className="mt-4">
              <div className="mb-2 text-sm text-gray-500 dark:text-gray-400">截取中 {captureProgress}%</div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                <div className="h-full rounded-full bg-gray-900 dark:bg-gray-100 transition-all" style={{ width: `${captureProgress}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {videos.length > 1 && frames.length > 0 && baseVideo && alignTargetVideo && (
        <div className="mb-6 grid gap-6 lg:grid-cols-[320px_1fr]">
          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <h3 className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">对齐校准</h3>

            <label className="mb-1 block text-sm text-gray-500 dark:text-gray-400">基准视频</label>
            <select
              value={baseVideo.video_id}
              disabled={busy}
              onChange={(event) => {
                const nextBaseId = event.target.value;
                setBaseVideoId(nextBaseId);
                resetAlignmentOffset(nextBaseId);
                if (alignTargetVideo.video_id === nextBaseId) {
                  setAlignTargetVideoId(videos.find((video) => video.video_id !== nextBaseId)?.video_id ?? '');
                }
              }}
              className="mb-4 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 dark:focus:border-gray-500 dark:focus:ring-gray-500 disabled:opacity-50"
            >
              {videos.map((video) => (
                <option key={video.video_id} value={video.video_id}>
                  {video.filename}
                </option>
              ))}
            </select>

            <label className="mb-1 block text-sm text-gray-500 dark:text-gray-400">调整视频</label>
            <select
              value={alignTargetVideo.video_id}
              disabled={busy}
              onChange={(event) => setAlignTargetVideoId(event.target.value)}
              className="mb-4 w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 dark:focus:border-gray-500 dark:focus:ring-gray-500 disabled:opacity-50"
            >
              {targetVideos.map((video) => (
                <option key={video.video_id} value={video.video_id}>
                  {video.filename}
                </option>
              ))}
            </select>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-gray-500 dark:text-gray-400">X 偏移</label>
                <input
                  type="number"
                  value={targetOffset.x}
                  disabled={busy}
                  onChange={(event) => setAlignmentOffsetValue(
                    alignTargetVideo.video_id,
                    'x',
                    Number.parseInt(event.target.value, 10) || 0
                  )}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 dark:focus:border-gray-500 dark:focus:ring-gray-500 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-gray-500 dark:text-gray-400">Y 偏移</label>
                <input
                  type="number"
                  value={targetOffset.y}
                  disabled={busy}
                  onChange={(event) => setAlignmentOffsetValue(
                    alignTargetVideo.video_id,
                    'y',
                    Number.parseInt(event.target.value, 10) || 0
                  )}
                  className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 dark:focus:border-gray-500 dark:focus:ring-gray-500 disabled:opacity-50"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div />
              <button
                type="button"
                onClick={() => nudgeAlignmentOffset(alignTargetVideo.video_id, 0, -1)}
                disabled={busy}
                aria-label="上移"
                className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 disabled:opacity-40"
              >
                ↑
              </button>
              <div />
              <button
                type="button"
                onClick={() => nudgeAlignmentOffset(alignTargetVideo.video_id, -1, 0)}
                disabled={busy}
                aria-label="左移"
                className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 disabled:opacity-40"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => resetAlignmentOffset(alignTargetVideo.video_id)}
                disabled={busy}
                className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 disabled:opacity-40"
              >
                归零
              </button>
              <button
                type="button"
                onClick={() => nudgeAlignmentOffset(alignTargetVideo.video_id, 1, 0)}
                disabled={busy}
                aria-label="右移"
                className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 disabled:opacity-40"
              >
                →
              </button>
              <div />
              <button
                type="button"
                onClick={() => nudgeAlignmentOffset(alignTargetVideo.video_id, 0, 1)}
                disabled={busy}
                aria-label="下移"
                className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 disabled:opacity-40"
              >
                ↓
              </button>
              <div />
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-6">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">叠加预览</h3>
              <div className="text-sm text-gray-500 dark:text-gray-400">
                X {targetOffset.x}px · Y {targetOffset.y}px
              </div>
            </div>
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-gray-100 dark:bg-gray-800">
              {basePreviewFrame && (
                <img
                  src={basePreviewFrame.thumb_url}
                  alt={`${baseVideo.filename} 基准帧`}
                  className="absolute inset-0 h-full w-full object-contain opacity-70"
                />
              )}
              {targetPreviewFrame && (
                <img
                  src={targetPreviewFrame.thumb_url}
                  alt={`${alignTargetVideo.filename} 对齐帧`}
                  className="absolute inset-0 h-full w-full object-contain opacity-60 mix-blend-multiply"
                  style={targetTransform ? { transform: targetTransform } : undefined}
                />
              )}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500 dark:text-gray-400">
              <span>基准：{baseVideo.filename}</span>
              <span>调整：{alignTargetVideo.filename}</span>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">帧编排 ({frames.length} 帧)</h3>
          <button
            onClick={() => setFrames([])}
            disabled={busy || frames.length === 0}
            className="self-start rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-800 px-4 py-2 text-sm text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-950 disabled:cursor-not-allowed disabled:opacity-50 sm:self-auto"
          >
            清空帧
          </button>
        </div>

        {frames.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 dark:border-gray-600 py-16 text-center text-sm text-gray-400 dark:text-gray-500">
            暂无关键帧
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {frames.map((frame, index) => (
              <div
                key={frame.id}
                draggable={!busy}
                onDragStart={() => handleDragStart(index)}
                onDragOver={(event) => handleDragOver(event, index)}
                onDrop={() => handleDrop(index)}
                onDragEnd={handleDragEnd}
                className={`group relative overflow-hidden rounded-xl border bg-gray-50 dark:bg-gray-800 transition-all ${
                  dragOverIndex === index ? 'border-gray-900 dark:border-gray-100 ring-2 ring-gray-900 dark:ring-gray-100' : 'border-gray-200 dark:border-gray-700'
                } ${busy ? '' : 'cursor-grab active:cursor-grabbing'}`}
              >
                <div className="flex aspect-video items-center justify-center bg-white dark:bg-gray-800">
                  <img
                    src={frame.thumb_url}
                    alt={`关键帧 ${index + 1}`}
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="space-y-1 px-2 py-2">
                  <div className="truncate text-xs font-medium text-gray-700 dark:text-gray-300">{frame.video_label}</div>
                  <div className="text-xs text-gray-400 dark:text-gray-500">#{index + 1} · {formatTime(frame.ts_ms)}</div>
                  <div className="flex gap-1 pt-1">
                    <button
                      onClick={() => moveFrame(index, index - 1)}
                      disabled={busy || index === 0}
                      className="flex-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 disabled:opacity-40"
                    >
                      上移
                    </button>
                    <button
                      onClick={() => moveFrame(index, index + 1)}
                      disabled={busy || index === frames.length - 1}
                      className="flex-1 rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 disabled:opacity-40"
                    >
                      下移
                    </button>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteFrame(index)}
                  disabled={busy}
                  aria-label={`删除第 ${index + 1} 帧`}
                  className="absolute right-2 top-2 hidden h-6 w-6 items-center justify-center rounded-full bg-white dark:bg-gray-800 text-xs text-red-500 shadow-sm group-hover:flex disabled:opacity-40"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">处理选项</h3>
          <label className="mb-4 flex cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={removeBg}
              disabled={busy}
              onChange={(event) => setRemoveBg(event.target.checked)}
              className="h-5 w-5 rounded border-gray-300 dark:border-gray-600"
            />
            <span className="text-base text-gray-700 dark:text-gray-300">去除背景</span>
          </label>

          {removeBg && (
            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-4">
              <div className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">去背景模式</div>
              <div className="space-y-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="multi-remove-bg-mode"
                    checked={removeBgMode === 'standard'}
                    disabled={busy}
                    onChange={() => setRemoveBgMode('standard')}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">标准：边缘更干净，适合普通角色和道具。</span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="multi-remove-bg-mode"
                    checked={removeBgMode === 'conservative'}
                    disabled={busy}
                    onChange={() => setRemoveBgMode('conservative')}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">保守：优先保留弧光、残影和发光特效。</span>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    name="multi-remove-bg-mode"
                    checked={removeBgMode === 'white'}
                    disabled={busy}
                    onChange={() => setRemoveBgMode('white')}
                    className="mt-0.5 h-4 w-4 border-gray-300 dark:border-gray-600"
                  />
                  <span className="text-sm text-gray-600 dark:text-gray-400">单一背景：仅去除纯白或近纯白背景。</span>
                </label>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <h3 className="mb-4 text-lg font-bold text-gray-900 dark:text-gray-100">精灵表布局</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm text-gray-500 dark:text-gray-400">列数</label>
              <input
                type="number"
                min="1"
                max="32"
                value={layout.cols}
                disabled={busy}
                onChange={(event) => setLayout((current) => ({ ...current, cols: parseInt(event.target.value) || 4 }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 dark:focus:border-gray-500 dark:focus:ring-gray-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-gray-500 dark:text-gray-400">间距 (px)</label>
              <input
                type="number"
                min="0"
                max="20"
                value={layout.padding}
                disabled={busy}
                onChange={(event) => setLayout((current) => ({ ...current, padding: parseInt(event.target.value) || 0 }))}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 outline-none focus:border-gray-400 focus:ring-1 focus:ring-gray-400 dark:focus:border-gray-500 dark:focus:ring-gray-500 disabled:opacity-50"
              />
            </div>
          </div>
        </div>
      </div>

      {isProcessing && (
        <div className="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">正在处理...</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">{Math.round(processProgress * 100)}%</div>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div className="h-full rounded-full bg-gray-900 dark:bg-gray-100 transition-all" style={{ width: `${Math.round(processProgress * 100)}%` }} />
          </div>
          <div className="mt-3 text-sm text-gray-500 dark:text-gray-400">{stageLabels[stage] || stage}</div>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => void handleStartProcess()}
          disabled={busy || frames.length === 0}
          className="rounded-lg bg-gray-900 px-8 py-3 text-base font-bold text-white transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 dark:hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          生成精灵表
        </button>
      </div>
    </PageShell>
  );
}
