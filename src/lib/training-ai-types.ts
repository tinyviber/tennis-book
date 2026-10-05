import type { Observation } from './training-types';
export type SelectedFrame = { atSeconds: number; image: string };
export type AnalysisRequest = { frames: SelectedFrame[]; stroke: string; coachNotes: string; consent: true };
export type TrainingAnalysis = {
  observations: Observation[];
  cue: string;
  drill: string;
  successMetric: string;
  limitations: string[];
  insufficientEvidence: boolean;
};
export const MAX_ANALYSIS_BYTES = 3 * 1024 * 1024;
export const MAX_FRAME_BYTES = 350 * 1024;
export const MAX_ANALYSIS_FRAMES = 6;
