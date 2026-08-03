import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadVideo, type VideoUploadResponse } from '../api/client';
import PageShell from '../components/PageShell';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Icon from '../components/ui/Icon';
import ProgressBar from '../components/ui/ProgressBar';
import Steps from '../components/ui/Steps';
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
  const [uploadedMeta, setUploadedMeta] = useState<VideoUploadResponse | null>(null);

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
    setUploadedMeta(null);

    try {
      const response = await uploadVideo(file, setProgress);
      setWorkflowState({
        ...createInitialWorkflowState(),
        currentStep: 'capture',
        videoMeta: response,
      });
      setUploadedMeta(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setIsUploading(false);
    }
  }, []);

  const handleStartCapture = useCallback(() => {
    if (!uploadedMeta) return;
    navigate(`/capture/${uploadedMeta.video_id}`, {
      state: createWorkflowRouteState({ videoMeta: uploadedMeta }),
    });
  }, [navigate, uploadedMeta]);

  const handleReset = useCallback(() => {
    setUploadedMeta(null);
    setError(null);
    setProgress(0);
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
      description="上传 MP4 或 WebM 视频，自动截帧、去背景并导出精灵表。"
      align="center"
      contentClassName="mx-auto w-full max-w-2xl space-y-6"
    >
      <Steps steps={['上传视频', '截取帧', '确认帧', '处理设置', '导出结果']} current={0} />

      {uploadedMeta ? (
        <Card title="上传成功" description="视频信息已解析完成，确认后开始截取关键帧。">
          <dl className="grid grid-cols-3 gap-4">
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">时长</dt>
              <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                {(uploadedMeta.duration_ms / 1000).toFixed(1)} 秒
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">分辨率</dt>
              <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                {uploadedMeta.width} × {uploadedMeta.height}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500 dark:text-gray-400">帧率</dt>
              <dd className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">
                {uploadedMeta.fps} fps
              </dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 border-t border-gray-100 pt-5 dark:border-gray-800">
            <Button size="lg" onClick={handleStartCapture}>
              开始截帧
              <Icon name="arrow-right" size={16} />
            </Button>
            <Button variant="ghost" size="lg" onClick={handleReset}>
              重新上传
            </Button>
          </div>
        </Card>
      ) : isUploading ? (
        <Card>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">正在上传视频…</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">大文件可能需要一些时间，请耐心等待</p>
            <ProgressBar value={progress / 100} className="mt-4" />
            <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{progress}%</p>
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

          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500">
            <Icon name="upload" size={22} />
          </span>
          <p className="mt-4 text-sm font-medium text-gray-900 dark:text-gray-100">拖放视频文件到此处</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">或点击选择文件，支持 MP4、WebM 格式，最大 500MB</p>
          <Button
            variant="secondary"
            className="mt-5"
            onClick={(e) => {
              e.stopPropagation();
              document.getElementById('file-input')?.click();
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
    </PageShell>
  );
}
