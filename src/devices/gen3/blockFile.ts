/**
 * Gen-3 `.blk` container parser — a single saved block from FM3-Edit /
 * Axe-Edit III / FM9-Edit (Setup → save one configured block to disk). The
 * file wraps a verbatim gen-3 state-broadcast burst: the same
 * 0x74 head / 0x75×N body / 0x76 end frames `assembleGen3BlockBulkRead`
 * already parses off the wire. Read-only: decodes bytes the editor already
 * wrote; emits nothing.
 *
 * Byte layout (all multi-byte fields little-endian), established by
 * inspecting all 230 real `.blk` files under an FM3-Edit install:
 *
 *   0x00 u16   fileVersion            3 | 4 | 5
 *   0x02 u16   headerModelId          0x10 III | 0x11 FM3 | 0x12 FM9 — NOT
 *                                     authoritative, see below
 *   0x04 u16   param-table revision   (unconfirmed; unused)
 *   0x06 [16]  UUID v4                (unused)
 *   0x16 u32   effectTypeId           the editor's own category enum
 *                                     (Comp 7, GEQ 8, PEQ 9, Amp 10, Cab 11,
 *                                     Rev 12, Delay 13, …, Drive 25 — stable
 *                                     per folder, confirmed one value per
 *                                     category across the whole library);
 *                                     kept for diagnostics only, not used to
 *                                     dispatch decoding
 *   0x1a u32   = 1                    (unused)
 *   0x1e u32   activeChannel          0..3 (A..D), selected when saved
 *   0x22 u32   nameLen, then nameLen ASCII bytes (unterminated)
 *        u32   = 0 (empty second string)
 *        [v4/v5 only] u32 = 1
 *        u32   payloadByteLength      NOT trusted as a hard scan bound, see below
 *        [payload]  the SysEx burst(s), verbatim
 *   last byte  XOR of every preceding byte, masked & 0x7f
 *
 * Two things the real library requires that a literal reading of the header
 * doesn't give you:
 *
 *  - **The header's model byte can disagree with the burst's own model
 *    byte.** One file in the wild (`Ring Modulator/Octaver`) has header
 *    0x11 (FM3) but its SysEx frames carry model 0x10 (Axe-Fx III) — almost
 *    certainly a cross-editor save. A decoder must dispatch on the burst's
 *    own model byte; `headerModelId` is kept only for diagnostics.
 *  - **`payloadByteLength` can undercount.** Two 2021-vintage files
 *    (`Wahwah/LT`, `Resonator/Resoflange`) carry a SECOND burst — a legacy
 *    Controllers/Modifier snapshot — that the declared length excludes
 *    entirely. So frames are found by scanning forward from the payload's
 *    first byte to the byte before the trailer, not by trusting the
 *    declared length, and grouped into bursts on each 0x74 head; the first
 *    burst is the block itself, the rest land in `extraBursts`.
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
   *  Controllers/Modifier snapshot on two 2021-vintage files. Empty for a normal file. */
  extraBursts: { blockId: number; values: number[] }[];
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
  const effectTypeId = u32le(bytes, 0x16);
  const activeChannel = u32le(bytes, 0x1e);

  let off = 0x22;
  const nameLen = u32le(bytes, off);
  off += 4;
  const name = new TextDecoder('ascii').decode(bytes.subarray(off, off + nameLen));
  off += nameLen;
  off += 4; // second string's nameLen (= 0, always empty)
  if (fileVersion >= 4) off += 4; // v4/v5 extra u32 (= 1)
  off += 4; // payloadByteLength — consumed but not trusted as a scan bound, see module doc

  const xorExpected = bytes[bytes.length - 1]!;
  let xor = 0;
  for (let i = 0; i < bytes.length - 1; i++) xor ^= bytes[i]!;
  xor &= 0x7f;
  if (xor !== xorExpected) {
    throw new Error(
      `parseGen3BlockFile: XOR trailer mismatch (computed 0x${xor.toString(16)}, file has 0x${xorExpected.toString(16)}) — file is corrupt`,
    );
  }

  const tail = bytes.subarray(off, bytes.length - 1);
  const frames = scanFrames(tail);
  const bursts = groupBursts(frames);
  if (bursts.length === 0) throw new Error('parseGen3BlockFile: no 0x74 state-broadcast burst found');

  // Trust the burst's own model byte over the header's (see module doc).
  const trueModel = bursts[0]![0]![4]!;
  const primary = assembleGen3BlockBulkRead(bursts[0]!, trueModel);
  const extraBursts = bursts.slice(1).map((b) => {
    const bulk = assembleGen3BlockBulkRead(b, trueModel);
    return { blockId: bulk.blockId, values: bulk.values };
  });

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
  };
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
