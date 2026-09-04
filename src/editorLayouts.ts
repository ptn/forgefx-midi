/**
 * Editor-layout catalog v2 — shared, pure-TypeScript schema.
 *
 * Describes the block-editor UI layouts (pages/tabs → rows → controls) that
 * each Fractal desktop editor (Axe-Edit III / FM9-Edit / FM3-Edit / AM4-Edit)
 * uses to lay out an effect's parameters. Consumed by the per-device
 * `*.generated.ts` layout data files (`<DEV>_LAYOUTS`).
 *
 * This module is DATA-SHAPE ONLY: pure types plus one widget-normalisation
 * table. No runtime dependencies, browser-safe (no `node:*` imports).
 *
 * Provenance of the data files: each editor embeds a JUCE "config" XML
 * (`__block_layout.xml`, `__amp_layout*.xml`) whose document order is the
 * on-screen order (controls left→right per row, rows top→bottom, pages in
 * tab order). The generator (`scripts/gen-editor-layouts.ts`) parses those
 * and joins every control's editor symbol (`parameterName`) against the
 * device's own parameter catalog to resolve a wire `paramId`.
 */

/**
 * Normalised widget kind. The editor XML uses ~90 fine-grained `type` values
 * (`knobCompact`, `dropdown1p5Tight`, `btnIgnoreScene`, …); each maps onto one
 * of these coarse kinds for rendering decisions, while the exact original
 * string is preserved on `EditorLayoutControl.rawWidget`.
 */
export type EditorWidgetKind =
  | 'knob'
  | 'toggle'
  | 'slider'
  | 'dropdown'
  | 'graph'
  | 'spacer'
  | 'button'
  | 'meter'
  | 'label'
  | 'readout'
  | 'unknown';

/** Optional firmware gate (inclusive lower / exclusive upper), as `"maj,min"`. */
export interface EditorFwRange {
  /** Applies for firmware >= this version (editor `version_gtet`). */
  gtet?: string;
  /** Applies for firmware < this version (editor `version_lt`). */
  lt?: string;
}

/** Fine placement hints the editor specifies for a control. */
export interface EditorControlPlacement {
  /** Zero-based layout column within its row, when specified. */
  col?: number;
  /** Horizontal pixel nudge from the grid slot. */
  offsetX?: number;
  /** Vertical pixel nudge from the grid slot. */
  offsetY?: number;
  /** Absolute `"x,y"` pixel position (overrides the grid) when specified. */
  positionExact?: string;
}

/**
 * A control whose owning effect differs from the page it renders on — e.g. the
 * global metronome shown on a block's Tempo page, or a modifier/foot-controller
 * reference. `effect` is the editor's cross-reference token (e.g. `ID_GLOBAL`).
 */
export interface EditorCrossBlockRef {
  /** Editor cross-effect token, e.g. `'ID_GLOBAL'`, `'ID_MODIFIER1'`. */
  effect: string;
  /** Resolved catalog family of the referenced parameter, or null. */
  family: string | null;
  /** The referenced parameter's editor symbol. */
  paramName: string | null;
  /** Resolved wire paramId of the referenced parameter, or null. */
  paramId: number | null;
}

/**
 * Typed, renderer-relevant per-control metadata from the layout XML — the fields
 * the editor authors on a control beyond its position and binding. Preserved
 * verbatim (typed) so the renderer never has to re-derive them, and so the
 * sweep test can assert none are silently dropped. Named for what they mean,
 * not for the private XML spelling.
 */
