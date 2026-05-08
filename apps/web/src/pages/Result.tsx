import { useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { deleteVideo } from '../api/client';
import { clearWorkflow } from '../utils/workflowState';

interface JobResult {
  id: string;
  video_id: string;
  status: string;
  progress: number;
  stage: string;
  error: string | null;
  result: {
    spritesheet_url: string;
    json_url: string;
    frame_urls?: string[];
  } | null;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function Result() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  
  const { data: job, error, isLoading } = useSWR<JobResult>(
    jobId ? `/api/jobs/${jobId}` : null,
    fetcher,
    { refreshInterval: 1000 }
  );

  const handleDownloadPng = useCallback(() => {
    if (job?.result?.spritesheet_url) {
      window.open(job.result.spritesheet_url, '_blank');
    }
  }, [job]);

  const handleDownloadZip = useCallback(async () => {
    if (!jobId) return;
    
    try {
      const response = await fetch(`/api/jobs/${jobId}/export.zip`);
      if (!response.ok) throw new Error('下载失败');
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `spritesheet_${jobId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('下载失败:', err);
    }
  }, [jobId]);

  const handleNewProject = useCallback(async () => {
    if (job?.video_id) {
      clearWorkflow(job.video_id);
      try {
        await deleteVideo(job.video_id);
      } catch {
        // Finished result cleanup should not block returning to upload.
      }
    }
    navigate('/');
  }, [job?.video_id, navigate]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <div className="text-2xl">加载中...</div>
      </div>
    );
  }

  if (error || !job) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <div className="text-2xl text-red-400 mb-4">加载失败</div>
        <button
          onClick={handleNewProject}
          className="px-6 py-3 bg-blue-600 rounded hover:bg-blue-500"
        >
          返回首页
        </button>
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <div className="text-6xl mb-4">❌</div>
        <div className="text-2xl text-red-400 mb-2">处理失败</div>
        <div className="text-gray-400 mb-8">{job.error || '未知错误'}</div>
        <button
          onClick={handleNewProject}
          className="px-6 py-3 bg-blue-600 rounded hover:bg-blue-500"
        >
          重新开始
        </button>
      </div>
    );
  }

  if (job.status !== 'done') {
    const stageLabels: Record<string, string> = {
      extract: '截帧',
      inpaint: '去水印',
      rembg: '去背景',
      pack: '打包精灵表',
    };

    return (
      <div className="max-w-4xl mx-auto text-center py-20">
        <div className="text-2xl font-bold mb-6">正在处理...</div>
        <div className="w-full max-w-md mx-auto bg-gray-700 rounded-full h-6 mb-4">
          <div
            className="bg-blue-500 h-6 rounded-full transition-all"
            style={{ width: `${Math.round(job.progress * 100)}%` }}
          />
        </div>
        <div className="text-lg text-gray-300">
          {stageLabels[job.stage] || job.stage} - {Math.round(job.progress * 100)}%
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold mb-8 text-center">处理完成</h2>

      <div className="bg-gray-800 rounded-lg p-6 mb-8">
        <h3 className="text-xl font-bold mb-4">精灵表预览</h3>
        {job.result?.spritesheet_url && (
          <div className="relative overflow-auto max-h-[60vh] bg-gray-900 rounded">
            <img
              src={job.result.spritesheet_url}
              alt="精灵表"
              className="max-w-full h-auto"
            />
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row justify-center gap-4">
        <button
          onClick={handleDownloadPng}
          className="px-8 py-3 bg-blue-600 rounded hover:bg-blue-500 font-bold"
        >
          下载 PNG
        </button>
        <button
          onClick={handleDownloadZip}
          className="px-8 py-3 bg-green-600 rounded hover:bg-green-500 font-bold"
        >
          下载 ZIP (PNG + JSON)
        </button>
        <button
          onClick={handleNewProject}
          className="px-8 py-3 bg-gray-700 rounded hover:bg-gray-600"
        >
          新项目
        </button>
      </div>
    </div>
  );
}
