import type { PlanCandidate, PlanVisit, PracticeRate, TrainingKind, TrainingProfile, WeekDay } from './training-types';

const kindLabel: Record<TrainingKind, string> = { coach: '私教', machine: '发球机', partner: '球友', gym: '健身' };
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Prices and travel are nullable: incomplete information never becomes a free visit. */
export function estimateSession(rate: PracticeRate, durationMinutes = rate.durationMinutes): PlanVisit {
  const minutes = Math.max(durationMinutes, rate.minimumMinutes);
  const warnings: string[] = [];
  if (durationMinutes < rate.minimumMinutes) warnings.push(`${rate.label}按最低预约 ${rate.minimumMinutes} 分钟计算。`);
  let costCny: number | null = null;
  if (rate.priceCny === null) warnings.push(`${rate.label}服务费用尚未填写。`);
  let courtCost: number | null = 0;
  if (rate.courtIncluded === 'unknown') { courtCost = null; warnings.push(`${rate.label}是否含场地费尚未确认。`); }
  if (rate.courtIncluded === 'no') {
    if (rate.courtFeeCny === null) { courtCost = null; warnings.push(`${rate.label}另付场地费尚未填写。`); }
    else courtCost = rate.courtFeeCny * (rate.courtBilling === 'hour' ? minutes / 60 : Math.ceil(minutes / rate.durationMinutes)) / rate.courtSplit;
  }
  if (rate.priceCny !== null && courtCost !== null) costCny = roundMoney(rate.priceCny * (rate.billing === 'hour' ? minutes / 60 : Math.ceil(minutes / rate.durationMinutes)) + courtCost);
  if (rate.travelMinutes === null) warnings.push(`${rate.label}往返时间尚未填写。`);
  return { rateId: rate.id, kind: rate.kind, day: null, minutes, costCny, totalMinutes: rate.travelMinutes === null ? null : minutes + rate.travelMinutes, warnings };
}

function assignDays(visits: PlanVisit[], rates: PracticeRate[], available: WeekDay[]): boolean | null {
  if (!available.length) return null;
  const options = visits.map((visit, index) => {
    const rate = rates.find(rate => rate.id === visit.rateId)!;
    return { index, days: available.filter(day => !rate.availableDays.length || rate.availableDays.includes(day)) };
  }).sort((a, b) => a.days.length - b.days.length);
  const used = new Set<WeekDay>();
  function assign(index: number): boolean {
    if (index === options.length) return true;
    const option = options[index];
    for (const day of option.days) {
      if (used.has(day)) continue;
      used.add(day); visits[option.index].day = day;
      if (assign(index + 1)) return true;
      used.delete(day); visits[option.index].day = null;
    }
    return false;
  }
  return assign(0);
}

function knownCostFloor(visit: PlanVisit, rates: PracticeRate[]): number {
  if (visit.costCny !== null) return visit.costCny;
  const rate = rates.find(rate => rate.id === visit.rateId)!;
  const units = Math.ceil(visit.minutes / rate.durationMinutes);
  const service = rate.priceCny === null ? 0 : rate.priceCny * (rate.billing === 'hour' ? visit.minutes / 60 : units);
  const court = rate.courtIncluded === 'no' && rate.courtFeeCny !== null ? rate.courtFeeCny * (rate.courtBilling === 'hour' ? visit.minutes / 60 : units) / rate.courtSplit : 0;
  return roundMoney(service + court);
}

function withinKnownLimits(profile: TrainingProfile, rates: PracticeRate[], visits: PlanVisit[]): boolean {
  if (profile.maxCourtSessions !== null && visits.filter(visit => visit.kind !== 'gym').length > profile.maxCourtSessions) return false;
  if (profile.weeklyBudgetCny !== null && roundMoney(visits.reduce((total, visit) => total + knownCostFloor(visit, rates), 0)) > profile.weeklyBudgetCny) return false;
  if (profile.weeklyAvailableMinutes !== null && visits.reduce((total, visit) => total + (visit.totalMinutes ?? visit.minutes), 0) > profile.weeklyAvailableMinutes) return false;
  return assignDays(visits.map(visit => ({ ...visit })), rates, profile.availableDays) !== false;
}

