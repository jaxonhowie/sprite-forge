import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadImage } from '../api/client';
import {
  createImageWorkflowRouteState,
  createInitialImageWorkflowState,
  setImageWorkflowState,
} from '../utils/imageWorkflowState';

export default function ImageUpload() {
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = useCallback(async (file: File) => {
    if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
      setError('只支持 PNG、JPG、WebP 格式');
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      setError('文件大小不能超过 500MB');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const response = await uploadImage(file, setProgress);
      setImageWorkflowState({
        ...createInitialImageWorkflowState(),
        currentStep: 'segments',
        imageMeta: response,
      });
      navigate(`/image/segments/${response.image_id}`, {
        state: createImageWorkflowRouteState({ imageMeta: response }),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setIsUploading(false);
    }
  }, [navigate]);

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

    const file = e.dataTransfer.files[0];
    if (file) {
      void handleUpload(file);
    }
  }, [handleUpload]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleUpload(file);
    }
  }, [handleUpload]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center">
      <div className="mb-10 mt-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight text-gray-900">图片切图</h1>
        <p className="mt-3 text-sm text-gray-500">上传白底素材图，自动识别图块并逐块去背景</p>
      </div>

      {isUploading ? (
        <div className="w-full rounded-lg border border-gray-200 bg-white p-6">
          <div className="mb-4 text-center text-lg font-medium text-gray-700">上传中...</div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div className="h-full rounded-full bg-green-600 transition-all" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-2 text-center text-sm text-gray-500">{progress}%</div>
        </div>
      ) : (
        <div
          className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-16 text-center transition-all ${
            isDragging
              ? 'border-green-600 bg-green-50'
              : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
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
            className="hidden"
            onChange={handleFileSelect}
            disabled={isUploading}
          />

          <svg className="mb-4 h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M3 7.5l4.5 4.5 3-3 4.5 4.5 3-3L21 13.5M3.75 6h16.5A.75.75 0 0 1 21 6.75v10.5a.75.75 0 0 1-.75.75H3.75a.75.75 0 0 1-.75-.75V6.75A.75.75 0 0 1 3.75 6Z" />
          </svg>

          <div className="mb-2 text-base font-medium text-gray-700">拖放素材图到此处</div>
          <div className="text-sm text-gray-400">或点击选择文件</div>
          <div className="mt-3 text-xs text-gray-400">支持 PNG、JPG、WebP，适合白底分离素材</div>
        </div>
      )}

      {error && (
        <div className="mt-6 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}
