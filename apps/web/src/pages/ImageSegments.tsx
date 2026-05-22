import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, createImageJob, detectImageSegments } from '../api/client';
import type { DetectedSegment, ImageUploadResponse } from '../api/client';
import {
  createImageWorkflowRouteState,
  getImageWorkflowState,
  mergeImageWorkflowState,
  type ImageWorkflowRouteState,
} from '../utils/imageWorkflowState';

function SegmentOverlay({
  imageUrl,
  segments,
  width,
  height,
}: {
  imageUrl: string;
  segments: DetectedSegment[];
  width: number;
  height: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
      <img src={imageUrl} alt="切图预览" className="h-auto max-w-full" />
      <div className="pointer-events-none absolute inset-0">
        {segments.map((segment) => (
          <div
            key={segment.index}
            className="absolute border border-blue-500 bg-blue-500/10"
            style={{
              left: `${(segment.box.x / width) * 100}%`,
              top: `${(segment.box.y / height) * 100}%`,
              width: `${(segment.box.w / width) * 100}%`,
              height: `${(segment.box.h / height) * 100}%`,
            }}
          >
            <span className="absolute left-0 top-0 bg-blue-600 px-1.5 py-0.5 text-xs text-white">
              {segment.index + 1}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ImageSegments() {
  const location = useLocation();
  const navigate = useNavigate();
  const locationState = location.state as ImageWorkflowRouteState | null;
  const workflowState = useMemo(() => getImageWorkflowState(), []);
  const imageMetas: ImageUploadResponse[] = locationState?.imageMetas ?? workflowState?.imageMetas ?? [];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [allSegments, setAllSegments] = useState<Record<string, DetectedSegment[]>>({});
  const [cols, setCols] = useState(workflowState?.settings.layout.cols ?? 6);
  const [padding, setPadding] = useState(workflowState?.settings.layout.padding ?? 2);
  const [isDetecting, setIsDetecting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentImage = imageMetas[currentIndex] ?? null;
  const currentSegments = currentImage ? (allSegments[currentImage.image_id] ?? []) : [];
  const allConfirmed = imageMetas.length > 0 && imageMetas.every((m) => (allSegments[m.image_id]?.length ?? 0) > 0);
  const totalItems = imageMetas.reduce((sum, m) => sum + (allSegments[m.image_id]?.length ?? 0), 0);

  useEffect(() => {
    if (imageMetas.length === 0) {
      navigate('/image', { replace: true });
    }
  }, [imageMetas, navigate]);

  // Detect segments for the current image if not yet done
  useEffect(() => {
    if (!currentImage) return;
    if (allSegments[currentImage.image_id]) return;

    let cancelled = false;

    const run = async () => {
      setIsDetecting(true);
      setError(null);
      try {
        const response = await detectImageSegments(currentImage.image_id);
        if (cancelled) return;
        setAllSegments((prev) => ({ ...prev, [currentImage.image_id]: response.segments }));
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError(err instanceof Error ? err.message : '自动切图失败');
        }
      } finally {
        if (!cancelled) {
          setIsDetecting(false);
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [currentImage, allSegments]);

  const handleStart = useCallback(async () => {
    if (!allConfirmed || totalItems === 0) return;

    setIsSubmitting(true);
    setError(null);

    try {
      mergeImageWorkflowState({
        currentStep: 'segments',
        imageMetas,
        settings: { layout: { cols, padding } },
      });

      const images = imageMetas.map((m) => ({
        image_id: m.image_id,
        boxes: (allSegments[m.image_id] ?? []).map((s) => s.box),
      }));

      const response = await createImageJob({
        images,
        remove_bg: true,
        layout: { cols, padding },
      });

      mergeImageWorkflowState({
        currentStep: 'result',
        imageMetas,
        jobId: response.job_id,
        settings: { layout: { cols, padding } },
      });

      navigate(`/image/result/${response.job_id}`, {
        state: createImageWorkflowRouteState({
          imageMetas,
          jobId: response.job_id,
        }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建任务失败');
    } finally {
      setIsSubmitting(false);
    }
  }, [allConfirmed, allSegments, cols, imageMetas, navigate, padding, totalItems]);

  if (imageMetas.length === 0 || !currentImage) {
    return null;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">确认切图结果</h1>
        <p className="mt-2 text-sm text-gray-500">
          系统会基于白底自动识别图块，再逐块去背景并导出。
          {imageMetas.length > 1 && ` 共 ${imageMetas.length} 张图片，已确认 ${Object.keys(allSegments).length} 张。`}
        </p>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {imageMetas.length > 1 && (
        <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-2">
          {imageMetas.map((img, index) => {
            const confirmed = (allSegments[img.image_id]?.length ?? 0) > 0;
            return (
              <button
                key={img.image_id}
                type="button"
                onClick={() => setCurrentIndex(index)}
                className={`flex h-10 min-w-10 items-center justify-center rounded-full border text-sm font-medium transition ${
                  index === currentIndex
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : confirmed
                      ? 'border-green-300 bg-green-50 text-green-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          {isDetecting ? (
            <div className="flex min-h-[320px] items-center justify-center text-sm text-gray-500">正在自动识别图块...</div>
          ) : (
            <SegmentOverlay
              imageUrl={currentImage.url}
              segments={currentSegments}
              width={currentImage.width}
              height={currentImage.height}
            />
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-gray-900">处理设置</h2>
          <div className="mt-4 space-y-4">
            <div className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-600">
              {imageMetas.length > 1 && <div>当前: 第 {currentIndex + 1} / {imageMetas.length} 张</div>}
              <div>源图尺寸: {currentImage.width} × {currentImage.height}</div>
              <div className="mt-1">识别图块: {currentSegments.length} 个</div>
              <div className="mt-1">背景处理: 自动去背景</div>
              {totalItems > 0 && <div className="mt-1 font-medium">合并总计: {totalItems} 个图块</div>}
            </div>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">精灵表列数</span>
              <input
                type="number"
                min={1}
                max={32}
                value={cols}
                onChange={(e) => setCols(Number(e.target.value))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium text-gray-700">图块间距</span>
              <input
                type="number"
                min={0}
                max={20}
                value={padding}
                onChange={(e) => setPadding(Number(e.target.value))}
                className="w-full rounded border border-gray-300 px-3 py-2 text-sm outline-none transition focus:border-blue-500"
              />
            </label>

            <button
              type="button"
              onClick={() => navigate('/image')}
              className="w-full rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              重新上传
            </button>
            <button
              type="button"
              onClick={() => void handleStart()}
              disabled={isDetecting || isSubmitting || !allConfirmed}
              className="w-full rounded bg-green-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-green-500 disabled:cursor-not-allowed disabled:bg-green-300"
            >
              {isSubmitting ? '正在创建任务...' : allConfirmed ? '开始处理' : '请确认所有图片'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
