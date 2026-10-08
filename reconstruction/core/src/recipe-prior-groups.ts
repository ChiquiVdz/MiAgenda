/** Groups are ranges of the frozen recipe, never extra levels of subtasks. */
export function recipePriorGroups<T extends { stepKey: string; priorGroup?: boolean; minutesBefore: number | null }>(steps: readonly T[]) {
  const groups: { anchor: T; steps: T[] }[] = [];
  let from = 0;
  for (let index = 0; index < steps.length; index++) {
    if (!steps[index].priorGroup || steps[index].minutesBefore === null) continue;
    groups.push({ anchor: steps[index], steps: steps.slice(from, index + 1) });
    from = index + 1;
  }
  return groups;
}
