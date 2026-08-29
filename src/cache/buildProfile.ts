/**
 * Source-agnostic cache-profile orchestrator.
 *
 * Ties the byte-walker (`parseCacheRecords`) and the section→family voter
 * (`buildDeviceCache`) into one call that produces a complete `BuiltCache`
 * from either a decoded `.cache` byte buffer OR an injected live self-describe
 * walk. The two sources are interchangeable: given the same records they
 * produce byte-identical data, differing only in `meta.source`.
 *
 * Pure and browser-safe — no `node:*`, no `Buffer`. The `bytes` path decodes
 * through the browser-safe `DataView` walker; the `live` path just consumes an
 * injected `walk()` (the device self-describe that PRODUCES that walk is a
 * separate future module, blocked on the A0 reply-payload decode — not here).
 *
 * Determinism: this module NEVER stamps a wall-clock time. `Date.now()` /
 * `new Date()` are banned in this codebase's build/runtime seams and would make
 * the output non-reproducible. A `builtAt` stamp is taken from `opts` only when
 * the caller supplies one; otherwise it is left undefined.
 */
import { parseCacheRecords } from './records.js';
import { buildDeviceCache } from './assign.js';
import type { BuiltCacheData, CacheRecord, DeviceParam } from './types.js';

/**
 * Current cache format schema. Bump whenever the live-walk classification or the section→family
 * assignment shape changes in a way that would make a previously-persisted cache serve wrong data
 * (e.g. the enum/float kind heuristic). Consuming runtimes reject docs whose `meta.schema` differs.
 */
export const CACHE_SCHEMA = 1;

/**
 * Where the decoded cache records come from.
 *   - `bytes`: a raw decoded `.cache` buffer (walked here).
 *   - `live`: an injected async producer of already-decoded records (a device
 *     self-describe walk supplied by the caller).
 */
export type RecordSource =
  | { kind: 'bytes'; buf: Uint8Array }
  | { kind: 'live'; walk: () => Promise<CacheRecord[]> };

/**
 * A complete built cache: the derived device tables (`BuiltCacheData` shapes)
 * wrapped in a small identity/provenance envelope.
 */
export interface BuiltCache extends BuiltCacheData {
  /** Device model code, when the caller knows it (e.g. 0x11 for FM3). */
  model?: number;
  /** Firmware version string, when known (e.g. '12.0'). */
  firmware?: string;
  meta: {
    /** Cache format version — bumped whenever the walk/assign shape changes such that an older
     *  persisted doc must not be trusted (a stale build would serve wrong classifications). */
    schema?: number;
    /** Total decoded records consumed (incl. special table records). */
    recordCount: number;
    /** Caller-supplied build timestamp; never wall-clock-stamped here. */
    builtAt?: string;
    /** Which `RecordSource` variant produced the records. */
    source: 'bytes' | 'live';
  };
}

/**
 * Build a complete `BuiltCache` from a byte buffer or an injected live walk.
 *
 * @param source `{ kind: 'bytes', buf }` decodes the buffer here;
 *               `{ kind: 'live', walk }` awaits the injected walk.
 * @param params device param catalog rows (e.g. `FM3_PARAMS`).
 * @param seeds  family → section-tag hardware anchors (e.g. `HW_SEEDS`).
 * @param opts   optional identity envelope (`model`/`firmware`) and a
 *               caller-supplied `builtAt` stamp (this module stamps none).
 */
export async function buildCache(
  source: RecordSource,
  params: DeviceParam[],
  seeds: Record<string, number>,
  opts: { model?: number; firmware?: string; builtAt?: string } = {},
): Promise<BuiltCache> {
  const records: CacheRecord[] =
    source.kind === 'bytes'
      ? parseCacheRecords(source.buf).records
      : await source.walk();

  const data = buildDeviceCache(records, params, seeds);

  const meta: BuiltCache['meta'] = {
    schema: CACHE_SCHEMA,
    recordCount: records.length,
    source: source.kind,
  };
  if (opts.builtAt !== undefined) meta.builtAt = opts.builtAt;

  const out: BuiltCache = { ...data, meta };
  if (opts.model !== undefined) out.model = opts.model;
  if (opts.firmware !== undefined) out.firmware = opts.firmware;
  return out;
}
