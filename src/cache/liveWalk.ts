/**
 * LIVE self-describe walk for gen-3 Fractal devices (FM3/FM9/Axe-Fx III).
 *
 * A device can be asked to describe its own parameters over SysEx function
 * 0x01. Sweeping that self-describe map yields the SAME `CacheRecord[]` the
 * `.cache` byte-walker (`records.ts`) produces, so either source feeds
 * `buildCache` and the derived device tables are identical (aside from the five
 * special table records — see "Coverage" below).
 *
 * This module has two layers:
 *   1. a PURE codec — `buildDefQuery` / `buildEnumQuery` / `decodeReply` /
 *      `decodeSeptetStream` — fully unit-testable with no transport; and
 *   2. a WALK DRIVER — `liveWalk(transport, opts)` — that sweeps blocks/params
 *      over an injected transport, walks enum label lists, paces, supports an
 *      `AbortSignal`, and reports progress.
 *
 * Pure and browser-safe: no `node:*`, no `Buffer`; wire bytes go through a
 * little-endian `DataView`, and pacing uses the ambient `setTimeout` (or an
 * injected scheduler). The transport is an injected interface, so this file
 * carries NO MIDI/serial dependency.
 *
 * ── Wire facts (hardware-validated, FM3 fw 12.0) ────────────────────────────
 * Frame: `F0 00 01 74 <model> 01 <body…> <cksum> F7`, cksum = XOR of every byte
 * from F0 through the last body byte, masked to 7 bits. Gen-3 model bytes:
 * FM3 0x11, FM9 0x12, Axe-Fx III 0x10.
 *
 * Query body (15 bytes) addresses view × block × param × sub:
 *     [VIEW, 0, BLOCK, 0, PARAM_LO, PARAM_HI, SUB, 0,0,0,0,0,0,0,0]
 *   body[0] VIEW  = 0x1c definition record, 0x1f enum label,
 *                   0x00 formatted value string, 0x2e large value dump
 *   body[2] BLOCK = parameter section address (swept 0..127)
 *   body[4] PARAM_LO = param & 0x7f      body[5] PARAM_HI = param >> 7
 *   body[6] SUB_LO   = sub & 0x7f        body[7] SUB_HIGH = sub >> 7
 * PARAM and SUB are thus 14-bit values, each split into a low/high 7-bit pair
 * (hardware-verified, including both high bytes non-zero in one query); the
 * 14-bit SUB range is what makes the 1024-label enum cap reachable.
 *
 * Reply: `inner = frame[6:-2]`.
 *   inner[0]     = view echo          inner[4] = param-low echo
 *   inner[6]     = TAG: 0x3a "changed since last read" / 0x00 "re-read" — BOTH
 *                  carry payload, so decode is TAG-INDEPENDENT (driven by the
 *                  length word). 0x03 / 0x01 = genuine no-payload sentinel;
 *                  an enum ordinal past the end of the value range (sub > max)
 *                  answers cnt = 0 under tag 0x40 — any cnt = 0 reply is
 *                  treated as no-payload regardless of tag.
 *   inner[13:15] = u16 LE `cnt` = raw payload byte count
 *   inner[15:…]  = a CONTINUOUS MSB-first septet stream (ceil(cnt*8/7) septets)
 *                  yielding exactly `cnt` raw bytes.
 *
 * Definition record (view 0x1c) = 36 raw bytes, little-endian:
 *     u32 id, u32 tc, f32 min, f32 max, f32 scale, f32 def, f32 step, u32 0, u32 0
 * The wire `id` is the device's internal symbol id — NOT the walk param; the
 * emitted record's `id` is the PARAM POSITION that was queried. The `scale`
 * slot is absent from the `.cache` grammar and is dropped here (cache/records.ts
 * has no scale field); the field VALUES min/max/def/step/tc match the cache
 * record byte-for-byte.
 *
 * Enum labels (view 0x1f): one septet-ASCII label per SUB ordinal. The SUB
 * ordinal is the parameter's RAW VALUE (min..max), NOT an index into the value
 * list: values[i] lives at sub = min + i (hardware-verified; the two coincide
 * only when min = 0). Raw values below min can still answer with a label, but
 * those are outside the value list and are not part of the walk. The label
 * range does NOT self-terminate cleanly — it spills into a shared label pool —
 * so the walk is bounded by the definition's value count (max−min+1),
 * hard-capped, and ends early on the first end-sentinel/empty reply. Past-end
 * ordinals (sub > max) answer with cnt = 0 under tag 0x40 — end-of-list
 * detection keys off cnt == 0, tag-independent.
 *
 * kind: the wire typecode is ambiguous (e.g. tc=16 is used by both enum and
 * float params), so kind is derived from the numeric record and, decisively,
 * from whether a 0x1f label list exists:
 *     enum : step==0 && scale==0 && integral bounds        (count = max−min+1)
 *     int  : step is an integer >= 1
 *     float: otherwise
 * A captured 0x1f label list always wins → enum (a genuine enum whose step is
 * non-zero is still an enum). The walk's 2-way output is {enum,float}: `int`
 * maps to `float` (the cache grammar has no integer kind).
 *
 * ── Coverage ────────────────────────────────────────────────────────────────
 * PARAM is 14-bit, so ids up to 16383 are reachable; the special table records
 * (id >= 0xff00: cab/IR bank tables, padded rosters) are NOT param-addressable
 * and are absent from a live walk by design. They affect only a section's
 * declared record count and the cab/IR banks; every other derived table is
 * reproduced exactly. A complete cache pairs the live walk with those few
 * byte-sourced table records.
 */
