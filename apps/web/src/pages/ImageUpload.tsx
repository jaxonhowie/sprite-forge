import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadImage, type ImageUploadResponse } from '../api/client';
import PageShell from '../components/PageShell';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Icon from '../components/ui/Icon';
import ProgressBar from '../components/ui/ProgressBar';
import Steps from '../components/ui/Steps';
import {
  createImageWorkflowRouteState,
  createInitialImageWorkflowState,
  setImageWorkflowState,
} from '../utils/imageWorkflowState';

interface UploadedImage {
  meta: ImageUploadResponse;
  file: File;
  previewUrl: string;
}

export default function ImageUpload() {
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<UploadedImage[]>([]);

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
    setUploadProgress({ current: 0, total: validFiles.length });

    const newImages: UploadedImage[] = [];
    for (let i = 0; i < validFiles.length; i++) {
      setUploadProgress({ current: i, total: validFiles.length });
      try {
        const response = await uploadImage(validFiles[i]);
        newImages.push({
          meta: response,
          file: validFiles[i],
          previewUrl: URL.createObjectURL(validFiles[i]),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : `"${validFiles[i].name}" 上传失败`);
        setIsUploading(false);
        return;
      }
    }

    setImages((prev) => [...prev, ...newImages]);
    setIsUploading(false);
  }, []);

  const handleRemoveImage = useCallback((imageId: string) => {
    setImages((prev) => {
      const target = prev.find((img) => img.meta.image_id === imageId);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((img) => img.meta.image_id !== imageId);
    });
  }, []);

  const handleNext = useCallback(() => {
    if (images.length === 0) return;

    const imageMetas = images.map((img) => img.meta);
    setImageWorkflowState({
      ...createInitialImageWorkflowState(),
      currentStep: 'segments',
      imageMetas,
    });
    navigate('/image/segments', {
      state: createImageWorkflowRouteState({ imageMetas }),
    });
  }, [images, navigate]);

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
      title="提取要素"
      description="上传白底素材图，自动识别图块并逐块去背景。"
      align="center"
      contentClassName="mx-auto w-full max-w-3xl space-y-6"
    >
      <Steps steps={['上传图片', '确认切块', '导出结果']} current={0} />

      {isUploading ? (
        <Card>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              正在上传图片… ({uploadProgress.current}/{uploadProgress.total})
            </p>
            <ProgressBar
              value={uploadProgress.total > 0 ? uploadProgress.current / uploadProgress.total : 0}
              className="mt-4"
            />
          </div>
        </Card>
      ) : (
        <div
          className={`cursor-pointer rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
            isDragging
              ? 'border-brand-500 bg-brand-50/50 dark:bg-brand-500/10'
              : 'border-gray-300 bg-white hover:border-brand-400 dark:border-gray-700 dark:bg-gray-900 dark:hover:border-brand-600'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => document.getElementById('image-file-input')?.click()}
        >
          <input
            id="image-file-input"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
            <Icon name="upload" size={22} />
          </span>
          <p className="mt-4 text-sm font-medium text-gray-900 dark:text-gray-100">拖放素材图到此处</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">或点击选择文件（支持多选），支持 PNG、JPG、WebP，适合白底分离素材</p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={(e) => {
              e.stopPropagation();
              document.getElementById('image-file-input')?.click();
            }}
          >
            选择文件
          </Button>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-500/10 dark:text-red-300">
          <Icon name="alert-circle" size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {images.length > 0 && (
        <Card
          title={`已上传 ${images.length} 张图片`}
          actions={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => document.getElementById('image-file-input')?.click()}
            >
              <Icon name="plus" size={14} />
              继续添加
            </Button>
          }
        >
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {images.map((img) => (
              <div
                key={img.meta.image_id}
                className="group relative overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="transparent-preview-bg flex aspect-square items-center justify-center overflow-hidden">
                  <img src={img.previewUrl} alt={img.file.name} className="max-h-full max-w-full object-contain" />
                </div>
                <div className="truncate px-2 py-1.5 text-xs text-gray-500 dark:text-gray-400" title={img.file.name}>
                  {img.file.name}
                </div>
                <button
                  type="button"
                  aria-label={`删除 ${img.file.name}`}
                  onClick={(e) => { e.stopPropagation(); handleRemoveImage(img.meta.image_id); }}
                  className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-gray-500 opacity-0 shadow-sm transition hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 group-hover:opacity-100 dark:bg-gray-800/90 dark:text-gray-400 dark:hover:text-red-400"
                >
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))}
          </div>

          <div className="mt-6 flex justify-center border-t border-gray-100 pt-5 dark:border-gray-800">
            <Button size="lg" onClick={handleNext}>
              下一步 — 确认切图区域
              <Icon name="arrow-right" size={16} />
            </Button>
          </div>
        </Card>
      )}
    </PageShell>
  );
}
