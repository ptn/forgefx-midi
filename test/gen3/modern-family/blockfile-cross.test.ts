/**
 * `.blk` block-file container — Axe-Fx III + edge-case goldens.
 *
 * Three real fixtures, each covering a distinct implementation-note edge case
 * from `blockFile.ts`'s module doc:
 *
 *  - `blockfile-axe3-delay-dd2.blk` — a plain Axe-Fx III save (header model
 *    byte AND frame model byte both 0x10) sitting in an FM3-Edit blocks
 *    library, decoded through the III's own catalog/enum vocabulary.
 *  - `blockfile-modelmismatch-ringmod.blk` — header model byte 0x11 (FM3) but
 *    the burst's own frames carry model byte 0x10 (Axe-Fx III): the decoder
 *    must dispatch on the frame's model, not the header's.
 *  - `blockfile-twoburst-wah.blk` — a 2021-vintage save carrying a SECOND
 *    burst (a legacy Controllers/Modifier snapshot) that the header's
 *    `payloadByteLength` excludes entirely; the primary block must still
 *    decode correctly and the second burst must land in `extraBursts`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGen3BlockFile, decodeGen3BlockFile } from '../../../src/devices/gen3/blockFile.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

export const CROSS_BLOCKFILE_CASE_COUNT = 3;

function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  if (actual !== expected) throw new Error(`${msg}: ${JSON.stringify(actual)} !== expected ${JSON.stringify(expected)}`);
}

export function runCrossBlockFileTests(): void {
  // Axe-Fx III delay: DD-2 → "Vintage Digital", Time ≈ 300 ms.
  {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'blockfile-axe3-delay-dd2.blk')));
    const file = parseGen3BlockFile(bytes);
    assertEqual(file.modelId, 0x10, '[blockfile-cross] DD-2 modelId (Axe-Fx III)');
    assertEqual(file.headerModelId, 0x10, '[blockfile-cross] DD-2 headerModelId agrees here');

    const blocks = decodeGen3BlockFile(bytes);
    const active = blocks[file.activeChannel]!;
    assertEqual(active.typeName, 'Vintage Digital', '[blockfile-cross] DD-2 typeName');
    const time = active.params.find((p) => p.name === 'DELAY_TIME');
    if (!time || time.value == null || Math.abs(time.value - 300) > 1) {
      throw new Error(`[blockfile-cross] DD-2 DELAY_TIME should be ≈300ms, got ${time?.value}`);
    }
  }

  // Header/frame model disagreement: header says FM3 (0x11), the burst's own
  // frames say Axe-Fx III (0x10) — must dispatch on the frame's model byte.
  {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'blockfile-modelmismatch-ringmod.blk')));
    const file = parseGen3BlockFile(bytes);
    assertEqual(file.headerModelId, 0x11, '[blockfile-cross] Octaver headerModelId (FM3, per file header)');
    assertEqual(file.modelId, 0x10, '[blockfile-cross] Octaver modelId must come from the frames (Axe-Fx III)');
    assertEqual(file.channels, 1, '[blockfile-cross] Octaver channels (non-channelable RingMod family)');

    const blocks = decodeGen3BlockFile(bytes);
    assertEqual(blocks.length, 1, '[blockfile-cross] Octaver decoded block count');
    assertEqual(blocks[0]!.family, 'RINGMOD', '[blockfile-cross] Octaver family');
  }

  // Legacy two-burst file: payloadByteLength covers only the first burst; the
  // second (a Controllers/Modifier snapshot) must be found anyway and kept
  // separate from the primary block's decode.
  {
    const bytes = new Uint8Array(readFileSync(join(FIXTURES, 'blockfile-twoburst-wah.blk')));
    const file = parseGen3BlockFile(bytes);
    assertEqual(file.extraBursts.length, 1, '[blockfile-cross] LT wah extraBursts count');

    const blocks = decodeGen3BlockFile(bytes);
    const active = blocks[file.activeChannel]!;
    assertEqual(active.family, 'WAH', '[blockfile-cross] LT wah family');
    assertEqual(active.typeName, 'Cry Babe', '[blockfile-cross] LT wah active channel typeName');
  }
}
