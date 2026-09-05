/**
 * Gen-3 `.blk` container — a single saved block from FM3-Edit /
 * Axe-Edit III / FM9-Edit (Setup → save one configured block to disk). The
 * file wraps a verbatim gen-3 state-broadcast burst: the same
 * 0x74 head / 0x75×N body / 0x76 end frames `assembleGen3BlockBulkRead`
 * already parses off the wire. `parseGen3BlockFile` reads one off disk;
 * `writeGen3BlockFile` is its exact inverse (used to save a live block back
 * to the library).
 *
 * Byte layout (all multi-byte fields little-endian), established by
 * inspecting all 231 real `.blk` files under an FM3-Edit install:
 *
 *   0x00 u16   fileVersion            3 | 4 | 5 (writer emits 5)
 *   0x02 u16   headerModelId          0x10 III | 0x11 FM3 | 0x12 FM9 — NOT
 *                                     authoritative, see below
 *   0x04 u8    firmwareMajor          of the device that saved it
 *   0x05 u8    firmwareMinor          displayed by the editor as %d.%02d
 *   0x06 [16]  UUID v4                random per file
 *   0x16 u32   effectTypeId           the editor's own category enum
 *                                     (Comp 7, GEQ 8, PEQ 9, Amp 10, Cab 11,
 *                                     Rev 12, Delay 13, …, Drive 25 — stable
 *                                     per folder, confirmed one value per
 *                                     category across the whole library);
 *                                     the editor validates it, so it must be
 *                                     exact. Not used to dispatch decoding.
 *   0x1a u32   = 1                    (one legacy file has 0)
 *   0x1e u32   activeChannel          0..3 (A..D), selected when saved
 *   0x22 u32   nameLen, then nameLen ASCII bytes (unterminated)
 *        u32   = 0 (empty second string)
 *        [v4/v5 only] u32 = 1
 *        u32   payloadByteLength      EXACT (ends at the final 0x76 frame's F7)
 *        [payload]  the SysEx burst, verbatim (0x74 head + 0x75×N body + 0x76 end)
 *        u32   extraSectionCount      0 in 229/231 files
 *        [v5 only] u32 = 0
 *        per section: u16 = 4, u32 sectionByteLength, then that many bytes
 *   last byte  XOR of every preceding byte, masked & 0x7f
 *
 * One thing the real library requires that a literal reading of the header
 * doesn't give you:
 *
 *  - **The header's model byte can disagree with the burst's own model
 *    byte.** One file in the wild (`Ring Modulator/Octaver`) has header
 *    0x11 (FM3) but its SysEx frames carry model 0x10 (Axe-Fx III) — almost
 *    certainly a cross-editor save. A decoder must dispatch on the burst's
 *    own model byte; `headerModelId` is kept only for diagnostics (and for
 *    the writer, which must round-trip it verbatim).
 *
 * The two 2021-vintage files that once looked like "a second burst the
 * declared length excludes" are actually a properly framed EXTRA-SECTION list
 * living after the payload (see `extraSections`): `payloadByteLength` is
 * exact, and the legacy Controllers/Modifier snapshot rides that list, not
 * an undocumented gap in the payload.
 *
 * Values are channel-blocked exactly like a live 0x1F bulk-read burst
 * (`index = channel × stride + paramId`). `stride`/`channels` use
 * `reader.ts#strideOf`'s LEGACY fallback rule (÷4 when itemCount divides
 * evenly, else one flat copy) rather than its stricter device-true-catalog
 * branch: that branch requires a live dump's per-channel size to be at
 * least the current catalog's max paramId + 1, which assumes the reading
 * firmware and our catalog agree on paramCount — true for a live device,
 * NOT for a `.blk` saved years before the catalog grew a param. Applying
 * that check here misclassifies real files: a 2024 FM3 Drive save with a
 * 40-param-per-channel FUZZ stride (today's catalog max is 42) would be
 * misread as 2 channels of 80 instead of the true 4 channels of 40,
 * silently corrupting which channel is "D". The legacy rule alone matches
 * every one of the 230 real files checked. Consequently a `.blk` can have a
 * shorter stride than the current catalog's max paramId —
 * `decodeGen3BlockFile` emits only the paramIds the file actually has,
 * never padding the rest with zeros.
 */
