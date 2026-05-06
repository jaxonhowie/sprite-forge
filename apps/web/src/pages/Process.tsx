import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import BoxSelector from '../components/BoxSelector';

interface WatermarkBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Layout {
  cols: number;
  padding: number;
}

export default function Process() {
  const { videoId } = useParams<{ videoId: string }>();
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  const [timestamps, setTimestamps] = useState<number[]>([]);
  const [thumbnails, setThumbnails] = useState<Map<number, string>>(new Map());
  const [removeBg, setRemoveBg] = useState(true);
  const [enableWatermark, setEnableWatermark] = useState(false);
  const [watermarkBox, setWatermarkBox] = useState<WatermarkBox | null>(null);
  const [layout, setLayout] = useState<Layout>({ cols: 8, padding: 2 });
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  
  const wsRef = useRef<WebSocket | null>(null);

  const videoUrl = videoId ? `/files/uploads/${videoId}/source.mp4` : '';

  const captureThumbnail = useCallback((timeMs: number): Promise<string> => {
    return new Promise((resolve, reject) => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        reject(new Error('视频元素不可用'));
        return;
      }

      const onSeeked = () => {
        video.removeEventListener('seeked', onSeeked);
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('无法获取 canvas 上下文'));
          return;
        }
        ctx.drawImage(video, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      };

      video.addEventListener('seeked', onSeeked);
      video.currentTime = timeMs / 1000;
    });
  }, []);

  useEffect(() => {
    const stored = sessionStorage.getItem(`frames_${videoId}`);
    if (!stored) {
      setError('未找到帧数据，请返回重新截取');
      setLoading(false);
      return;
    }

    try {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        if (typeof parsed[0] === 'number') {
          setTimestamps(parsed);
        } else {
          setTimestamps(parsed.map((f: { ts_ms: number }) => f.ts_ms));
        }
      } else {
        setError('帧数据为空');
        setLoading(false);
      }
    } catch {
      setError('帧数据解析失败');
      setLoading(false);
    }
  }, [videoId]);

  const generateThumbnails = useCallback(async () => {
    if (timestamps.length === 0) return;

    const video = videoRef.current;
    if (!video || !video.duration) return;

    const map = new Map<number, string>();
    for (const ts of timestamps) {
      try {
        const dataUrl = await captureThumbnail(ts);
        map.set(ts, dataUrl);
      } catch {
        // skip failed thumbnails
      }
    }
    setThumbnails(map);
    setLoading(false);
  }, [timestamps, captureThumbnail]);

  useEffect(() => {
    if (timestamps.length > 0 && videoRef.current) {
      const video = videoRef.current;
      if (video.readyState >= 1) {
        generateThumbnails();
      } else {
        video.addEventListener('loadedmetadata', () => generateThumbnails(), { once: true });
      }
    }
  }, [timestamps, generateThumbnails]);

  const handleStartProcess = useCallback(async () => {
    if (timestamps.length === 0) {
      setError('没有可处理的帧');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          timestamps_ms: timestamps,
          remove_bg: removeBg,
          watermark_box: enableWatermark ? watermarkBox : null,
          layout: layout,
        }),
      });

      if (!response.ok) {
        throw new Error(`创建任务失败: ${response.status}`);
      }

      const { job_id } = await response.json();

      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws/jobs/${job_id}`;
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        setProgress(data.progress || 0);
        setStage(data.stage || '');
        
        if (data.status === 'done') {
          ws.close();
          navigate(`/result/${job_id}`);
        } else if (data.status === 'failed') {
          ws.close();
          setError(data.error || '处理失败');
          setIsProcessing(false);
        }
      };

      ws.onerror = () => {
        setError('WebSocket 连接失败');
        setIsProcessing(false);
      };

      ws.onclose = () => {
        if (isProcessing) {
          setError('连接断开');
          setIsProcessing(false);
        }
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : '处理失败');
      setIsProcessing(false);
    }
  }, [videoId, timestamps, removeBg, enableWatermark, watermarkBox, layout, navigate, isProcessing]);

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const handleBack = useCallback(() => {
    navigate(`/frames/${videoId}`);
  }, [videoId, navigate]);

  const stageLabels: Record<string, string> = {
    extract: '截帧',
    inpaint: '去水印',
    rembg: '去背景',
    pack: '打包精灵表',
  };

  const firstThumbnail = timestamps.length > 0 ? thumbnails.get(timestamps[0]) : undefined;

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold mb-8">处理设置</h2>

      <video
        ref={videoRef}
        src={videoUrl}
        preload="auto"
        className="hidden"
      />
      <canvas ref={canvasRef} className="hidden" />

      {error && (
        <div className="mb-6 p-4 bg-red-500/20 border border-red-500 rounded text-red-300">
          {error}
        </div>
      )}

      {isProcessing ? (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <div className="text-2xl font-bold mb-6">正在处理...</div>
          
          <div className="w-full bg-gray-700 rounded-full h-6 mb-4">
            <div
              className="bg-blue-500 h-6 rounded-full transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          
          <div className="text-lg text-gray-300">
            {stageLabels[stage] || stage} - {Math.round(progress * 100)}%
          </div>
          
          <div className="mt-4 text-sm text-gray-400">
            处理中请勿关闭页面
          </div>
        </div>
      ) : loading ? (
        <div className="text-center py-20 text-gray-400">
          <div className="text-6xl mb-4 animate-pulse">⏳</div>
          <div className="text-xl">正在加载帧数据...</div>
        </div>
      ) : (
        <>
          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h3 className="text-xl font-bold mb-4">帧预览 ({timestamps.length} 帧)</h3>
            <div className="flex flex-wrap gap-2">
              {timestamps.slice(0, 8).map((ts, i) => {
                const thumb = thumbnails.get(ts);
                return thumb ? (
                  <img
                    key={ts}
                    src={thumb}
                    alt={`帧 ${i + 1}`}
                    className="w-20 h-auto rounded"
                  />
                ) : (
                  <div key={ts} className="w-20 h-12 bg-gray-700 rounded flex items-center justify-center text-xs text-gray-400">
                    {Math.floor(ts / 1000)}s
                  </div>
                );
              })}
              {timestamps.length > 8 && (
                <div className="w-20 h-12 bg-gray-700 rounded flex items-center justify-center text-sm">
                  +{timestamps.length - 8}
                </div>
              )}
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h3 className="text-xl font-bold mb-4">处理选项</h3>
            
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={removeBg}
                  onChange={(e) => setRemoveBg(e.target.checked)}
                  className="w-5 h-5"
                />
                <span className="text-lg">去除背景 (rembg)</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={enableWatermark}
                  onChange={(e) => setEnableWatermark(e.target.checked)}
                  className="w-5 h-5"
                />
                <span className="text-lg">去除水印</span>
              </label>

              {enableWatermark && firstThumbnail && (
                <div className="ml-8 mt-4">
                  <p className="text-sm text-gray-400 mb-2">
                    在下方图片上框选水印区域
                  </p>
                  <BoxSelector
                    imageUrl={firstThumbnail}
                    onBoxChange={setWatermarkBox}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="bg-gray-800 rounded-lg p-6 mb-6">
            <h3 className="text-xl font-bold mb-4">精灵表布局</h3>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">列数</label>
                <input
                  type="number"
                  min="1"
                  max="32"
                  value={layout.cols}
                  onChange={(e) => setLayout(prev => ({ ...prev, cols: parseInt(e.target.value) || 8 }))}
                  className="w-full bg-gray-700 rounded px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">间距 (px)</label>
                <input
                  type="number"
                  min="0"
                  max="20"
                  value={layout.padding}
                  onChange={(e) => setLayout(prev => ({ ...prev, padding: parseInt(e.target.value) || 2 }))}
                  className="w-full bg-gray-700 rounded px-3 py-2"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={handleBack}
              className="px-6 py-3 bg-gray-700 rounded hover:bg-gray-600"
            >
              ← 返回
            </button>
            <button
              onClick={handleStartProcess}
              className="px-8 py-3 bg-green-600 rounded hover:bg-green-500 font-bold text-lg"
            >
              开始处理
            </button>
          </div>
        </>
      )}
    </div>
  );
}
