import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadImage, type ImageUploadResponse } from '../api/client';
import PageShell from '../components/PageShell';
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
      title="图片切图"
      description="上传白底素材图，自动识别图块并逐块去背景。"
      align="center"
      contentClassName="flex w-full flex-col items-center"
    >
      {isUploading ? (
        <div className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
          <div className="mb-4 text-center text-lg font-medium text-gray-700 dark:text-gray-300">
            上传中... ({uploadProgress.current}/{uploadProgress.total})
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full rounded-full bg-green-600 transition-all"
              style={{ width: `${uploadProgress.total > 0 ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : (
        <div
          className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-16 text-center transition-all ${
            isDragging
              ? 'border-green-600 dark:border-green-400 bg-green-50 dark:bg-green-950'
              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
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

          <svg className="mb-4 h-12 w-12 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M3 7.5l4.5 4.5 3-3 4.5 4.5 3-3L21 13.5M3.75 6h16.5a.75.75 0 0 1 .75.75v10.5a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75V6.75A.75.75 0 0 1 3.75 6Z" />
          </svg>

          <div className="mb-2 text-base font-medium text-gray-700 dark:text-gray-300">拖放素材图到此处</div>
          <div className="text-sm text-gray-400 dark:text-gray-500">或点击选择文件（支持多选）</div>
          <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">支持 PNG、JPG、WebP，适合白底分离素材</div>
        </div>
      )}

      {error && (
        <div className="mt-6 w-full rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {images.length > 0 && (
        <div className="mt-6 w-full">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-700 dark:text-gray-300">已上传 {images.length} 张图片</h2>
            <button
              type="button"
              onClick={() => document.getElementById('image-file-input')?.click()}
              className="text-sm text-blue-600 hover:text-blue-500"
            >
              继续添加
            </button>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
            {images.map((img) => (
              <div key={img.meta.image_id} className="group relative rounded border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 p-2">
                <div className="transparent-preview-bg flex aspect-square items-center justify-center overflow-hidden rounded">
                  <img src={img.previewUrl} alt={img.file.name} className="max-h-full max-w-full object-contain" />
                </div>
                <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400" title={img.file.name}>
                  {img.file.name}
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleRemoveImage(img.meta.image_id); }}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-white dark:bg-gray-800 text-xs text-red-500 shadow-sm opacity-0 transition-opacity group-hover:opacity-100"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>

          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={handleNext}
              className="rounded-lg bg-gray-900 dark:bg-gray-100 dark:text-gray-900 px-8 py-3 text-sm font-bold text-white transition-colors hover:bg-gray-800 dark:hover:bg-gray-200 dark:hover:text-gray-900"
            >
              下一步 — 确认切图区域
            </button>
          </div>
        </div>
      )}
    </PageShell>
  );
}