import {
  assembleGen3BlockBulkRead,
} from '../../gen3/axe-fx-iii/setParam.js';
import {
  gen3BlockParamModel,
  decodeOne,
  type DecodedBlock,
  type Gen3BlockParamTables,
} from './blockParams.js';

const LEGACY_NUM_CHANNELS = 4;

export interface Gen3BlockFile {
  fileVersion: number;
  /** From the SysEx frames — trust this over `headerModelId` (they disagree in 1/230 files). */
  modelId: number;
  /** The header's own model field, kept for diagnostics only. */
  headerModelId: number;
  name: string;
  /** Header 0x16 — the editor's own category enum. Diagnostic; not used for decoding. */
  effectTypeId: number;
  /** 0..3 (A..D), the channel selected when the file was saved. */
  activeChannel: number;
  /** The burst head's blockId — the grid slot the block occupied (e.g. Drive 1 = 118). */
  blockId: number;
  itemCount: number;
  channels: number;
  stride: number;
  /** Channel-blocked raw values, itemCount long: index = channel * stride + paramId. */
  values: number[];
  /** A second (or later) burst found after the primary block — observed as a legacy
   *  Controllers/Modifier snapshot on two 2021-vintage files. Empty for a normal file.
   *  Derived from the extra-section list (and any trailing payload bursts). */
  extraBursts: { blockId: number; values: number[] }[];
  /** Firmware of the device that saved the file (0x04/0x05). The writer's most
   *  silently-failure-prone field — see the save plan. */
  firmware: { major: number; minor: number };
  /** The 16-byte UUID v4 (0x06..0x15), retained for byte-identical round-trips. */
  uuid: Uint8Array;
  /** The 0x1a u32 (= 1 in 230/231 files). */
  flag: number;
  /** The verbatim payload bytes (0x74 head … 0x76 end), EXACTLY payloadByteLength long. */
  payload: number[];
  /** The trailing extra-section list (the legacy Controllers/Modifier snapshot rides here). */
  extraSections: Gen3BlockFileExtraSection[];
  /** The v5-only trailing u32 after `extraSectionCount` (0 in every real file). */
  extraField: number;
}

/** One entry of the trailing extra-section list: `u16 tag` (4) + `u32 sectionByteLength` + bytes. */
export interface Gen3BlockFileExtraSection {
  tag: number;
  bytes: number[];
}

/** Everything `writeGen3BlockFile` needs to author one `.blk` file. */
export interface Gen3BlockFileWrite {
  /** Header model byte (0x10/0x11/0x12) — echoed from the device, not the burst. */
  modelId: number;
  /** Firmware of the device being saved FROM — never copied from a previewed block. */
  firmware: { major: number; minor: number };
  /** The editor's category enum (see the table in the module doc). Must be exact. */
  effectTypeId: number;
  /** 0..3 (A..D), the channel selected when saved. */
  xyState: number;
  /** ASCII block name (caller-truncated). */
  name: string;
  /** Verbatim payload frames: 0x74 head + 0x75×N body + 0x76 end. */
  payload: number[];
  /** Container version to emit (default 5). */
  fileVersion?: number;
  /** The 0x1a u32 (default 1). */
  flag?: number;
  /** Trailing extra sections (default none). */
  extraSections?: Gen3BlockFileExtraSection[];
  /** The v5-only trailing u32 (default 0). */
  extraField?: number;
  /** Inject a fixed UUID for tests; a random v4 otherwise. */
  uuid?: Uint8Array;
}