function evaluate(profile: TrainingProfile, rates: PracticeRate[], visits: PlanVisit[]): Pick<PlanCandidate, 'visits' | 'totalCostCny' | 'totalMinutes' | 'feasible' | 'warnings'> {
  const warnings = visits.flatMap(visit => visit.warnings);
  const totalCostCny = visits.some(visit => visit.costCny === null) ? null : roundMoney(visits.reduce((total, visit) => total + visit.costCny!, 0));
  const totalMinutes = visits.some(visit => visit.totalMinutes === null) ? null : visits.reduce((total, visit) => total + visit.totalMinutes!, 0);
  let feasible: boolean | null = true;
  const courtCount = visits.filter(visit => visit.kind !== 'gym').length;
  const knownCost = roundMoney(visits.reduce((total, visit) => total + knownCostFloor(visit, rates), 0));
  const minimumTime = visits.reduce((total, visit) => total + (visit.totalMinutes ?? visit.minutes), 0);
  if (profile.maxCourtSessions !== null && courtCount > profile.maxCourtSessions) { warnings.push('超过每周球场次数上限。'); feasible = false; }
  if (profile.weeklyBudgetCny !== null && knownCost > profile.weeklyBudgetCny) { warnings.push('已知费用已经超过每周预算。'); feasible = false; }
  if (profile.weeklyAvailableMinutes !== null && minimumTime > profile.weeklyAvailableMinutes) { warnings.push('已知训练及往返时间已经超过每周可用总时间。'); feasible = false; }
  const assigned = assignDays(visits, rates, profile.availableDays);
  if (assigned === false) { warnings.push('可用星期无法容纳这些预约；同一天最多安排一次训练。'); feasible = false; }
  if (assigned === null) warnings.push('个人可用星期尚未填写，未分配训练日。');
  if (rates.some(rate => visits.some(visit => visit.rateId === rate.id) && !rate.availableDays.length)) warnings.push('部分服务可约星期尚未确认。');
  if (profile.weeklyBudgetCny === null) warnings.push('每周预算尚未填写。');
  if (profile.weeklyAvailableMinutes === null) warnings.push('每周可用总时间尚未填写。');
  if (feasible !== false && (totalCostCny === null || totalMinutes === null || assigned === null || profile.weeklyBudgetCny === null || profile.weeklyAvailableMinutes === null || rates.some(rate => visits.some(visit => visit.rateId === rate.id) && !rate.availableDays.length))) feasible = null;
  if (!visits.length) { warnings.push('没有可安排的训练，请补充服务和可用时间。'); feasible = false; }
  return { visits, totalCostCny, totalMinutes, feasible, warnings: [...new Set(warnings)] };
}

