// Visual intensity is an aggregate indicator, never a count of query completions.
export function sessionIntensity(executing: number | null) {
  if (executing === null || executing <= 0) return 0;
  return Math.min(1, 0.25 + Math.log2(1 + executing) / 7);
}

export function coreActivity(sql: number | null, executing: number | null) {
  if (sql === null && executing === null) return 0;
  const throughput = sql !== null && sql > 0
    ? Math.min(1, 0.25 + Math.sqrt(sql / 18000) * 0.75)
    : 0;
  return Math.max(throughput, sessionIntensity(executing));
}