import { fractalChecksum } from '../shared/checksum.js';
import { buildSetParameterContinuous } from '../gen3/axe-fx-iii/setParam.js';
import type { RecordSource } from './buildProfile.js';
import type { CacheRecord, EnumRecord, FloatRecord, FloatTaper } from './types.js';

// ---------------------------------------------------------------------------
// Frame constants
// ---------------------------------------------------------------------------

/** Fractal manufacturer SysEx header. */
const MFR = [0xf0, 0x00, 0x01, 0x74] as const;
/** Self-describe function byte. */
const FN_SELFDESCRIBE = 0x01;

/** Query view bytes (body[0]). */
export const VIEW_DEFINITION = 0x1c;
export const VIEW_ENUM_LABEL = 0x1f;
export const VIEW_VALUE = 0x00;

/** Reply TAG bytes (inner[6]) that carry NO payload (sentinels). */
const TAG_SENTINELS = new Set([0x01, 0x03]);

// ---------------------------------------------------------------------------
// Pure codec — query builders
// ---------------------------------------------------------------------------

function buildQuery(model: number, view: number, block: number, param: number, sub: number): Uint8Array {
  const body = new Array<number>(15).fill(0);
  body[0] = view & 0x7f;
  body[2] = block & 0x7f; // BLOCK_LO
  body[3] = (block >> 7) & 0x7f; // BLOCK_HI — reaches effectId>=128 (Synth 130-133,
  //                                Mixer 128/129). HW-verified FM3 fw12.00 2026-07-16;
  //                                symmetric to the param (body[5]) / sub (body[7]) splits.
  body[4] = param & 0x7f; // PARAM_LO
  body[5] = (param >> 7) & 0x7f; // PARAM_HI
  body[6] = sub & 0x7f; // SUB_LO
  body[7] = (sub >> 7) & 0x7f; // SUB_HIGH
  const core = [...MFR, model & 0x7f, FN_SELFDESCRIBE, ...body];
  return Uint8Array.from([...core, fractalChecksum(core), 0xf7]);
}

/** Build a DEFINITION query (view 0x1c) for (model, block, param). */
export function buildDefQuery(model: number, block: number, param: number): Uint8Array {
  return buildQuery(model, VIEW_DEFINITION, block, param, 0);
}

/** Build an ENUM-LABEL query (view 0x1f) for (model, block, param, sub). */
export function buildEnumQuery(model: number, block: number, param: number, sub: number): Uint8Array {
  return buildQuery(model, VIEW_ENUM_LABEL, block, param, sub);
}

// ---------------------------------------------------------------------------
// Pure codec — septet stream
// ---------------------------------------------------------------------------

/**
 * Decode a CONTINUOUS MSB-first septet stream into exactly `nbytes` raw bytes.
 *
 * The wire is a bit stream: each 7-bit septet contributes its 7 low bits (MSB
 * first) to an accumulator from which 8-bit bytes are pulled off the top. `n`
 * raw bytes occupy ceil(8n/7) septets; the final septet's low padding bits are
 * discarded once `nbytes` bytes have been emitted. Returns fewer than `nbytes`
 * bytes only when the wire is too short (caller must check `.length`).
 */
export function decodeSeptetStream(wire: Uint8Array, nbytes: number, start = 0): Uint8Array {
  const out = new Uint8Array(nbytes);
  let acc = 0;
  let nbits = 0;
  let o = 0;
  for (let i = start; i < wire.length && o < nbytes; i++) {
    acc = (acc << 7) | (wire[i]! & 0x7f);
    nbits += 7;
    while (nbits >= 8 && o < nbytes) {
      nbits -= 8;
      out[o++] = (acc >>> nbits) & 0xff;
    }
  }
  return o < nbytes ? out.subarray(0, o) : out;
}

/** Wire septet count for `nbytes` raw payload bytes. */
function septetLen(nbytes: number): number {
  return Math.ceil((nbytes * 8) / 7);
}

// ---------------------------------------------------------------------------
// Pure codec — reply decode
// ---------------------------------------------------------------------------

