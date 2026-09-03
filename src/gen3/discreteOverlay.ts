// Shared discrete-ordinal overlay merge, used by every gen-3 device (FM3/FM9/
// Axe-Fx III). Each device ships its own SYMBOL -> maxOrdinal classification
// table (see e.g. `fm3/discreteOverlay.ts`), which today is applied only on
// the SET-encoding write path (`devices/gen3/factory.ts`). This helper lets
// the same table also correct the READ-side ranges table so a misclassified
// `kind:'float'` row (device stores an ordinal, not a continuous value) is
// exposed as `kind:'enum'` to API consumers — CLASSIFICATION ONLY, never
// touching displayMin/Max/scale/typecode/defaultRaw beyond what the ordinal
// bound requires.

/** Minimal shape shared by every device's generated per-param range row. */
export interface DiscreteOverlayRange {
  kind: 'enum' | 'float';
  displayMin: number;
  displayMax: number;
  enumCount?: number;
}

/** Minimal shape shared by every device's generated per-param catalog row. */
export interface DiscreteOverlayParam {
  paramId: number;
  name: string;
}

/**
 * Merge a `SYMBOL -> maxOrdinal` overlay into a generated ranges table.
 *
 * For each (family, paramId) whose catalog `name` (symbol) appears in the
 * overlay: if the range is currently `kind:'float'`, reclassify it
 * `kind:'enum'` with `displayMin:0`, `displayMax:maxOrdinal`,
 * `enumCount:maxOrdinal+1`. A row already `kind:'enum'` is left untouched
 * (the overlay's own join rule: never override an existing enum path), and a
 * symbol absent from the ranges table is a no-op. Rows the overlay doesn't
 * mention pass through unchanged (same object reference).
 */
export function applyDiscreteOverlay<R extends DiscreteOverlayRange>(
  ranges: Readonly<Record<string, Readonly<Record<number, R>>>>,
  paramsByFamily: Readonly<Record<string, readonly DiscreteOverlayParam[]>>,
  overlay: Readonly<Record<string, number>>
): Record<string, Record<number, R>> {
  const out: Record<string, Record<number, R>> = {};
  for (const [family, familyRanges] of Object.entries(ranges)) {
    const params = paramsByFamily[family];
    const maxOrdinalByParamId = new Map<number, number>();
    if (params) {
      for (const p of params) {
        const maxOrdinal = overlay[p.name];
        if (maxOrdinal != null) maxOrdinalByParamId.set(p.paramId, maxOrdinal);
      }
    }
    const outFamily: Record<number, R> = { ...familyRanges };
    for (const [paramId, maxOrdinal] of maxOrdinalByParamId) {
      const row = outFamily[paramId];
      if (!row || row.kind === 'enum') continue; // already discrete, or no row to correct
      outFamily[paramId] = { ...row, kind: 'enum', displayMin: 0, displayMax: maxOrdinal, enumCount: maxOrdinal + 1 };
    }
    out[family] = outFamily;
  }
  return out;
}
