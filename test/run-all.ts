// fractal-midi test runner.
//
// tsx-runnable goldens, each printing PASS / FAIL and exiting non-zero
// on failure.

import { VERSION } from '../src/index.js';
import { runPackValueTests, runChecksumTests } from './shared/packvalue.test.js';
import { runLineageTests } from './shared/lineage.test.js';
import { runEffectIdTests, EFFECTID_CASE_COUNT } from './shared/effectid.test.js';
import { runIdentifyTests, IDENTIFY_CASE_COUNT } from './shared/identify.test.js';
import { runFirmwareTests, FIRMWARE_CASE_COUNT } from './shared/firmware.test.js';
import { runAm4SetParamTests, AM4_GOLDEN_CASE_COUNT } from './am4/setparam.test.js';
import { runAm4BlockLayoutTests, AM4_BLOCK_LAYOUT_CASE_COUNT } from './am4/blocklayout.test.js';
import { runAm4DecodeTests, AM4_DECODE_CASE_COUNT } from './am4/decode.test.js';
import {
  runAm4PresetBinaryTests,
  AM4_PRESET_BINARY_CASE_COUNT,
} from './am4/presetbinary.test.js';
import {
  runAm4PresetDumpTests,
  AM4_PRESET_DUMP_CASE_COUNT,
} from './am4/presetdump.test.js';
import {
  runAm4ModifierTests,
  AM4_MODIFIER_CASE_COUNT,
} from './am4/modifiers.test.js';
import {
  runAm4FirmwareTests,
  AM4_FIRMWARE_CASE_COUNT,
} from './am4/firmware.test.js';
import { runAm4DescribeTests, AM4_DESCRIBE_CASE_COUNT } from './am4/describe.test.js';
import { runAm4LivePollTests, AM4_LIVE_POLL_CASE_COUNT } from './am4/livepolls.test.js';
import { runAm4PollDecodeTests, AM4_POLL_DECODE_CASE_COUNT } from './am4/polldecode.test.js';
import { runAm4LiveDecodeTests, AM4_LIVE_DECODE_CASE_COUNT } from './am4/livedecode.test.js';
import { runAm4MidiRegisterTests, AM4_MIDI_REGISTERS_CASE_COUNT } from './am4/midiregisters.test.js';
import { runAm4TunerTests, AM4_TUNER_CASE_COUNT } from './am4/tuner.test.js';
import { runAm4ChannelTests, AM4_CHANNEL_CASE_COUNT } from './am4/channel.test.js';
import { runAm4PresetContainerTests, AM4_PRESET_CONTAINER_CASE_COUNT } from './am4/presetcontainer.test.js';
import { runAxeFxIISetParamTests, AXEFX2_GOLDEN_CASE_COUNT } from './gen2/axe-fx-ii/setparam.test.js';
import { runAxeFxIIRoutingTests, AXEFX2_ROUTING_CASE_COUNT } from './gen2/axe-fx-ii/routing.test.js';
import { runAxeFxGen1SetParamTests, AXEFXGEN1_GOLDEN_CASE_COUNT } from './gen1/setparam.test.js';
import { runAxeFxGen1ReadParamTests, AXEFXGEN1_READ_CASE_COUNT } from './gen1/readparam.test.js';
import { runAxeFxGen1PatchDumpTests, GEN1_PATCHDUMP_CASE_COUNT } from './gen1/patchdump.test.js';
import { runAxeFxIIAnnotationCoverageTests, AXEFX2_ANNOTATION_CASE_COUNT } from './gen2/axe-fx-ii/annotation-coverage.test.js';
import { runAxeFxIIISetParamTests, AXEFX3_GOLDEN_CASE_COUNT } from './gen3/axe-fx-iii/setparam.test.js';
import { runGen3BulkWriteTests, GEN3_BULK_WRITE_CASE_COUNT } from './gen3/axe-fx-iii/bulkwrite.test.js';
import { runAxeFxIIICalibrationTest } from './gen3/axe-fx-iii/calibration.test.js';
import { runGen3RoutingTests, GEN3_ROUTING_CASE_COUNT } from './gen3/axe-fx-iii/routing.test.js';
import { runGen3SubactionTests, GEN3_SUBACTION_CASE_COUNT } from './gen3/axe-fx-iii/subactions.test.js';
import { runGen3GridLayoutTests, GEN3_GRIDLAYOUT_CASE_COUNT } from './gen3/axe-fx-iii/gridlayout.test.js';
import { runModernFamilyTests, MODERN_FAMILY_CASE_COUNT } from './gen3/modern-family/catalog.test.js';
import { runBoundCodecTests, BOUNDCODEC_CASE_COUNT } from './gen3/modern-family/boundcodec.test.js';
import { runFm3MetersTests, FM3_METERS_CASE_COUNT } from './gen3/fm3/meters.test.js';
import { runFm3CabIrTests, FM3_CAB_IR_CASE_COUNT } from './gen3/fm3/cab-irs.test.js';
import { runFm3BlockParamsTests, FM3_BLOCKPARAMS_CASE_COUNT } from './gen3/fm3/blockparams.test.js';
import { runFm3BlockFileTests, FM3_BLOCKFILE_CASE_COUNT } from './gen3/fm3/blockfile.test.js';
import { runBlockFileWriteTests, BLOCKFILE_WRITE_CASE_COUNT } from './gen3/fm3/blockfile-write.test.js';
import { runPresetAuthorIrTests, PRESET_AUTHOR_IR_CASE_COUNT } from './gen3/fm3/preset-author-ir.test.js';
import { runPresetSynthIrTests, PRESET_SYNTH_IR_CASE_COUNT } from './gen3/fm3/preset-synth-ir.test.js';
import { runDefaultRawRoundTripTests, DEFAULT_RAW_ROUNDTRIP_CASE_COUNT } from './gen3/default-raw-roundtrip.test.js';
import { runPresetSynthCatalogTests, PRESET_SYNTH_CATALOG_CASE_COUNT } from './gen3/fm3/preset-synth-catalog.test.js';
import { runGen3SynthNonFm3Tests, GEN3_SYNTH_NONFM3_CASE_COUNT } from './gen3/gen3-synth-nonfm3.test.js';
import { runRoutingRoundTripTests, ROUTING_ROUNDTRIP_CASE_COUNT } from './gen3/fm3/routing-roundtrip.test.js';
import { runConvertGridEidTests, CONVERT_GRID_EID_CASE_COUNT } from './convert/grid-eid.test.js';
import { runCrossBlockParamsTests, CROSS_BLOCKPARAMS_CASE_COUNT } from './gen3/modern-family/blockparams-cross.test.js';
import { runCrossBlockFileTests, CROSS_BLOCKFILE_CASE_COUNT } from './gen3/modern-family/blockfile-cross.test.js';
import { runFm3TelemetryTests, FM3_TELEMETRY_CASE_COUNT } from './gen3/fm3/telemetry.test.js';
import { runGen3RosterTests, FM3_ROSTER_CASE_COUNT } from './gen3/fm3/roster.test.js';
import { runPresetValidateTests, PRESET_VALIDATE_CASE_COUNT } from './gen3/preset-validate.test.js';
import { runFm9MetersTests, FM9_METERS_CASE_COUNT } from './gen3/fm9/meters.test.js';
import { runFm9FootControllerTests, FM9_FOOTCONTROLLER_CASE_COUNT } from './gen3/fm9/footcontroller.test.js';
import { runFm9ModifierTests, FM9_MODIFIER_CASE_COUNT } from './gen3/fm9/modifiers.test.js';
import { runAxe3MetersTests, AXE3_METERS_CASE_COUNT } from './gen3/axe-fx-iii/meters.test.js';
import { runAxe3FootControllerTests, AXE3_FC_CASE_COUNT } from './gen3/axe-fx-iii/footcontroller.test.js';
import { runAxe3ModifierTests, AXE3_MOD_CASE_COUNT } from './gen3/axe-fx-iii/modifiers.test.js';
import { runVp4SetParamTests, VP4_SETPARAM_CASE_COUNT } from './gen3/vp4/setparam.test.js';
import { runVp4StructureBlobTests, VP4_STRUCTUREBLOB_CASE_COUNT } from './gen3/vp4/structureblob.test.js';
import { runDiscreteOverlayTests, DISCRETE_OVERLAY_CASE_COUNT } from './gen3/discrete-overlay.test.js';
import { runGen3TypeNameTests, GEN3_TYPENAME_CASE_COUNT } from './gen3/axe-fx-iii/typename.test.js';
import { runAm4InternalFromDisplayTests, AM4_INTERNAL_FROM_DISPLAY_CASE_COUNT } from './am4/internalfromdisplay.test.js';
import { runAxeFxIIApplicabilityTests, AXEFX2_APPLICABILITY_CASE_COUNT } from './gen2/axe-fx-ii/applicability.test.js';
import { runSharedDisplayScaleTests, SHARED_DISPLAYSCALE_CASE_COUNT } from './shared/displayscale.test.js';
import { runDevicesSmokeTests, DEVICES_SMOKE_CASE_COUNT } from './devices-smoke.test.js';
import { runRecords, RECORDS_CASE_COUNT } from './cache/records.test.js';
import { runAssign, runAssignLive, ASSIGN_CASE_COUNT, ASSIGN_LIVE_CASE_COUNT } from './cache/assign.test.js';
import { runBuildProfile, BUILDPROFILE_CASE_COUNT } from './cache/buildprofile.test.js';
import { runAm4Cache, AM4_CACHE_CASE_COUNT } from './cache/am4-cache.test.js';
import { runLiveWalk, LIVEWALK_CASE_COUNT } from './cache/livewalk.test.js';
import { runFullWalk, FULLWALK_CASE_COUNT } from './cache/fullwalk.test.js';
import { runRigV2Replay, RIGV2REPLAY_CASE_COUNT } from './cache/rigv2replay.test.js';
import { runEditorLayoutsTests, EDITOR_LAYOUTS_CASE_COUNT } from './editorLayouts.test.js';
import { runEditorRendererTests, EDITOR_RENDERER_CASE_COUNT } from './editorLayouts.test.js';
import { runFamiliesTests, FAMILIES_CASE_COUNT } from './convert/families.test.js';
import { runGen3AdapterTests, GEN3_ADAPTER_CASE_COUNT } from './convert/gen3-adapter.test.js';
import { runShallowAdaptersTests, SHALLOW_ADAPTERS_CASE_COUNT } from './convert/adapters-shallow.test.js';
import { runConceptCoverageTests, CONCEPT_COVERAGE_CASE_COUNT } from './convert/concept-coverage.test.js';
import { runLineageIndexTests, LINEAGE_INDEX_CASE_COUNT } from './convert/lineage-index.test.js';
import { runEngineTests, ENGINE_CASE_COUNT } from './convert/engine.test.js';
import { runTargetRangesTests, TARGET_RANGES_CASE_COUNT } from './convert/target-ranges.test.js';

