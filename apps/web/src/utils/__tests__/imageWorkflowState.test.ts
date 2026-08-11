import { describe, it, expect, beforeEach } from 'vitest';
import {
  getImageWorkflowState,
  mergeImageWorkflowState,
  clearImageWorkflow,
} from '../imageWorkflowState';

describe('imageWorkflowState', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('getImageWorkflowState', () => {
    it('returns null when nothing stored', () => {
      expect(getImageWorkflowState()).toBeNull();
    });

    it('parses stored state with defaults merged', () => {
      sessionStorage.setItem(
        'sprite_forge_image_workflow',
        JSON.stringify({ currentStep: 'segments', segments: [{ index: 0, box: { x: 1, y: 2, w: 3, h: 4 } }] })
      );
      const state = getImageWorkflowState();
      expect(state).not.toBeNull();
      expect(state!.currentStep).toBe('segments');
      expect(state!.settings.layout.cols).toBe(6); // default
    });

    it('migrates legacy single imageMeta to array', () => {
      sessionStorage.setItem(
        'sprite_forge_image_workflow',
        JSON.stringify({ imageMeta: { image_id: 'abc', width: 100, height: 100, url: '/x' } })
      );
      const state = getImageWorkflowState();
      expect(state!.imageMetas).toHaveLength(1);
      expect(state!.imageMetas![0].image_id).toBe('abc');
    });

    it('returns null on invalid JSON', () => {
      sessionStorage.setItem('sprite_forge_image_workflow', '{bad');
      expect(getImageWorkflowState()).toBeNull();
    });
  });

  describe('mergeImageWorkflowState', () => {
    it('merges settings.layout deeply', () => {
      mergeImageWorkflowState({ settings: { layout: { cols: 4 } } as any });
      const state = getImageWorkflowState();
      expect(state!.settings.layout.cols).toBe(4);
      expect(state!.settings.layout.padding).toBe(2); // default preserved
    });
  });

  describe('clearImageWorkflow', () => {
    it('removes the image workflow key', () => {
      mergeImageWorkflowState({ currentStep: 'result' });
      clearImageWorkflow();
      expect(getImageWorkflowState()).toBeNull();
    });
  });
});
