import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWeekCandidates, estimateSession } from '../src/lib/training-planner';
import type { PracticeRate, TrainingProfile } from '../src/lib/training-types';

const rate = (patch: Partial<PracticeRate> = {}): PracticeRate => ({
  id: 'bbb37071-e1f0-4358-802a-f3b2284d0621', label: 'Ball machine', kind: 'machine', priceCny: 100,
  billing: 'hour', durationMinutes: 60, minimumMinutes: 60, courtIncluded: 'yes', courtFeeCny: null,
  courtBilling: 'hour', courtSplit: 1, travelMinutes: 30, availableDays: [1, 3, 5], notes: '', ...patch,
});
const profile = (patch: Partial<TrainingProfile> = {}): TrainingProfile => ({
  name: 'Owner', level: 'Beginner', goals: 'Rally reliably', dominantHand: 'right', weeklyBudgetCny: 300,
  weeklyAvailableMinutes: 180, maxCourtSessions: 2, availableDays: [1, 3, 5], gymExperience: 'New',
  equipment: [], constraints: '', ...patch,
});

test('minimum booking, hourly service, separate shared court and travel all count', () => {
  const visit = estimateSession(rate({ minimumMinutes: 90, courtIncluded: 'no', courtFeeCny: 80, courtSplit: 2 }), 30);
  assert.equal(visit.minutes, 90);
  assert.equal(visit.costCny, 210);
  assert.equal(visit.totalMinutes, 120);
});

test('included courts are not added again and only the separate court fee is shared', () => {
  assert.equal(estimateSession(rate({ courtIncluded: 'yes', courtFeeCny: 80, courtSplit: 2 })).costCny, 100);
  const separate = estimateSession(rate({ billing: 'session', priceCny: 200, courtIncluded: 'no', courtBilling: 'session', courtFeeCny: 80, courtSplit: 2 }));
  assert.equal(separate.costCny, 240);
});

test('unknown price, inclusion and travel remain unknown instead of becoming zero', () => {
  for (const patch of [{ priceCny: null }, { courtIncluded: 'unknown' as const }, { courtIncluded: 'no' as const, courtFeeCny: null }]) {
    const visit = estimateSession(rate(patch));
    assert.equal(visit.costCny, null);
    assert.ok(visit.warnings.length > 0);
  }
  assert.equal(estimateSession(rate({ travelMinutes: null })).totalMinutes, null);
  assert.equal(estimateSession(rate({ priceCny: 0, travelMinutes: 0 })).costCny, 0);
});

test('feasible candidates respect court count, allowed days, budget and total available minutes', () => {
  const owner = profile();
  const rates = [rate(), rate({ id: '2cb4ecad-35de-4a21-99f5-c219ba57d774', kind: 'coach', label: 'Coach', priceCny: 200, billing: 'session' })];
  const candidates = buildWeekCandidates(owner, rates);
  assert.ok(candidates.some(candidate => candidate.feasible === true && candidate.visits.length > 0));
  for (const candidate of candidates.filter(item => item.feasible === true)) {
    assert.ok(candidate.totalCostCny! <= owner.weeklyBudgetCny!);
    assert.ok(candidate.totalMinutes! <= owner.weeklyAvailableMinutes!);
    assert.ok(candidate.visits.filter(visit => visit.kind !== 'gym').length <= owner.maxCourtSessions!);
    const days = candidate.visits.map(visit => visit.day);
    assert.equal(new Set(days).size, days.length);
    for (const visit of candidate.visits) {
      assert.ok(visit.day !== null && owner.availableDays.includes(visit.day));
      assert.ok(rates.find(item => item.id === visit.rateId)!.availableDays.includes(visit.day!));
    }
  }
});

test('missing budgets and incompatible days cannot produce a confirmed feasible practice plan', () => {
  const noBudget = buildWeekCandidates(profile({ weeklyBudgetCny: null }), [rate()]);
  assert.equal(noBudget.some(candidate => candidate.feasible === true && candidate.visits.length > 0), false);
  const incompatible = buildWeekCandidates(profile({ availableDays: [2] }), [rate()]);
  assert.equal(incompatible.some(candidate => candidate.feasible === true && candidate.visits.length > 0), false);
  const zero = buildWeekCandidates(profile({ maxCourtSessions: 0 }), [rate()]);
  assert.equal(zero.some(candidate => candidate.feasible === true && candidate.visits.some(visit => visit.kind !== 'gym')), false);
});

