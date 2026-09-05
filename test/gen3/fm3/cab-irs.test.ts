import { buildCabIrNameRead, parseCabIrNameResponse } from '../../../src/gen3/axe-fx-iii/index.js';
import { fractalChecksum } from '../../../src/shared/checksum.js';
import { packValueChunked } from '../../../src/shared/packValue.js';

function hex(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function reply(name: string, stale = ''): number[] {
  const raw = new Uint8Array(32);
  for (let i = 0; i < name.length; i++) raw[i] = name.charCodeAt(i);
  for (let i = 0; i < stale.length && name.length + 1 + i < raw.length; i++) raw[name.length + 1 + i] = stale.charCodeAt(i);
  const frame = [
    0xf0, 0x00, 0x01, 0x74, 0x11, 0x01, 0x4b, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x10, 0x01, 0x00, 0x00, 0x00, 0x00, 32, 0,
    ...packValueChunked(raw),
  ];
  frame.push(fractalChecksum(frame), 0xf7);
  return frame;
}

export function runFm3CabIrTests(): void {
  const first = buildCabIrNameRead(0x11, 2048);
  if (hex(first) !== 'f000017411014b00000000000010000000000000004ef7') {
    throw new Error(`USER slot 0 request drifted: ${hex(first)}`);
  }
  const last = buildCabIrNameRead(0x11, 2559);
  if (hex(last) !== 'f000017411014b00000000007f130000000000000032f7') {
    throw new Error(`USER slot 511 request drifted: ${hex(last)}`);
  }
  if (parseCabIrNameResponse(reply('TDR Vox mix', 'stale bytes')) !== 'TDR Vox mix') {
    throw new Error('cab name parser did not stop at the NUL terminator');
  }
  if (parseCabIrNameResponse(reply('')) !== '') {
    throw new Error('empty cab slot did not decode to an empty string');
  }
  if (parseCabIrNameResponse([0xf0, 0x00, 0x01, 0x74, 0x11, 0x01, 0x4b, 0xf7]) !== null) {
    throw new Error('short cab reply was accepted');
  }
}

export const FM3_CAB_IR_CASE_COUNT = 5;
