import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadVideo } from '../api/client';
import PageShell from '../components/PageShell';
import {
  createInitialWorkflowState,
  createWorkflowRouteState,
  setWorkflowState,
} from '../utils/workflowState';

export default function Upload() {
  const navigate = useNavigate();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handleUpload = useCallback(async (file: File) => {
    if (!file.type.match(/^video\/(mp4|webm)$/)) {
      setError('只支持 MP4 和 WebM 格式');
      return;
    }

    if (file.size > 500 * 1024 * 1024) {
      setError('文件大小不能超过 500MB');
      return;
    }

    setIsUploading(true);
    setError(null);

    try {
      const response = await uploadVideo(file, setProgress);
      setWorkflowState({
        ...createInitialWorkflowState(),
        currentStep: 'capture',
        videoMeta: response,
      });
      navigate(`/capture/${response.video_id}`, {
        state: createWorkflowRouteState({ videoMeta: response }),
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
      handleUpload(file);
    }
  }, [handleUpload]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUpload(file);
    }
  }, [handleUpload]);

  return (
    <PageShell
      title="视频处理"
      description="上传 MP4 或 WebM，自动截帧、去背景并导出精灵表。"
      align="center"
      contentClassName="flex w-full flex-col items-center"
    >
      {isUploading ? (
        <div className="w-full">
          <div className="mb-4 text-center text-lg font-medium text-gray-700 dark:text-gray-300">上传中...</div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
            <div
              className="h-full rounded-full bg-gray-900 dark:bg-gray-100 dark:text-gray-900 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-2 text-center text-sm text-gray-500 dark:text-gray-400">{progress}%</div>
        </div>
      ) : (
        <div
          className={`flex w-full cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-16 text-center transition-all ${
            isDragging
              ? 'border-gray-900 dark:border-gray-100 bg-gray-50 dark:bg-gray-800'
              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-800'
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => document.getElementById('file-input')?.click()}
        >
          <input
            id="file-input"
            type="file"
            accept="video/mp4,video/webm"
            className="hidden"
            onChange={handleFileSelect}
            disabled={isUploading}
          />

          <svg className="mb-4 h-12 w-12 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
          </svg>

          <div className="mb-2 text-base font-medium text-gray-700 dark:text-gray-300">拖放视频文件到此处</div>
          <div className="text-sm text-gray-400 dark:text-gray-500">或点击选择文件</div>
          <div className="mt-3 text-xs text-gray-400 dark:text-gray-500">支持 MP4、WebM 格式，最大 500MB</div>
        </div>
      )}

      {error && (
        <div className="mt-6 w-full rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400">
          {error}
        </div>
      )}
    </PageShell>
  );
}