test('an unaffordable minimum booking cannot be advertised as affordable', () => {
  const candidates = buildWeekCandidates(profile({ weeklyBudgetCny: 150 }), [rate({ minimumMinutes: 120 })]);
  assert.equal(candidates.some(candidate => candidate.feasible === true && candidate.visits.length > 0), false);
});

test('an unavailable cheaper location cannot hide a feasible alternative of the same kind', () => {
  const unavailable = rate({ priceCny: 10, travelMinutes: 300, availableDays: [1] });
  const available = rate({ id: '2cb4ecad-35de-4a21-99f5-c219ba57d774', label: 'Wednesday machine', priceCny: 20, travelMinutes: 0, availableDays: [3] });
  const candidates = buildWeekCandidates(profile({ availableDays: [3], weeklyAvailableMinutes: 180, weeklyBudgetCny: 100 }), [unavailable, available]);
  assert.ok(candidates.some(candidate => candidate.feasible === true && candidate.visits.some(visit => visit.rateId === available.id && visit.day === 3)));
  for (const candidate of candidates.filter(item => item.feasible === true)) {
    assert.ok(candidate.visits.every(visit => visit.rateId !== unavailable.id));
  }
});

test('a repetition candidate can combine two locations with different limited days', () => {
  const monday = rate({ label: 'Monday machine', priceCny: 10, travelMinutes: 0, availableDays: [1] });
  const wednesday = rate({ id: '2cb4ecad-35de-4a21-99f5-c219ba57d774', label: 'Wednesday machine', priceCny: 20, travelMinutes: 0, availableDays: [3] });
  const candidates = buildWeekCandidates(profile({ availableDays: [1, 3], weeklyAvailableMinutes: 180, weeklyBudgetCny: 100, maxCourtSessions: 2 }), [monday, wednesday]);
  const repetition = candidates.find(candidate => candidate.id === 'repetition')!;
  assert.equal(repetition.feasible, true);
  assert.equal(repetition.visits.length, 2);
  assert.deepEqual(new Set(repetition.visits.map(visit => visit.rateId)), new Set([monday.id, wednesday.id]));
  assert.deepEqual(new Set(repetition.visits.map(visit => visit.day)), new Set([1, 3]));
  assert.equal(repetition.totalCostCny, 30);
  assert.equal(repetition.totalMinutes, 120);
});

test('a coach slot is preserved by choosing a machine location on a different day', () => {
  const coach = rate({ id: '7b4e892c-5406-4d80-a6d2-8e01c44d3e8d', label: 'Monday coach', kind: 'coach', priceCny: 30, travelMinutes: 0, availableDays: [1] });
  const sameDay = rate({ label: 'Monday machine', priceCny: 10, travelMinutes: 0, availableDays: [1] });
  const alternate = rate({ id: '2cb4ecad-35de-4a21-99f5-c219ba57d774', label: 'Wednesday machine', priceCny: 20, travelMinutes: 0, availableDays: [3] });
  const feedback = buildWeekCandidates(profile({ availableDays: [1, 3], weeklyAvailableMinutes: 180, weeklyBudgetCny: 100, maxCourtSessions: 2 }), [coach, sameDay, alternate]).find(candidate => candidate.id === 'feedback')!;
  assert.equal(feedback.feasible, true);
  assert.equal(feedback.visits.length, 2);
  assert.ok(feedback.visits.some(visit => visit.rateId === coach.id && visit.day === 1));
  assert.ok(feedback.visits.some(visit => visit.rateId === alternate.id && visit.day === 3));
  assert.equal(feedback.totalCostCny, 50);
});

test('an already unaffordable service fee is infeasible even when its additional court fee is unknown', () => {
  const candidates = buildWeekCandidates(profile({ weeklyBudgetCny: 100 }), [rate({ priceCny: 200, courtIncluded: 'unknown' })]);
  assert.ok(candidates.every(candidate => candidate.feasible === false));
});
