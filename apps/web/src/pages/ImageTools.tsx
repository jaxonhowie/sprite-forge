import { useCallback, useState } from 'react';
import {
  processImage,
  uploadImage,
  type ImageProcessBgMode,
  type ImageProcessOperation,
  type ImageProcessResponse,
  type ImageUploadResponse,
} from '../api/client';
import BoxSelector from '../components/BoxSelector';
import PageShell from '../components/PageShell';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Icon from '../components/ui/Icon';
import Select from '../components/ui/Select';
import Steps from '../components/ui/Steps';

interface WatermarkBoxValue {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ToolImage {
  meta: ImageUploadResponse;
  file: File;
  previewUrl: string;
  operation: ImageProcessOperation;
  removeBgMode: ImageProcessBgMode;
  watermarkBox: WatermarkBoxValue | null;
  processing: boolean;
  error: string | null;
  result: ImageProcessResponse | null;
}

const OPERATION_OPTIONS: { value: ImageProcessOperation; label: string }[] = [
  { value: 'remove_bg', label: '去除背景' },
  { value: 'remove_watermark', label: '去除水印' },
];

const REMOVE_BG_MODE_OPTIONS: { value: ImageProcessBgMode; label: string; hint: string }[] = [
  { value: 'standard', label: '标准识别', hint: 'AI 主体分割，适合大多数图片' },
  { value: 'conservative', label: '保守模式', hint: '保留半透明边缘与光效光晕' },
  { value: 'white', label: '白底优化', hint: '仅去除纯白/近白背景' },
  { value: 'solid', label: '纯色背景', hint: '去除任意纯色背景' },
];

export default function ImageTools() {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<ToolImage[]>([]);

  const currentStep = images.length === 0 ? 0 : images.some((img) => img.result) ? 2 : 1;

  const uploadFiles = useCallback(async (files: File[]) => {
    const validFiles: File[] = [];
    for (const file of files) {
      if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
        setError(`"${file.name}" 格式不支持，只支持 PNG、JPG、WebP`);
        return;
      }
      if (file.size > 500 * 1024 * 1024) {
        setError(`"${file.name}" 大小不能超过 500MB`);
        return;
      }
      validFiles.push(file);
    }

    if (validFiles.length === 0) return;

    setIsUploading(true);
    setError(null);

    const newImages: ToolImage[] = [];
    for (const file of validFiles) {
      try {
        const response = await uploadImage(file);
        newImages.push({
          meta: response,
          file,
          previewUrl: URL.createObjectURL(file),
          operation: 'remove_bg',
          removeBgMode: 'standard',
          watermarkBox: null,
          processing: false,
          error: null,
          result: null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : `"${file.name}" 上传失败`);
        setIsUploading(false);
        return;
      }
    }

    setImages((prev) => [...prev, ...newImages]);
    setIsUploading(false);
  }, []);

  const updateImage = useCallback((imageId: string, patch: Partial<ToolImage>) => {
    setImages((prev) =>
      prev.map((img) => (img.meta.image_id === imageId ? { ...img, ...patch } : img))
    );
  }, []);

  const handleRemoveImage = useCallback((imageId: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.meta.image_id === imageId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.meta.image_id !== imageId);
    });
  }, []);

  const handleProcess = useCallback(async (image: ToolImage) => {
    updateImage(image.meta.image_id, { processing: true, error: null });
    try {
      const result = await processImage(image.meta.image_id, {
        operation: image.operation,
        remove_bg_mode: image.removeBgMode,
        watermark_box: image.operation === 'remove_watermark' ? image.watermarkBox : null,
      });
      updateImage(image.meta.image_id, { processing: false, result });
    } catch (err) {
      updateImage(image.meta.image_id, {
        processing: false,
        error: err instanceof Error ? err.message : '处理失败，请稍后重试',
      });
    }
  }, [updateImage]);

  const handleDownload = useCallback((result: ImageProcessResponse) => {
    const anchor = document.createElement('a');
    anchor.href = result.result_url;
    anchor.download = result.result_url.split('/').pop() ?? 'result.png';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      void uploadFiles(files);
    }
  }, [uploadFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) {
      void uploadFiles(files);
    }
    e.target.value = '';
  }, [uploadFiles]);

  return (
    <PageShell
      title="图片处理"
      description="上传图片，逐张去除背景或框选去除水印，处理结果可直接下载。"
      align="center"
      contentClassName="mx-auto w-full max-w-4xl space-y-6"
    >
      <Steps steps={['上传图片', '选择处理方式', '查看结果']} current={currentStep} />

      <div
        className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
          isDragging
            ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-500/10'
            : 'border-gray-300 bg-white hover:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-brand-600'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => document.getElementById('image-tools-file-input')?.click()}
      >
        <input
          id="image-tools-file-input"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
          <Icon name="upload" size={22} />
        </span>
        <p className="mt-4 text-sm font-medium text-gray-900 dark:text-gray-100">
          {isUploading ? '正在上传图片…' : '拖放图片到此处'}
        </p>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          或点击选择文件（支持多选），支持 PNG、JPG、WebP
        </p>
        <Button
          variant="secondary"
          className="mt-5"
          loading={isUploading}
          onClick={(e) => {
            e.stopPropagation();
            document.getElementById('image-tools-file-input')?.click();
          }}
        >
          选择文件
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300">
          <Icon name="alert-circle" size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {images.map((image) => {
        const imageId = image.meta.image_id;
        const canProcess =
          !image.processing &&
          (image.operation === 'remove_bg' || image.watermarkBox !== null);

        return (
          <Card
            key={imageId}
            title={image.file.name}
            description={`${image.meta.width} × ${image.meta.height}`}
            actions={
              <Button
                variant="ghost"
                size="sm"
                aria-label={`删除 ${image.file.name}`}
                onClick={() => handleRemoveImage(imageId)}
              >
                <Icon name="trash" size={14} />
                删除
              </Button>
            }
          >
            <div className="flex flex-col gap-5 sm:flex-row">
              <div className="transparent-preview-bg flex h-40 w-full shrink-0 items-center justify-center overflow-hidden rounded-lg border border-gray-200 sm:w-40 dark:border-gray-700">
                <img
                  src={image.previewUrl}
                  alt={image.file.name}
                  className="max-h-full max-w-full object-contain"
                />
              </div>

              <div className="min-w-0 flex-1 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">
                      处理方式
                    </span>
                    <Select
                      value={image.operation}
                      disabled={image.processing}
                      onChange={(e) =>
                        updateImage(imageId, {
                          operation: e.target.value as ImageProcessOperation,
                          watermarkBox: null,
                          error: null,
                        })
                      }
                    >
                      {OPERATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </label>

                  {image.operation === 'remove_bg' && (
                    <label className="block">
                      <span className="mb-1.5 block text-xs font-medium text-gray-600 dark:text-gray-400">
                        去背景模式
                      </span>
                      <Select
                        value={image.removeBgMode}
                        disabled={image.processing}
                        onChange={(e) =>
                          updateImage(imageId, {
                            removeBgMode: e.target.value as ImageProcessBgMode,
                          })
                        }
                      >
                        {REMOVE_BG_MODE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    </label>
                  )}
                </div>

                {image.operation === 'remove_bg' && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {REMOVE_BG_MODE_OPTIONS.find((option) => option.value === image.removeBgMode)?.hint}
                  </p>
                )}

                {image.operation === 'remove_watermark' && (
                  <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-800/60">
                    <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                      在下方图片上框选水印区域
                    </p>
                    <div className="max-w-md">
                      <BoxSelector
                        key={`${imageId}-watermark`}
                        imageUrl={image.previewUrl}
                        onBoxChange={(box) => updateImage(imageId, { watermarkBox: box })}
                      />
                    </div>
                  </div>
                )}

                {image.error && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300">
                    <Icon name="alert-circle" size={15} className="mt-0.5 shrink-0" />
                    <span>{image.error}</span>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  <Button
                    onClick={() => void handleProcess(image)}
                    loading={image.processing}
                    disabled={!canProcess}
                  >
                    {image.processing ? '处理中…' : '开始处理'}
                  </Button>
                  {image.operation === 'remove_watermark' && !image.watermarkBox && (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      请先框选水印区域
                    </span>
                  )}
                </div>
              </div>
            </div>

            {image.result && (
              <div className="mt-5 border-t border-gray-100 pt-5 dark:border-gray-800">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">原图</p>
                    <div className="flex h-48 items-center justify-center overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/60">
                      <img
                        src={image.previewUrl}
                        alt={`${image.file.name} 原图`}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 text-xs font-medium text-gray-600 dark:text-gray-400">
                      处理结果
                    </p>
                    <div className="transparent-preview-bg flex h-48 items-center justify-center overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
                      <img
                        src={image.result.result_url}
                        alt={`${image.file.name} 处理结果`}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button variant="secondary" onClick={() => handleDownload(image.result!)}>
                    <Icon name="download" size={15} />
                    下载结果
                  </Button>
                </div>
              </div>
            )}
          </Card>
        );
      })}
    </PageShell>
  );
}