export interface EditorControlRenderMeta {
  /** Section-heading span: `sectionLabel_col_count` / `sectionLabel_pixel_count`. */
  sectionSpan?: { cols?: number; pixels?: number };
  /** `min_dB` — meter floor in dB. */
  minDb?: number;
  /** `max_dB` — meter ceiling in dB. */
  maxDb?: number;
  /** `seperator_height` — vertical-rule (`labelSeperator`) height. */
  separatorHeight?: number;
  /** `controllingParamName` + `controllingParamValue` — visibility/alternate gate:
   *  this control renders when the named param's value is in the comma-joined list. */
  controllingParamName?: string;
  controllingParamValue?: string;
  /** `secondaryParameterName` — a second param this control also reads/writes. */
  secondaryParameterName?: string;
  /** `parameterOffset` — index offset into a repeated parameter group. */
  parameterOffset?: number;
  /** `lock` — the param whose value locks this control. */
  lock?: string;
  /** `graphIndex` — comma-joined graph band/ordinal list. */
  graphIndex?: string;
  /** `graphOScope` — the graph is an oscilloscope. */
  graphOScope?: boolean;
  /** `graphMarkerX` — the param that positions a graph marker on the X axis. */
  graphMarkerX?: string;
  /** `dynamicParamInfo` / `dynamicParamId` — dynamic-parameter flags. */
  dynamicParamInfo?: boolean;
  dynamicParamId?: boolean;
  /** `knobDirection` — `'bipolar'` | `'reverse'`. */
  knobDirection?: string;
  /** `disabledText` — the caption shown while disabled (e.g. `'--'`). */
  disabledText?: string;
  /** `ctrl_label_color` — control label colour. */
  ctrlLabelColor?: string;
  /** `markerColor` / `useMarker` — graph marker styling. */
  markerColor?: string;
  useMarker?: boolean;
  /** `message` — the device message this control triggers (e.g. `'MESSAGE_EXECUTE'`). */
  message?: string;
}

/** One control on an editor page. */
export interface EditorLayoutControl {
  /** Editor caption (HTML entities decoded; may contain `\n`). '' if none. */
  label: string;
  /** Editor parameter symbol, or null for decorative controls (spacer/label/graph). */
  paramName: string | null;
  /** Resolved wire paramId (join vs the device catalog by name), or null. */
  paramId: number | null;
  /** Normalised widget kind. */
  widget: EditorWidgetKind;
  /** Original editor `type` string (e.g. `'knobCompact'`), preserved verbatim. */
  rawWidget: string;
  /** Fine placement hints, when any are present. */
  placement?: EditorControlPlacement;
  /** Cross-block reference, when this control belongs to another effect. */
  crossBlock?: EditorCrossBlockRef;
  /** Per-control firmware gate, when present. */
  fw?: EditorFwRange;
  /** Typed per-control rendering metadata (section span, meter dB range, gates, …). */
  render?: EditorControlRenderMeta;
  /** Server-resolved outer widget bounds (from the renderer profile's `widgetBounds`).
   *  NOT present in the raw generated data — the server resolves `rawWidget` and
   *  attaches it so the renderer sizes every control from device metadata. */
  bounds?: EditorWidgetBounds;
}

/** One row of controls (editor order). */
export interface EditorLayoutRow {
  /** Which page section the row belongs to. */
  section: 'parameters' | 'mixer';
  /** Controls in this row, left→right editor order. */
  controls: EditorLayoutControl[];
}

/** One editor page (tab) of a block variant. */
export interface EditorLayoutPage {
  /** Page/tab name as shown in the editor (e.g. 'Basic', 'Authentic'). */
  name: string;
  /** Editor page number, when specified. */
  pageNum?: number;
  /** Rows in editor (top→bottom) order. */
  rows: EditorLayoutRow[];
  /** Firmware gate for the whole page, when present. */
  fw?: EditorFwRange;
  /** The `PageLayout` name this page is drawn on (e.g. `'LAYOUT_MIXER2'`). The
   *  server resolves it to an `EditorPageLayout` geometry when serving. */
  layout?: string;
  /** Server-resolved page geometry (the `EditorPageLayout` this page's `layout`
   *  names). NOT present in the raw generated data — the server resolves and
   *  attaches it so the renderer never reproduces PageLayout constants. */
  geometry?: EditorPageLayout;
  /**
   * Block-type / amp-model selector value(s) that activate this page, as the
   * editor's comma-joined list (e.g. amp pages keyed by `DISTORT_TYPE`). Only
   * set where the editor gates a page by a selector value.
   */
  value?: string;
  /** The selector parameter whose `value` gates this page, when present. */
  selectorParamName?: string;
}

/**
 * One block-type variant of a block's layout. The `value` is the block-type
 * selector value(s) that select this variant (comma-joined as in the editor
 * XML), or null when the block has a single unconditional layout.
 */
export interface EditorLayoutVariant {
  /** Editor variant display name (e.g. 'Analog', '10 Band', 'Amp GTE 6.00'). */
  name: string;
  /** Block-type selector value(s) selecting this variant, or null. */
  value: string | null;
  /** Firmware gate for the whole variant, when present. */
  fw?: EditorFwRange;
  /**
   * True for the variant pinned to the device's current firmware ceiling.
   * Used for firmware-versioned layouts (the Amp block): every historical
   * variant is kept, exactly one is flagged as the shipped/current one.
   */
  pinned?: boolean;
  /** Pages (tabs) in editor display order. */
  pages: EditorLayoutPage[];
}

