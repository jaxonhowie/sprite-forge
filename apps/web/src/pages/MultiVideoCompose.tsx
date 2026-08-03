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
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import EmptyState from '../components/ui/EmptyState';
import Icon from '../components/ui/Icon';
import Input from '../components/ui/Input';
import ProgressBar from '../components/ui/ProgressBar';
import Select from '../components/ui/Select';
import useSortableList from '../hooks/useSortableList';
import { formatTime } from '../utils/format';
import { videoStageLabels } from '../utils/stageLabels';
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
  const [isDragActive, setIsDragActive] = useState(false);
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

  const handleDeleteVideo = useCallback(
    async (videoId: string) => {
      if (isUploading || isCapturing || isProcessing) return;

      setVideos((current) => current.filter((video) => video.video_id !== videoId));
      setFrames((current) => current.filter((frame) => frame.video_id !== videoId));
      setError(null);

      try {
        await deleteVideo(videoId);
      } catch {
        // Local reset should still finish if a temporary upload was already removed.
      }
    },
    [isCapturing, isProcessing, isUploading],
  );

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
        <div className="mb-6 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300">
          <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card
          title="视频素材"
          description="上传多个视频，统一截取关键帧后拼成精灵表。"
          actions={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleClearVideos()}
              disabled={busy || videos.length === 0}
            >
              清空视频
            </Button>
          }
        >
          <label
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors ${
              isDragActive
                ? 'border-brand-500 bg-brand-50/50 dark:border-brand-500 dark:bg-brand-500/10'
                : 'border-gray-300 bg-gray-50 hover:border-brand-400 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-brand-600'
            } ${busy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setIsDragActive(true);
            }}
            onDragLeave={() => setIsDragActive(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDragActive(false);
              if (!busy) void handleFiles(event.dataTransfer.files);
            }}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500">
              <Icon name="upload" size={22} />
            </span>
            <span className="mt-4 text-sm font-medium text-gray-900 dark:text-gray-100">
              拖拽视频到此处，或点击选择文件
            </span>
            <span className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              支持 MP4 / WebM，可一次选择多个，单个文件不超过 500MB
            </span>
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

          {isUploading && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>上传中</span>
                <span>{uploadProgress}%</span>
              </div>
              <ProgressBar value={uploadProgress / 100} />
            </div>
          )}

          <div className="mt-4">
            {videos.length === 0 ? (
              <EmptyState
                icon="video"
                title="暂无视频"
                description="上传视频后即可为每个视频均匀截取关键帧。"
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {videos.map((video, index) => (
                  <div
                    key={video.video_id}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-700 dark:bg-gray-800"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
                      <Icon name="film" size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                        {video.filename}
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                        #{index + 1} · {Math.round(video.duration_ms / 1000)} 秒 · {video.width}×{video.height}
                      </div>
                    </div>
                    <Button
                      variant="dangerSoft"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleDeleteVideo(video.video_id)}
                      aria-label={`删除视频 ${video.filename}`}
                    >
                      <Icon name="trash" size={14} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        <Card title="截帧设置" description="为每个视频均匀截取相同数量的关键帧。">
          <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
            每个视频截取帧数
          </label>
          <Input
            type="number"
            min="1"
            max="60"
            value={frameCount}
            disabled={busy}
            onChange={(event) => setFrameCount(parseInt(event.target.value) || 1)}
            className="mb-4"
          />
          <Button
            className="w-full"
            loading={isCapturing}
            onClick={() => void handleAutoCapture()}
            disabled={busy || videos.length === 0}
          >
            自动截取关键帧
          </Button>

          {isCapturing && (
            <div className="mt-4">
              <div className="mb-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>截取中</span>
                <span>{captureProgress}%</span>
              </div>
              <ProgressBar value={captureProgress / 100} />
            </div>
          )}
        </Card>
      </div>

      {videos.length > 1 && frames.length > 0 && baseVideo && alignTargetVideo && (
        <div className="mb-6 grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card title="对齐校准" description="以基准视频为准，微调其他视频帧的位置。">
            <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
              基准视频
            </label>
            <Select
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
              wrapperClassName="mb-4"
            >
              {videos.map((video) => (
                <option key={video.video_id} value={video.video_id}>
                  {video.filename}
                </option>
              ))}
            </Select>

            <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
              调整视频
            </label>
            <Select
              value={alignTargetVideo.video_id}
              disabled={busy}
              onChange={(event) => setAlignTargetVideoId(event.target.value)}
              wrapperClassName="mb-4"
            >
              {targetVideos.map((video) => (
                <option key={video.video_id} value={video.video_id}>
                  {video.filename}
                </option>
              ))}
            </Select>

            <div className="mb-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  X 偏移
                </label>
                <Input
                  type="number"
                  value={targetOffset.x}
                  disabled={busy}
                  onChange={(event) => setAlignmentOffsetValue(
                    alignTargetVideo.video_id,
                    'x',
                    Number.parseInt(event.target.value, 10) || 0
                  )}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Y 偏移
                </label>
                <Input
                  type="number"
                  value={targetOffset.y}
                  disabled={busy}
                  onChange={(event) => setAlignmentOffsetValue(
                    alignTargetVideo.video_id,
                    'y',
                    Number.parseInt(event.target.value, 10) || 0
                  )}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => nudgeAlignmentOffset(alignTargetVideo.video_id, 0, -1)}
                disabled={busy}
                aria-label="上移"
              >
                ↑
              </Button>
              <div />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => nudgeAlignmentOffset(alignTargetVideo.video_id, -1, 0)}
                disabled={busy}
                aria-label="左移"
              >
                ←
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => resetAlignmentOffset(alignTargetVideo.video_id)}
                disabled={busy}
              >
                归零
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => nudgeAlignmentOffset(alignTargetVideo.video_id, 1, 0)}
                disabled={busy}
                aria-label="右移"
              >
                →
              </Button>
              <div />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => nudgeAlignmentOffset(alignTargetVideo.video_id, 0, 1)}
                disabled={busy}
                aria-label="下移"
              >
                ↓
              </Button>
              <div />
            </div>
          </Card>

          <Card
            title="叠加预览"
            actions={
              <Badge tone="gray">
                X {targetOffset.x}px · Y {targetOffset.y}px
              </Badge>
            }
          >
            <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-100 dark:border-gray-800 dark:bg-gray-800">
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
          </Card>
        </div>
      )}

      <Card
        title={`帧编排（${frames.length} 帧）`}
        description="拖拽调整顺序，生成精灵表时将按此顺序排列。"
        className="mb-6"
        actions={
          <Button
            variant="dangerSoft"
            size="sm"
            onClick={() => setFrames([])}
            disabled={busy || frames.length === 0}
          >
            清空帧
          </Button>
        }
      >
        {frames.length === 0 ? (
          <EmptyState
            icon="images"
            title="暂无关键帧"
            description="先在上方设置截帧数量，然后点击「自动截取关键帧」。"
          />
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
                className={`group relative overflow-hidden rounded-lg border bg-white transition-all dark:bg-gray-800 ${
                  dragOverIndex === index
                    ? 'border-brand-500 ring-2 ring-brand-500 dark:border-brand-400 dark:ring-brand-400'
                    : 'border-gray-200 dark:border-gray-700'
                } ${busy ? '' : 'cursor-grab active:cursor-grabbing'}`}
              >
                <div className="flex aspect-video items-center justify-center bg-gray-50 dark:bg-gray-900">
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
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 flex-1 px-2"
                      onClick={() => moveFrame(index, index - 1)}
                      disabled={busy || index === 0}
                    >
                      上移
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="h-7 flex-1 px-2"
                      onClick={() => moveFrame(index, index + 1)}
                      disabled={busy || index === frames.length - 1}
                    >
                      下移
                    </Button>
                  </div>
                </div>
                <button
                  onClick={() => handleDeleteFrame(index)}
                  disabled={busy}
                  aria-label={`删除第 ${index + 1} 帧`}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-red-500 opacity-0 shadow-sm transition-opacity hover:bg-white group-hover:opacity-100 disabled:opacity-40 dark:bg-gray-800/90 dark:text-red-400 dark:hover:bg-gray-800"
                >
                  <Icon name="x" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card title="处理选项" description="去背景可让精灵表直接用于游戏引擎。">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={removeBg}
              disabled={busy}
              onChange={(event) => setRemoveBg(event.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 dark:border-gray-600 dark:bg-gray-800"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">去除背景</span>
          </label>

          {removeBg && (
            <div className="mt-4">
              <div className="mb-1.5 text-xs font-medium text-gray-700 dark:text-gray-300">去背景模式</div>
              <div className="space-y-2">
                <label className="block cursor-pointer">
                  <input
                    type="radio"
                    name="multi-remove-bg-mode"
                    checked={removeBgMode === 'standard'}
                    disabled={busy}
                    onChange={() => setRemoveBgMode('standard')}
                    className="peer sr-only"
                  />
                  <div className="rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-gray-300 peer-checked:border-brand-500 peer-checked:bg-brand-50/50 peer-checked:ring-1 peer-checked:ring-brand-500 peer-disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:peer-checked:bg-brand-500/10 dark:hover:border-gray-600">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">标准</div>
                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      边缘更干净，适合普通角色和道具。
                    </div>
                  </div>
                </label>
                <label className="block cursor-pointer">
                  <input
                    type="radio"
                    name="multi-remove-bg-mode"
                    checked={removeBgMode === 'conservative'}
                    disabled={busy}
                    onChange={() => setRemoveBgMode('conservative')}
                    className="peer sr-only"
                  />
                  <div className="rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-gray-300 peer-checked:border-brand-500 peer-checked:bg-brand-50/50 peer-checked:ring-1 peer-checked:ring-brand-500 peer-disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:peer-checked:bg-brand-500/10 dark:hover:border-gray-600">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">保守</div>
                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      优先保留弧光、残影和发光特效。
                    </div>
                  </div>
                </label>
                <label className="block cursor-pointer">
                  <input
                    type="radio"
                    name="multi-remove-bg-mode"
                    checked={removeBgMode === 'white'}
                    disabled={busy}
                    onChange={() => setRemoveBgMode('white')}
                    className="peer sr-only"
                  />
                  <div className="rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-gray-300 peer-checked:border-brand-500 peer-checked:bg-brand-50/50 peer-checked:ring-1 peer-checked:ring-brand-500 peer-disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:peer-checked:bg-brand-500/10 dark:hover:border-gray-600">
                    <div className="text-sm font-medium text-gray-900 dark:text-gray-100">单一背景</div>
                    <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      仅去除纯白或近纯白背景。
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}
        </Card>

        <Card title="精灵表布局" description="控制导出精灵表的列数与帧间距。">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                列数
              </label>
              <Input
                type="number"
                min="1"
                max="32"
                value={layout.cols}
                disabled={busy}
                onChange={(event) => setLayout((current) => ({ ...current, cols: parseInt(event.target.value) || 4 }))}
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
                disabled={busy}
                onChange={(event) => setLayout((current) => ({ ...current, padding: parseInt(event.target.value) || 0 }))}
              />
            </div>
          </div>
        </Card>
      </div>

      {isProcessing && (
        <Card className="mb-6">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Badge tone="brand" dot>
                处理中
              </Badge>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                {videoStageLabels[stage] || stage}
              </span>
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {Math.round(processProgress * 100)}%
            </span>
          </div>
          <ProgressBar value={processProgress} />
        </Card>
      )}

      <div className="flex justify-end">
        <Button
          size="lg"
          loading={isProcessing}
          onClick={() => void handleStartProcess()}
          disabled={busy || frames.length === 0}
        >
          生成精灵表
        </Button>
      </div>
    </PageShell>
  );
}
