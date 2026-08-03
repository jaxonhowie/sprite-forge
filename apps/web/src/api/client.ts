export interface VideoUploadResponse {
  video_id: string;
  duration_ms: number;
  fps: number;
  width: number;
  height: number;
  url: string;
}

export interface VideoMeta {
  video_id: string;
  duration_ms: number;
  fps: number;
  width: number;
  height: number;
  url: string;
}

export interface ExtractedFramePreview {
  ts_ms: number;
  url: string;
}

export interface ExtractFramesResponse {
  frames: ExtractedFramePreview[];
}

export interface ImageUploadResponse {
  image_id: string;
  width: number;
  height: number;
  url: string;
}

export type ImageProcessOperation = 'remove_bg' | 'remove_watermark';
export type ImageProcessBgMode = 'standard' | 'conservative' | 'white' | 'solid';

export interface ImageProcessRequest {
  operation: ImageProcessOperation;
  remove_bg_mode?: ImageProcessBgMode;
  watermark_box?: {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
}

export interface ImageProcessResponse {
  image_id: string;
  operation: ImageProcessOperation;
  result_url: string;
  width: number;
  height: number;
}

export interface SegmentBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DetectedSegment {
  index: number;
  box: SegmentBox;
}

export interface DetectSegmentsResponse {
  segments: DetectedSegment[];
}

export interface CreateJobRequest {
  video_id: string;
  timestamps_ms: number[];
  remove_bg: boolean;
  remove_bg_mode: 'standard' | 'conservative' | 'white';
  watermark_box: {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
  layout: {
    cols: number;
    padding: number;
  };
}

export interface JobResponse {
  job_id: string;
  status: string;
}

export interface ImageEntry {
  image_id: string;
  boxes: SegmentBox[];
}

export interface CreateImageJobRequest {
  images: ImageEntry[];
  remove_bg: boolean;
  layout: {
    cols: number;
    padding: number;
  };
}

export interface FrameAssemblySource {
  video_id: string;
  ts_ms: number;
  x_offset: number;
  y_offset: number;
}

export interface CreateFrameAssemblyJobRequest {
  frames: FrameAssemblySource[];
  remove_bg: boolean;
  remove_bg_mode: 'standard' | 'conservative' | 'white';
  layout: {
    cols: number;
    padding: number;
  };
}

export interface FrameOffset {
  x: number;
  y: number;
}

export interface JobStatus {
  id: string;
  video_id: string;
  status: string;
  progress: number;
  stage: string;
  params: CreateJobRequest;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  result?: {
    spritesheet_url: string;
    json_url: string;
    frame_urls?: string[];
    video_ids?: string[];
  };
}

export interface ImageJobStatus {
  id: string;
  image_ids: string[];
  status: string;
  progress: number;
  stage: string;
  params: CreateImageJobRequest;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  result?: {
    spritesheet_url: string;
    json_url: string;
    manifest_url: string;
    item_urls: string[];
  };
}

export type EngineExportTarget = 'generic' | 'cocos' | 'unity' | 'godot' | 'frames' | 'gif';
export type ImageExportTarget = 'generic' | 'items' | 'gif' | 'cocos' | 'unity' | 'godot';

export interface WsJobUpdate {
  stage: string;
  progress: number;
  status: string;
  message?: string;
  error?: string;
}

const BASE_URL = '';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const EXPORT_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function createTimeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timeoutId),
  };
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  options: RequestInit = {},
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS
): Promise<Response> {
  const timeout = createTimeoutSignal(timeoutMs);

  try {
    return await fetch(input, {
      ...options,
      signal: timeout.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('请求超时，请稍后重试');
    }
    throw err;
  } finally {
    timeout.clear();
  }
}

export async function downloadBlobWithTimeout(
  url: string,
  timeoutMs = EXPORT_DOWNLOAD_TIMEOUT_MS
): Promise<Blob> {
  const timeout = createTimeoutSignal(timeoutMs);

  try {
    const response = await fetch(url, { signal: timeout.signal });
    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText);
      throw new ApiError(response.status, `导出失败 (${response.status}): ${error}`);
    }
    return await response.blob();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('导出超时，请稍后重试或减少导出内容');
    }
    throw err;
  } finally {
    timeout.clear();
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.text().catch(() => response.statusText);
    throw new ApiError(response.status, `请求失败 (${response.status}): ${error}`);
  }

  return response.json();
}