const u16le = (b: Uint8Array, o: number): number => b[o]! | (b[o + 1]! << 8);
const u32le = (b: Uint8Array, o: number): number =>
  (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** Per-block channel count + stride: ÷4 when itemCount divides evenly (the normal
 *  case for a channelable family — Amp/Cab/Comp/Delay/Drive/GEQ/Reverb/Wah all save
 *  4 A-D copies), else one flat copy (the non-channelable families — Send, Return,
 *  Ring Mod, Megatap — whose itemCount is never observed divisible by 4). See the
 *  module doc for why the stricter device-true-catalog check `reader.ts#strideOf`
 *  also has is deliberately NOT applied here. */
function strideOf(itemCount: number, valuesLength: number): { stride: number; channels: number } {
  if (itemCount > 0 && itemCount % LEGACY_NUM_CHANNELS === 0 && valuesLength >= itemCount) {
    return { stride: itemCount / LEGACY_NUM_CHANNELS, channels: LEGACY_NUM_CHANNELS };
  }
  return { stride: valuesLength, channels: 1 };
}

/** A family reserves `firstId..firstId+3` in the grid id space (instances 1..4) —
 *  the same span `readBlockParams` assumes via its own `INSTANCE_SPAN` constant. */
const INSTANCE_SPAN = 4;

/**
 * Resolve a blockId to its family + 1-based instance. `tables.familyByEffectId`
 * (shared with the live preset-body path) keys ONLY each family's `firstId` — a
 * `.blk` saved from a non-first instance (e.g. "Drive 2", blockId 119) has no
 * direct entry. Real files hit this: of 230 checked, 3 are instance ≥2 saves
 * (Drive 2, two Parametric EQ 2s). Fall back to the nearest firstId at or below
 * blockId, accepting it only within the instance span — never crossing into the
 * next family's own firstId.
 */
function resolveBlockFamily(tables: Gen3BlockParamTables, blockId: number): { family: string; instance: number } | undefined {
  const direct = tables.familyByEffectId[String(blockId)];
  if (direct) return { family: direct, instance: 1 };

  let nearest: number | undefined;
  for (const key of Object.keys(tables.familyByEffectId)) {
    const k = Number(key);
    if (k <= blockId && (nearest === undefined || k > nearest)) nearest = k;
  }
  if (nearest === undefined) return undefined;
  const span = blockId - nearest;
  if (span <= 0 || span >= INSTANCE_SPAN) return undefined;
  return { family: tables.familyByEffectId[String(nearest)]!, instance: span + 1 };
}

/**
 * Scan `tail` (already past the header, up to but excluding the trailer byte) for
 * F0…F7 SysEx frames. Every byte inside a real gen-3 broadcast frame is 7-bit
 * clean (0..0x7f) except the F0/F7 delimiters themselves, so once the scan starts
 * exactly at the payload's first byte — never earlier, the header/UUID region can
 * contain incidental 0xf0/0xf7 bytes — no frame body byte can be mistaken for a
 * delimiter.
 */
function scanFrames(tail: Uint8Array): number[][] {
  const frames: number[][] = [];
  let i = 0;
  while (i < tail.length) {
    if (tail[i] === 0xf0) {
      let j = i;
      while (j < tail.length && tail[j] !== 0xf7) j++;
      if (j >= tail.length) break; // truncated trailing frame — ignore
      frames.push(Array.from(tail.subarray(i, j + 1)));
      i = j + 1;
    } else {
      i++;
    }
  }
  return frames;
}

/** Group frames into bursts on each 0x74 head frame. Frames before the first head
 *  are dropped (shouldn't occur once scanning starts exactly at the payload). */
function groupBursts(frames: readonly number[][]): number[][][] {
  const bursts: number[][][] = [];
  let current: number[][] | null = null;
  for (const f of frames) {
    const isHead = f.length >= 6 && f[0] === 0xf0 && f[1] === 0x00 && f[2] === 0x01 && f[3] === 0x74 && f[5] === 0x74;
    if (isHead) {
      current = [f];
      bursts.push(current);
    } else if (current) {
      current.push(f);
    }
  }
  return bursts;
}

/** Parse a `.blk` file's header + burst(s) into raw channel-blocked values. Verifies
 *  the XOR trailer and throws on mismatch — cheap integrity check, holds universally
 *  across the real library. Does not require a calibrated catalog for the model. */
export function parseGen3BlockFile(bytes: Uint8Array): Gen3BlockFile {
  if (bytes.length < 0x26) throw new Error('parseGen3BlockFile: file too short to hold a block-file header');

  const fileVersion = u16le(bytes, 0x00);
  const headerModelId = u16le(bytes, 0x02);
  const firmwareMajor = bytes[0x04]!;
  const firmwareMinor = bytes[0x05]!;
  const uuid = bytes.subarray(0x06, 0x16);
  const effectTypeId = u32le(bytes, 0x16);
  const flag = u32le(bytes, 0x1a);
  const activeChannel = u32le(bytes, 0x1e);

  let off = 0x22;
  const nameLen = u32le(bytes, off);
  off += 4;
  const name = new TextDecoder('ascii').decode(bytes.subarray(off, off + nameLen));
  off += nameLen;
  off += 4; // second string's nameLen (= 0, always empty)
  if (fileVersion >= 4) off += 4; // v4/v5 extra u32 (= 1)
  const payloadByteLength = u32le(bytes, off);
  off += 4;

  const payloadEnd = off + payloadByteLength;
  const payload = Array.from(bytes.subarray(off, payloadEnd));
  off = payloadEnd;

  // Trailing extra-section list (the legacy Controllers/Modifier snapshot rides here).
  const extraSectionCount = u32le(bytes, off);
  off += 4;
  let extraField = 0;
  if (fileVersion >= 5) {
    extraField = u32le(bytes, off);
    off += 4;
  }
  const extraSections: Gen3BlockFileExtraSection[] = [];
  for (let i = 0; i < extraSectionCount; i++) {
    const tag = u16le(bytes, off);
    off += 2;
    const len = u32le(bytes, off);
    off += 4;
    extraSections.push({ tag, bytes: Array.from(bytes.subarray(off, off + len)) });
    off += len;
  }

  const xorExpected = bytes[bytes.length - 1]!;
  let xor = 0;
  for (let i = 0; i < bytes.length - 1; i++) xor ^= bytes[i]!;
  xor &= 0x7f;
  if (xor !== xorExpected) {
    throw new Error(
      `parseGen3BlockFile: XOR trailer mismatch (computed 0x${xor.toString(16)}, file has 0x${xorExpected.toString(16)}) — file is corrupt`,
    );
  }

  const frames = scanFrames(Uint8Array.from(payload));
  const bursts = groupBursts(frames);
  if (bursts.length === 0) throw new Error('parseGen3BlockFile: no 0x74 state-broadcast burst found');

  // Trust the burst's own model byte over the header's (see module doc).
  const trueModel = bursts[0]![0]![4]!;
  const primary = assembleGen3BlockBulkRead(bursts[0]!, trueModel);
  const extraBursts: { blockId: number; values: number[] }[] = bursts.slice(1).map((b) => {
    const bulk = assembleGen3BlockBulkRead(b, trueModel);
    return { blockId: bulk.blockId, values: bulk.values };
  });
  for (const section of extraSections) {
    for (const b of groupBursts(scanFrames(Uint8Array.from(section.bytes)))) {
      const bulk = assembleGen3BlockBulkRead(b, trueModel);
      extraBursts.push({ blockId: bulk.blockId, values: bulk.values });
    }
  }

  const { stride, channels } = strideOf(primary.itemCount, primary.values.length);

  return {
    fileVersion,
    modelId: trueModel,
    headerModelId,
    name,
    effectTypeId,
    activeChannel,
    blockId: primary.blockId,
    itemCount: primary.itemCount,
    channels,
    stride,
    values: primary.values,
    extraBursts,
    firmware: { major: firmwareMajor, minor: firmwareMinor },
    uuid,
    flag,
    payload,
    extraSections,
    extraField,
  };
}

/** Random 16-byte UUID v4 (browser-safe: globalThis.crypto when present, else Math.random). */
function randomUuid(): Uint8Array {
  const out = new Uint8Array(16);
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(out);
  } else {
    for (let i = 0; i < 16; i++) out[i] = Math.floor(Math.random() * 256);
  }
  out[6] = (out[6]! & 0x0f) | 0x40; // version 4
  out[8] = (out[8]! & 0x3f) | 0x80; // RFC 4122 variant
  return out;
}