/** Compare practical options, without treating a cheaper court hour as equivalent to coaching. */
export function buildWeekCandidates(profile: TrainingProfile, rates: PracticeRate[]): PlanCandidate[] {
  const choices = new Map<TrainingKind, PracticeRate[]>();
  const estimates = new Map(rates.map(rate => [rate.id, estimateSession(rate)]));
  for (const kind of ['coach', 'machine', 'partner', 'gym'] as const) {
    const options = rates.filter(rate => rate.kind === kind).sort((a, b) => {
      const left = estimates.get(a.id)!, right = estimates.get(b.id)!;
      return (left.costCny ?? Infinity) - (right.costCny ?? Infinity) || (left.totalMinutes ?? Infinity) - (right.totalMinutes ?? Infinity) || a.id.localeCompare(b.id);
    });
    choices.set(kind, options);
  }
  const patterns: { id: string; label: string; rationale: string; priority: TrainingKind[]; desired: TrainingKind[] }[] = [
    { id: 'feedback', label: '反馈优先', rationale: '私教校准一个任务，再通过重复练习和体能记录检查执行。', priority: ['coach', 'gym', 'machine', 'partner'], desired: ['coach', 'machine', 'gym'] },
    { id: 'repetition', label: '重复练习优先', rationale: '围绕当前任务增加重复练习；球机记录与球友对拉分别统计。', priority: ['machine', 'coach', 'gym', 'partner'], desired: ['machine', 'machine', 'coach', 'gym'] },
    { id: 'economy', label: '时间与费用优先', rationale: '先比较能承担的球友或球机练习；需要技术校准时再调整私教比例。', priority: ['partner', 'machine', 'gym', 'coach'], desired: ['partner', 'partner', 'gym'] },
  ];
  return patterns.map(pattern => {
    const missing = [...new Set(pattern.desired.filter(kind => !choices.get(kind)!.length))].map(kind => `尚未填写${kindLabel[kind]}服务。`);
    const desired = pattern.desired.filter(kind => choices.get(kind)!.length);
    type Result = ReturnType<typeof evaluate>;
    const winner: { best: Result | null } = { best: null };
    function isBetter(candidate: Result, current: Result | null): boolean {
      if (!current) return true;
      const status = (result: Result) => result.feasible === true ? 2 : result.feasible === null ? 1 : 0;
      if (status(candidate) !== status(current)) return status(candidate) > status(current);
      if (candidate.visits.length !== current.visits.length) return candidate.visits.length > current.visits.length;
      const priority = (result: Result) => result.visits.reduce((score, visit) => score + pattern.priority.indexOf(visit.kind), 0);
      if (priority(candidate) !== priority(current)) return priority(candidate) < priority(current);
      if ((candidate.totalCostCny ?? Infinity) !== (current.totalCostCny ?? Infinity)) return (candidate.totalCostCny ?? Infinity) < (current.totalCostCny ?? Infinity);
      if ((candidate.totalMinutes ?? Infinity) !== (current.totalMinutes ?? Infinity)) return (candidate.totalMinutes ?? Infinity) < (current.totalMinutes ?? Infinity);
      return false;
    }
    // At most four visits and forty rates. Search resource combinations instead of committing to
    // the cheapest location before checking its weekdays, travel and shared day allocation.
    const subsets = new Map<string, TrainingKind[]>();
    for (let mask = 1; mask < 1 << desired.length; mask++) {
      const subset = desired.filter((_, index) => mask & 1 << index);
      subsets.set([...subset].sort().join(','), subset);
    }
    const orderedSubsets = [...subsets.values()].sort((a, b) => b.length - a.length);
    for (const subset of orderedSubsets) {
      if (winner.best?.feasible === true && subset.length < winner.best.visits.length) break;
      function search(index: number, visits: PlanVisit[]) {
        if (index === subset.length) {
          const result = evaluate(profile, rates, visits.map(visit => ({ ...visit })));
          if (isBetter(result, winner.best)) winner.best = result;
          return;
        }
        for (const rate of choices.get(subset[index])!) {
          const next = [...visits, { ...estimates.get(rate.id)!, day: null }];
          if (withinKnownLimits(profile, rates, next)) search(index + 1, next);
        }
      }
      search(0, []);
    }
    // When even one visit violates explicit constraints, show that limitation rather than
    // silently producing a zero-cost empty plan or ignoring the user's constraints.
    if (!winner.best) {
      for (const kind of [...new Set(desired)]) for (const rate of choices.get(kind)!) {
        const result = evaluate(profile, rates, [{ ...estimates.get(rate.id)! }]);
        if (isBetter(result, winner.best)) winner.best = result;
      }
    }
    const result: Result = winner.best ?? evaluate(profile, rates, []);
    const remaining = result.visits.map(visit => visit.kind);
    const removed = desired.filter(kind => { const index = remaining.indexOf(kind); if (index < 0) return true; remaining.splice(index, 1); return false; }).map(kind => kindLabel[kind]);
    return { id: pattern.id, label: pattern.label, rationale: pattern.rationale, ...result, warnings: [...new Set([...result.warnings, ...missing, ...(removed.length ? [`根据已填写的预算、时间或可用星期减少了${removed.join('、')}次数。`] : []), '这些是可调整的计划候选，尚未预订；可用星期不代表具体小时已确认。'])] };
  });
}