const tests: Array<{ name: string; run: () => void | Promise<void> }> = [
  {
    name: 'skeleton-smoke',
    run: () => {
      if (typeof VERSION !== 'string' || VERSION.length === 0) {
        throw new Error('VERSION export missing');
      }
    },
  },
  { name: 'shared/checksum', run: runChecksumTests },
  { name: 'shared/packvalue', run: runPackValueTests },
  { name: 'shared/lineage-load', run: runLineageTests },
  { name: `shared/effectid (${EFFECTID_CASE_COUNT} goldens)`, run: runEffectIdTests },
  { name: `shared/identify (${IDENTIFY_CASE_COUNT} goldens)`, run: runIdentifyTests },
  { name: `shared/firmware (${FIRMWARE_CASE_COUNT} cases)`, run: runFirmwareTests },
  { name: `am4/setparam (${AM4_GOLDEN_CASE_COUNT} goldens)`, run: runAm4SetParamTests },
  { name: `am4/blocklayout (${AM4_BLOCK_LAYOUT_CASE_COUNT} cases)`, run: runAm4BlockLayoutTests },
  { name: `am4/decode (${AM4_DECODE_CASE_COUNT} cases)`, run: runAm4DecodeTests },
  {
    name: `am4/presetBinary (${AM4_PRESET_BINARY_CASE_COUNT} cases)`,
    run: runAm4PresetBinaryTests,
  },
  {
    name: `am4/presetDump (${AM4_PRESET_DUMP_CASE_COUNT} cases)`,
    run: runAm4PresetDumpTests,
  },
  {
    name: `am4/modifiers (${AM4_MODIFIER_CASE_COUNT} cases)`,
    run: runAm4ModifierTests,
  },
  {
    name: `am4/firmware (${AM4_FIRMWARE_CASE_COUNT} cases)`,
    run: runAm4FirmwareTests,
  },
  { name: `am4/describe (${AM4_DESCRIBE_CASE_COUNT} capture labels)`, run: runAm4DescribeTests },
  { name: `am4/livePolls (${AM4_LIVE_POLL_CASE_COUNT} candidates)`, run: runAm4LivePollTests },
  { name: `am4/pollDecode (${AM4_POLL_DECODE_CASE_COUNT} real-frame cases)`, run: runAm4PollDecodeTests },
  { name: `am4/liveDecode (${AM4_LIVE_DECODE_CASE_COUNT} cases)`, run: runAm4LiveDecodeTests },
  { name: `am4/midiRegisters (${AM4_MIDI_REGISTERS_CASE_COUNT} cases)`, run: runAm4MidiRegisterTests },
  { name: `am4/tuner (${AM4_TUNER_CASE_COUNT} real-frame cases)`, run: runAm4TunerTests },
  { name: `am4/channel (${AM4_CHANNEL_CASE_COUNT} cases)`, run: runAm4ChannelTests },
  { name: `am4/presetcontainer (${AM4_PRESET_CONTAINER_CASE_COUNT} cases)`, run: runAm4PresetContainerTests },
  { name: `axe-fx-ii/setparam (${AXEFX2_GOLDEN_CASE_COUNT} goldens)`, run: runAxeFxIISetParamTests },
  { name: `axe-fx-ii/routing (${AXEFX2_ROUTING_CASE_COUNT} goldens)`, run: runAxeFxIIRoutingTests },
  { name: `axe-fx-gen1/setparam (${AXEFXGEN1_GOLDEN_CASE_COUNT} goldens)`, run: runAxeFxGen1SetParamTests },
  { name: `axe-fx-gen1/readparam (${AXEFXGEN1_READ_CASE_COUNT} goldens)`, run: runAxeFxGen1ReadParamTests },
  { name: `axe-fx-gen1/patchdump (${GEN1_PATCHDUMP_CASE_COUNT} goldens)`, run: runAxeFxGen1PatchDumpTests },
  { name: `axe-fx-ii/annotation-coverage (${AXEFX2_ANNOTATION_CASE_COUNT} goldens)`, run: runAxeFxIIAnnotationCoverageTests },
  { name: `axe-fx-iii/setparam (${AXEFX3_GOLDEN_CASE_COUNT} goldens)`, run: runAxeFxIIISetParamTests },
  { name: `axe-fx-iii/bulkwrite (${GEN3_BULK_WRITE_CASE_COUNT} goldens)`, run: runGen3BulkWriteTests },
  { name: 'axe-fx-iii/calibration', run: runAxeFxIIICalibrationTest },
  { name: `axe-fx-iii/routing (${GEN3_ROUTING_CASE_COUNT} goldens)`, run: runGen3RoutingTests },
  { name: `axe-fx-iii/subactions (${GEN3_SUBACTION_CASE_COUNT} goldens)`, run: runGen3SubactionTests },
  { name: `axe-fx-iii/gridlayout (${GEN3_GRIDLAYOUT_CASE_COUNT} goldens)`, run: runGen3GridLayoutTests },
  { name: `modern-family/catalog (${MODERN_FAMILY_CASE_COUNT} goldens)`, run: runModernFamilyTests },
  { name: `modern-family/boundcodec (${BOUNDCODEC_CASE_COUNT} model bytes, full surface)`, run: runBoundCodecTests },
  { name: `fm3/meters (${FM3_METERS_CASE_COUNT} cases)`, run: runFm3MetersTests },
  { name: `fm3/cab-irs (${FM3_CAB_IR_CASE_COUNT} cases)`, run: runFm3CabIrTests },
  { name: `fm3/blockparams (${FM3_BLOCKPARAMS_CASE_COUNT} live-FM3 preset goldens)`, run: runFm3BlockParamsTests },
  { name: `fm3/blockfile (${FM3_BLOCKFILE_CASE_COUNT} real .blk goldens)`, run: runFm3BlockFileTests },
  { name: `fm3/blockfile-write (${BLOCKFILE_WRITE_CASE_COUNT} round-trip + author goldens)`, run: runBlockFileWriteTests },
  { name: `fm3/preset-author-ir (${PRESET_AUTHOR_IR_CASE_COUNT} offline round-trip)`, run: runPresetAuthorIrTests },
  { name: `fm3/preset-synth-ir (${PRESET_SYNTH_IR_CASE_COUNT} full-body synthesis round-trip)`, run: runPresetSynthIrTests },
  { name: `fm3/preset-synth-catalog (${PRESET_SYNTH_CATALOG_CASE_COUNT} geometry families, catalog/defaults build)`, run: runPresetSynthCatalogTests },
  { name: `gen3-synth-nonfm3 (${GEN3_SYNTH_NONFM3_CASE_COUNT} devices: FM9 + Axe-Fx III full-body synthesis round-trip)`, run: runGen3SynthNonFm3Tests },
  { name: `fm3/routing-roundtrip (${ROUTING_ROUNDTRIP_CASE_COUNT} grid route-flag cases)`, run: runRoutingRoundTripTests },
  { name: `modern-family/blockparams-cross (${CROSS_BLOCKPARAMS_CASE_COUNT} cross-device preset goldens)`, run: runCrossBlockParamsTests },
  { name: `modern-family/blockfile-cross (${CROSS_BLOCKFILE_CASE_COUNT} .blk edge-case goldens)`, run: runCrossBlockFileTests },
  { name: `gen3/default-raw-roundtrip (${DEFAULT_RAW_ROUNDTRIP_CASE_COUNT} models: FM3/FM9/III)`, run: runDefaultRawRoundTripTests },
  { name: `fm3/telemetry (${FM3_TELEMETRY_CASE_COUNT} live-FM3 frame goldens)`, run: runFm3TelemetryTests },
  { name: `gen3/roster (${FM3_ROSTER_CASE_COUNT} projection goldens)`, run: runGen3RosterTests },
  { name: `gen3/preset-validate (${PRESET_VALIDATE_CASE_COUNT} cases)`, run: runPresetValidateTests },
  { name: `fm9/meters (${FM9_METERS_CASE_COUNT} cases)`, run: runFm9MetersTests },
  { name: `fm9/footcontroller (${FM9_FOOTCONTROLLER_CASE_COUNT} cases)`, run: runFm9FootControllerTests },
  { name: `fm9/modifiers (${FM9_MODIFIER_CASE_COUNT} cases)`, run: runFm9ModifierTests },
  { name: `axe-fx-iii/meters (${AXE3_METERS_CASE_COUNT} cases)`, run: runAxe3MetersTests },
  { name: `axe-fx-iii/footcontroller (${AXE3_FC_CASE_COUNT} cases)`, run: runAxe3FootControllerTests },
  { name: `axe-fx-iii/modifiers (${AXE3_MOD_CASE_COUNT} cases)`, run: runAxe3ModifierTests },
  { name: `vp4/setparam (${VP4_SETPARAM_CASE_COUNT} goldens)`, run: runVp4SetParamTests },
  { name: `vp4/structureblob (${VP4_STRUCTUREBLOB_CASE_COUNT} goldens)`, run: runVp4StructureBlobTests },
  { name: `gen3/discrete-overlay (${DISCRETE_OVERLAY_CASE_COUNT} cases)`, run: runDiscreteOverlayTests },
  { name: `gen3/typename (${GEN3_TYPENAME_CASE_COUNT} goldens)`, run: runGen3TypeNameTests },
  { name: `am4/internalFromDisplay (${AM4_INTERNAL_FROM_DISPLAY_CASE_COUNT} cases)`, run: runAm4InternalFromDisplayTests },
  { name: `axe-fx-ii/applicability (${AXEFX2_APPLICABILITY_CASE_COUNT} cases)`, run: runAxeFxIIApplicabilityTests },
  { name: `shared/displayScale (${SHARED_DISPLAYSCALE_CASE_COUNT} cases)`, run: runSharedDisplayScaleTests },
  { name: `devices/smoke (${DEVICES_SMOKE_CASE_COUNT} descriptors, from dist)`, run: runDevicesSmokeTests },
  { name: `cache/records (${RECORDS_CASE_COUNT} cases)`, run: runRecords },
  { name: `cache/assign (${ASSIGN_CASE_COUNT} oracle cases)`, run: runAssign },
  { name: `cache/assign-live (${ASSIGN_LIVE_CASE_COUNT} cases)`, run: runAssignLive },
  { name: `cache/buildprofile (${BUILDPROFILE_CASE_COUNT} cases)`, run: runBuildProfile },
  { name: `cache/am4 (${AM4_CACHE_CASE_COUNT} cases)`, run: runAm4Cache },
  { name: `cache/livewalk (${LIVEWALK_CASE_COUNT} cases)`, run: runLiveWalk },
  { name: `cache/fullwalk (${FULLWALK_CASE_COUNT} cases)`, run: runFullWalk },
  { name: `cache/rigv2replay (${RIGV2REPLAY_CASE_COUNT} device captures)`, run: runRigV2Replay },
  { name: `editorLayouts (${EDITOR_LAYOUTS_CASE_COUNT} devices)`, run: runEditorLayoutsTests },
  { name: `editorRenderer (${EDITOR_RENDERER_CASE_COUNT} devices)`, run: runEditorRendererTests },
  { name: `convert/families (${FAMILIES_CASE_COUNT} cases)`, run: runFamiliesTests },
  { name: `convert/gen3-adapter (${GEN3_ADAPTER_CASE_COUNT} preset goldens)`, run: runGen3AdapterTests },
  { name: `convert/adapters-shallow (${SHALLOW_ADAPTERS_CASE_COUNT} adapters)`, run: runShallowAdaptersTests },
  { name: `convert/concept-coverage (${CONCEPT_COVERAGE_CASE_COUNT} cases)`, run: runConceptCoverageTests },
  { name: `convert/lineage-index (${LINEAGE_INDEX_CASE_COUNT} cases)`, run: runLineageIndexTests },
  { name: `convert/engine (${ENGINE_CASE_COUNT} conversion cases)`, run: runEngineTests },
  { name: `convert/grid-eid (${CONVERT_GRID_EID_CASE_COUNT} cross-device fm3 eid-assignment)`, run: runConvertGridEidTests },
  { name: `convert/target-ranges (${TARGET_RANGES_CASE_COUNT} cases)`, run: runTargetRangesTests },
];

let failures = 0;

for (const { name, run } of tests) {
  try {
    await run();
    console.log(`PASS ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} test(s) passed.`);
