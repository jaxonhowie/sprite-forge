import type { VideoMeta } from '../api/client';

export type WorkflowStep = 'upload' | 'capture' | 'frames' | 'settings' | 'result';

export interface WorkflowSettings {
  removeBg: boolean;
  removeBgMode: 'standard' | 'conservative' | 'white';
  enableWatermark: boolean;
  watermarkBox: {
    x: number;
    y: number;
    w: number;
    h: number;
  } | null;
  layout: {
    cols: number;
    padding: number;
  };
  layoutColsTouched: boolean;
}

export interface WorkflowState {
  currentStep: WorkflowStep;
  videoMeta?: VideoMeta;
  frameTimestamps: number[];
  frameThumbs: Record<string, string>;
  processSettings: WorkflowSettings;
  jobId?: string;
}

export interface WorkflowRouteState {
  videoMeta?: VideoMeta;
  frameTimestamps?: number[];
  jobId?: string;
}

const workflowKey = 'sprite_forge_workflow';
const frameKey = (videoId: string) => `frames_${videoId}`;

export const defaultWorkflowSettings: WorkflowSettings = {
  removeBg: true,
  removeBgMode: 'standard',
  enableWatermark: false,
  watermarkBox: null,
  layout: {
    cols: 8,
    padding: 2,
  },
  layoutColsTouched: false,
};

export function createInitialWorkflowState(): WorkflowState {
  return {
    currentStep: 'upload',
    frameTimestamps: [],
    frameThumbs: {},
    processSettings: defaultWorkflowSettings,
  };
}

export function createWorkflowRouteState(state: WorkflowRouteState = {}): WorkflowRouteState {
  return {
    videoMeta: state.videoMeta,
    frameTimestamps: state.frameTimestamps ? [...state.frameTimestamps] : undefined,
    jobId: state.jobId,
  };
}

export function getWorkflowState(): WorkflowState | null {
  const stored = sessionStorage.getItem(workflowKey);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      currentStep: parsed.currentStep ?? 'upload',
      videoMeta: parsed.videoMeta,
      frameTimestamps: Array.isArray(parsed.frameTimestamps) ? parsed.frameTimestamps : [],
      frameThumbs: parsed.frameThumbs && typeof parsed.frameThumbs === 'object' ? parsed.frameThumbs : {},
      processSettings: {
        ...defaultWorkflowSettings,
        ...(parsed.processSettings ?? {}),
        layout: {
          ...defaultWorkflowSettings.layout,
          ...(parsed.processSettings?.layout ?? {}),
        },
      },
      jobId: parsed.jobId,
    };
  } catch {
    return null;
  }
}

export function setWorkflowState(state: WorkflowState): void {
  sessionStorage.setItem(workflowKey, JSON.stringify(state));
}

export function mergeWorkflowState(patch: Partial<WorkflowState>): WorkflowState {
  const current = getWorkflowState() ?? createInitialWorkflowState();
  const next: WorkflowState = {
    ...current,
    ...patch,
    processSettings: {
      ...current.processSettings,
      ...(patch.processSettings ?? {}),
      layout: {
        ...current.processSettings.layout,
        ...(patch.processSettings?.layout ?? {}),
      },
    },
  };

  setWorkflowState(next);
  return next;
}

export function getFrameTimestamps(videoId: string): number[] | null {
  const stored = sessionStorage.getItem(frameKey(videoId));
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return null;

    const timestamps = parsed
      .map((item) => {
        if (typeof item === 'number') return item;
        if (item && typeof item.ts_ms === 'number') return item.ts_ms;
        return null;
      })
      .filter((item): item is number => item !== null && Number.isFinite(item));

    return timestamps.length > 0 ? timestamps : null;
  } catch {
    return null;
  }
}

export function setFrameTimestamps(videoId: string, timestamps: number[]): void {
  sessionStorage.setItem(frameKey(videoId), JSON.stringify(timestamps));
  mergeWorkflowState({ frameTimestamps: timestamps });
}

export function clearWorkflow(videoId?: string): void {
  sessionStorage.removeItem(workflowKey);
  if (videoId) {
    sessionStorage.removeItem(frameKey(videoId));
  }
}