/** A decoded self-describe DEFINITION record (view 0x1c). */
export interface LiveDefinition {
  view: 'definition';
  selector: number;
  param: number;
  /** Device-internal symbol id (NOT the walk param). */
  id: number;
  tc: number;
  /** Heuristic 3-way kind before the label-list confirmation. */
  kind: 'enum' | 'int' | 'float';
  min: number;
  max: number;
  scale: number;
  def: number;
  step: number;
}

/** Any decoded self-describe reply, or `null` for a sentinel / no payload. */
export type LiveReply =
  | LiveDefinition
  | { view: 'enum_label'; selector: number; param: number; label: string }
  | { view: 'value'; selector: number; param: number; value: string }
  | { view: 'string'; selector: number; param: number; text: string }
  | null;

function integral(x: number): boolean {
  // STRICT equality, not a tolerance window (FORGEFX-32): system selectors answer definition
  // queries with junk floats in the subnormal range (e.g. 3e-41), which a tolerance check
  // rounds to "integral 0" — classifying garbage as an enum and triggering a lethal 0x1f
  // label query. Real enum bounds are exact integers in the float32 payload, so exact
  // comparison loses nothing. (The HW-proven prober used exact integrality all along.)
  return Number.isFinite(x) && x === Math.round(x);
}

/** Numeric kind heuristic (3-way), mirroring the wire decode. */
function classifyKind(mn: number, mx: number, scale: number, st: number): 'enum' | 'int' | 'float' {
  if (st === 0 && scale === 0 && integral(mn) && integral(mx)) return 'enum';
  if (st !== 0 && integral(st) && st >= 1) return 'int';
  return 'float';
}

/**
 * Decode ONE self-describe reply frame. Returns a typed result, or `null` when
 * the frame is not a func-0x01 reply, is a sentinel (tag 0x03/0x01), or carries
 * no payload. Decode is TAG-INDEPENDENT: a 0x3a "fresh" and a 0x00 "re-read"
 * reply with the same payload decode identically.
 */
export function decodeReply(frame: Uint8Array): LiveReply {
  const n = frame.length;
  if (
    n < 10 ||
    frame[0] !== 0xf0 ||
    frame[1] !== 0x00 ||
    frame[2] !== 0x01 ||
    frame[3] !== 0x74 ||
    frame[5] !== FN_SELFDESCRIBE ||
    frame[n - 1] !== 0xf7
  ) {
    return null;
  }
  const inner = frame.subarray(6, n - 2);
  if (inner.length < 7) return null;
  const selector = inner[0]!;
  const param = inner[4]!;
  const tag = inner[6]!;
  if (TAG_SENTINELS.has(tag)) return null;
  if (inner.length < 15) return null;
  const cnt = inner[13]! | (inner[14]! << 8);
  if (cnt < 1) return null;
  if (inner.length < 15 + septetLen(cnt)) return null;
  const raw = decodeSeptetStream(inner, cnt, 15);
  if (raw.length < cnt) return null;

  // DEFINITION record: exactly 36 raw bytes with finite numeric fields.
  if (cnt === 36 && raw.length === 36) {
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const id = dv.getUint32(0, true);
    const tc = dv.getUint32(4, true);
    const min = dv.getFloat32(8, true);
    const max = dv.getFloat32(12, true);
    const scale = dv.getFloat32(16, true);
    const def = dv.getFloat32(20, true);
    const step = dv.getFloat32(24, true);
    if ([min, max, scale, def, step].every((x) => Number.isFinite(x))) {
      return {
        view: 'definition',
        selector,
        param,
        id,
        tc,
        kind: classifyKind(min, max, scale, step),
        min,
        max,
        scale,
        def,
        step,
      };
    }
  }

  // STRING payload: enum label (0x1f) or formatted value (0x00).
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0x00) end -= 1;
  if (end > 0) {
    let printable = true;
    for (let i = 0; i < end; i++) {
      const c = raw[i]!;
      if (c < 0x20 || c >= 0x7f) {
        printable = false;
        break;
      }
    }
    if (printable) {
      let s = '';
      for (let i = 0; i < end; i++) s += String.fromCharCode(raw[i]!);
      if (selector === VIEW_ENUM_LABEL) return { view: 'enum_label', selector, param, label: s };
      if (selector === VIEW_VALUE) return { view: 'value', selector, param, value: s };
      return { view: 'string', selector, param, text: s };
    }
  }

  // tag carries payload but it is neither a clean record nor a printable string
  // (e.g. the 0x2e large value dump). Not a parameter definition.
  return null;
}

// ---------------------------------------------------------------------------
// Record synthesis
// ---------------------------------------------------------------------------

/** The all-zero definition body a device returns for an empty/absent slot. */
function isFillerDefinition(d: LiveDefinition): boolean {
  return d.id === 0 && d.tc === 0 && d.min === 0 && d.max === 0 && d.def === 0 && d.step === 0;
}

/** Largest plausible wire typecode — real catalogs top out ~3200; system-selector junk reads
 *  in the tens of thousands. */
