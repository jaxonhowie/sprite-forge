import { useState, useEffect, useRef } from 'react';
import type { WsJobUpdate } from '../api/client';

interface UseJobProgressOptions {
  jobId: string | null;
  jobType?: 'video' | 'image';
  onComplete?: (jobId: string) => void;
  onError?: (error: string) => void;
}

interface UseJobProgressReturn {
  progress: number;
  stage: string;
  status: string;
  message: string;
  isConnected: boolean;
  error: string | null;
}

export function useJobProgress({
  jobId,
  jobType = 'video',
  onComplete,
  onError,
}: UseJobProgressOptions): UseJobProgressReturn {
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
  }, [onComplete, onError]);

  useEffect(() => {
    if (!jobId) return;

    const wsPath = jobType === 'image' ? `/ws/image-jobs/${jobId}` : `/ws/jobs/${jobId}`;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProtocol}//${window.location.host}${wsPath}`;

    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const data: WsJobUpdate = JSON.parse(event.data);

        if (data.progress !== undefined) {
          setProgress(data.progress);
        }

        if (data.stage) {
          setStage(data.stage);
        }

        if (data.status) {
          setStatus(data.status);
        }

        if (data.message) {
          setMessage(data.message);
        }

        if (data.status === 'done') {
          onCompleteRef.current?.(jobId);
        }

        if (data.status === 'failed' || data.error) {
          const errorMsg = data.error || '处理失败';
          setError(errorMsg);
          onErrorRef.current?.(errorMsg);
        }
      } catch (err) {
        console.error('解析 WebSocket 消息失败:', err);
      }
    };

    ws.onerror = () => {
      setError('WebSocket 连接失败');
      setIsConnected(false);
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, [jobId, jobType]);

  return { progress, stage, status, message, isConnected, error };
}

export default useJobProgress;
