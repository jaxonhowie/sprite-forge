import type { DetectedSegment, ImageUploadResponse } from '../api/client';

export type ImageWorkflowStep = 'upload' | 'segments' | 'result';

export interface ImageWorkflowSettings {
  layout: {
    cols: number;
    padding: number;
  };
}

export interface ImageWorkflowState {
  currentStep: ImageWorkflowStep;
  imageMeta?: ImageUploadResponse;
  segments: DetectedSegment[];
  settings: ImageWorkflowSettings;
  jobId?: string;
}

export interface ImageWorkflowRouteState {
  imageMeta?: ImageUploadResponse;
  segments?: DetectedSegment[];
  jobId?: string;
}

const imageWorkflowKey = 'sprite_forge_image_workflow';

export const defaultImageWorkflowSettings: ImageWorkflowSettings = {
  layout: {
    cols: 6,
    padding: 2,
  },
};

export function createInitialImageWorkflowState(): ImageWorkflowState {
  return {
    currentStep: 'upload',
    segments: [],
    settings: defaultImageWorkflowSettings,
  };
}

export function createImageWorkflowRouteState(
  state: ImageWorkflowRouteState = {}
): ImageWorkflowRouteState {
  return {
    imageMeta: state.imageMeta,
    segments: state.segments ? [...state.segments] : undefined,
    jobId: state.jobId,
  };
}

export function getImageWorkflowState(): ImageWorkflowState | null {
  const stored = sessionStorage.getItem(imageWorkflowKey);
  if (!stored) return null;

  try {
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      currentStep: parsed.currentStep ?? 'upload',
      imageMeta: parsed.imageMeta,
      segments: Array.isArray(parsed.segments) ? parsed.segments : [],
      settings: {
        ...defaultImageWorkflowSettings,
        ...(parsed.settings ?? {}),
        layout: {
          ...defaultImageWorkflowSettings.layout,
          ...(parsed.settings?.layout ?? {}),
        },
      },
      jobId: parsed.jobId,
    };
  } catch {
    return null;
  }
}

export function setImageWorkflowState(state: ImageWorkflowState): void {
  sessionStorage.setItem(imageWorkflowKey, JSON.stringify(state));
}

export function mergeImageWorkflowState(
  patch: Partial<ImageWorkflowState>
): ImageWorkflowState {
  const current = getImageWorkflowState() ?? createInitialImageWorkflowState();
  const next: ImageWorkflowState = {
    ...current,
    ...patch,
    settings: {
      ...current.settings,
      ...(patch.settings ?? {}),
      layout: {
        ...current.settings.layout,
        ...(patch.settings?.layout ?? {}),
      },
    },
  };

  setImageWorkflowState(next);
  return next;
}

export function clearImageWorkflow(): void {
  sessionStorage.removeItem(imageWorkflowKey);
}
