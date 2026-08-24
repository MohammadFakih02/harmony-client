/**
 * The read-status of a data-loading store slice (audit A12). Modelling this alongside the data lets a
 * consumer tell "loaded, genuinely empty" apart from "the load failed" — the distinction the old
 * `catch {} → empty` pattern erased, which rendered a failed boot as a false-blank UI with no retry.
 *
 * - `idle`    — never loaded (initial).
 * - `loading` — a fetch is in flight.
 * - `loaded`  — the last fetch (or a bootstrap distribution) succeeded; the data is authoritative.
 * - `error`   — the last fetch failed; the data may be stale/empty and a retry is warranted.
 */
export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';
