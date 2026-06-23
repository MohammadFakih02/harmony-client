/**
 * Harmony snowflake IDs encode their creation time in the high bits:
 * `[62..22]` = milliseconds since the Harmony epoch (2024-01-01 UTC), `[21..0]` =
 * datacenter/worker/sequence. So the account/resource creation date is derivable from
 * the id alone — no extra field needed (mirrors the backend's `ExtractTimestamp`).
 */
const HARMONY_EPOCH_MS = Date.UTC(2024, 0, 1); // 1704067200000
const TIMESTAMP_SHIFT = 22n;

/** Creation timestamp (ms) encoded in a snowflake id, or null if it can't be parsed. */
export function snowflakeToMs(id: string): number | null {
  try {
    return Number(BigInt(id) >> TIMESTAMP_SHIFT) + HARMONY_EPOCH_MS;
  } catch {
    return null;
  }
}

/** Creation Date encoded in a snowflake id, or null if it can't be parsed. */
export function snowflakeToDate(id: string): Date | null {
  const ms = snowflakeToMs(id);
  return ms === null ? null : new Date(ms);
}