/** A block's full editor layout: its block-type variants. */
export interface EditorBlockLayout {
  /** Editor display name of the block (e.g. 'Reverb', 'Amp', 'Foot Controller'). */
  editorName: string;
  /** Catalog family symbol — the key into `<DEV>_LAYOUTS` and the param catalog. */
  family: string;
  /** Block-type variants in editor order. */
  variants: EditorLayoutVariant[];
}

/** A device's editor layouts, keyed by catalog family symbol. */
export type DeviceEditorLayouts = Readonly<Record<string, EditorBlockLayout>>;

/**
 * One `PageLayout` entry from an editor's `__components.xml` — the geometry the
 * device-authored page is laid out on. Pages reference one by name
 * (`EditorLayoutPage.layout`); the renderer resolves that name to these values
 * and uses them for the parameter/mixer baselines, per-section horizontal
 * pitch, and the Bypass / Scene Ignore / Kill Dry button anchors.
 */
export interface EditorPageLayout {
  /** The `name` attribute (e.g. `'LAYOUT_MIXER2'`). */
  name: string;
  /** X origin of the parameters section. */
  parametersX?: number;
  /** Y origin of the parameters section (first parameters row). */
  parametersY?: number;
  /** Horizontal pitch between parameter columns. */
  parametersSpacingX?: number;
  /** Vertical pitch between parameter rows. */
  parametersSpacingY?: number;
  /** X origin of the mixer section. */
  mixerX?: number;
  /** Y origin of the mixer section (first mixer row). */
  mixerY?: number;
  /** Horizontal pitch between mixer columns. */
  mixerSpacingX?: number;
  /** Vertical pitch between mixer rows. */
  mixerSpacingY?: number;
  /** Absolute `"x,y"` anchor for the Bypass button, when supplied. */
  btnBypassPosition?: string;
  /** Absolute `"x,y"` anchor for the Scene Ignore button, when supplied. */
  btnIgnoreScenePosition?: string;
  /** Absolute `"x,y"` anchor for the Kill Dry button, when supplied. */
  btnKillDryPosition?: string;
}

/** Outer box of one editor widget, in device canvas pixels (`__components.xml`). */
export interface EditorWidgetBounds {
  w: number;
  h: number;
}

/**
 * A device's renderer profile: the `__components.xml`-derived geometry that is
 * shared across every page of the device's layouts. Emitted per device by the
 * generator as a sibling of the layout data; the server resolves each page's
 * `layout` name and each control's `rawWidget` against it when serving.
 */
export interface EditorRendererProfile {
  /** PageLayout entries by name. */
  pageLayouts: Readonly<Record<string, EditorPageLayout>>;
  /** Widget outer bounds by editor `type` (rawWidget) token. */
  widgetBounds: Readonly<Record<string, EditorWidgetBounds>>;
}

/**
 * Map an editor `type` string to a coarse {@link EditorWidgetKind}. Prefix
 * based so firmware-specific variants (`knobCompact`, `dropdown1p5Tight`,
 * `btnIgnoreScene`, `meterGainVert`, …) collapse onto their base kind.
 */
export function normalizeWidget(rawType: string | null | undefined): EditorWidgetKind {
  const t = (rawType ?? '').toLowerCase();
  if (!t) return 'unknown';
  if (t.startsWith('knob')) return 'knob';
  if (t.startsWith('toggle')) return 'toggle';
  if (t.startsWith('slider')) return 'slider';
  if (t.startsWith('dropdown')) return 'dropdown';
  if (t.startsWith('graph')) return 'graph';
  if (t === 'spacer' || t.startsWith('spacer') || t.startsWith('seperator') || t.startsWith('separator')) return 'spacer';
  if (t.startsWith('btn') || t === 'button') return 'button';
  if (t.startsWith('meter')) return 'meter';
  if (t.startsWith('readout')) return 'readout';
  if (t.includes('label')) return 'label';
  return 'unknown';
}

/** All widget kinds, for validation. */
export const EDITOR_WIDGET_KINDS: readonly EditorWidgetKind[] = [
  'knob', 'toggle', 'slider', 'dropdown', 'graph', 'spacer',
  'button', 'meter', 'label', 'readout', 'unknown',
];
