/** Private training records. Runtime data lives outside the source-book directories. */
export type TrainingKind = 'coach' | 'machine' | 'partner' | 'gym';
export type WeekDay = 1 | 2 | 3 | 4 | 5 | 6 | 7; // Monday = 1
export type Stroke = 'forehand' | 'backhand' | 'serve' | 'volley' | 'footwork';
export type TrainingProfile = {
  name: string;
  level: string;
  goals: string;
  dominantHand: 'right' | 'left';
  weeklyBudgetCny: number | null;
  weeklyAvailableMinutes: number | null;
  maxCourtSessions: number | null;
  availableDays: WeekDay[];
  gymExperience: string;
  equipment: string[];
  constraints: string;
};
export type Observation = {
  id: string;
  atSeconds: number;
  kind: 'visible' | 'hypothesis';
  text: string;
  source: 'self' | 'coach' | 'ai';
  confidence: 'low' | 'medium' | 'high';
};
export type CoachRevision = { id: string; date: string; note: string };
export type Review = {
  id: string;
  date: string;
  title: string;
  stroke: Stroke;
  feed: 'machine' | 'partner' | 'coach' | 'self';
  camera: 'side' | 'rear' | 'front' | 'other';
  conditions: string;
  mediaId: string | null;
  durationSeconds: number | null;
  observations: Observation[];
  coachRevisions: CoachRevision[];
  cue: string;
  drill: string;
  successMetric: string;
  previousReviewId: string | null;
};
export type TrainingTask = {
  id: string;
  reviewId: string | null;
  cue: string;
  drill: string;
  successMetric: string;
  sourceCardId: string | null;
  createdAt: string;
  status: 'active' | 'done';
};
export type PracticeSession = {
  id: string;
  date: string;
  kind: TrainingKind;
  minutes: number;
  costCny: number | null;
  exertion: number | null;
  taskId: string | null;
  successes: number | null;
  attempts: number | null;
  metric: string;
  notes: string;
};
export type GymSet = {
  id: string;
  exercise: string;
  index?: number;
  type?: string;
  reps: number | null;
  weightKg: number | null;
  distanceMeters?: number | null;
  durationSeconds: number | null;
  rpe: number | null;
};
export type GymWorkout = {
  id: string;
  date: string;
  title: string;
  source: 'manual' | 'csv' | 'json' | 'hevy' | 'xunji' | 'strong' | 'generic-json';
  sourceId: string | null;
  durationSeconds?: number | null;
  notes: string;
  sets: GymSet[];
};
/** priceCny is the user's own service fee; only a separate court fee is divided by courtSplit. */
export type PracticeRate = {
  id: string;
  label: string;
  kind: TrainingKind;
  priceCny: number | null;
  billing: 'session' | 'hour';
  durationMinutes: number;
  minimumMinutes: number;
  courtIncluded: 'yes' | 'no' | 'unknown';
  courtFeeCny: number | null;
  courtBilling: 'session' | 'hour';
  courtSplit: number;
  travelMinutes: number | null; // Round trip per visit.
  availableDays: WeekDay[];
  notes: string;
};
export type PlanVisit = {
  rateId: string;
  kind: TrainingKind;
  day: WeekDay | null;
  minutes: number;
  costCny: number | null;
  totalMinutes: number | null;
  warnings: string[];
};
export type PlanCandidate = {
  id: string;
  label: string;
  rationale: string;
  visits: PlanVisit[];
  totalCostCny: number | null;
  totalMinutes: number | null;
  feasible: boolean | null;
  warnings: string[];
};
export type WeekPlan = PlanCandidate & { weekOf: string; notes: string };
export type TrainingState = {
  schemaVersion: 1;
  profile: TrainingProfile;
  reviews: Review[];
  currentTask: TrainingTask | null;
  sessions: PracticeSession[];
  workouts: GymWorkout[];
  rates: PracticeRate[];
  weekPlan: WeekPlan | null;
  lessons: TeachingLesson[];
  pinnedLessonId: string | null;
};
export type TeachingStep = {
  id: string;
  title: string;
  cue: string;
  instructions: string;
  repetitions: string;
  sourceQuote: string;
  evidenceAtSeconds: number | null;
  startSeconds: number | null;
  endSeconds: number | null;
  gifMediaId: string | null;
  origin: 'manual' | 'ai' | 'import';
  confirmed: boolean;
};
export type TeachingLesson = {
  id: string;
  title: string;
  category: Stroke | 'conditioning' | 'other';
  sourceKind: 'article' | 'video' | 'notes';
  sourceUrl: string | null;
  sourceText: string;
  mediaId: string | null;
  durationSeconds: number | null;
  summary: string;
  steps: TeachingStep[];
  createdAt: string;
  updatedAt: string;
};
export type MediaAsset = {
  id: string;
  name: string;
  contentType: 'video/mp4' | 'video/quicktime' | 'video/webm' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  size: number;
  status: 'pending' | 'ready';
  createdAt: string;
  url: string; // Authenticated application route, never a persisted signed URL.
};
export type SourceCard = {
  id: string;
  title: string;
  category: 'court' | 'gym' | 'review';
  summary: string;
  book: string;
  chapter: string;
  pageStart: number | null;
  pageEnd: number | null;
  href: string;
  editorialStatus: 'needs-review';
  sourceNote: string;
};
export type TrainingCapabilities = {
  storageDriver: 'local' | 'vercel-blob';
  maxMediaBytes: number;
  aiConfigured: boolean;
  poseModelUrl?: string;
};
export type TrainingDocument = { state: TrainingState; revision: string | null };
export type TrainingBootstrap = TrainingDocument & {
  media: MediaAsset[];
  sourceCards: SourceCard[];
  capabilities: TrainingCapabilities;
};
export type TrainingExport = { format: 'tennis-training-records'; version: 1; exportedAt: string; state: TrainingState; media: MediaAsset[]; mediaIncluded: false };
export type RestoreResult = TrainingBootstrap & { warnings: string[] };
export type MediaReservation = { asset: MediaAsset; pathname: string; uploadUrl: string };
