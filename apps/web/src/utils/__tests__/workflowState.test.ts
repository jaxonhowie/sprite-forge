import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getWorkflowState,
  mergeWorkflowState,
  setFrameTimestamps,
  getFrameTimestamps,
  clearWorkflow,
  clearAllWorkflowState,
  createWorkflowRouteState,
} from '../workflowState';

describe('workflowState', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('getWorkflowState', () => {
    it('returns null when nothing stored', () => {
      expect(getWorkflowState()).toBeNull();
    });

    it('returns parsed state with defaults merged', () => {
      sessionStorage.setItem(
        'sprite_forge_workflow',
        JSON.stringify({ currentStep: 'capture', frameTimestamps: [100, 200] })
      );
      const state = getWorkflowState();
      expect(state).not.toBeNull();
      expect(state!.currentStep).toBe('capture');
      expect(state!.frameTimestamps).toEqual([100, 200]);
      expect(state!.processSettings.removeBg).toBe(true); // default
    });

    it('returns null on invalid JSON', () => {
      sessionStorage.setItem('sprite_forge_workflow', '{bad json');
      expect(getWorkflowState()).toBeNull();
    });

    it('returns null on non-object JSON', () => {
      sessionStorage.setItem('sprite_forge_workflow', '"just a string"');
      expect(getWorkflowState()).toBeNull();
    });
  });

  describe('mergeWorkflowState', () => {
    it('merges patch into current state', () => {
      mergeWorkflowState({ currentStep: 'capture', frameTimestamps: [100] });
      mergeWorkflowState({ currentStep: 'frames' });

      const state = getWorkflowState();
      expect(state!.currentStep).toBe('frames');
      expect(state!.frameTimestamps).toEqual([100]); // preserved
    });

    it('deep-merges processSettings.layout', () => {
      mergeWorkflowState({
        processSettings: { layout: { cols: 8 } } as any,
      });
      const state = getWorkflowState();
      expect(state!.processSettings.layout.cols).toBe(8);
      expect(state!.processSettings.layout.padding).toBe(2); // default preserved
    });
  });

  describe('frame timestamps (H5: safe sessionStorage writes)', () => {
    it('stores and retrieves frame timestamps', () => {
      setFrameTimestamps('vid12345', [1000, 2000, 3000]);
      expect(getFrameTimestamps('vid12345')).toEqual([1000, 2000, 3000]);
    });

    it('handles legacy {ts_ms: number} shape', () => {
      sessionStorage.setItem(
        'frames_vid0001',
        JSON.stringify([{ ts_ms: 500 }, { ts_ms: 1500 }])
      );
      expect(getFrameTimestamps('vid0001')).toEqual([500, 1500]);
    });

    it('returns null for empty array', () => {
      sessionStorage.setItem('frames_vid0002', '[]');
      expect(getFrameTimestamps('vid0002')).toBeNull();
    });

    it('returns null on invalid JSON', () => {
      sessionStorage.setItem('frames_vid0003', '{bad');
      expect(getFrameTimestamps('vid0003')).toBeNull();
    });

    it('does not throw when sessionStorage quota exceeded (H5)', () => {
      const original = sessionStorage.setItem;
      sessionStorage.setItem = vi.fn(() => {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      });

      // Even after the first setItem throws, the fallback retries (removeItem + setItem).
      // Both attempts fail, so it should swallow the error and not throw.
      expect(() => setFrameTimestamps('vidquota', [100])).not.toThrow();

      sessionStorage.setItem = original;
    });
  });

  describe('clearWorkflow', () => {
    it('removes workflow and frame keys', () => {
      setFrameTimestamps('vidclear', [100]);
      mergeWorkflowState({ currentStep: 'capture' });

      clearWorkflow('vidclear');

      expect(getWorkflowState()).toBeNull();
      expect(getFrameTimestamps('vidclear')).toBeNull();
    });
  });

  describe('clearAllWorkflowState', () => {
    it('removes all frame_ keys', () => {
      setFrameTimestamps('vidA', [100]);
      setFrameTimestamps('vidB', [200]);

      clearAllWorkflowState();

      expect(getFrameTimestamps('vidA')).toBeNull();
      expect(getFrameTimestamps('vidB')).toBeNull();
    });
  });

  describe('createWorkflowRouteState', () => {
    it('creates a defensive copy of frameTimestamps', () => {
      const ts = [100, 200];
      const route = createWorkflowRouteState({ frameTimestamps: ts });
      expect(route.frameTimestamps).toEqual([100, 200]);
      expect(route.frameTimestamps).not.toBe(ts); // different array instance
    });
  });
});
