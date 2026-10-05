import { parse } from 'csv-parse/browser/esm/sync';
import type { GymSet, GymWorkout } from './training-types';

export class ImportError extends Error { constructor(message: string) { super(message); this.name = 'ImportError'; } }
export type ImportFormat = 'auto' | 'hevy' | 'strong' | 'generic-json';
export type ImportOptions = { weightUnit?: 'kg' | 'lb'; distanceUnit?: 'km' | 'mile'; timeZone?: string };
export type ImportPreview = { workouts: GymWorkout[]; warnings: string[]; source: string; rowCount: number };
function fail(message: string): never { throw new ImportError(message); }
const nullable = (value: unknown, label: string, maximum = 1_000_000): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0 || number > maximum) fail(`${label}必须是有效的非负数字。`);
  return number;
};
const boundedText = (value: unknown, label: string, required = false): string => {
  const text = value == null ? '' : String(value).replace(/\r\n?/g, '\n').trim();
  if (text.length > 2000 || (required && !text)) fail(`${label}为空或超过 2000 字。`);
  return text;
};
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function localTime(raw: string, options: ImportOptions): string {
  const zone = options.timeZone ?? 'Asia/Shanghai';
  if (zone !== 'Asia/Shanghai' && zone !== 'UTC') fail('当前导入只支持 Asia/Shanghai 或 UTC，请先转换其他时区。');
  let match = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) {
    const english = raw.match(/^(\d{1,2}) ([A-Za-z]{3}) (\d{4}), (\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (english) match = [english[0], english[3], String(months.indexOf(english[2]) + 1), english[1], english[4], english[5], english[6]];
  }
  if (!match) return fail(`无法确定日期「${raw}」。支持 YYYY-MM-DD HH:mm:ss 或 D MMM YYYY, HH:mm。`);
  const parts = match.slice(1).map((value, index) => Number(value ?? (index === 5 ? '0' : '0')));
  const [year, month, day, hour, minute, second] = parts;
  const utc = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (year < 1900 || year > 2200 || utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day || utc.getUTCHours() !== hour || utc.getUTCMinutes() !== minute || utc.getUTCSeconds() !== second) fail(`日期「${raw}」不合法。`);
  return new Date(utc.getTime() - (zone === 'Asia/Shanghai' ? 8 * 3600_000 : 0)).toISOString();
}
function jsonTime(raw: string, options: ImportOptions): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return localTime(raw, options);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!match) return fail('JSON 训练日期必须是 YYYY-MM-DD 或带时区的 ISO 时间。');
  localTime(`${match[1]} ${match[2]}`, { timeZone: 'UTC' });
  if (match[3] !== 'Z' && (Number(match[3].slice(1, 3)) > 14 || Number(match[3].slice(4)) > 59 || (Number(match[3].slice(1, 3)) === 14 && Number(match[3].slice(4)) > 0))) fail('日期时区偏移不合法。');
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) fail('JSON 日期不合法。');
  return date.toISOString();
}
function duration(raw: string): number | null {
  if (!raw.trim()) return null;
  const clock = raw.match(/^(\d+):(\d{2}):(\d{2})$/);
  if (clock && Number(clock[2]) < 60 && Number(clock[3]) < 60) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
  const units = raw.trim().match(/^(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?$/);
  if (units && units.slice(1).some(Boolean)) return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  return fail(`无法确定训练时长「${raw}」。支持 30m、1h 20m 或 00:30:00。`);
}
/** Stable, non-security content fingerprint; all normalized fields participate in deduplication. */
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  const hashes = [2166136261, 3335557771, 3141592653, 2718281829];
  for (let index = 0; index < text.length; index++) for (let lane = 0; lane < 4; lane++) hashes[lane] = Math.imul(hashes[lane] ^ (text.charCodeAt(index) + lane * 101), 16777619);
  return `import-${hashes.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('')}`;
}
function finish(workout: GymWorkout): GymWorkout {
  workout.sourceId = fingerprint({ source: workout.source, date: workout.date, title: workout.title, durationSeconds: workout.durationSeconds, notes: workout.notes, sets: workout.sets.map(({ id: _id, ...set }) => set) });
  return workout;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('JSON 记录必须是对象。');
  return value as Record<string, unknown>;
}
function parseGeneric(text: string, options: ImportOptions): ImportPreview {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return fail('JSON 格式不正确。'); }
  const root = object(value);
  if (root.version !== 1 || !Array.isArray(root.workouts) || root.workouts.length > 2000) fail('需要 version:1 和 workouts 数组（最多 2000 次训练）。');
  const source = root.source === 'xunji' ? 'xunji' : 'generic-json';
  let count = 0;
  const workouts = (root.workouts as unknown[]).map(item => {
    const entry = object(item);
    if (!Array.isArray(entry.exercises) || entry.exercises.length > 200) fail('每次训练需要 exercises 数组（最多 200 项）。');
    const sets: GymSet[] = [];
    for (const item of entry.exercises as unknown[]) {
      const exercise = object(item);
      const name = boundedText(exercise.name, '动作名', true);
      if (!Array.isArray(exercise.sets) || exercise.sets.length > 200) fail('每个动作需要 sets 数组（最多 200 组）。');
      for (const item of exercise.sets as unknown[]) {
        if (++count > 10000) fail('一次最多导入 10000 组。');
        const set = object(item);
        const reps = nullable(set.reps, '次数', 10000);
        const index = nullable(set.index, '组序号', 10000);
        if ((reps !== null && !Number.isInteger(reps)) || (index !== null && !Number.isInteger(index))) fail('次数和组序号必须是整数。');
        sets.push({ id: crypto.randomUUID(), exercise: name, reps, weightKg: nullable(set.weightKg, '重量', 2000), durationSeconds: nullable(set.durationSeconds, '组时长', 86400), rpe: nullable(set.rpe, 'RPE', 10), distanceMeters: nullable(set.distanceMeters, '距离'), ...(index !== null ? { index } : {}), type: boundedText(set.type, '组类型') || 'normal' });
      }
    }
    if (!sets.length) fail('每次训练至少需要一组。');
    return finish({ id: crypto.randomUUID(), date: jsonTime(boundedText(entry.date, '日期', true), options), title: boundedText(entry.title, '训练标题', true), source, sourceId: null, notes: boundedText(entry.notes, '备注'), durationSeconds: nullable(entry.durationSeconds, '训练时长', 86400), sets });
  });
  return { workouts, source, rowCount: count, warnings: ['这是本项目的通用 JSON 格式，不能直接读取未经转换的训记备份。', '导入不会自动翻译或合并动作名称。'] };
}
export function parseTrainingImport(text: string, format: ImportFormat = 'auto', options: ImportOptions = {}): ImportPreview {
  if (new TextEncoder().encode(text).length > 2 * 1024 * 1024) fail('导入文件不能超过 2 MB。');
  text = text.replace(/^\uFEFF/, '');
  if (format === 'generic-json' || (format === 'auto' && text.trimStart().startsWith('{'))) return parseGeneric(text, options);
  const firstLine = text.split(/\r?\n/, 1)[0];
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ',';
  let rows: Record<string, string>[];
  try { rows = parse(text, { bom: true, delimiter, columns: (headers: string[]) => headers.map(header => header.trim()), skip_empty_lines: true, relax_column_count: false, max_record_size: 100000 }); } catch { return fail('CSV 格式不正确，请检查分隔符、引号或列数。'); }
  if (!rows.length || rows.length > 10000) fail('CSV 需要 1–10000 行训练组。');
  const headers = Object.keys(rows[0]);
  const source = format === 'auto' ? (headers.includes('exercise_title') ? 'hevy' : headers.includes('Exercise Name') ? 'strong' : null) : format;
  if (source !== 'hevy' && source !== 'strong') fail('未识别到 Hevy 或 Strong 的具名表头，请使用通用 JSON 或选择对应格式。');
  const required = source === 'hevy' ? ['title', 'start_time', 'exercise_title', 'set_index'] : ['Date', 'Workout Name', 'Exercise Name', 'Set Order'];
  for (const field of required) if (!headers.includes(field)) fail(`缺少列「${field}」。`);
  const groups = new Map<string, GymWorkout>();
  const warnings = [`无时区的 CSV 日期按 ${options.timeZone ?? 'Asia/Shanghai'} 解释；原始日期保存在备注中。`, '重复导入按完整训练内容识别；修改过的导出会作为新记录，请在预览中检查。'];
  for (const [index, row] of rows.entries()) {
    const field = (hevy: string, strong: string) => (row[source === 'hevy' ? hevy : strong] ?? '').trim();
    const rawDate = field('start_time', 'Date');
    const date = localTime(rawDate, options);
    const title = boundedText(field('title', 'Workout Name'), `第 ${index + 2} 行标题`, true);
    const notes = boundedText(field('description', 'Workout Notes'), '训练备注');
    const key = JSON.stringify([title, date, source === 'hevy' ? row.end_time : field('', 'Duration') || field('', 'Workout Duration')]);
    let workout = groups.get(key);
    if (!workout) {
      let seconds: number | null = null;
      if (source === 'hevy' && row.end_time?.trim()) { seconds = (new Date(localTime(row.end_time.trim(), options)).getTime() - new Date(date).getTime()) / 1000; if (seconds < 0 || seconds > 86400) fail('训练结束时间必须在开始后的 24 小时内。'); }
      if (source === 'strong') seconds = duration(row.Duration?.trim() || row['Workout Duration']?.trim() || '');
      workout = { id: crypto.randomUUID(), date, title, source, sourceId: null, durationSeconds: seconds, notes: `${notes}${notes ? '\n' : ''}原始日期：${rawDate}；时区：${options.timeZone ?? 'Asia/Shanghai'}`, sets: [] };
      groups.set(key, workout);
    }
    const name = boundedText(field('exercise_title', 'Exercise Name'), '动作名', true);
    let weight = nullable(source === 'hevy' ? row.weight_kg ?? row.weight_lbs : row.Weight, '重量', 2000);
    let distance = nullable(source === 'hevy' ? row.distance_km ?? row.distance_miles : row.Distance, '距离');
    const weightUnit = source === 'hevy' ? (headers.includes('weight_kg') ? 'kg' : 'lb') : row['Weight Unit']?.trim().toLowerCase() || options.weightUnit;
    const distanceUnit = source === 'hevy' ? (headers.includes('distance_km') ? 'km' : 'mile') : row['Distance Unit']?.trim().toLowerCase() || options.distanceUnit;
    if (weight !== null && weight > 0 && weightUnit !== 'kg' && weightUnit !== 'lb' && weightUnit !== 'lbs') fail('重量缺少明确单位；请选择 kg 或 lb 后重新预览。');
    if (distance !== null && distance > 0 && distanceUnit !== 'km' && distanceUnit !== 'mile' && distanceUnit !== 'mi' && distanceUnit !== 'miles' && distanceUnit !== 'm') fail('距离缺少明确单位；请选择 km 或 mile 后重新预览。');
    if (weight !== null && (weightUnit === 'lb' || weightUnit === 'lbs')) weight *= 0.45359237;
    if (distance !== null) distance *= distanceUnit === 'km' ? 1000 : ['mile', 'miles', 'mi'].includes(distanceUnit ?? '') ? 1609.344 : 1;
    const reps = nullable(field('reps', 'Reps'), '次数', 10000);
    const order = nullable(field('set_index', 'Set Order'), '组序号', 10000);
    if (order === null || !Number.isInteger(order) || (reps !== null && !Number.isInteger(reps))) fail('组序号和次数必须是整数，组序号不能为空。');
    const exerciseNotes = boundedText(field('exercise_notes', 'Notes'), '动作备注');
    if (exerciseNotes && !workout.notes.includes(`${name}：${exerciseNotes}`)) workout.notes += `\n${name}：${exerciseNotes}`;
    workout.sets.push({ id: crypto.randomUUID(), exercise: name, index: order, type: boundedText(field('set_type', ''), '组类型') || 'normal', weightKg: weight === null ? null : Math.round(weight * 1e6) / 1e6, reps, distanceMeters: distance === null ? null : Math.round(distance * 1e6) / 1e6, durationSeconds: nullable(field('duration_seconds', 'Seconds'), '组时长', 86400), rpe: nullable(field('rpe', 'RPE'), 'RPE', 10) });
  }
  return { workouts: [...groups.values()].map(finish), warnings, source, rowCount: rows.length };
}
export function mergeImportedWorkouts(existing: GymWorkout[], incoming: GymWorkout[]) {
  const identities = new Set(existing.flatMap(workout => workout.sourceId ? [workout.sourceId] : []));
  const unique: GymWorkout[] = [];
  let duplicates = 0;
  for (const workout of incoming) {
    if (workout.sourceId && identities.has(workout.sourceId)) { duplicates++; continue; }
    if (workout.sourceId) identities.add(workout.sourceId);
    unique.push(workout);
  }
  return { workouts: [...existing, ...unique], added: unique.length, duplicates };
}