function uploadFile<T>(endpoint: string, file: File, onProgress?: (progress: number) => void): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);

  const xhr = new XMLHttpRequest();

  return new Promise((resolve, reject) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    });

    xhr.onload = () => {
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(`上传失败: ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.open('POST', endpoint);
    xhr.send(formData);
  });
}

export function uploadVideo(file: File, onProgress?: (progress: number) => void): Promise<VideoUploadResponse> {
  return uploadFile<VideoUploadResponse>('/api/videos', file, onProgress);
}

export function uploadImage(file: File, onProgress?: (progress: number) => void): Promise<ImageUploadResponse> {
  return uploadFile<ImageUploadResponse>('/api/images', file, onProgress);
}

export async function getVideoMeta(videoId: string): Promise<VideoMeta> {
  return request<VideoMeta>(`/api/videos/${videoId}`);
}

export async function extractVideoFrames(videoId: string, timestampsMs: number[]): Promise<ExtractFramesResponse> {
  return request<ExtractFramesResponse>(`/api/videos/${videoId}/frames`, {
    method: 'POST',
    body: JSON.stringify({
      timestamps_ms: timestampsMs,
    }),
  });
}

export async function createJob(jobData: CreateJobRequest): Promise<JobResponse> {
  return request<JobResponse>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(jobData),
  });
}

export async function detectImageSegments(imageId: string): Promise<DetectSegmentsResponse> {
  return request<DetectSegmentsResponse>(`/api/images/${imageId}/segments:detect`, {
    method: 'POST',
  });
}

export async function processImage(
  imageId: string,
  data: ImageProcessRequest
): Promise<ImageProcessResponse> {
  return request<ImageProcessResponse>(`/api/images/${imageId}/process`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function createImageJob(jobData: CreateImageJobRequest): Promise<JobResponse> {
  return request<JobResponse>('/api/image-jobs', {
    method: 'POST',
    body: JSON.stringify(jobData),
  });
}

export async function createFrameAssemblyJob(jobData: CreateFrameAssemblyJobRequest): Promise<JobResponse> {
  return request<JobResponse>('/api/frame-assembly-jobs', {
    method: 'POST',
    body: JSON.stringify(jobData),
  });
}

export async function repackImageJobItems(
  jobId: string,
  itemNames: string[]
): Promise<ImageJobStatus> {
  return request<ImageJobStatus>(`/api/image-jobs/${jobId}/items:repack`, {
    method: 'POST',
    body: JSON.stringify({
      item_names: itemNames,
    }),
  });
}

export async function getJobStatus(jobId: string): Promise<JobStatus> {
  return request<JobStatus>(`/api/jobs/${jobId}`);
}

export async function getImageJobStatus(jobId: string): Promise<ImageJobStatus> {
  return request<ImageJobStatus>(`/api/image-jobs/${jobId}`);
}

export async function normalizeJobLighting(jobId: string): Promise<JobStatus> {
  return request<JobStatus>(`/api/jobs/${jobId}/normalize-lighting`, {
    method: 'POST',
  });
}

export async function repackJobFrames(
  jobId: string,
  frameNames: string[],
  frameOffsets: Record<string, FrameOffset> = {}
): Promise<JobStatus> {
  return request<JobStatus>(`/api/jobs/${jobId}/frames:repack`, {
    method: 'POST',
    body: JSON.stringify({
      frame_names: frameNames,
      frame_offsets: frameOffsets,
    }),
  });
}

export async function deleteJob(jobId: string): Promise<void> {
  await request(`/api/jobs/${jobId}`, {
    method: 'DELETE',
  });
}

export async function deleteVideo(videoId: string): Promise<void> {
  await request(`/api/videos/${videoId}`, {
    method: 'DELETE',
  });
}

export async function deleteImage(imageId: string): Promise<void> {
  await request(`/api/images/${imageId}`, {
    method: 'DELETE',
  });
}

export async function clearRuntimeData(): Promise<void> {
  await request('/api/runtime/clear', {
    method: 'POST',
  });
}

export function getJobExportUrl(jobId: string, target: EngineExportTarget = 'generic'): string {
  const params = target === 'generic' ? '' : `?target=${target}`;
  return `/api/jobs/${jobId}/export.zip${params}`;
}

export function getFileUrl(path: string): string {
  return `/files${path}`;
}

export function getImageJobExportUrl(jobId: string, target: ImageExportTarget = 'generic'): string {
  const params = target === 'generic' ? '' : `?target=${target}`;
  return `/api/image-jobs/${jobId}/export.zip${params}`;
}
