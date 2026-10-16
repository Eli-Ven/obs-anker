export interface VariantUsage {
  count: number;
  heat: number;
  updatedAt: number;
}
export type CharacterUsage = Record<string, VariantUsage>;
export type VariantUsageStore = Record<string, CharacterUsage>;

const HALF_LIFE = 7 * 24 * 60 * 60 * 1000;

function heatAt(usage: VariantUsage, now: number): number {
  return usage.heat * 2 ** (-Math.max(0, now - usage.updatedAt) / HALF_LIFE);
}

export function recordUse(
  previous: VariantUsage | undefined,
  now: number,
): VariantUsage {
  return {
    count: (previous?.count ?? 0) + 1,
    heat: (previous ? heatAt(previous, now) : 0) + 1,
    updatedAt: now,
  };
}

export function resetBoost(usage: CharacterUsage, urls: string[]): void {
  for (const url of urls) {
    const previous = usage[url];
    if (previous) usage[url] = { ...previous, heat: 0 };
  }
}

export function rankVariants<T>(
  rows: readonly T[],
  usage: (row: T) => VariantUsage | undefined,
  now: number,
): T[] {
  return rows
    .map((row, index) => {
      const record = usage(row);
      const boost = record
        ? Math.min(3, Math.round(Math.log2(1 + heatAt(record, now))))
        : 0;
      return { row, index, boost };
    })
    .sort(
      (a, b) =>
        a.index - a.boost - (b.index - b.boost) ||
        b.boost - a.boost ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}
