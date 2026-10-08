import type { SeriesProgressRule, SeriesStepDefinition } from "../generated/client.ts";

export function projectedProgress(steps: SeriesStepDefinition[], rules: SeriesProgressRule[], ordinal: number) {
  const applicable = rules.filter(rule => rule.fromOrdinal <= ordinal && (rule.toOrdinal === null || rule.toOrdinal > ordinal)).sort((a, b) => a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0);
  const latestRoot = applicable.filter(rule => !rule.stepKeyId).at(-1);
  const children = steps.map(step => {
    const rule = applicable.filter(rule => (!rule.stepKeyId || rule.stepKeyId === step.stepKeyId) && rule.sequence >= step.createdSequence).at(-1);
    return { step, completedAt: rule?.completed ? rule.appliedAt : null, completedSequence: rule?.completed ? rule.sequence : undefined };
  });
  const completedAt = children.length ? children.every(child => child.completedAt) ? new Date(Math.max(...children.map(child => child.completedAt!.getTime()))) : null : latestRoot?.completed ? latestRoot.appliedAt : null;
  return { children, completedAt };
}