/** ASCII-encode a block name (each char's low byte, 7-bit). Caller truncates length. */
function asciiBytes(name: string): number[] {
  const out: number[] = [];
  for (const ch of name) out.push(ch.charCodeAt(0) & 0x7f);
  return out;
}

/**
 * Write a `.blk` file — the exact inverse of `parseGen3BlockFile`. Emits
 * fileVersion 5 by default (the format every modern editor opens), the corrected
 * firmware bytes at 0x04/0x05, an exact `payloadByteLength`, and the XOR trailer
 * over every preceding byte. Passing a parse result back in reproduces the file
 * byte-for-byte (`write(parse(f)) === f`), which the round-trip test asserts.
 */
export function writeGen3BlockFile(spec: Gen3BlockFileWrite): Uint8Array {
  const fileVersion = spec.fileVersion ?? 5;
  const flag = spec.flag ?? 1;
  const extraField = spec.extraField ?? 0;
  const extraSections = spec.extraSections ?? [];
  const uuid = spec.uuid ?? randomUuid();

  const parts: number[] = [];
  const u16 = (v: number): void => { parts.push(v & 0xff, (v >>> 8) & 0xff); };
  const u32 = (v: number): void => { parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff); };
  const u8 = (v: number): void => { parts.push(v & 0xff); };

  u16(fileVersion);
  u16(spec.modelId);
  u8(spec.firmware.major);
  u8(spec.firmware.minor);
  for (let i = 0; i < 16; i++) u8(uuid[i] ?? 0);
  u32(spec.effectTypeId);
  u32(flag);
  u32(spec.xyState);
  const nameBytes = asciiBytes(spec.name);
  u32(nameBytes.length);
  for (const b of nameBytes) u8(b);
  u32(0); // second string nameLen (= 0, always empty)
  if (fileVersion >= 4) u32(1); // v4/v5 extra u32
  u32(spec.payload.length);
  for (const b of spec.payload) u8(b);
  u32(extraSections.length);
  if (fileVersion >= 5) u32(extraField);
  for (const section of extraSections) {
    u16(section.tag);
    u32(section.bytes.length);
    for (const b of section.bytes) u8(b);
  }

  let xor = 0;
  for (const b of parts) xor ^= b;
  parts.push(xor & 0x7f);

  return Uint8Array.from(parts);
}