const MAX_PLAUSIBLE_TC = 0x3fff;
/** Anything with magnitude below this (but non-zero) is float32 subnormal junk, not a value a
 *  parameter definition would carry. */
const SUBNORMAL_FLOOR = 1e-37;

/**
 * NOT a real parameter definition (FORGEFX-32): system selectors (e.g. FM3 block 0) answer
 * definition queries with junk — subnormal-range floats, implausible typecodes, non-finite
 * fields. Treat those as ABSENT so the walk skips the block after its opening probes instead
 * of recording garbage or, worse, label-probing it.
 */
function isGarbageDefinition(d: LiveDefinition): boolean {
  if (d.tc > MAX_PLAUSIBLE_TC) return true;
  const junk = (x: number): boolean => !Number.isFinite(x) || (x !== 0 && Math.abs(x) < SUBNORMAL_FLOOR);
  return junk(d.min) || junk(d.max) || junk(d.def) || junk(d.step) || junk(d.scale);
}

/**
 * A definition COULD be an enum worth a 0x1f label walk when its bounds are
 * integral and the value count is within the cap — regardless of `step` (an
 * enum with a non-zero step is still an enum, decided by whether labels exist).
 * Scaled controls (`scale != 0`) are NEVER label-walked: they are continuous by
 * contract, and a 0x1f label query against a param with no label list is
 * out-of-contract for the device — the FM3 hard-freezes on it (power-cycle
 * recovery). Genuine step!=0 enums all report scale == 0.
 */
function couldBeEnum(d: LiveDefinition, cap: number): boolean {
  if (d.kind === 'enum') return true;
  if (d.scale !== 0) return false;
  if (!integral(d.min) || !integral(d.max)) return false;
  const span = Math.round(d.max - d.min + 1);
  return span >= 1 && span <= cap;
}

/** Build one `CacheRecord` from a decoded definition (+ any 0x1f labels). */
/** Plausible physical-unit token (rejects model/type NAMES that ride a discrete
 * param's value string, e.g. 'INPUT 2' — those contain a space or digits). */
const UNIT_RE = /^[A-Za-z%°µΩ/]{1,8}$/;

/** Parse the device's formatted value string (view 0x00) → its unit token, or
 * undefined. '440.0 Hz'→'Hz', '0.00 ct'→'ct', '100.0 %'→'%', 'ACTIVE'→undefined. */
export function parseUnit(display: string): string | undefined {
  const m = display.trim().match(/^[+-]?\d[\d.]*(?:[eE][+-]?\d+)?\s*(.*)$/);
  if (!m) return undefined; // no leading number = a label, not a valued param
  const tail = m[1]!.trim();
  return tail && UNIT_RE.test(tail) ? tail : undefined;
}

/**
 * Extract the leading numeric value from a device formatted-value string (view
 * 0x00), or `null` for a pure label. '200.00 Hz'→200, '-3.0 dB'→-3, 'ON'→null.
 * Port of CaptureRig v2's `parse_display` (value half). Full-mode taper sweeps
 * classify on these numbers; a non-numeric display makes that sample inert.
 */
