import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ImportError, mergeImportedWorkouts, parseTrainingImport } from '../src/lib/training-import';

const fixture = (name: string) => fs.readFile(new URL(`./fixtures/training/${name}`, import.meta.url), 'utf8');
const strongHeader = 'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes';
const strong = (date = '2026-10-04 18:30:00', weight = '10', distance = '0') => `${strongHeader}\n${date},Court support,30m,Row,1,${weight},10,${distance},0,Keep steady\n`;
const normalized = (date = '2026-10-04T18:30:00+08:00') => JSON.stringify({
  version: 1, source: 'generic-json', workouts: [{
    date, title: 'Court support', durationSeconds: 1800, notes: 'Recorded workout',
    exercises: [{ name: 'Row', sets: [{ weightKg: 10, reps: 12, distanceMeters: 0, durationSeconds: 0, rpe: 7, index: 1, type: 'normal' }] }],
  }],
});

test('Hevy preserves quoted multiline records and normalizes explicit pounds and miles', async () => {
  const result = parseTrainingImport(await fixture('hevy-lbs.csv'), 'hevy', { timeZone: 'Asia/Shanghai' });
  assert.equal(result.rowCount, 2);
  assert.equal(result.workouts.length, 1);
  const workout = result.workouts[0];
  assert.equal(workout.title, 'Upper "A"');
  assert.equal(new Date(workout.date).toISOString(), '2026-10-04T10:30:00.000Z');
  assert.equal(workout.durationSeconds, 1800);
  assert.match(workout.notes, /First line,\nsecond line/);
  assert.equal(workout.sets.length, 2);
  assert.equal(workout.sets[0].exercise, 'Dumbbell row');
  assert.ok(Math.abs(workout.sets[0].weightKg! - 10) < 0.000001);
  assert.equal(workout.sets[0].reps, 12);
  assert.equal(workout.sets[0].rpe, 7);
  assert.equal(workout.sets[1].weightKg, 0);
  assert.ok(Math.abs(workout.sets[1].distanceMeters! - 1609.344) < 0.000001);
});

test('BOM and CRLF do not alter Hevy row grouping or deduplication', async () => {
  const text = await fixture('hevy-lbs.csv');
  const original = parseTrainingImport(text, 'auto', { timeZone: 'Asia/Shanghai' });
  const copied = parseTrainingImport(`\uFEFF${text.replace(/\r?\n/g, '\r\n')}`, 'auto', { timeZone: 'Asia/Shanghai' });
  assert.equal(copied.workouts.length, 1);
  const merged = mergeImportedWorkouts(original.workouts, copied.workouts);
  assert.equal(merged.added, 0);
  assert.equal(merged.duplicates, 1);
  assert.equal(merged.workouts.length, 1);
});

test('Strong semicolon export reads explicit units, quoted commas and embedded newlines', async () => {
  const result = parseTrainingImport(await fixture('strong-units.csv'), 'strong', { timeZone: 'UTC' });
  assert.equal(result.rowCount, 2);
  assert.equal(result.workouts.length, 1);
  assert.equal(result.workouts[0].title, 'Gym, A');
  assert.equal(new Date(result.workouts[0].date).toISOString(), '2026-10-04T18:30:00.000Z');
  assert.ok(Math.abs(result.workouts[0].sets[0].weightKg! - 10) < 0.000001);
  assert.ok(Math.abs(result.workouts[0].sets[1].distanceMeters! - 1609.344) < 0.000001);
});

test('ambiguous Strong units require a choice and bodyweight zero remains zero', () => {
  assert.throws(() => parseTrainingImport(strong(), 'strong', { timeZone: 'UTC' }), ImportError);
  assert.throws(() => parseTrainingImport(strong(undefined, '0', '1'), 'strong', { timeZone: 'UTC', weightUnit: 'kg' }), ImportError);
  const result = parseTrainingImport(strong(), 'strong', { timeZone: 'UTC', weightUnit: 'lb' });
  assert.ok(Math.abs(result.workouts[0].sets[0].weightKg! - 4.5359237) < 0.000001);
  const zero = parseTrainingImport(strong(undefined, '0'), 'strong', { timeZone: 'UTC' });
  assert.equal(zero.workouts[0].sets[0].weightKg, 0);
});

test('invalid dates, malformed quotes, negative loads and unsupported CSV headers fail clearly', () => {
  for (const date of ['03/04/26', '2026-02-30 18:30:00', '2026-10-04 24:01:00']) {
    assert.throws(() => parseTrainingImport(strong(date), 'strong', { timeZone: 'UTC', weightUnit: 'kg' }), ImportError);
  }
  assert.throws(() => parseTrainingImport(`${strongHeader}\n2026-10-04 18:30:00,"unfinished`, 'strong', { weightUnit: 'kg' }), ImportError);
  assert.throws(() => parseTrainingImport(strong(undefined, '-5'), 'strong', { weightUnit: 'kg' }), ImportError);
  assert.throws(() => parseTrainingImport('date,exercise,weight\n2026-10-04,Row,10', 'auto', { weightUnit: 'kg' }), ImportError);
});

test('generic JSON is the documented normalized format and rejects invalid calendar dates', () => {
  const result = parseTrainingImport(normalized(), 'generic-json', {});
  assert.equal(result.workouts.length, 1);
  assert.equal(result.workouts[0].sets[0].weightKg, 10);
  assert.equal(result.workouts[0].sets[0].distanceMeters, 0);
  assert.equal(new Date(result.workouts[0].date).toISOString(), '2026-10-04T10:30:00.000Z');
  assert.throws(() => parseTrainingImport(normalized('2026-02-30T18:30:00+08:00'), 'generic-json', {}), ImportError);
  assert.throws(() => parseTrainingImport('{"version":2,"source":"generic-json","workouts":[]}', 'generic-json', {}), ImportError);
  assert.throws(() => parseTrainingImport(JSON.stringify([{ date: '2026-10-04', weight: 10 }]), 'generic-json', {}), ImportError);
});

test('repeat imports deduplicate contents while a changed set remains a distinct workout', () => {
  const first = parseTrainingImport(normalized(), 'generic-json', {}).workouts;
  const same = parseTrainingImport(normalized(), 'generic-json', {}).workouts;
  const changedText = JSON.parse(normalized());
  changedText.workouts[0].exercises[0].sets[0].reps = 13;
  const changed = parseTrainingImport(JSON.stringify(changedText), 'generic-json', {}).workouts;
  const repeated = mergeImportedWorkouts(first, same);
  assert.equal(repeated.added, 0);
  assert.equal(repeated.duplicates, 1);
  assert.equal(repeated.workouts.length, 1);
  assert.equal(mergeImportedWorkouts(first, changed).added, 1);
  assert.equal(mergeImportedWorkouts([], [...first, ...same]).duplicates, 1);
  assert.equal(first[0].sets[0].reps, 12);
});