/**
 * Decode a `.blk` file into one `DecodedBlock` per channel it actually has, using
 * the same named/scaled/enum-labelled join `readBlockParams` uses for a live
 * preset body. Throws for a model this package hasn't calibrated (VP4) — refusing
 * beats a plausible-but-wrong decode — and for a blockId with no mapped family.
 */
export function decodeGen3BlockFile(bytes: Uint8Array): DecodedBlock[] {
  const file = parseGen3BlockFile(bytes);
  const { tables } = gen3BlockParamModel(file.modelId);
  const resolved = resolveBlockFamily(tables, file.blockId);
  if (!resolved || !tables.paramsByFamily[resolved.family]) {
    throw new Error(`decodeGen3BlockFile: no family mapped for blockId ${file.blockId} on model 0x${file.modelId.toString(16)}`);
  }
  const { family, instance } = resolved;

  const out: DecodedBlock[] = [];
  for (let ch = 0; ch < file.channels; ch++) {
    const base = ch * file.stride;
    out.push(
      decodeOne(
        tables,
        file.blockId,
        family,
        instance,
        (paramId) => (paramId < file.stride && base + paramId < file.values.length ? file.values[base + paramId] : undefined),
        file.channels > 1 ? ch : undefined,
      ),
    );
  }
  return out;
}
