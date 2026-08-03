import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ApiError, createImageJob, detectImageSegments } from '../api/client';
import type { DetectedSegment, ImageUploadResponse } from '../api/client';
import PageShell from '../components/PageShell';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Icon from '../components/ui/Icon';
import Input from '../components/ui/Input';
import Steps from '../components/ui/Steps';
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
    <div className="relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800">
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

  const showEmptyWarning =
    !isDetecting && !error && Boolean(allSegments[currentImage.image_id]) && currentSegments.length === 0;

  return (
    <PageShell
      title="确认切块"
      description={`系统会自动识别图块，再逐块识别主体并去除外部纯色背景后导出。${
        imageMetas.length > 1 ? ` 共 ${imageMetas.length} 张图片，已确认 ${Object.keys(allSegments).length} 张。` : ''
      }`}
      back={{ to: '/image', label: '返回上传' }}
      contentClassName="space-y-6"
    >
      <Steps steps={['上传图片', '确认切块', '导出结果']} current={1} />

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300">
          <Icon name="alert-circle" size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {showEmptyWarning && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-500/10 dark:text-amber-300">
          <Icon name="alert-triangle" size={16} className="mt-0.5 shrink-0" />
          <span>当前图片未检测到图块，可返回上一步重新上传素材图。</span>
        </div>
      )}

      {imageMetas.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {imageMetas.map((img, index) => {
            const confirmed = (allSegments[img.image_id]?.length ?? 0) > 0;
            return (
              <button
                key={img.image_id}
                type="button"
                onClick={() => setCurrentIndex(index)}
                className={`flex h-9 min-w-9 items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
                  index === currentIndex
                    ? 'border-brand-600 bg-brand-600 text-white dark:border-brand-500 dark:bg-brand-500'
                    : confirmed
                      ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100 dark:border-green-800 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700'
                }`}
              >
                {index + 1}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card title="切块预览" bodyClassName="p-4">
          {isDetecting ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <Icon name="loader" size={22} className="animate-spin" />
              正在自动识别图块...
            </div>
          ) : (
            <SegmentOverlay
              imageUrl={currentImage.url}
              segments={currentSegments}
              width={currentImage.width}
              height={currentImage.height}
            />
          )}
        </Card>

        <Card title="处理设置">
          <div className="space-y-4">
            <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs leading-5 text-gray-600 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400">
              {imageMetas.length > 1 && <div>当前: 第 {currentIndex + 1} / {imageMetas.length} 张</div>}
              <div>源图尺寸: {currentImage.width} × {currentImage.height}</div>
              <div className="mt-1">识别图块: {currentSegments.length} 个</div>
              <div className="mt-1">背景处理: 识别主体去除纯色背景</div>
              {totalItems > 0 && <div className="mt-1 font-medium">合并总计: {totalItems} 个图块</div>}
            </div>

            <div>
              <label htmlFor="segments-cols" className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                精灵表列数
              </label>
              <Input
                id="segments-cols"
                type="number"
                min={1}
                max={32}
                value={cols}
                onChange={(e) => setCols(Number(e.target.value))}
              />
            </div>

            <div>
              <label htmlFor="segments-padding" className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
                图块间距
              </label>
              <Input
                id="segments-padding"
                type="number"
                min={0}
                max={20}
                value={padding}
                onChange={(e) => setPadding(Number(e.target.value))}
              />
            </div>

            <div className="space-y-2 pt-1">
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => navigate('/image')}
              >
                重新上传
              </Button>
              <Button
                className="w-full"
                loading={isSubmitting}
                disabled={isDetecting || isSubmitting || !allConfirmed}
                onClick={() => void handleStart()}
              >
                {isSubmitting ? '正在创建任务...' : allConfirmed ? '开始处理' : '请确认所有图片'}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </PageShell>
  );
}
