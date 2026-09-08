/**
 * Gen-3 typecode-derived display units.
 *
 * `scripts/derive-gen3-units.ts` fills each device catalog's `unit` tag from the
 * high byte of the device's own `typecode` bitfield (see that script's header for
 * the decode and its evidence). The script's own `--check` mode only proves the
 * committed files match what the script would emit today — if the MAP were wrong,
 * check would still pass happily.
 *
 * This suite pins the semantics instead, per device (FM3 / FM9 / Axe-Fx III):
 *   - representative params of every mapped class resolve to the expected unit;
 *   - the deliberately UNMAPPED params stay 'numeric' (classes 0xa/0xb/0xc have
 *     no verified row anywhere to validate a guess against — CONTROLLERS_TEMPO
 *     and CABINET_MICSPACE are the canaries);
 *   - a human-assigned unit is never overwritten by its class (DISTORT_TREMFREQ
 *     is tagged 'db' in the overlay while its class says 'hz' — a known overlay
 *     error the derivation reports but must leave alone);
 *   - 'cents' actually landed somewhere, since it is a unit code the derivation
 *     introduced and nothing else in the catalog produces.
 */
import { FM3_PARAMS } from '../../src/gen3/fm3/index.js';
import { FM9_PARAMS } from '../../src/gen3/fm9/index.js';
import { PARAMS as AXE3_PARAMS } from '../../src/gen3/axe-fx-iii/index.js';
import type { Param, Unit } from '../../src/gen3/types.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`[derived-units] ${msg}`);
}

const DEVICES: { label: string; params: readonly Param[] }[] = [
  { label: 'FM3', params: FM3_PARAMS },
  { label: 'FM9', params: FM9_PARAMS },
  { label: 'Axe-Fx III', params: AXE3_PARAMS },
];

/** One representative param per mapped typecode class. */
const EXPECTED: { name: string; unit: Unit; why: string }[] = [
  { name: 'CABINET_LEVEL', unit: 'db', why: 'class 0x1' },
  { name: 'CABINET_HICUT', unit: 'hz', why: 'class 0x2' },
  { name: 'REVERB_TIME', unit: 'seconds', why: 'class 0x3' },
  { name: 'COMP_ATTACK', unit: 'ms', why: 'class 0x4' },
  { name: 'CHORUS_MIX', unit: 'percent', why: 'class 0x5' },
  { name: 'CHORUS_LFOPHASE', unit: 'degrees', why: 'class 0x6' },
  { name: 'PITCH_DETUNE1', unit: 'cents', why: 'class 0x7' },
  { name: 'DISTORT_BRIGHTCAP', unit: 'pf', why: 'class 0x8' },
];

/** Params the derivation must NOT touch, and why. */
const UNTOUCHED: { name: string; unit: Unit; why: string }[] = [
  { name: 'CONTROLLERS_TEMPO', unit: 'numeric', why: 'class 0xb is unmapped — BPM is a guess' },
  { name: 'CABINET_MICSPACE', unit: 'numeric', why: 'class 0xa is unmapped' },
  { name: 'CABINET_ROOMSIZE', unit: 'numeric', why: 'class 0xc is unmapped' },
  { name: 'DISTORT_TREMFREQ', unit: 'db', why: 'human-assigned unit wins over its class (known overlay error)' },
];

const cases: (() => void)[] = [];

for (const dev of DEVICES) {
  const byName = new Map(dev.params.map((p) => [p.name, p]));

  for (const { name, unit, why } of [...EXPECTED, ...UNTOUCHED]) {
    cases.push(() => {
      const p = byName.get(name);
      // Not every family exists on every device; absence is not a failure, a wrong unit is.
      if (!p) return;
      assert(p.unit === unit, `${dev.label}: ${name} expected unit '${unit}' (${why}), got '${p.unit}'`);
    });
  }

  // 'cents' is introduced by the derivation — nothing else in the pipeline emits it.
  cases.push(() => {
    const cents = dev.params.filter((p) => p.unit === 'cents');
    assert(cents.length > 0, `${dev.label}: no param carries 'cents' — did the class 0x7 mapping drop out?`);
    assert(
      cents.every((p) => /DETUNE|OFFSET/.test(p.name)),
      `${dev.label}: 'cents' leaked outside detune/offset params: ` +
        cents.filter((p) => !/DETUNE|OFFSET/.test(p.name)).map((p) => p.name).join(', '),
    );
  });

  // The point of the exercise: most knobs must no longer be bare numbers.
  cases.push(() => {
    const unitful = dev.params.filter((p) => ['db', 'hz', 'ms', 'seconds', 'percent', 'degrees', 'cents', 'pf'].includes(p.unit ?? ''));
    assert(
      unitful.length > 500,
      `${dev.label}: only ${unitful.length} params carry a display unit — expected 500+ after derivation`,
    );
  });
}

export const DERIVED_UNITS_CASE_COUNT = cases.length;

export function runDerivedUnitsTests(): void {
  for (const c of cases) c();
}