export function parseDisplayValue(display: string): number | null {
  const m = display.trim().match(/^[+-]?\d[\d.]*(?:[eE][+-]?\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
}

/** Round to 5 decimals — CaptureRig v2's `round(err, 5)` for the fit error. */
function round5(x: number): number {
  return Math.round(x * 1e5) / 1e5;
}

/**
 * Classify a normalized→display sweep into a knob taper. Faithful port of
 * CaptureRig v2's `classify_taper` (fas-re): fewer than 3 numeric points →
 * 'unknown' (unreliable); no movement (span ≤ 1e-9 or span/scale < 1e-4) →
 * 'flat' (unreliable — the block is not instantiated / the param is inert, so
 * the sweep carries no taper info); otherwise fit linear (`lo + span·n`) vs log
 * (`lo·(hi/lo)^n`, only when both endpoints > 0) by max relative error — log
 * wins if `log_err < lin_err && log_err < 0.02`, else linear if `lin_err <
 * 0.02`, else 'custom' (reliable, with the sample points).
 */
export function classifyTaper(samples: ReadonlyArray<readonly [number, number | null]>): FloatTaper {
  const pts: Array<readonly [number, number]> = [];
  for (const [n, v] of samples) if (v !== null) pts.push([n, v]);
  if (pts.length < 3) return { shape: 'unknown', err: null, reliable: false, points: pts };
  const vals = pts.map(([, v]) => v);
  const vspan = Math.max(...vals) - Math.min(...vals);
  let vscale = Math.max(...vals.map((v) => Math.abs(v)));
  if (!vscale) vscale = 1.0;
  if (vspan <= 1e-9 || vspan / vscale < 1e-4) {
    // no movement -> block not active / param inert -> no taper info
    return { shape: 'flat', err: 0.0, reliable: false, points: pts };
  }
  const lo = pts[0]![1];
  const hi = pts[pts.length - 1]![1];
  const span = hi - lo;
  const rel = (a: number, b: number): number => {
    const d = Math.max(Math.abs(a), Math.abs(b), 1e-9);
    return Math.abs(a - b) / d;
  };
  let linErr = 0;
  for (const [n, v] of pts) linErr = Math.max(linErr, rel(v, lo + span * n));
  let logErr: number | null = null;
  if (lo > 0 && hi > 0) {
    logErr = 0;
    for (const [n, v] of pts) logErr = Math.max(logErr, rel(v, lo * Math.pow(hi / lo, n)));
  }
  if (logErr !== null && logErr < linErr && logErr < 0.02) {
    return { shape: 'log', err: round5(logErr), reliable: true, points: pts };
  }
  if (linErr < 0.02) {
    return { shape: 'linear', err: round5(linErr), reliable: true, points: pts };
  }
  return { shape: 'custom', err: round5(Math.min(linErr, logErr ?? linErr)), reliable: true, points: pts };
}

/**
 * The normalized position that reproduces display `target` using a classified
 * taper — analytic inverse for log/linear, piecewise-linear interpolation over
 * the samples for custom/degenerate. Port of CaptureRig v2's `_invert`.
 */
function invertTaper(
  points: ReadonlyArray<readonly [number, number]>,
  target: number | null,
  shape: FloatTaper['shape'],
): number | null {
  if (target === null || points.length < 2) return null;
  const lo = points[0]![1];
  const hi = points[points.length - 1]![1];
  if (shape === 'log' && lo > 0 && hi > 0 && target > 0 && hi !== lo) {
    return Math.log(target / lo) / Math.log(hi / lo);
  }
  if (shape === 'linear' && hi !== lo) {
    return (target - lo) / (hi - lo);
  }
  for (let i = 0; i + 1 < points.length; i++) {
    const [na, va] = points[i]!;
    const [nb, vb] = points[i + 1]!;
    if ((va - target) * (vb - target) <= 0 && va !== vb) {
      return na + (nb - na) * (target - va) / (vb - va);
    }
  }
  let best = points[0]!;
  for (const p of points) if (Math.abs(p[1] - target) < Math.abs(best[1] - target)) best = p;
  return best[0];
}

function buildRecord(block: number, param: number, d: LiveDefinition, labels: readonly string[], unit?: string, taper?: FloatTaper): CacheRecord {
  const enumKind = labels.length > 0 || (d.kind === 'enum' && !unit);
  if (enumKind) {
    let count = Math.round(d.max - d.min + 1);
    if (count < 1) count = labels.length;
    const rec: EnumRecord = {
      kind: 'enum',
      section: block,
      offset: 0,
      id: param,
      tc: d.tc,
      min: d.min,
      max: d.max,
      def: d.def,
      step: d.step,
      ...(unit ? { unit } : {}),
      count,
      values: [...labels],
      x: 0,
    };
    return rec;
  }
  const rec: FloatRecord = {
    kind: 'float',
    section: block,
    offset: 0,
    id: param,
    tc: d.tc,
    min: d.min,
    max: d.max,
    def: d.def,
    step: d.step,
    ...(unit ? { unit } : {}),
    t1: 0,
    t2: 0,
    ...(taper ? { taper } : {}),
  };
  return rec;
}

// ---------------------------------------------------------------------------
// Walk driver
// ---------------------------------------------------------------------------

/**
 * Minimal transport the walk drives: send a query frame, resolve with the reply
 * frame (or `null` on timeout/no reply). Deliberately transport-agnostic — a
 * ForgeFX MIDI port, a browser Web-MIDI adapter, or a test fake all satisfy it.
 */
export interface LiveTransport {
  request(query: Uint8Array): Promise<Uint8Array | null>;
}

/**
 * Host-provided WRITE side for a FULL-mode walk (`mode: 'full'`). The codec
 * stays transport-pure: it BUILDS the gen-3 continuous-SET frame with its own
 * encoder (`buildSetParameterContinuous`) and hands the finished bytes to
 * `send`; the host owns the wire. `reloadPreset` re-selects the current preset
 * to reload it from flash — the non-destructive safety net run after every
 * block whose params were swept, mirroring CaptureRig v2's per-block reload.
 * Ignored entirely in read-only mode.
 */
export interface LiveWalkWriteHooks {
  /** Send one raw SysEx frame (a codec-built continuous-SET) to the device. */
  send(frame: Uint8Array): Promise<void>;
  /** Reload the current preset from flash, discarding the sweep's writes. */
  reloadPreset(): Promise<void>;
}

/** Progress event, shaped for a future SSE surface. */
export interface LiveWalkProgress {
  /**
   * `block-start`/`block-done`/`done` fire for every walk; `param-sweep` fires
   * once per completed FULL-mode taper sweep (never in read-only mode — an
   * additive value existing read-only consumers never observe).
   */
  phase: 'block-start' | 'block-done' | 'done' | 'param-sweep';
  /** Current block address (undefined on `done`). */
  block?: number;
  /** Param id being swept (present only on `param-sweep`). */
  param?: number;
  blockIndex: number;
  blockCount: number;
  records: number;
  enumLabels: number;
  queries: number;
  /** Cumulative FULL-mode taper sweeps completed (present in full mode). */
  tapers?: number;
}

export interface LiveWalkOptions {
  /** Device model byte (FM3 0x11, FM9 0x12, Axe-Fx III 0x10). */
  model: number;
  /**
   * Walk mode (default `'read-only'`). `'read-only'` never writes and is
   * byte-identical to the original walk. `'full'` additionally sweeps every
   * continuous float param with a normalized CONTINUOUS-SET, reads the display
   * back to recover the knob taper (linear/log/custom), records it on the
   * `FloatRecord`, then RESTORES the original value (non-destructive). Full mode
   * REQUIRES `write` hooks — the walk throws at start when they are absent.
   */
  mode?: 'read-only' | 'full';
  /**
   * Host WRITE hooks — REQUIRED for `mode: 'full'` (the walk throws at start
   * when absent). Ignored entirely in read-only mode.
   */
  write?: LiveWalkWriteHooks;
  /**
   * Normalized sample count per taper sweep (default 9, matching CaptureRig v2):
   * n = i/(points-1) for i in 0..points-1. Full mode only.
   */
  taperPoints?: number;
  /**
   * Settle pause (ms) between a sweep SET and the display read-back, floored at
   * 20ms (CaptureRig v2's ≥20ms pacing). Routed through `sleep`. Full mode only.
   */
  sweepSettleMs?: number;
  /** Explicit block addresses to sweep; defaults to `0..maxBlock`. */
  blocks?: number[];
  /** Highest block address swept when `blocks` is omitted (default 160 — the block
   * byte splits lo/hi so effectId>=128 blocks are reachable). */
  maxBlock?: number;
  /**
   * Read the device's formatted value (self-describe view 0x00) for each found
   * param and record its device-true `unit` (default true). Read-only; adds one
   * query per param. Set false to skip (e.g. a faster minimal walk).
   */
  readValues?: boolean;
  /**
   * Highest PARAM id swept per block (default 16383 = the full 14-bit range).
   * The reachable id range can be capped here.
   */
  maxParamId?: number;
  /**
   * Consecutive absent params that end a block's sweep (default 256). Must
   * exceed a section's largest internal id gap to reach every record; raise it
   * to reach sparse high-id (param>127) records.
   */
  paramAbsentRunLimit?: number;
  /**
   * Absent params from the start of a block before the block is skipped as
   * empty (default 4).
   */
  blockProbeDepth?: number;
  /** Hard cap on labels collected per enum param (default 1024). */
  enumCountCap?: number;
  /** Pause between queries, ms (default 0 = none). */
  interQueryMs?: number;
  /** Pause between blocks, ms (default 0 = none). */
  blockPauseMs?: number;
  /** Abort the walk; a partial result is discarded (the walk rejects). */
  signal?: AbortSignal;
  /** Progress callback (block boundaries + `done`). */
  onProgress?: (p: LiveWalkProgress) => void;
  /**
   * Scheduler seam for pacing (default the ambient `setTimeout`). Injected in
   * tests to make pacing deterministic without real timers.
   */
  sleep?: (ms: number) => Promise<void>;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const reason = (signal as { reason?: unknown }).reason;
    throw reason instanceof Error ? reason : new Error('live walk aborted');
  }
}

async function pace(ms: number, signal: AbortSignal | undefined, sleep?: (ms: number) => Promise<void>): Promise<void> {
  if (!ms || ms <= 0) return;
  throwIfAborted(signal);
  if (sleep) {
    await sleep(ms);
  } else {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }
}

// ---------------------------------------------------------------------------
// Full-mode taper sweep (write + restore) — port of CaptureRig v2's Gen3Profile
// ---------------------------------------------------------------------------

/** CaptureRig v2's ≥20ms floor between a sweep SET and the display read-back. */
const MIN_SWEEP_SETTLE_MS = 20;

/** Default normalized sample count per sweep (CaptureRig v2 default). */
const DEFAULT_TAPER_POINTS = 9;

/** Read the device's formatted-value string (view 0x00), or `null`. */
async function readDisplay(transport: LiveTransport, model: number, block: number, param: number): Promise<string | null> {
  const vr = await transport.request(buildQuery(model, VIEW_VALUE, block, param, 0));
  const vd = vr ? decodeReply(vr) : null;
  return vd && vd.view === 'value' ? vd.value : null;
}

interface SweepContext {
  transport: LiveTransport;
  write: LiveWalkWriteHooks;
  model: number;
  points: number;
  settleMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Sweep one continuous float param: read the current display, drive normalized
 * 0..1 via CONTINUOUS-SET reading the display back at each step, classify the
 * taper, then RESTORE the original value through the classified curve's analytic
 * inverse. Faithful port of CaptureRig v2's `_sweep_taper`/`_restore`. Returns
 * the classified taper; ALWAYS attempts the restore (the codec builds every
 * SET with `buildSetParameterContinuous` and sends it via the host `write`
 * hook). `reads` counts the display queries issued (folded into `queries`).
 */
async function sweepTaper(ctx: SweepContext, block: number, param: number): Promise<{ taper: FloatTaper; reads: number }> {
  const { transport, write, model, points, settleMs, signal, sleep } = ctx;
  const settle = Math.max(settleMs, MIN_SWEEP_SETTLE_MS);
  let reads = 0;

  const origDisplay = await readDisplay(transport, model, block, param);
  reads += 1;
  const origVal = origDisplay === null ? null : parseDisplayValue(origDisplay);

  const samples: Array<readonly [number, number | null]> = [];
  const denom = points > 1 ? points - 1 : 1;
  for (let i = 0; i < points; i++) {
    throwIfAborted(signal);
    const n = i / denom;
    await write.send(Uint8Array.from(buildSetParameterContinuous(block, param, n, model)));
    await pace(settle, signal, sleep);
    const disp = await readDisplay(transport, model, block, param);
    reads += 1;
    samples.push([round5(n), disp === null ? null : parseDisplayValue(disp)] as const);
  }

  const taper = classifyTaper(samples);

  // Restore via the classified curve's analytic inverse (precise even for
  // wide-range log params); the per-block preset reload is the safety net.
  const n0 = invertTaper(taper.points, origVal, taper.shape);
  if (n0 !== null) {
    throwIfAborted(signal);
    await write.send(Uint8Array.from(buildSetParameterContinuous(block, param, Math.max(0, Math.min(1, n0)), model)));
    await pace(settle, signal, sleep);
    // Read back so the restore mirrors the hardware round-trip (result unused in
    // the record; a bad restore is caught by the per-block preset reload).
    await readDisplay(transport, model, block, param);
    reads += 1;
  }

  return { taper, reads };
}

/**
 * Sweep a device's self-describe map into `CacheRecord[]` deep-equivalent to the
 * `.cache` byte-walker's output (minus the unreachable special table records).
 *
 * Feed the result straight to `buildCache({ kind: 'live', walk })` — or use
 * `liveSource(transport, opts)` to build that source in one call.
 */
export async function liveWalk(transport: LiveTransport, opts: LiveWalkOptions): Promise<CacheRecord[]> {
  const model = opts.model;
  // 160 (not 127): the block byte now splits lo/hi (body[2]/[3]) so effectId>=128
  // blocks are reachable. Empty high blocks are skipped after `blockProbeDepth`
  // params (see the found===0 break below), so the extra range is nearly free.
  const maxBlock = opts.maxBlock ?? 160;
  const blocks = opts.blocks ?? Array.from({ length: maxBlock + 1 }, (_, i) => i);
  const maxParamId = opts.maxParamId ?? 16383;
  const absentRunLimit = opts.paramAbsentRunLimit ?? 256;
  const probeDepth = opts.blockProbeDepth ?? 4;
  const enumCap = opts.enumCountCap ?? 1024;
  // read view 0x00 per found param to capture the device-true unit (default on).
  const readValues = opts.readValues ?? true;
  const { signal, sleep, onProgress } = opts;

  // FULL mode: opt-in taper sweep. Requires host write hooks — fail fast at the
  // walk start (before any wire traffic) when they are missing.
  const mode = opts.mode ?? 'read-only';
  const full = mode === 'full';
  if (full && !opts.write) {
    throw new Error(
      "liveWalk: mode 'full' requires write hooks (opts.write.{send,reloadPreset}); pass them or use mode 'read-only'",
    );
  }
  const taperPoints = opts.taperPoints ?? DEFAULT_TAPER_POINTS;
  const sweepSettleMs = opts.sweepSettleMs ?? MIN_SWEEP_SETTLE_MS;
  const sweepCtx: SweepContext | undefined = full
    ? { transport, write: opts.write!, model, points: taperPoints, settleMs: sweepSettleMs, signal, sleep }
    : undefined;

  const records: CacheRecord[] = [];
  let queries = 0;
  let enumLabels = 0;
  let tapers = 0;

  for (let bi = 0; bi < blocks.length; bi++) {
    const block = blocks[bi]!;
    throwIfAborted(signal);
    onProgress?.({ phase: 'block-start', block, blockIndex: bi, blockCount: blocks.length, records: records.length, enumLabels, queries, ...(full ? { tapers } : {}) });

    let absentRun = 0;
    let found = 0;
    let sweptInBlock = false;
    for (let param = 0; param <= maxParamId; param++) {
      throwIfAborted(signal);
      await pace(opts.interQueryMs ?? 0, signal, sleep);
      const reply = await transport.request(buildDefQuery(model, block, param));
      queries += 1;
      const dec = reply ? decodeReply(reply) : null;
      const def = dec && dec.view === 'definition' ? dec : null;

      if (!def || isFillerDefinition(def) || isGarbageDefinition(def)) {
        absentRun += 1;
        // Skip an empty block once its opening params are all absent.
        if (found === 0 && param + 1 >= probeDepth) break;
        if (absentRun >= absentRunLimit) break;
        continue;
      }
      absentRun = 0;
      found += 1;

      let labels: string[] = [];
      const lo = Math.round(def.min);
      // SPECULATIVE probes (def not positively enum-kind) never open a list at a
      // high absolute sub: every hardware-verified enum starts at a small ordinal,
      // and an out-of-contract high-sub 0x1f (e.g. a 430..450 pitch range) is the
      // FORGEFX-32 freeze trigger. Positively-classified enums keep the full range.
      const speculative = def.kind !== 'enum';
      if (lo >= 0 && (!speculative || lo <= 127) && couldBeEnum(def, enumCap)) {
        // The SUB ordinal is the parameter's RAW VALUE, not a list index:
        // values[i] lives at sub = min + i, so the walk covers exactly
        // min..max. Raw values below min can answer with a label, but they are
        // outside the value list and are never queried. Bounded by the
        // declared count (max−min+1), hard-capped at `enumCountCap`.
        const span = Math.round(def.max - def.min + 1);
        const bound = Math.max(1, Math.min(span >= 1 ? span : enumCap, enumCap));
        for (let i = 0; i < bound; i++) {
          throwIfAborted(signal);
          await pace(opts.interQueryMs ?? 0, signal, sleep);
          const er = await transport.request(buildEnumQuery(model, block, param, lo + i));
          queries += 1;
          const ed = er ? decodeReply(er) : null;
          if (!ed || ed.view !== 'enum_label') break; // end sentinel / empty reply ends the list
          labels.push(ed.label);
        }
        enumLabels += labels.length;
      }
      // UNIT: read the device's own formatted value (view 0x00) and parse the unit
      // token. Read-only, one extra query per found param; skipped when the caller
      // opts out or for enum/label params whose value carries no unit.
      let unit: string | undefined;
      if (readValues && labels.length === 0) {
        throwIfAborted(signal);
        await pace(opts.interQueryMs ?? 0, signal, sleep);
        const vr = await transport.request(buildQuery(model, VIEW_VALUE, block, param, 0));
        queries += 1;
        const vd = vr ? decodeReply(vr) : null;
        if (vd && vd.view === 'value') unit = parseUnit(vd.value);
      }

      // FULL mode: sweep the taper of a CONTINUOUS FLOAT param only — never an
      // enum (a label list was found) nor an int/inert param (kind!=float or
      // max==min). Mirrors CaptureRig v2's `d["kind"]=="float" and max!=min`
      // (the label walk already claimed any enum). The sweep writes + restores;
      // its taper rides the FloatRecord and is threaded into the RangeDef.
      let taper: FloatTaper | undefined;
      if (sweepCtx && labels.length === 0 && def.kind === 'float' && def.max !== def.min) {
        await pace(opts.interQueryMs ?? 0, signal, sleep);
        const swept = await sweepTaper(sweepCtx, block, param);
        taper = swept.taper;
        queries += swept.reads;
        tapers += 1;
        sweptInBlock = true;
        onProgress?.({ phase: 'param-sweep', block, param, blockIndex: bi, blockCount: blocks.length, records: records.length, enumLabels, queries, tapers });
      }

      records.push(buildRecord(block, param, def, labels, unit, taper));
    }

    // FULL-mode safety net: reload the preset from flash after every block whose
    // params were swept, so an interrupt can never leave unsaved sweep edits
    // behind (CaptureRig v2's per-block `reload_preset`).
    if (sweepCtx && sweptInBlock) {
      throwIfAborted(signal);
      await sweepCtx.write.reloadPreset();
    }

    onProgress?.({ phase: 'block-done', block, blockIndex: bi, blockCount: blocks.length, records: records.length, enumLabels, queries, ...(full ? { tapers } : {}) });
    await pace(opts.blockPauseMs ?? 0, signal, sleep);
  }

  onProgress?.({ phase: 'done', blockIndex: blocks.length, blockCount: blocks.length, records: records.length, enumLabels, queries, ...(full ? { tapers } : {}) });
  return records;
}

/**
 * Convenience: a `RecordSource` that walks a live device, ready for
 * `buildCache(liveSource(transport, opts), params, seeds, …)`.
 */
export function liveSource(transport: LiveTransport, opts: LiveWalkOptions): RecordSource {
  return { kind: 'live', walk: () => liveWalk(transport, opts) };
}
