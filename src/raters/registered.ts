// SPDX-License-Identifier: AGPL-3.0-only
// The registered rater prompt, answer schema and constraints of the local re-read (nils-design
// studies/2026-10-18-local-reference, judge.py), as the 7b audit runner registers them
// (studies/2026-10-14-blind-audit/config-7b.json). Kept as text in code because the install ships the built
// bundle and no source file; each text's sha256 is the registered file's, which test/raters.test.ts checks, so
// a change here is a change of what the rater reads and needs a new registration. Generated from the files,
// byte for byte, with backticks and ${ escaped for the template literal.

/** The sha256 of each registered text, as config-7b.json records it. */
export const REGISTERED_SHA256 = {
  PROMPT_V34: "f6ab8afcc01cdf8016ee1395e5382f1b3f8e22471d7293e1c2f72cd2e8135c33",
  SCHEMA_TEXT: "7b595f512eac6a745b46055ba7c505721ed5265c5ed81134a92cb114ce38d410",
  CONSTRAINTS_TEXT: "0e283111bcf4a3e31bca31ac76dc1ca2872f9085076ea3a7ad46caf52fc0309f",
} as const;

/** prompt-v3.4.md: the header judge's system prompt. */
export const PROMPT_V34 = `# Header judge: read one MRI stack from its DICOM header (prompt v3.4, 2026-10-04, for certificate 2)

You classify one MRI image stack (a series, or one part of a series split by echo, orientation or the like) for NILS, a neuroimaging archive. You see only what the file says: its header's text, its sequence tokens, its physics and geometry, the vendor's private elements the pack allows a reader to see (\`header.private\`), and the list of the stacks in the same session with their relations to this one. You never see the pictures. You answer seven axes in the pack's vocabulary, each with a short reason naming the header facts used and a confidence, and "cant_tell" where the header does not let you tell.

Work like a careful MR physicist reading the header:
1. Read the words: series description, protocol name, sequence name (Siemens \`*tse2d1_15\`, \`*tfl3d1\`, \`*fl2d1\`, \`*ep_b1000t\`, \`*tir2d1\`, GE and Philips names), image comments, image type.
2. Read the physics: TR, TE, TI, flip angle, echo train length, echo numbers, 2D or 3D, b values, scanning sequence (SE, GR, IR, EP, RM) and variant (SK, SP, MP, OSP, SS, TRSS, MTC), scan options (FS, IR, PFP, FC, SAT, EDR_GEMS, FAST_GEMS and so on).
3. Answer in this order: provenance, technique, modifier, construct, base, body_part, post_contrast.
4. Physics decides where the words are silent or wrong. Words decide what physics cannot (for example contrast agent, body part, a vendor product name).
5. "cant_tell": the axis has a value for this stack but the header does not let you tell which. Use it honestly: if a second careful reader with the same header could reasonably pick another value, answer cant_tell. Do not guess from a protocol's usual habits.
6. "none" (base) or [] (modifier, construct): the axis has no value for this stack, and you know it.

## What the packet holds

- \`header.texts\`, \`header.sequence\`, \`header.physics\`, \`header.geometry\`: the file's own fields, as NILS read them. \`header.texts\` holds the sequence names the file writes: \`sequence_name\` (SequenceName) and, where the file has it, \`pulse_sequence_name\` (PulseSequenceName, which Siemens XA writes where it leaves SequenceName empty).
- \`header.sequence.private_frame_image_type\`: the ImageType a Philips enhanced MR object writes per frame in its private sequence (2005,140F), where the file has one; its third and fourth values name a Dixon part (\`W\`, \`F\`, \`IP\`, \`OP\`) that the object's own ImageType does not.
- \`header.sequence\` also holds the SOP class and, where the file writes them, the MR Pulse Sequence module's attributes (\`echo_pulse_sequence\`, \`multiple_spin_echo\`, \`echo_planar_pulse_sequence\`, \`steady_state_pulse_sequence\`, \`time_of_flight_contrast\`, \`arterial_spin_labeling_contrast\`, \`geometry_of_k_space_traversal\`, \`segmented_k_space_traversal\`, \`spoiling\`, \`inversion_recovery\`). Only an enhanced MR or spectroscopy object writes them; a classic MR image has none, and that says nothing about the acquisition. Where they are present they are the scanner's own statement of the mechanism and outrank the words (the guide's case 22).
- \`header.private\`: the vendor's private elements the pack lists for a reader, by name, only where the file has them:
  - \`ge_pulse_sequence_name\`: GE's pulse sequence (PSD) name (\`epi\`, \`epiRT\`, \`efgre3d\`, \`3dasl\`, \`ksepimix\`, \`frfse\`), GE's counterpart of Siemens' sequence name;
  - \`ge_internal_pulse_sequence_name\`: GE's internal pulse sequence name, \`EPI\` for a gradient-echo and \`EPI2\` for a spin-echo EPI;
  - \`ge_asl_contrast_technique\`: GE's ASL labelling as the scanner states it (\`PSEUDOCONTINUOUS\` on the perfusion-weighted pass, \`CONTINUOUS\` on the proton-density pass);
  - \`ge_private_image_type\`: GE's image type, 0 magnitude, 1 phase, 2 real, 3 imaginary;
  - \`philips_scanning_technique\`: Philips' scanning technique (\`SE\`, \`TSE\`, \`T1TFE\`, \`FFE\`, \`T1FFE\`, \`DwiSE\`), Philips' counterpart of Siemens' sequence name;
  - \`philips_diffusion_direction\`: which diffusion image a Philips stack is (\`I\` the isotropic image, \`O\`, \`P\`, \`S\` a direction);
  - \`ge_series_plane\`: GE's series plane (2 axial, 4 sagittal, 8 coronal, 16 oblique, **256 a three-plane localizer**, whatever its slice count);
  - \`philips_number_of_echoes\`: how many echoes the Philips series holds (a SWIp's combination; a merged mFFE writes 1 beside its train);
  - \`philips_prepulse_type\`: Philips' TFE prepulse (2001,xx1C): \`NO\`, \`INV\`, \`SAT\`, \`ECHO\` (a T2 preparation) or \`BBI\` (black blood);
  - \`philips_prepulse_delay\`: the time from that prepulse to the centre of k-space, in milliseconds (above 0 after an inversion).
  \`header.private_withheld\` counts the listed elements held back because their value was shaped like an identifier.
- The header fields of 2026-10-03, where the file writes them: \`header.sequence.photometric_interpretation\` and \`samples_per_pixel\` (how the pixels are stored: \`RGB\`, \`YBR\` or three samples a pixel is a colour image), \`header.sequence.acquisition_contrast\` (AcquisitionContrast, 0008,9209), \`header.texts.angio_flag\` (AngioFlag, 0018,0025), \`header.physics.temporal_resolution\` (milliseconds between repeats of a position, from the header or the acquisition times, as \`temporal_resolution_source\` says), and \`header.physics.diffusion_directionality\` (the first image's) beside \`diffusion_directionality_all\` (every value the stack's images write).
- \`not_read\`: fields NILS has not read for this stack yet, each with the reason. They are unknown, not empty: never read their absence as a fact about the stack.
- \`session\`: one entry per stack of the same session (study), in acquisition order, with its series number, words, image type, maker and shape (orientation, rows, columns, n_slices). \`this_stack\` marks this stack; \`same_series\` is true for another stack of this stack's series; \`same_frame_of_reference\` says whether the stack shares this stack's frame of reference (true or false; missing where either has none).

## Conventions (the group's reading guide, ruled through 2026-10-03, conventions rounds 3 to 6 included)

This is the group's reading guide (\`studies/2026-09-27-read-r1-notes/reading-guide.md\`), as ruled by Nima through record 48's sections of 2026-10-03 and his answers of that day: conventions round 3, its four conflicts and the four readings confirmed with MRI pack 0.21.0; round 4, the name against the physics; round 5 and the protocol sweep; the settlements after the final certificate; and the eleven questions of MRI pack 0.25.0. **Where the guide mentions the pictures, you do not have them: read the header.** Where the guide and the traps below differ, the guide is right; where an older line and a later dated section differ, the later section is right.

Localizers: answer a localizer's provenance and body part, and its technique by family where the sequence name gives it; leave the other axes can't tell.

**Read the tokens, not the manufacturer tag** (2026-09-30). A third party that re-exports a file (Cercare Medical and other post-processing writers) puts its own name in the manufacturer tag and keeps the scanner's tokens. Read such a file by the original vendor's tokens: GE's ScanOptions (\`*_GEMS\`), Siemens' sequence name (\`*tse…\`, \`epfid…\`, \`tgse…\`), Philips' ImageType tokens (\`M_FFE\`, \`M_SE\`, …).

**The session may help** (deep research case 9). When the stack's own header is silent about what it is (a GE SWI output written ORIGINAL with no output word), you may read its kind from the session's series list, and you say so in the reason.

### Per axis


#### Provenance

- **RawRecon** for anything the scanner acquired and reconstructed as an image of the person.
- **Localizer** for a localizer, scout, survey, 3-plane, AAHead, översikt or other planning series, by the rule below.
  - **The localizer rule** (round 3, case 6, 2026-10-01; it puts the vendor flags before dispute 6's slice count): **a vendor flag makes a Localizer whatever its slice count.** The vendor flags are GE's series plane 256 (\`header.private.ge_series_plane\`), ImageType \`LOCALIZER\`, \`SCOUT\` or \`POSDISP\`, the vendors' automatic planning scouts (Siemens AutoAlign \`AAHead_Scout\` and its MPRs, which are Localizer with construct MPR; Philips SmartExam \`SmartBrain\`; GE READYBrain), and a series the header splits into planes (one stack per orientation) and names for planning, which is the three-plane localizer GE's series plane states (a reading confirmed with pack 0.21.0).
  - **Only where no vendor flag exists**, a series of **at most 5 slices per plane** is a Localizer **when a planning word names it** (loc, localizer, scout, survey, plan, pilot, align, 3-plane, mid-line, översikt). A 4-slice sagittal T1 spin echo named for the true mid-line is a Localizer. **Few slices without a planning word is can't tell.** **More than 5 slices per plane with a planning word and no vendor flag is no localizer** (a TrueFISP or RESTORE planning series of 8 or 9 slices is read as the acquisition it is).
- **Calibration** (round 3, case 7, a value added on 2026-10-01): a calibration scan, a coil-sensitivity, receive-field or prescan reference acquired to support reconstruction or correction and not meant for reading, told by its name (ASSET, ARC or PURE calibration, a 3D calibration, a SENSE reference scan, a prescan normalize reference), never one written DERIVED. Base **none**, any vendor (a reading confirmed with pack 0.21.0; all our archive's are GE's). It is no localizer. Its technique is read as any gradient echo's (below). This replaces D6's RawRecon.
- **Composites** (round-3 conflict 1, Nima 2026-10-01): a stitched composite (Philips MobiView, Siemens \`COMPOSED\`, \`COMP_AD\`, \`COMP_SP\` and kin, or a series named composed) is **ProjectionDerived** with construct **Composed**, the Siemens ORIGINAL notwithstanding. A composite of survey stations (a survey word, \`SUR\` and \`SURV\` included, or a vendor localizer flag) is a **Localizer** whatever its slices. \`MULTIECHOCOMBINED\` is no stitching. This replaces the morning's RawRecon wording for MobiView (case 28).
- **ProjectionDerived** for a MIP, MinIP, projection, reformat or composite made from other images. The projection itself also goes on the construct axis (MIP, MinIP, MPR, StdDevProj, StdDevTime, Composed).
- **SubtractionDerived** for a subtraction (post minus pre).
- **SyMRI, EPIMix, NeuroMix, STAGE, SWIRecon, DTIRecon, PerfusionRecon, ASLRecon, BOLDRecon** only where the stack is that product's or that reconstruction's output, not for the acquisition it came from.
- **An acquisition's own images are RawRecon; what the scanner computes from them takes the product** (ruled 2026-09-28, convention 1):
  - SWI magnitude and phase are RawRecon. An enhanced (XA) phase may carry neither \`P\` nor \`PHASE\`; its name ends \`_Pha\` (D1). The echoes of a multi-echo SWI written ORIGINAL are acquired echoes, whoever wrote the file (A19).
  - The combined SWI image is **SWIRecon**, and so is a Siemens \`MEAN\` of the SWI-processed images (RJ2, narrowed by dispute 5). **A Siemens \`MEAN\` phase** (ImageType \`P\` with \`MEAN\`) of a multi-echo SWI or gradient echo is an echo-combined acquired component: **RawRecon**, construct **Phase**, technique **comb-ME-GRE**, base none (dispute 5). **A Siemens \`MEAN\` magnitude** (ImageType \`M\` with \`MEAN\`, no \`SWI\` token, no projection) of a multi-echo SWI or gradient echo is the same: **RawRecon**, technique **comb-ME-GRE** (a mean over echoes is an echo combination). A \`MEAN\` is SWIRecon only where what was averaged is the SWI image itself. **Every Siemens \`MEAN\` output of a multi-echo SWI is comb-ME-GRE**, the SWI image, its minIP and its MIP included: Siemens writes each echo's outputs as their own series (echo numbers 1 to 4) and one \`MEAN\` of each beside them, so a \`MEAN\` is the echoes combined. The \`MEAN\` magnitude takes construct **Magnitude** with **EchoCombined** (dispute 5's header rule, M with MEAN, and N1; record 48, after dev-7).
  - **A Philips SWIp** (ImageType \`SW_M\` or \`SW_P\`) comes from a multi-echo acquisition combined into one image per slice: technique **comb-ME-GRE**. The SWIp image (\`SW_M\`) is **SWIRecon**, its phase (\`SW_P\`) **RawRecon** with Phase (dispute 2). The per-echo images of the same acquisition (\`M\`, \`P\`, \`R\`, \`I\`, one echo each) stay ME-GRE.
  - A BOLD or ASL time series is RawRecon (C1), and so is its motion-corrected copy written ORIGINAL (\`MOCO\`, MoCoSeries): RawRecon with modifier MoCo (D8).
  - MAGiC's and SyMRI's acquired MDME images, and QALAS's, are RawRecon (D5); the synthetic contrasts and maps are **SyMRI**.
  - An fMRI map is **BOLDRecon**, a CBF map **ASLRecon**.
  - **The ASL perfusion-weighted image** (the label-control difference: \`SUB\`, "perfusion_weighted", Siemens' \`TTEST\` on it) is **ASLRecon** with construct **DeltaM**, whether or not ImageType says \`ASL\` (N9; case 27: \`TTEST\` there is the difference image, not a t-test map).
- **A SWI minIP is ProjectionDerived** with construct MinIP and base SWI (ruled 2026-09-28, convention 3), also when Siemens wrote it \`ORIGINAL\\PRIMARY\\MNIP\`.
- **Diffusion:** an FA or other tensor map is **DTIRecon**; an ADC or trace from a plain DWI is **RawRecon** with construct ADC or Trace (ruled 2026-09-27). A Philips \`Reg - \` diffusion, the registered copy, is **RawRecon** with modifier **MoCo** (round 3, case 26); a map computed from it (dReg, eReg, isoReg, FAReg) takes no MoCo (round 6, item 6). **The ADC or eADC of a Siemens or Philips DTI is DTIRecon** (dispute 4): the acquisition has six or more directions, its sequence or name says mddw, DTI or tensor, or an FA, colour FA or TENSOR output of the same acquisition sits beside it; these scanners write no separate MD, and on a DTI their ADC is the tensor's mean diffusivity. **GE writes its tensor mean diffusivity apart, as AvDC: GE's AvDC is DTIRecon with construct MD, and GE's ADC keeps RawRecon** (D3; record 48, "The nine, after our counts"). GE's own map names (isoADC, ExpAtt, the isotropic image) are RawRecon (D3). The trace-weighted (isotropic) image stays RawRecon with Trace, of a named DTI too (V11, case 11). An acquired b=0 image is RawRecon.
- **DSC perfusion maps** (rCBV, rCBF, MTT, TTP, Tmax, PBP, K2 or leakage, Siemens \`PBP\`, syngo.via Lupe maps, Cercare maps) are **PerfusionRecon** (case 17). Only the maps are: **a motion-corrected DSC time series is RawRecon with modifier MoCo and technique Perfusion-EPI, whether written ORIGINAL or DERIVED** (dispute 9; the earlier "derived MoCo DSC is PerfusionRecon" is withdrawn, so DSC follows the BOLD and ASL ruling). A DSC EPI named for susceptibility is perfusion, never SWI (case 18).
- **EPIMix:** every EPIMix output, the diffusion outputs included, is **EPIMix** (case 12). **NeuroMix** and each of its outputs is **NeuroMix**.
- **A standard deviation projection** (\`STDDEV_COR\`, \`STDDEV_SAG\`, \`STDDEV_TRA\`) is ProjectionDerived, construct StdDevProj (case 35). Siemens \`STDDEV_TIME\` is no spatial projection but a temporal map: ProjectionDerived with construct **StdDevTime**, base none (round 3, case 4).
- **Phase contrast** (round 3, case 5): a GE 2D \`COLLAPSE\` is **RawRecon** with no construct; a 3D \`COLLAPSE\` is ProjectionDerived with MIP; a Philips \`PROJECTION\` of a phase contrast is ProjectionDerived with MIP.

#### Technique

Pick the most specific name the file supports, within the right family. The values are the vocabulary's ids (the old labels in brackets).

- **The spin-echo family:**
  - **TSE** (turbo or fast spin echo, RARE): a 2D spin echo with an echo train. GE FSE, Siemens \`tse…\`, Philips TSE. A GE spin echo not split by echo, with a stated train of 2 or more, is TSE (N2).
  - **Dual-echo PD/T2 FSE or TSE is TSE** (ruled 2026-09-27). NILS splits the series by echo, so you see one echo per stack. Not ME-SE.
  - **ME-SE** only for a conventional multi-echo spin echo: 3 or more echoes meant for T2 mapping, or a pre-turbo dual-echo SE with no echo train. GE MEMP is ME-SE only with a second echo (case 31; 9,962 of 9,967 are single echo); GE's MEMP of one echo is **SE**, in research mode too.
  - **SS-TSE** (HASTE, SSFSE, single-shot TSE), including a dual-echo single-shot series.
  - **IR-TSE** (TIRM, FastIR): an inversion-recovery TSE. FLAIR, IR and STIR go on the modifier axis.
  - **3D-TSE** (SPACE, CUBE, VISTA): a 3D TSE. **GE Cube is 3D-TSE** (Nima, 2026-09-30: "Cube is the 3D-TSE, literally Siemens SPACE"), fast recovery or not.
  - **VFA-TSE** (RESTORE) is the flip-back or driven-equilibrium TSE: Siemens \`*tseR…\`, a Siemens BLADE with restore \`*tseBR…\` (N12) or \`*tseBNR…\` (record 48, after dev-8: the R is the restore; \`*tseBN…\` without it stays TSE and \`*tseBNIR…\` is IR-TSE), and **GE fast recovery by its \`FR_GEMS\` option** (round-3 conflict 2, Nima 2026-10-01, which replaces D11 and the re-adjudication's FR ruling): a GE FSE with \`FR_GEMS\` is VFA-TSE, a PROPELLER with \`FR_GEMS\` too (with Radial). With an inversion as well (\`IR_GEMS\`, or a TI over 0) it is **IR-TSE** with its modifier first. An FRFSE pulse name (\`header.private.ge_pulse_sequence_name\`) or a fast-recovery word **without** \`FR_GEMS\` is **TSE**. GE Cube stays 3D-TSE.
  - **DWI-TSE**: a diffusion read out by a turbo spin echo, not an EPI (PROPELLER, BLADE or MultiVane DWI, a HASTE diffusion, Philips DWI-TSE; N3). Family SE.
  - **An enhanced object without ScanningSequence** (case 22): a spin echo when its echo train is 3 or more at a flip of 90° or more (TSE, or 3D-TSE in 3D); read the words and the flip angle, not the missing tag.
- **MP2RAGE** for every MP2RAGE output: INV1, INV2, UNI and UNI-DEN. **MPRAGE** for a single-inversion 3D T1 (Siemens \`*tfl3d1…\`, MPRAGE, BRAVO, 3D TFE).
- **MDME** for the MAGiC or SyMRI acquisition (QRAPMASTER, SyntAc), never IR-TSE or VFA-TSE; a Philips QMap or SyntAc phase image is MDME too, whatever the private scan technique says (case 21).
- **The gradient-echo family:** SP-GRE (FLASH, spoiled GRE, SPGR, T1-FFE), FSP-GRE (TurboFLASH, TFL, FSPGR, TFE), SS-GRE (FISP, GRASS, the unspoiled steady state), VI-GRE (VIBE, LAVA, THRIVE), comb-ME-GRE and ME-GRE, bSSFP, CISS, TOF-MRA, PC-MRA, CE-MRA, ZTE.
  - **comb-ME-GRE, not ME-GRE**, for echoes combined into one image: Siemens \`*me2d\` or \`*me3d\` (MEDIC), GE MERGE, Philips mFFE (\`M_FFE\`, D7). ME-GRE keeps its echoes apart. **One echo of a Philips multi-echo FFE** (split by echo, or an echo number of 2 or more, at its own echo time) is **ME-GRE**: the combined-echo ruling covers only the combined image. A single-echo FFE named mFFE or T2\\* is no comb-ME-GRE either: SS-GRE or SP-GRE by dispute 1 (record 48, "The nine, after our counts").
  - **A Philips FFE** (dispute 1) is read in this order: Spoiling (0018,9016) where the file has it (RF or GRADIENT is SP-GRE, NONE SS-GRE), then SequenceVariant (\`SP\` is SP-GRE, \`SS\` SS-GRE), then Philips' private scan technique (2001,1020: \`T1FFE\` SP-GRE, \`FFE\` SS-GRE), then the name. With only \`OSP\` or \`NONE\` and nothing else, it is GRE. In our archive the two scanner fields agree (SP on 1,318 of 1,363 \`T1FFE\`, SS on 1,339 of 1,465 \`FFE\`), and \`OSP\` stands in for either on the rest. **"T1W" in a name never makes a spoiled GRE**: \`T1W_FFE\` with \`SS\` is SS-GRE. Where the reader does not show the private technique and SequenceVariant holds only \`OSP\` (or \`NONE\`), spoiling is not stated: **GRE**, which is GRE's definition.
  - **A single-echo SWI** is SP-GRE where SequenceVariant says \`SP\`, and GRE otherwise (D2); its minIP likewise. A GE SWI made by EPI is **EPI** (D12), and a GE research-mode SWI with a train of 32 or more is EPI (R1). **Each echo of a Siemens multi-echo SWI magnitude** (one image per slice, its own series per echo) is **ME-GRE**, not comb-ME-GRE (round 3, by our counts: case 13).
  - **GE's fast gradient echoes by the pulse sequence name** (\`header.private.ge_pulse_sequence_name\`; round 3, case 8): \`fgre\` without \`SP\` in SequenceVariant is **SS-GRE**; \`fspgr\`, and an \`fgre\` or \`efgre3d\` with \`SP\`, is **FSP-GRE**; an \`efgre3d\` without \`SP\` is **GRE** (spoiling not stated), and **bSSFP** at a flip of 40° or more and TR under 10 ms (CISS where named FIESTA-C; round 6, item 10); an inversion-prepared one stays MPRAGE. \`FAST_GEMS\` and \`EDR_GEMS\` say nothing of spoiling. **A single-echo Siemens FLASH** (\`*fl2d1\`, \`*fl3d1\`; not \`tfl\`, the turbo FLASH) is **SP-GRE** whatever SequenceVariant says (case 9).
  - **Dixon** (round 3, case 10): the technique comes from Philips' private scan technique (\`TSE\` or \`FFE\`), never from ScanningSequence \`GR\` on an mDixon TSE: a Philips mDixon part whose private technique is a spin echo, or which has none and is named TSE with an echo train, is **TSE**. The part (W, F, IP, OP) is read from Philips' per-frame ImageType (\`header.sequence.private_frame_image_type\`, its third and fourth values) or the image type, and Siemens' from \`DIXON\` with \`WATER\`, \`FAT\`, \`IN_PHASE\`, \`OPP_PHASE\`; modifier **Dixon**. Siemens' Dixon parts are **SP-GRE**, **VI-GRE** when named VIBE.
  - **Philips echoes** (round 3, case 12): the echo count is (2001,1014), \`header.private.philips_number_of_echoes\`, where written: it tells a SWIp's combination. A merged mFFE writes 1 there beside a train of 5 and stays **comb-ME-GRE**: the single-echo test reads the train (a reading confirmed with pack 0.21.0). The ImageType token \`T1\` or \`T2\` on an FFE says nothing of the base. Philips \`FEEPI\` is **GRE-EPI**.
  - **A Philips 3D T1 TFE by its prepulse** (round 6, item 1, Nima 2026-10-03, which replaces round 3's case 17 line on InversionRecovery \`NO\`): Prepulse Type (\`header.private.philips_prepulse_type\`, 2001,xx1C) \`INV\` or \`BBI\` is **MPRAGE**; \`NO\`, \`SAT\` or \`ECHO\` is **FSP-GRE**, whatever InversionRecovery or \`MP\` say. Where the packet has no prepulse type, an inversion time or a prepulse delay above 0 (\`philips_prepulse_delay\`) makes MPRAGE, then SequenceVariant \`MP\` does; with neither it is **can't tell**. InversionRecovery \`NO\` or a missing \`MP\` alone never makes FSP-GRE.
  - **GE \`SS\\SK\` with \`FAST_GEMS\`**, not spoiled (no \`SP\`), is **SS-GRE**, an ASSET calibration of that shape too (the re-adjudication's ruling 3). GE SPGR (by name or pulse sequence) with \`FAST_GEMS\` is **FSP-GRE** (case 7).
  - **GE \`VASCTOF_GEMS\`** is TOF-MRA only when no contrast agent or contrast word, no multiphase and no SPGR name goes with it; a series named TOF stays TOF-MRA (case 2). A contrast-enhanced or time-resolved angiography is **CE-MRA**: TRICKS, TWIST, 4D-TRAK, bolus chase, a named CE-MRA (cases 2 and 33).
  - **Philips \`PCA\`** is **PC-MRA** (case 19), and so are GE's \`VASCPC_GEMS\`, its \`2dphcon\` and \`3dphcon\` pulse sequences and Inhance \`Inh-Vel\` (round 3, case 5). **Philips \`s3DI\`** is an inflow **TOF-MRA** (case 20).
  - **GE FIESTA-C is CISS** (case 13): only its name tells it from FIESTA. A Philips balanced FFE named "ciss" is **bSSFP** unless the header shows phase cycling (case 5).
  - **GE \`MRF_GEMS\` alone is no MR fingerprinting** (case 23): read the technique from the rest of the header, or can't tell.
  - **Zero echo time:** GE Silenz and Silent MRA, Siemens PETRA are **ZTE**, modifier Radial. GE Silent MRA has no construct (no M0 from its ASL token) and base none; its MIPs are ProjectionDerived with MIP (round 3, case 18).
- **The EPI family:** DWI-EPI, MS-EPI (readout- or shot-segmented: Siemens RESOLVE when the sequence name says \`*re_b\`, GE MUSE by \`epi2muse\` or the name, Philips IRIS by the name; round 3, case 27), BOLD-EPI, ASL, Perfusion-EPI (DSC), DCE, SE-EPI, GRE-EPI, EPI.
  - **Siemens \`epse\` and \`epir\` are SE-EPI** whatever ScanningSequence says (case 1); \`epir\` takes FLAIR or IR by its inversion. Siemens \`epfid\` is GRE-EPI.
  - **EPIMix:** its T2 (the b=0) and T2-FLAIR blocks are SE-EPI (also when named mix2), its **T1-FLAIR block EPI** (round 3, case 28), its T2\\* block GRE-EPI, its diffusion outputs and ADC DWI-EPI (case 12). NeuroMix's T2w and T2-FLAIR blocks are single-shot fast spin echo, SS-TSE, and its T2w FSE block TSE.
  - **A single DSC volume** written ORIGINAL (one temporal position, one mosaic image, or no more images than slices) is Perfusion-EPI with base T2\\*w (case 8; kept by round-3 conflict 4).
  - **A GE SPGR-EPI** is GRE-EPI (case 32). An EPI named T2\\* is GRE-EPI; a GRE-EPI with a b value is no DWI.
  - **Philips diffusion** by its private technique \`DwiSE\` is DWI-EPI, the b=0 image included.
  - **GE headers rewritten with numbers** (ScanningSequence and ScanOptions as integers, a third-party toolkit): read them by their names; ScanningSequence \`GE\` there is no gradient echo (case 24).
- **MRS:** spectroscopy, or the few images a scanner writes of one (GE PROBE), with no image contrast. Base none.
- **MAVRIC** for GE MAVRIC SL, its composite too (no construct, case 3).
- **A localizer is read by family** (ruled 2026-09-27): GRE for \`*fl2d1\` or a gradient-echo scout, the SE family (TSE or SS-TSE) for \`*tse\` or \`*haste\`; the exact member is not read. Otherwise can't tell. A stack settled Localizer is scored by family (N8).
- **A diagnostic gradient echo is told apart** where the header supports it; where it does not, can't tell rather than plain GRE.

#### Modifier (several allowed)

- **FLAIR**, **STIR**, **IR**, **DIR**, **PSIR** on an inversion recovery:
  - **PSIR by a real IR image** (dispute 3): a Siemens inversion recovery (ScanningSequence IR, an inversion time, \`*spcir…\`, \`*tir…\`) whose ImageType component (the third value) is \`R\`, real, is **PSIR** with construct **Real**: a real-valued reconstruction keeps the sign of the longitudinal magnetisation. An ImageType token \`PSIR\` is PSIR too. The magnitude image (\`M\`) of the same acquisition keeps IR or FLAIR by its TI; a phase (\`P\`) is Phase, not PSIR.
  - **At TI 300 to 1,400 ms, a spin-echo inversion recovery is FLAIR only near the CSF null** at its TR, else IR (case 15). The CSF-null TI is 4,000 × ln(2 / (1 + e^(−TR / 4,000))) ms; FLAIR when TI is within 20 % of it. For example TR 2,000 and TI 800 is FLAIR (the null is about 880 ms), and TR 2,500 and TI 800 is IR (the null is about 1,060 ms). **GE's \`T1FLAIR_GEMS\` option gives FLAIR** over the CSF-null rule (round-3 conflict 3, Nima 2026-10-01); the rule decides where the option is absent.
  - A long TI with a fluid-nulling name is FLAIR; a short TI (about 150 to 250 ms at 1.5 and 3 T) is STIR.
- **FatSat** (fat saturation, SPAIR, SPIR), **WaterExcitation**, **Dixon**, **MT**. GE FLEX is **Dixon** (case 26).
- **Radial** (BLADE, PROPELLER, MultiVane, GE \`PROPks\` and PROPELLER's \`PROP\` tokens, ZTE), **Spiral**, **MoCo**. No MoCo from GE's "MC" in a diffusion map's name (N11): nearly every GE map carries it. **GE PROMO** (prospective motion correction) **is no MoCo** (round 3, case 37); a Philips \`Reg - \` diffusion copy is MoCo (case 26).
- **MT:** GE's \`MT_GEMS\` is **MT**. \`MTC\` in a name is MT below the header's tokens, never where the words switch it off; a bare \`MT\` in a name is not (round 5). **BlackBlood** only from a name that says so.
- **FlowComp** only where the header's ScanOptions (FC, or GE's flow-compensation options) say it is on, not because a name mentions flow (C5).
- **GE ScanOptions:** FS is FatSat and FC (or FC_FREQ_AX_GEMS, FC_SLICE_AX_GEMS) is FlowComp. SAT_GEMS is spatial saturation bands, never FatSat. FSA_GEMS, FSP_GEMS, FSS_GEMS, FSI_GEMS, FSR_GEMS and FSL_GEMS name the readout direction (A, P, S, I, R, L): geometry, never FatSat. EDR_GEMS, FAST_GEMS, NPW, PFP, TRF_GEMS and the like add no modifier.
- **A synthetic image carries the modifier its contrast names** (SyntheticFLAIR takes FLAIR, a synthetic PSIR PSIR; D12).
- **none** when the stack has no modifier. Can't tell only when the header cannot say.

#### Construct (several allowed)

- What the image is of beyond the acquisition: **ADC**, **eADC**, **Trace**, **FA**, **MD**, maps (**T1map**, **T2map**, **QSM** and so on), DSC maps (**CBV**, **CBF**, **MTT**, **TTP**, **Tmax**, **PBP**, **K2**), ASL (**DeltaM**, **M0**, **CBF**), **MIP**, **MinIP**, **StdDevProj**, **StdDevTime**, **MPR**, **Composed**, **EchoCombined**, Dixon parts (**Water**, **Fat**, **InPhase**, **OutPhase**), MP2RAGE outputs (**INV1**, **INV2**, **UNI**, **UNI-DEN**), **SWI**, **Phase**, **Velocity**, **Speed**, **SBRef**, **FieldmapRef**.
- **Phase-contrast outputs** (round 3, case 5): Philips \`VELOCITY MAP\` (\`…\\P\\PCA\`) is **Velocity**, \`M_PCA\` **Magnitude**, the PCA angiogram (the speed or complex-difference image) the new construct **Speed**, its \`PROJECTION\` a **MIP**; GE's 2D \`COLLAPSE\` has no construct and its 3D \`COLLAPSE\` is a MIP.
- **A Siemens 3D-card output is read image by image from its own ImageType** (round 3, case 3): \`CSA MPR\` is **MPR** and \`CSA MIP\` is **MIP**, whatever the series is named. A position display (\`POSDISP\`) takes no reformat construct from a protocol's name.
- **ND** where ImageType holds \`ND\` (not distortion corrected). Read it off the image type; it is not a judgement.
- **Magnitude** only where a route that knows the acquisition's phase wrote it (SWI, QSM, SyMRI, STAGE) or the image type says so (Philips \`M_PCA\`); never on a plain acquired image (N7). **The SWI route's own magnitude keeps Magnitude:** a Siemens SWI sequence's magnitude (\`*swi3d1r\` \`Mag_Images\`, each per-echo \`_Mag\` of a multi-echo \`*swi3d4r\`, written ORIGINAL with component \`M\`) is **Magnitude**, as every reference has settled it. N7's exception names two vendors' acquired SWI echoes only, a Philips per-echo \`M_FFE\` and a GE image with no output prefix and no magnitude token: written ORIGINAL, they have no Magnitude. A GE QSM source echo written ORIGINAL has neither QSM nor Magnitude. On a phase image, the construct is **Phase**, never Magnitude (E1).
- **Diffusion:** the isotropic image is **Trace**, never isoDWI (D9). A Philips diffusion image with a positive b value written \`PROJECTION IMAGE\` (not a b=0 image, a map or a MIP) is Trace (N4). A GE single b=1000 volume with no trace token has no Trace (N10). Siemens \`EXP\` is **eADC** (case 30). A Siemens sequence name ending in \`t\` after the b value is **Trace**; a bare Philips b>0 stack with no direction marker is can't tell, unless its session tells (round 3, case 26).
- **EchoCombined** stays on a \`MEAN\` SWI output (N1), and never goes on a combined multi-echo FFE, whose technique already says it (R2).
- **Philips \`MAXIMUM\`** is a **MIP**, and ProjectionDerived, only when the geometry shows a projection: 3 slices or fewer, or a slab of 10 mm or more (round 3, case 2; it replaces case 14). Our archive's \`MAXIMUM\` objects are whole 3D volumes: RawRecon with no construct.
- **GE's private image type** (\`header.private.ge_private_image_type\`): 1 is a phase image; 2 on a PROPELLER is how newer software writes every PROPELLER image, **no Real** (round 3, case 21); 2 on a GE MAGiC or MDME ORIGINAL image is **Real** (round 6, item 2).
- **GE's prefixes** in the series description (round 3): ImageType first; \`PU:\` no construct, \`ORIG:\` ORIG, \`PJN:\` MIP, \`SC:\` a secondary-capture copy of the series it names; \`FL:\` as DR8.
- **No construct** for Elscint's \`ENHANCED\` (routine filtering, case 10) and for the MAVRIC composite (case 3).
- **GE's \`FL:\` prefix** (\`FL:A/…\` to \`FL:D/…\` in the series description; dispute 8, decided by our counts): an \`FL:\` image written **DERIVED** is **Filtered**, a separate filtered copy (127 of 144 in our archive, beside the ORIGINAL where both were exported), whether or not its original is in the session; one written **ORIGINAL** has no construct. \`FILTERED_GEMS\` in ScanOptions without the prefix is no marker (it is on almost every GE series).
- **References of an EPI run:** the single-band reference of a multiband run is **SBRef**, base DWI for a diffusion run (case 6). **FieldmapRef** is an EPI of a few volumes with the phase encoding reversed, for distortion correction: where the header names it a reference (fieldmap, TOPUP, reverse, blip, pepolar), and also **a b=0 EPI of at most about 6 volumes whose phase encoding is reversed against a diffusion series of the same session** (dispute 7): the same phase-encoding axis and the opposite polarity where the reader shows it (the Siemens CSA sign, GE's polarity flag), else a direction token opposite to the diffusion's (\`PA\` beside \`AP\`). Where the sign is shown, it decides: a run whose name says reversed but whose sign equals the diffusion's is not FieldmapRef (18 in our archive). It is not a b=0 diffusion image. A reversed series with b > 0 volumes and gradient directions is a diffusion, not FieldmapRef.
- **none** for an ordinary acquired image.

#### Base

- The contrast the image carries: **T1w, T2w, PDw, T2\\*w, DWI, PWI, SWI, MTw** and the rarer ones.
- **Dual-echo TSE: by the echo on screen.** TE below 40 ms is **PDw**, TE of 40 ms or more is **T2w**. A long-TR spin echo under TE 40 ms named T2 is PDw too: the TE outranks the word. This never covers an inversion recovery: a STIR named T2 is T2w (round 4, R2).
- **A gradient echo named T2** (Philips \`T2FFE\` included) is **T2\\*w** at any echo time (round 3, case 25). On a gradient echo, **MTw** outranks a T2 word.
- **none** where the image has no contrast of its own: MP2RAGE's INV1 and INV2 (ruled 2026-09-27; UNI and UNI-DEN are T1w), an acquired MDME echo (D10), a synthetic PD map (N5), a phase image, spectroscopy (MRS), GE Silent MRA, a **calibration** scan, every **phase-contrast output** (velocity, magnitude, speed, MIP), a **StdDevTime** map, and **a real or imaginary spin-echo component without PSIR evidence** (round 3, cases 5, 7 and 24).
- **SWI** (ruled 2026-09-28): the combined SWI image is **SWI**, the magnitude **T2\\*w**, the phase **none**, and a SWI minIP **SWI**. A SWI EPI reformat with no SWI, M or P token in its image type is **can't tell**: the header does not hold which it is (RJ1).
- **Balanced steady state** (FIESTA, FIESTA-C, TrueFISP, CISS, balanced FFE) is **T2w** by convention, never T1w (N6); PDw for a 2D scan at a flip of 10° or less, and a magnetisation-prepared one takes its preparation's contrast.
- **T1-FLAIR is T1w** with modifier FLAIR.
- MRCP and a spin echo at TE 80 ms or more are T2w; a plain GRE-EPI is T2\\*w; a single DSC volume written ORIGINAL is T2\\*w.
- Can't tell when neither the words nor the physics nor the picture settle it. Do not guess from the protocol's usual habits.
- **Round 4, the name against the physics (Nima, 2026-10-02; \`../2026-10-02-name-vs-physics/round4-conventions-draft.md\`; for the next read's registration, with its prompts composed and their sha256 recorded).** The weighting a name states is the base, and the physics overrides it only where it contradicts it outright:
  - a STIR-window inversion time named T1 is **T2w** (TI 100 to 220 ms up to 1.5 T, 140 to 280 ms at 3 T, 180 to 350 ms at 7 T);
  - a FLAIR-window inversion time named T1 at TE 80 ms or more, or on a 3D TSE, is **T2w** (TI 1,700 ms or more up to 1.5 T, 1,500 ms or more at 3 T, 2,000 ms or more at 7 T);
  - a 2D spin echo with no inversion at TR 2,500 ms or more and TE 80 ms or more, named T1, is **T2w**;
  - a spin echo with no inversion at TR 1,000 ms or less and TE 30 ms or less, named T2, is **T1w**;
  - a gradient echo named T2 at TR under 50 ms, flip 15° or more and TE under 5 ms is **T1w** (N6 stands beside it: a balanced steady state, bSSFP or CISS, named T2 stays T2w).

  A T1-IR inversion time (300 to 1,300 ms up to 1.5 T, 300 to 1,400 ms at 3 T, 350 to 1,800 ms at 7 T) keeps a T1 name at any echo time. That covers \`t1_space_ir\`, the T1-FLAIR BLADE and PROPELLER, and \`T1FLAIR_GEMS\`. A STIR named T2 or PD keeps its name. Never read a 3D TSE's written echo time as its contrast, and leave DIR out of the inversion-time windows. Two qualifiers, \`contrast_mix\` and \`base_basis\`, are described in the pack and are not asked.

#### Body part

- **brain**: the stack covers the head and ends at or above C2.
- **brain-neck**: it covers the brain and clearly reaches below C2 (ruled 2026-09-27). A stack ending at about C2 is brain.
- **spine** (G2): the field of view is centred on the vertebral column: a sagittal spine protocol, HWS, the axial slices of a cord or spine exam.
- **neck** (G2): the field of view is centred on the neck's soft tissue: larynx, thyroid, the vessels.
- The label follows what the image is centred on and covers, not the coil and not what the exam was registered as.
- **chest**, and **other** for a phantom, a stack over several parts, or anything else.

Body part and post-contrast are answered and kept, but they are not the header certificate's reference (record 48, 2026-09-28 and 2026-09-29); they are certified from the pictures on their own tracks.

#### Post-contrast

- **given** when the words say so (med K, efter K, +C, Gd, post KM, T1+C) or the picture shows enhancement of vessels, dura or choroid plexus that a native image would not. A DCE or DSC series is given.
- **not_given** when the words say native, pre, före K, or the series precedes the injection in a session that has one.
- Can't tell otherwise. Session order counts as much as the words (ruled 2026-09-27).

### The values added (pack mri 0.18.0 and earlier, 2026-09-30; pack mri 0.21.0, 2026-10-01)

The pack's own definitions (\`packs/mri/axes/*.yml\` in kineuro/nils).

| axis | value | what it is | read it from |
|---|---|---|---|
| technique | **CE-MRA** (family GRE) | contrast-enhanced MR angiography: a T1-weighted 3D spoiled gradient echo timed to the arterial bolus, single phase or time resolved; base T1w | TRICKS, TWIST, 4D-TRAK, bolus chase, a named CE-MRA, \`VASCTOF_GEMS\` with a contrast agent or multiphase |
| technique | **MRS** (family OTHER) | magnetic resonance spectroscopy (single voxel or chemical shift imaging): a spectrum, or the images a scanner writes of one, with no image contrast; base none | PROBE, SVS, PRESS, CSI, a few images named for spectroscopy |
| technique | **ZTE** (family GRE) | a zero echo time 3D radial readout (GE Silenz, Siemens PETRA); with an arterial spin labelling preparation, GE Silent MRA; modifier Radial; a Silent MRA has no base | Silenz, Silent MRA, PETRA, ZTE |
| technique | **DWI-TSE** (family SE) | diffusion-weighted imaging read out by a turbo spin echo (PROPELLER, BLADE, MultiVane, HASTE, Philips DWI-TSE), not an EPI | a diffusion with a spin-echo train and no EP |
| provenance | **NeuroMix** | GE NeuroMix: a rapid multicontrast examination of single-shot EPI and single-shot fast spin echo blocks, and each of its outputs | NeuroMix, \`ksneuromix\` |
| construct | **DeltaM** | the ASL perfusion-weighted image: control minus label, subtracted by the scanner (BIDS aslcontext deltam) | \`SUB\`, "perfusion_weighted", Siemens \`TTEST\` on an ASL output |
| construct | **M0** | the ASL M0 (equilibrium magnetisation) scan a CBF quantification divides by (BIDS m0scan) | M0, a proton-density reference pass of an ASL |
| construct | **PBP** | the percentage of baseline at peak of a DSC bolus: the peak signal drop relative to baseline (Siemens inline perfusion), a surrogate of blood volume and no CBV | \`PBP\`, "percentage of baseline" |
| construct | **K2** | the leakage coefficient of a DSC (K2), from a leakage-corrected fit: contrast leaking out of the vessels | K2, rLeakage, leakage |
| construct | **Velocity** | the velocity image of a phase-contrast acquisition: the phase difference scaled to velocity by the encoding velocity; base none | a phase contrast's velocity, VENC or phase image (not its magnitude) |
| construct | **StdDevProj** | a standard deviation projection through a volume, each pixel the standard deviation of the voxels along the ray | \`STDDEV_COR\`, \`STDDEV_SAG\`, \`STDDEV_TRA\` |
| construct | **SBRef** | the single-band reference image of a multiband EPI run (BIDS sbref) | SBRef in the name or image type |
| construct | **FieldmapRef** | an EPI of a few volumes with the phase encoding reversed, for distortion correction (BIDS fmap epi) | a name that says so (fieldmap, TOPUP, reverse, blip, pepolar), or a b=0 EPI of a few volumes reversed against the session's diffusion (dispute 7) |
| provenance | **Calibration** (pack mri 0.21.0, 2026-10-01) | a coil-sensitivity, receive-field or prescan reference image acquired to support reconstruction or correction, not for reading; base none; a working scan | ASSET, ARC or PURE calibration, a SENSE reference scan, a prescan normalize reference, by the name and never DERIVED |
| construct | **Speed** (pack mri 0.21.0) | the angiogram of a phase-contrast acquisition: the magnitude of the velocity vector or the complex difference, neither a signed velocity component nor a tissue magnitude; base none | the Philips PCA angiogram, a phase contrast's speed or complex-difference image |
| construct | **StdDevTime** (pack mri 0.21.0) | the voxelwise standard deviation over the measurements or time points of a series, a temporal map and no spatial projection; ProjectionDerived, base none | Siemens \`STDDEV_TIME\`, "Std-Dev-Time", a tSD map |

**Not used:** isoDWI (the isotropic image is Trace, D9); TTestMap for Siemens \`TTEST\` on an ASL output (it is the difference image, DeltaM).

### Can't tell, none and unsure

- **none**: the axis has no value for this stack, and you know it (no modifier on a plain TSE, no construct on an acquired image, base none on an MP2RAGE inversion).
- **can't tell**: the axis has a value but the stack does not let you tell which. It counts as missing, so use it honestly, not as a shortcut.
- **unsure**: one mark per stack. You answered, but you would not stake the stack on it. An unsure answer stays out of the certificate's reference until it is looked at again.
- Rule of thumb: if a second reader with the same screen could reasonably pick another value, it is can't tell or unsure; if the axis cannot apply, it is none.

### Ruled by Nima (2026-09-27)

The seven questions this guide left open, as Nima ruled them on the guide's recommendations:

1. **Localizers: a one-key answer.** It sets provenance Localizer and the body part (from the file's words, for the rater to confirm) and marks every other asked axis *not asked for a localizer*, a value of its own, neither none nor can't tell. A desk change and a campaign rule, not built yet.
2. **MP2RAGE inversions: INV1 and INV2 both take base none.** UNI and UNI-DEN are T1w. Pack 0.9.0 carries it.
3. **Post-contrast not_given** from the words (native, pre, före K) **or from the session's order** (the series precedes the contrast series of a session that has one).
4. **Technique granularity: the family is enough for localizers.** A diagnostic gradient echo is told apart (SP-GRE, FSP-GRE, VI-GRE, comb-ME-GRE, ME-GRE) or answered can't tell.
5. **ND and FlowComp are read from the header only**: ND from ImageType, FlowComp from ScanOptions (FC or the vendor's flow-compensation option). Never from the picture or from a name that mentions flow.
6. **brain-neck only when the stack clearly reaches below C2.** A stack that ends at about C2 is brain.
7. **Maps:** an FA or other tensor map (FA, MD, colour FA, tensor) is provenance **DTIRecon**; an ADC or trace made from a plain DWI is **RawRecon** with construct **ADC** (or Trace).

### Ruled by Nima (2026-09-28)

The three conventions the header judge pilot (\`studies/2026-09-27-header-judge/README.md\`) found unruled, as Nima ruled them on its recommendations:

1. **Provenance of SWI, BOLD, ASL and MAGiC.** The acquired images are RawRecon: SWI magnitude and phase, the BOLD and ASL time series, MAGiC's MDME images. What the scanner computes takes the pack's derived value: the combined SWI image SWIRecon, CBF maps ASLRecon, fMRI maps BOLDRecon, MAGiC's synthetic contrasts and maps SyMRI.
2. **SWI base.** The combined SWI image is SWI, the magnitude T2\\*w, the phase none.
3. **SWI minIP.** ProjectionDerived with construct MinIP (the pack already excludes RawRecon for a minIP), base SWI.

Pack 0.9.0 carries them, with MP2RAGE's inversions as base none and dual-echo TSE by the echo.

### Ruled by Nima (2026-09-29 and 2026-09-30)

Record 48's sections of those days, in the words a rater needs. The short names are the correction records' (\`../2026-09-28-certificate/tools/rulings.py\`), so a settled cell can be traced to its ruling.

**On the disputes of packs 0.13 to 0.15 (2026-09-29 and 2026-09-30):**
- D1, D5, C1, D8: the acquisitions' own images are RawRecon (convention 1 as ruled), their motion-corrected copies written ORIGINAL too.
- D2: a single-echo SWI is SP-GRE where SequenceVariant says SP, else GRE.
- D3: GE's own diffusion map names are RawRecon; the header cannot tell a GE DTI of 14 to 20 directions from a plain DWI.
- D4: SyMRI screenshots are excluded; no axis of theirs is answered.
- D6: a GE calibration scan is no localizer: RawRecon, FSP-GRE. (Its provenance and base are superseded on 2026-10-01 by R3-CAL: Calibration, base none.)
- D7: Philips mFFE is the combined multi-echo GRE (comb-ME-GRE).
- D9: one value for the isotropic diffusion image, Trace.
- D10: an acquired MDME echo has base none.
- D11: GE FRFSE (VFA-TSE) against FSE (TSE) is decided by the pulse name; \`FR_GEMS\` alone is not enough. (Superseded on 2026-10-01 by round-3 conflict 2: \`FR_GEMS\` decides.)
- D12: a GE EPI SWI is EPI; a synthetic image carries its contrast's modifier.
- N1: EchoCombined stays on MEAN SWI outputs. N2: a GE spin echo, not split by echo, with a stated train of 2 or more, is TSE. N3: a diffusion read out by a TSE is DWI-TSE. N4: a Philips diffusion image with a positive b value written PROJECTION IMAGE is Trace. N5: a synthetic PD map has no base. N6: a balanced steady state is T2w. N7: no Magnitude on a plain acquired image. N8: a stack settled Localizer is scored on technique by family. N9: the ASL perfusion-weighted image is ASLRecon and DeltaM. N10: a GE single b=1000 volume with no trace token has no Trace. N11: no MoCo from GE's "MC". N12: a Siemens BLADE with restore is VFA-TSE.
- R1: a GE research-mode SWI with a train of 32 or more is EPI. R2: no EchoCombined on a combined multi-echo FFE. C5: FlowComp from ScanOptions only.

**After the re-adjudication (2026-09-30):** the base of a Siemens SWI EPI reformat with no SWI, M or P token is can't tell (RJ1); a MEAN SWI output is SWIRecon (RJ2); a GE \`SS\\SK\` \`FAST_GEMS\` gradient echo, not spoiled, is SS-GRE (RA); a GE PROPELLER with \`FR_GEMS\` is TSE by D11 (superseded on 2026-10-01 by round-3 conflict 2: VFA-TSE with Radial).

**After dev-5's reading (2026-09-30):** the conventions follow the deep research on vendor conventions (\`../2026-09-28-certificate/deep-research-conventions.md\`, Part A), with our own counts deciding where it is unsure or where they refute it (\`../2026-09-28-certificate/empirical-conventions.md\`); GE Cube is 3D-TSE; missing values are added, never forced. Pack 0.18.0 carries them (\`../2026-09-30-pack-0180/README.md\`). The per-axis sections above give each one with its case number. Where the research and our data disagreed, our data decided: Siemens \`TTEST\` on an ASL output is DeltaM (case 27), GE's ASL pass is read from ORIGINAL against DERIVED (case 34), and the EPIMix isotropic image is Trace (case 25, D9).

**The nine dev-5 disputes, by the deep research (2026-09-30, record 48; \`../2026-09-30-dev5-reference/deep-research-disputes.md\`, checked against \`empirical-disputes.md\` there and record 48's "The nine, after our counts"):** the final record of \`rulings.py\` carries them as DR1 to DR9, and the ruling found beside them as DR10.
- DR1: a Philips FFE is read by Spoiling, then SequenceVariant, then the private scan technique, then the name; SS is SS-GRE, SP SP-GRE; with OSP alone the private technique decides (T1FFE SP-GRE, FFE SS-GRE), and GRE where it is not shown; "T1W" in a name never makes SP-GRE.
- DR2: a Philips SWIp output of a multi-echo acquisition is comb-ME-GRE; the SWIp image SWIRecon, its phase RawRecon.
- DR3: a Siemens real (\`R\`) inversion recovery is PSIR, construct Real; its magnitude keeps IR or FLAIR by TI.
- DR4: the ADC or eADC of a Siemens or Philips DTI is DTIRecon; its trace-weighted image stays RawRecon and Trace; GE's ADC stays RawRecon and its AvDC is DTIRecon with MD.
- DR5: a Siemens MEAN phase is RawRecon, Phase, comb-ME-GRE, and a MEAN magnitude (no SWI token) RawRecon, comb-ME-GRE; SWIRecon's MEAN clause covers only the MEAN of SWI-processed images.
- DR6: at most 5 slices per plane with a planning word or \`LOCALIZER\`/\`SCOUT\` is a Localizer; few slices without a planning word is can't tell. (Round 3 puts the vendor flags first: R3-LOC.)
- DR7: a reversed-phase b=0 EPI of a few volumes beside opposite-direction diffusion is FieldmapRef.
- DR8: GE's \`FL:\` prefix (the research found no source, so our counts decided): written DERIVED, a separate filtered output, construct Filtered; written ORIGINAL, no construct.
- DR9: a motion-corrected DSC series, DERIVED or not, is RawRecon with MoCo and Perfusion-EPI; only the maps are PerfusionRecon.
- DR10 (found beside the nine): one echo of a Philips multi-echo FFE is ME-GRE, and a single-echo FFE named mFFE or T2\\* is SS-GRE or SP-GRE by DR1; comb-ME-GRE (D7) is the combined image only.

### Ruled 2026-10-01: conventions round 3

Record 48's "Conventions, round 3" (the deep research's 40 cases, \`../2026-10-01-conventions-r3/deep-research-r3.md\`, checked against \`empirical.md\` there), "The four round-3 conflicts" (Nima, 2026-10-01: "agreed") and the four readings confirmed with pack mri 0.21.0 (\`../2026-10-01-pack-0210/README.md\`). The short names are the final correction record's (\`../2026-09-28-certificate/tools/rulings.py\`) where a rule over the packet and the settled value can express the ruling; the others are named by their case.

**The four conflicts, as Nima ruled them:**
- V28 (conflict 1): a stitched composite (MobiView, Siemens \`COMPOSED\`, \`COMP_AD\`, \`COMP_SP\`) is ProjectionDerived with Composed; a composite of survey stations is a Localizer. It replaces the morning's RawRecon wording.
- R3-FR and R3-FRNO (conflict 2): GE's \`FR_GEMS\` decides VFA-TSE (a PROPELLER's too, with Radial); an inversion first makes IR-TSE; an FRFSE pulse name without \`FR_GEMS\` is TSE. They replace D11.
- R3-T1FLAIR (conflict 3): GE's \`T1FLAIR_GEMS\` gives FLAIR over the CSF-null rule.
- Conflict 4: a single-volume DSC keeps base T2\\*w (V8 stands).

**The four readings confirmed with pack 0.21.0:**
- A series split into planes and named for planning is a vendor localizer flag: the three-plane localizer GE's series plane 256 states.
- Philips SmartExam (\`SmartBrain\`) and GE READYBrain count with Siemens AutoAlign as automatic planning scouts.
- Calibration applies to any vendor, by its name, never DERIVED.
- A merged Philips mFFE stays combined: (2001,1014) writes 1 beside a train of 5, so the single-echo test reads the train.

**The round's rulings:**
- R3-LOC (case 6): a vendor localizer flag outranks the slice count; otherwise at most 5 slices per plane with a planning word; more than 5 with a planning word and no vendor flag is no localizer.
- R3-CAL (case 7): a calibration scan is provenance Calibration with base none.
- R3-EFGRE and case 8: GE \`fgre\` without SP is SS-GRE; \`fspgr\`, and \`fgre\` or \`efgre3d\` with SP, FSP-GRE; \`efgre3d\` without SP GRE; \`FAST_GEMS\` and \`EDR_GEMS\` say nothing of spoiling. Case 9: a single-echo Siemens FLASH (\`fl\`, not \`tfl\`) is SP-GRE.
- R3-TFE (case 17): a Philips 3D T1 TFE with InversionRecovery NO is FSP-GRE; YES or a TI is MPRAGE. **Replaced by round 6, item 1** (below): the prepulse decides, and InversionRecovery NO alone no longer makes FSP-GRE.
- R3-MAX (case 2): Philips \`MAXIMUM\` is a MIP only at 3 slices or fewer or a slab of 10 mm or more.
- R3-COLLAPSE (case 5): a GE 2D \`COLLAPSE\` is RawRecon with no construct, a 3D one a MIP. Case 5 also: GE \`VASCPC_GEMS\`, \`2dphcon\`, \`3dphcon\` and \`Inh-Vel\` are PC-MRA; Philips \`M_PCA\` Magnitude, its angiogram Speed, its \`PROJECTION\` a MIP; no phase-contrast output has a base.
- R3-REG (case 26): a Philips \`Reg - \` diffusion is RawRecon with MoCo. Case 26 also: a Siemens \`t\` after the b value is Trace; a bare Philips b>0 stack with no direction marker is can't tell.
- R3-FEEPI (case 12): Philips \`FEEPI\` is GRE-EPI. Case 12 also: Philips' echo count is (2001,1014); the \`T1\`/\`T2\` ImageType token on an FFE says nothing of the base.
- R3-SWIME (case 13, by our counts): each echo of a Siemens multi-echo SWI magnitude is ME-GRE.
- R3-GEPROP (case 21, by our counts): GE PROPELLER's private image type 2 is no Real; its type 1 is a phase image.
- Case 3: a Siemens 3D-card output by its own ImageType (\`CSA MPR\` MPR, \`CSA MIP\` MIP). Case 4: Siemens \`STDDEV_TIME\` is StdDevTime; \`STDDEV_SAG/COR/TRA\` stay StdDevProj.
- Case 10: Dixon technique from Philips' private scan technique, never ScanningSequence GR on an mDixon TSE; the part from the per-frame W/F/IP/OP tokens; Siemens Dixon parts SP-GRE (VI-GRE when VIBE); modifier Dixon.
- Case 18: GE Silent MRA is ZTE, Radial, no construct, base none. Case 24: a real or imaginary spin-echo component without PSIR evidence has base none. Case 25: a gradient echo named T2 is T2\\*w. Case 27: MS-EPI includes GE MUSE and Philips IRIS. Case 28: EPIMix's T1-FLAIR is EPI; NeuroMix's T2w and T2-FLAIR SS-TSE, its T2w FSE TSE. Case 37: MT_GEMS is MT, PROMO no MoCo, black blood only by a name.
- Unchanged and confirmed: EXP is eADC; SBRef base DWI; a Siemens real IR is PSIR; \`epir\` is SE-EPI; integer ScanOptions, \`MRF_GEMS\` and Elscint \`ENHANCED\` are ignored; a reading from the session is said in the reason (record 53).

**Ruled after dev-7** (record 48): a Siemens SWI image combined from several echoes (\`MEAN\`) is comb-ME-GRE, and its \`MEAN\` magnitude is Magnitude with EchoCombined (above). **Still open** (dev-6's C2, no ruling yet): the base of an unnamed short-TE first echo of an MT-weighted Philips multi-echo FFE. Answer it from the header as best you can and say why.

### Ruled 2026-10-03: conventions round 5 and the protocol sweep (for the next read's registration)

Record 48's "Conventions, round 5" and "After the protocol sweep's grade". The prompts are composed from these lines at the next read's registration, with their sha256 recorded.
- **Quantitative maps have no base:** a T1, R1, T2 or R2 map (MOLLI, MP2RAGE's T1 map, SyMRI's maps, any map in ms or s) is base **none**. A synthetic T1-weighted image and MP2RAGE's UNI stay **T1w**. An old Philips acquisition typed \`T1 MAP\` at a TR of a few tens of ms is an ordinary weighted image, not a map.
- **GE SWAN:** an output written one image per slice combines its echoes: technique **comb-ME-GRE**. The combined image keeps base **SWI** and provenance SWIRecon, and its minIP base SWI (Nima: "Keep SWI for SWAN"); a SWAN exported split by echo is ME-GRE.
- **A Siemens TWIST-VIBE dynamic run that names no angiography** is **DCE**, base PWI; a TWIST or TWIST-VIBE named for an angiography (MRA, angio), or carrying AngioFlag Y with spatial MIP or subtraction outputs, is CE-MRA. Siemens' MIPT is a maximum over time, not a spatial MIP.
- **MTC in a name is MT** below the header's own tokens, never where the words switch it off (\`utan MTC\`, \`no MTC\`, \`MT off\`). A bare \`MT\` in a name is no magnetisation transfer.
- **Siemens \`SFS\` in ScanOptions is FatSat.**
- **A subtraction of a composite** is SubtractionDerived with construct **Composed**, where the composite is stated, named, or sits beside it with the same geometry; never from a large field of view alone.
- **A real inversion recovery is PSIR with Real** on Philips (\`R_IR\\R\`) as on Siemens (DR3); its magnitude named PSIR keeps IR, FLAIR or STIR by its TI.
- **A gradient-echo real or imaginary component** (Philips \`R_FFE\`, \`I_FFE\`) without PSIR evidence has **no base**, as a spin-echo one (case 24).
- **A Siemens SWI output named for its echoes combined** (\`_Combined\`) is comb-ME-GRE; a two-echo \`fl3d2r\` or \`fm2d2r\` component kept apart is ME-GRE.
- **A Siemens composed copy written DERIVED and named \`_FILT\`** is Filtered, as an \`Image Filter\` copy is (C4).
- **A Siemens ORIGINAL diffusion stack named trace that holds its b=0 and trace images** is Trace.
- **A GE reference of b 0 and 10 with the phase encoding reversed** (named PA, \`REV_POL\`) is FieldmapRef (DR7).
- **A Philips projection of thin contiguous slices named mip** is MPR, by its geometry (R3-MAX).
- **A Siemens 3D HASTE** (\`*h3d\`) is SS-TSE.
- **A sequence named \`scout\`** with no planning word and more than 5 slices a plane is no localizer.
- **GE \`IFLOW_GEMS\`** (Inhance 3D Velocity) is PC-MRA.
- **SyMRI's EPW, NON, NAC and ICV maps** are Qmap, as its CSF, WM and GM maps.
- **A technique word in a name never outranks the sequence:** no FLAIR from a word on an MPRAGE or TFE, no 3D-TSE from Cube on a GE 2D FSE pulse sequence. **MTw from the MT token** only on a gradient echo, or where the name states no weighting.

### Ruled 2026-10-02 and 2026-10-03: after the final certificate, after the protocol sweep, and the eleven questions (for the next read's registration)

Record 48's "After the final certificate's grade" and "After the protocol sweep's grade" (the settlements, and the correction record's X9 readings and narrowed rules where they change what a reader answers), and Nima's answers of 2026-10-03 to the eleven questions of pack mri 0.25.0 (\`../2026-10-03-pack-0250/README.md\`, "The questions, answered"; the final correction record's X10-TFE to X10-RGB in \`../2026-09-28-certificate/tools/rulings.py\`). The prompts are composed from these lines at the next read's registration, with their sha256 recorded. Where one of these lines and an older line differ, this line is right.

**After the final certificate's grade (2026-10-02):**
- **GE \`ksepi\`** (a 3D EPI, \`3DEPI\`) at short TR and TE is **GRE-EPI** (C2).
- **A Philips diffusion set that holds its directional images takes no Trace** (C3): a stack with private direction \`I\`, two or more directions and more images than slices holds the b=0 and the M, P and S directional images beside the isotropic one, registered (\`Reg - DWI\`) or not. A bare Philips diffusion stack with no direction marker that states no b value above 0 and holds more images than slices (a b=0 with one more image a slice) is **can't tell** on construct, not Trace.
- **A Siemens QSM-named acquired echo has no Magnitude** (C5).
- **A Siemens MPR of an inversion recovery** whose ImageType names no component, beside an ORIGINAL source of the same sequence name and frame of reference written real (\`R\`), is **PSIR with construct Real**, as its source is (DR3 for a reformat).
- **A Siemens MEAN magnitude of a multi-echo gradient echo** (no SWI) is **Magnitude with EchoCombined**, as the SWI one is.
- **A Siemens reformat whose ORIGINAL source beside it** (the same protocol and frame of reference) **is named DANTE** takes **BlackBlood** (case 37).
- **A map of a GE MUSE source** (\`epi2muse\`, or MUSE in the words) keeps **MS-EPI** (case 27).
- **EPIMix's T1-FLAIR block is EPI** (case 28); only its T2 and T2-FLAIR blocks are SE-EPI.
- **Siemens' relative perfusion maps** (\`RELCBF\`, \`RELCBV\`, \`RELMTT\`) are maps, **PerfusionRecon**; only the motion-corrected DSC series itself is RawRecon with MoCo (dispute 9).
- **A stack that is no localizer** answers its technique's member, never the family alone (dispute 6).

**After the protocol sweep's grade (2026-10-03):**
- **A protocol named MAGiC, SyMRI or QMap reaches only its own acquisition:** an acquired MDME or QALAS echo has base none (D10), and another acquisition in such an exam keeps its own base (a BRAVO in a MAGiC-named exam is T1w).
- **Siemens FastView is a survey:** a FastView composite is a Localizer (V28).
- **Philips \`FEEPI\` names the readout:** it makes GRE-EPI only where no application settles the technique; a DSC, BOLD, diffusion, multi-shot or ASL series keeps Perfusion-EPI, BOLD-EPI, DWI-EPI, MS-EPI or ASL.

**The eleven questions (Nima, 2026-10-03: "we should fix all of the problem"):**
1. **A Philips 3D TFE by its prepulse** (\`header.private.philips_prepulse_type\`, 2001,xx1C): \`INV\` or \`BBI\` is **MPRAGE**; \`NO\`, \`SAT\` or \`ECHO\` is **FSP-GRE**, whatever InversionRecovery or \`MP\` say. Where the packet has no prepulse type, an inversion time or a prepulse delay above 0 (\`philips_prepulse_delay\`) makes MPRAGE, then \`MP\` does; with neither it is **can't tell**. A localizer's technique stays its family's (Philips SmartBrain surveys stay surveys).
2. **GE MAGiC and MDME ORIGINAL images with private image type 2 are Real** (construct Real); a PROPELLER's type 2 stays no Real.
3. **A GE reformat whose header is a BRAVO** (a gradient echo with an inversion, DERIVED) **and whose name is a Cube FLAIR not named T1** is **can't tell** on technique, modifier and base: the name and the header disagree.
4. **A Siemens SPACE real inversion recovery** (\`*spcir\`, component R) at a written TE of 360 ms or more, with no T2, PD or FLAIR word, is **T1w**: a 3D TSE's written TE is not its contrast.
5. **Siemens \`fs\` as a word of its own in a name**, with no FS token, is **FatSat**, as \`SFS\` is; not where the words switch it off, and not on a fs-dixon, an inversion recovery or a water excitation.
6. **A map computed from a Philips registered diffusion** (dReg, eReg, isoReg, FAReg) is no motion-corrected copy: **no MoCo** (N11).
7. **A Philips \`Reg - DWI\` with direction I** is a diffusion set like its unregistered source: **no Trace** (C3, above).
8. **The SWI image and minIP of a two-echo Siemens FLASH SWI** (\`fl3d2r\`) combine its echoes: **comb-ME-GRE**, base **SWI**.
9. **An R2\\* map** (GE's multi-echo QSM) is an output the scanner computed: **SWIRecon**, construct **R2starmap**, base **none**.
10. **A GE \`efgre3d\` without SP** at a flip of 40° or more and TR under 10 ms is **bSSFP** (CISS where named FIESTA-C), not GRE.
11. **A GE reversed-phase EPI of 10 volumes or fewer beside opposite-direction diffusion** is **FieldmapRef** where every b value is 50 or less; with any b value of 100 or more it is a diffusion and no FieldmapRef; between 50 and 100 its construct is **can't tell**. **A SyMRI stack saved in colour** (PhotometricInterpretation RGB or YBR, or three samples a pixel) is a display composite of the viewer, read as a SyMRI screenshot is (D4: no axis answered).

**The new header fields** (the fingerprint of 2026-10-03, wired in pack mri 0.25.0):
- **DiffusionDirectionality** (\`diffusion_directionality_all\`, every value the stack's images write): a stack whose images are ISOTROPIC, with or without b=0 images written NONE, and never beside DIRECTIONAL, is **Trace**.
- **AngioFlag** \`Y\` on an unnamed 3D FLASH at a time-of-flight TR (15 ms or more) is **TOF-MRA**; a TWIST with AngioFlag \`Y\` is read by the round-5 line above.
- **AcquisitionContrast** (0008,9209) fills a base only where nothing else gives one, never on an inversion recovery, and never T1 on a gradient echo at TE 15 ms or more: Philips writes \`PROTON_DENSITY\` on T1-weighted PSIRs and STIRs and \`T1\` on its T2\\*-weighted venous FFE.

## Traps: header facts that readers have missed (v2, from the 2026-09-28 re-measure; amended for v3, v3.1, v3.2, v3.3 and v3.4 where a later ruling supersedes one)

Each of these was misread on real stacks. Check every one that could apply before you answer.

### Tokens that decide an axis, wherever they appear

Read ImageType, ScanOptions and SequenceVariant token by token, split on the backslash. A token that is there decides; do not drop it because the stack is a map, a scout or a reformat.

| where | token | answer |
|---|---|---|
| ImageType | \`ND\` | construct ND (also on a trace, a MIP or an MPR that carries it) |
| ImageType | \`P\`, \`PHASE\`, \`PHASE MAP\` | construct Phase |
| ImageType | \`MOCO\` | modifier MoCo; provenance stays RawRecon for an acquired series |
| ImageType | \`UNIFORM\` | construct Uniform (MP2RAGE UNI) |
| ImageType or description | \`TRACEW\`, \`TRACE\`, \`_TRACEW\` | construct Trace (base DWI) |
| ImageType or description | \`ADC\`, \`dADC\` | construct ADC (base DWI); the provenance follows DR4 |
| series description (GE) | a leading \`ORIG\` or \`ORIG:\` | construct ORIG (the unfiltered original GE keeps beside the filtered series) |
| ScanOptions | \`FS\` (Siemens \`SFS\` too, round 5) | modifier FatSat, also on a CUBE or SPACE FLAIR (FLAIR plus FatSat) and on a TOF |
| ScanOptions | \`FC\`, \`FC_FREQ_AX_GEMS\`, \`FC_SLICE_AX_GEMS\` | modifier FlowComp, every time |
| ScanOptions | \`WE\` | modifier WaterExcitation |
| ScanOptions or SequenceVariant | \`MT\`, \`MTC\` | modifier MT; also from \`MTC\` in a name, below the tokens and never where the words switch it off (round 5) |
| sequence or description | \`PROP\`, \`PROPELLER\`, \`BLADE\` | modifier Radial |

- **FlowComp comes from the tokens only, and MT from the tokens or from \`MTC\` in a name** (round 5). A protocol name with "flow comp" or "0 flow comp", or a bare "MT" in a description, is not evidence.
- **Never cite a token the header does not hold.** If you write \`SequenceVariant MTC\`, the packet's sequence_variant must contain MTC.

### Philips and GE inversion-prepared 3D T1 is MPRAGE

- **Philips 3D TFE:** ScanningSequence GR, MRAcquisitionType 3D, ImageType \`M_FFE\` or \`FFE\`, TR about 7 to 10 ms, flip about 8, names such as \`T1W_3D_TFE\`, \`sT1W_3D_TFE\`, \`3D T1 TFE\`. **Its prepulse decides** (round 6, item 1, which replaces round 3's case 17 reading): \`header.private.philips_prepulse_type\` \`INV\` or \`BBI\` is **MPRAGE**, base **T1w**; \`NO\`, \`SAT\` or \`ECHO\` is **FSP-GRE**, whatever InversionRecovery or \`MP\` say. Where the packet has no prepulse type, an inversion time or \`philips_prepulse_delay\` above 0 makes MPRAGE, then SequenceVariant \`MP\` does; with neither it is can't tell. A long echo train length is the TFE shot length, not a multi-echo train.
- **GE IR-FSPGR, BRAVO, \`EFGRE3D\`, \`FSPGR\` with \`IR_GEMS\` or ScanningSequence with IR, TI about 400 to 1000 ms, 3D:** technique **MPRAGE**, base T1w. A reformat of it keeps MPRAGE, **except** a reformat named a Cube FLAIR and not named T1, which is can't tell on technique, modifier and base (round 6, item 3).
- **The inversion of an MPRAGE or MP2RAGE belongs to the technique.** Never add an IR modifier to it.

### SyMRI, MAGiC and MDME

- **The acquisition's own images are RawRecon with technique MDME:** Philips \`SyMRI Qmap ...\` series with ImageType \`ORIGINAL\\PRIMARY\\M_SE\\...\` (magnitude echoes) or \`ORIGINAL\\PRIMARY\\PHASE MAP\\P\\...\` (phase), split by echo, with several temporal positions; Siemens \`*tir2d2_5\` or a name with SyMRI or QRAPMASTER and ImageType ORIGINAL; GE MAGiC \`ORIGINAL\`. Provenance **RawRecon** even when the name says SyMRI or Qmap. Technique **MDME**, never IR-TSE, SE or TSE.
- **Their construct comes from ImageType:** Phase where it holds \`P\` or \`PHASE\`; never Qmap, MultiQmap or a map construct on an acquisition image. A GE MAGiC or MDME ORIGINAL image with \`ge_private_image_type\` 2 is **Real** (round 6, item 2).
- **The exam's name reaches only the MDME acquisition:** another acquisition in a MAGiC-, SyMRI- or QMap-named exam (a BRAVO, a FLAIR) is read as itself, with its own base (D10, narrowed after the protocol sweep).
- **MDME's short saturation delay (TI about 20 to 150 ms) is part of the technique.** No STIR or IR modifier on it.
- **SyMRI provenance only for what the software computed:** a synthetic contrast (ImageType DERIVED, "Synthetic", "SE Synthetic", a synthetic T2 or FLAIR; construct SyntheticT2w, SyntheticFLAIR and so on) or a computed map (T1, T2, PD, R1 map; construct by the map). A map has no base (round 5); SyMRI's EPW, NON, NAC and ICV maps are Qmap; a SyMRI stack saved in colour (PhotometricInterpretation RGB or YBR, or three samples a pixel) is a display composite, read as a SyMRI screenshot (D4; round 6, item 11).

### Spin echo, TSE and their relatives

- **Dual-echo TSE is TSE.** Siemens \`tse2-5\`, \`*tse2d2\`, a PD/T2 pair split by echo with an echo train: technique TSE, base by the echo (PDw below TE 40 ms, T2w at 40 ms or more). Never SE, never ME-SE.
- **SE only with no echo train:** echo train length 0 or 1. With an echo train of 2 or more it is TSE, and it is not SS-TSE unless the header says single shot (HASTE, SSFSE, SS_GEMS with the whole k-space in one shot, "single shot").
- **A 2D FSE-IR or FLAIR** (GE \`FAST_GEMS\` with IR, TI about 2000 to 2500, or ScanningSequence SE\\IR with an echo train) is IR-TSE, not SE or SS-TSE. A STIR with an echo train (TI about 150 to 200, ETL 10 or more) is IR-TSE with modifier STIR.
- **A 3D inversion TSE** (3D, echo train over 100, DIR or FLAIR) is 3D-TSE, not the 2D IR-TSE.
- **GE fast recovery is decided by the \`FR_GEMS\` option** (round-3 conflict 2, which replaces D11): a GE FSE or PROPELLER with \`FR_GEMS\` is **VFA-TSE** (the pack's RESTORE family; a PROPELLER with Radial); with an inversion as well (\`IR_GEMS\`, or a TI over 0) it is **IR-TSE** first; an FRFSE pulse sequence name (\`header.private.ge_pulse_sequence_name\`) or a fast-recovery word **without** \`FR_GEMS\` is **TSE**. GE Cube stays 3D-TSE.
- **Siemens RESTORE only from \`*tseR\`, \`*tseBR\` or \`*tseBNR\`:** an R right after \`tse\` (for example \`*tseR2d1rs16\`), or after the B or the BN of a BLADE (\`*tseBR2d1\`, N12; \`*tseBNR2d1\`, record 48 after dev-8), is RESTORE, VFA-TSE. \`*tseBN\` without the R is TSE, and \`*tseBNIR\` (an inversion, written IR) is IR-TSE. The letters after the echo train number (\`*tse2d1rs15\`) are not.

### Diffusion and EPI

- **A diffusion acquisition read out by an EPI** (EP, b values over 0, diffusion directions; Philips DTI or DWI names; Philips \`DwiSE\`) is DWI-EPI. Never SS-TSE or SE-EPI.
- **A diffusion read out by a turbo spin echo, not an EPI** (PROPELLER, BLADE or MultiVane DWI, a HASTE diffusion, Philips DWI-TSE: a diffusion with a spin-echo train and no EP) is **DWI-TSE** (N3).
- **An ADC or trace computed by the scanner from a plain DWI** is provenance RawRecon, technique the source's (DWI-EPI, or DWI-TSE for a TSE readout), construct ADC or Trace, base DWI.
- **The ADC or eADC of a Siemens or Philips DTI is DTIRecon** (DR4): six or more directions, mddw, DTI or tensor in the sequence or name, or an FA, colour FA or TENSOR output of the same acquisition beside it. Its trace-weighted image stays RawRecon with Trace. GE's ADC stays RawRecon; GE's AvDC is DTIRecon with construct MD (D3).
- **A 3D segmented FID EPI** (\`epfid3d1\`) is GRE-EPI, not plain EPI or MS-EPI.
- **A Philips diffusion set with private direction \`I\`** that holds more images than slices of two or more directions holds the b=0 and the directional images beside the isotropic one: a diffusion set, **no Trace**, registered (\`Reg - DWI\`) or not (C3; round 6, item 7). A stack whose images are all ISOTROPIC (\`diffusion_directionality_all\`; b=0 images written NONE beside them allowed), never beside DIRECTIONAL, is **Trace**.
- **A GE reversed-phase EPI** of 10 volumes or fewer beside opposite-direction diffusion is FieldmapRef where every b value is 50 or less, a diffusion where any is 100 or more, and can't tell on construct between (round 6, item 11).

### Gradient echo

- **A multi-echo FFE split by echo** (an MT-weighted or PD-weighted multi-echo series, or one echo of a Philips mFFE at its own echo time, one echo per stack) is ME-GRE (DR10). comb-ME-GRE is only the combined image. A single-echo FFE is read by DR1 (Spoiling, SequenceVariant, the private scan technique, then the name).
- **Echo combinations** (round 5, the protocol sweep and round 6): a GE SWAN output written one image per slice, a Siemens SWI output named \`_Combined\`, and the SWI image and minIP of a two-echo Siemens \`fl3d2r\` are **comb-ME-GRE**; the combined SWI image and its minIP keep base **SWI**. A two-echo \`fl3d2r\` or \`fm2d2r\` component kept apart is ME-GRE. A gradient-echo real or imaginary component (Philips \`R_FFE\`, \`I_FFE\`) without PSIR evidence has no base. An R2\\* map is SWIRecon with R2starmap and base none. A GE \`efgre3d\` without SP at a flip of 40° or more and TR under 10 ms is bSSFP.

### Provenance: scouts, reformats and copies

- **Surveys and scouts (round 3, R3-LOC; DR6 after the vendor flags):** a vendor flag makes a Localizer whatever its slice count: \`header.private.ge_series_plane\` 256, ImageType \`LOCALIZER\`, \`SCOUT\` or \`POSDISP\`, an automatic planning scout (Siemens AutoAlign \`AAHead_Scout\` and its MPRs, Philips \`SmartBrain\`, GE READYBrain), or a series split into planes (one stack per orientation) and named for planning. Without a vendor flag, a series of at most 5 slices per plane is Localizer when a planning word names it (\`SUR\`, \`/SUR\`, \`SUR+\`, \`Survey\`, \`3-pl\`, loc, scout, plan, pilot, align), even when the rest of the name reads like a diagnostic series (\`T2W_TSE/SUR\`); few slices without a planning word is cant_tell; more than 5 slices per plane with a planning word and no vendor flag is no localizer. Siemens FastView is a survey (V28, after the protocol sweep); a sequence named \`scout\` alone, with no planning word and more than 5 slices a plane, is no localizer.
- **Not scouts:** a stack with a diagnostic number of slices (for example 30) is not a localizer because its name says "repos" or "slice"; a stitched composite (Philips \`MobiView\`, Siemens \`COMPOSED\`, \`COMP_AD\`) is ProjectionDerived with construct Composed, not a localizer, unless it is a composite of survey stations (round-3 conflict 1); a GE \`SC:\` prefix is a copy or screen save of the series it names, not a scout.
- **Reformats:** ImageType \`REFORMATTED\`, \`MPR\`, or Philips \`DERIVED\` or \`SECONDARY\` with \`PROJECTION IMAGE\` on a view of a 3D series (\`VSag\`, \`VCor\`, "rek", "MPR") is ProjectionDerived with construct MPR. \`<MPR Thick Range>\` is MPR, not MIP; MIP needs MIP in the words or ImageType, and a Siemens image's own \`CSA MPR\` or \`CSA MIP\` token outranks the series name (round 3, case 3). Philips \`MAXIMUM\` is a MIP only at 3 slices or fewer or a slab of 10 mm or more (round 3, case 2).
- **A reformat's technique and base are its source's** when the header or the session list shows the source (a CUBE FLAIR reformat is 3D-TSE with FLAIR; an MPRAGE reformat is MPRAGE). Answer cant_tell only when the source cannot be told. A reformat keeps its source's PSIR and Real (a Siemens MPR beside a real-IR source) and its BlackBlood (beside a DANTE-named source; the final certificate's X9 readings).

### Post-contrast

- **Given** when the words name contrast in any language or form: \`+C\`, \`Gd\`, \`GD\`, \`KM\`, \`med K\`, \`mdc\` (mezzo di contrasto), an agent and a volume in ImageComments (\`19 ML Clariscan iv.\`), or ContrastBolusAgent filled.
- **Session order counts:** a series acquired after the session's first contrast series is given, whatever its own name says (a STIR after the +Gd series is given). A series acquired before it, and a reformat of such a series, is not_given.
- **A ProtocolName that names the whole exam** (\`MS+GD\`, \`MS -/+ gd\`) says nothing about this series. Use the series' own words and its place in the session.

### Confidence

- can't tell always carries confidence \`low\`.
- \`high\` only when a header fact you name settles the value.

## The vocabulary (pack mri, with the values of 2026-09-30 and pack 0.21.0)

### provenance
Where the stack comes from. Single value.

- \`SyMRI\`: synthetic MRI, MAGiC, SyMRI, SyntAc
- \`NeuroMix\`: GE NeuroMix, a rapid multicontrast examination of single-shot EPI and single-shot fast spin echo blocks, and each of its outputs; NeuroMix, \`ksneuromix\`
- \`EPIMix\`: EPIMix, and each of its outputs
- \`STAGE\`: strategically acquired gradient echo
- \`SWIRecon\`: SWI reconstruction, SWAN, SWI
- \`DTIRecon\`: diffusion reconstruction, tensor, DTI
- \`PerfusionRecon\`: perfusion reconstruction, perfusion maps
- \`ASLRecon\`: ASL reconstruction, CBF from ASL
- \`BOLDRecon\`: BOLD reconstruction, fMRI maps
- \`Calibration\`: a coil-sensitivity, receive-field or prescan reference image acquired to support reconstruction or correction, not for reading (ASSET, ARC or PURE calibration, SENSE reference scan, prescan normalize reference; by the name, never DERIVED); base none
- \`Localizer\`: localizer, localiser, scout, survey, tri-pilot, 3-plane localizer, AAHead_Scout, pilot
- \`ProjectionDerived\`: projection, MIP, MinIP, MPR, reformat
- \`SubtractionDerived\`: subtraction, SUB, post minus pre
- \`RawRecon\`: acquired, scanner reconstruction, original acquisition, raw

### technique
The acquisition technique (pulse sequence). Single value. Pick the most specific value the header supports, within the right family.

- \`MRS\` (family OTHER): magnetic resonance spectroscopy (single voxel or chemical shift imaging): a spectrum, or the images a scanner writes of one, with no image contrast; base none; PROBE, SVS, PRESS, CSI, a few images named for spectroscopy, an MR Spectroscopy Storage object
- \`MS-EPI\` (vendor/v0 name RESOLVE; family EPI): readout-segmented EPI, readout segmented, IRIS, MUSE, rs-EPI, segmented EPI DWI
- \`DWI-TSE\` (family SE): diffusion-weighted imaging read out by a turbo spin echo, not an EPI; PROPELLER, BLADE or MultiVane DWI, HASTE diffusion, Philips DWI-TSE
- \`DWI-EPI\` (family MIXED): ep2d_diff, diffusion weighted EPI, SS-EPI DWI
- \`DWI-STEAM\` (family MIXED)
- \`BOLD-EPI\` (vendor/v0 name BOLD; family MIXED): ep2d_bold, fMRI EPI, BOLD
- \`ZTE\` (family GRE): a zero echo time 3D radial readout (GE Silenz, Siemens PETRA); with an arterial spin labelling preparation, GE Silent MRA; modifier Radial; a Silent MRA has no base
- \`ASL\` (vendor/v0 name ASL; family MIXED): arterial spin labeling, arterial spin labelling, 3D ASL, pCASL, PASL, 3D GRASE ASL, spiral ASL. arterial spin labelling perfusion, any readout (3D GRASE, 3D spiral FSE, EPI)
- \`DCE\` (family GRE): dynamic contrast enhanced, DCE-MRI, DCE perfusion, permeability. dynamic contrast enhanced perfusion: a T1-weighted 3D spoiled gradient echo repeated through a bolus
- \`Perfusion-EPI\` (vendor/v0 name Perfusion; family EPI): ep2d_perf, DSC perfusion, dynamic susceptibility contrast, bolus tracking. dynamic susceptibility contrast (DSC) perfusion, a gradient- or spin-echo EPI through a bolus
- \`GRASE\` (family MIXED): gradient and spin echo, TGSE, Hybrid EPI
- \`SE-EPI\` (family MIXED)
- \`GRE-EPI\` (family MIXED)
- \`MRF\` (family MIXED): MR fingerprinting, magnetic resonance fingerprinting
- \`MDME\` (family SE): QRAPMASTER, MAGiC, SyMRI acquisition, SyntAc
- \`MAVRIC\` (family SE)
- \`3D-TSE\` (vendor/v0 name SPACE; family SE): SPACE, CUBE, VISTA, 3D TSE, 3D FSE, MVOX, isoFSE, 3D FLAIR TSE
- \`SS-TSE\` (vendor/v0 name HASTE; family SE): HASTE, SSFSE, SSh TSE, single shot TSE, FASE, single-shot FSE
- \`IR-TSE\` (vendor/v0 name TIRM; family SE): TIRM, FSE-IR, IR TSE, TSE-IR, turbo inversion recovery, TIR, FastIR, Fast IR
- \`ME-SE\` (vendor/v0 name MESE; family SE): multi-echo spin echo, MESE, dual echo SE, double echo TSE
- \`VFA-TSE\` (vendor/v0 name RESTORE; family SE): RESTORE, FRFSE, DRIVE, T2 Plus, driven equilibrium, fast recovery FSE, DE-FSE, DE-FIR. 90-degree flip-back (driven equilibrium) turbo spin echo
- \`TSE\` (family SE): turbo spin echo, fast spin echo, FSE, TSE, RARE
- \`SE\` (family SE): spin echo, SE, conventional spin echo
- \`QALAS\` (family GRE): 3D-QALAS
- \`MP2RAGE\` (family GRE): MP2RAGE, MP2 RAGE
- \`MEMPRAGE\` (family GRE): multi-echo MPRAGE, ME-MPRAGE
- \`MPRAGE\` (family GRE): MPRAGE, MP-RAGE, MP RAGE, BRAVO, FSPGR BRAVO, IR-FSPGR, 3D IR-FSPGR, 3D TFE. 3D inversion-prepared rapid gradient echo (T1-weighted)
- \`CE-MRA\` (family GRE): contrast-enhanced MR angiography, a T1-weighted 3D spoiled gradient echo timed to the arterial bolus, single phase or time resolved; base T1w; TRICKS, TWIST, 4D-TRAK, bolus chase, a named CE-MRA, \`VASCTOF_GEMS\` with a contrast agent or multiphase
- \`TOF-MRA\` (vendor/v0 name TOF; family GRE): time-of-flight, TOF MRA, inflow angiography, Inhance Inflow
- \`PC-MRA\` (vendor/v0 name PC; family GRE): phase-contrast MRA, PC angio, Qflow, 4D flow, flow quantification
- \`comb-ME-GRE\` (vendor/v0 name MEDIC; family GRE): MEDIC, MERGE, mFFE, M-FFE, combined multi-echo GRE, mEcho, ADAGE
- \`ME-GRE\` (vendor/v0 name MEGRE; family GRE): multi-echo GRE, MEGRE, multi-echo gradient echo
- \`CISS\` (family GRE): CISS, FIESTA-C, PBSG, Phase Balanced SARGE
- \`bSSFP\` (vendor/v0 name FIESTA; family GRE): TrueFISP, FIESTA, balanced FFE, bFFE, True SSFP, balanced SSFP, trufi, BASG
- \`DESS\` (family GRE): double echo steady state, MENSA
- \`SSFP\` (vendor/v0 name PSIF; family GRE): PSIF, T2-FFE, CE-FAST, reversed FISP, TRSG
- \`VFA-GRE\` (family GRE): DESPOT, variable flip angle GRE
- \`VI-GRE\` (vendor/v0 name VIBE; family GRE): VIBE, LAVA, THRIVE, Quick 3D, TIGRE, volumetric interpolated
- \`FSP-GRE\` (vendor/v0 name TurboFLASH; family GRE): TurboFLASH, FSPGR, TFE, turbo field echo, fast SPGR, TFL, Fast FE, FastFE
- \`SP-GRE\` (vendor/v0 name FLASH; family GRE): FLASH, SPGR, T1-FFE, spoiled gradient echo, spoiled GRE, RSSG
- \`SS-GRE\` (vendor/v0 name FISP; family GRE): FISP, GRASS, FFE, steady state GRE, SARGE, Rephased SARGE
- \`GRE\` (family GRE): gradient echo, gradient recalled echo, field echo, FE
- \`EPI\` (family EPI): echo planar, echo-planar imaging

### modifier
Preparations and trajectories added to the technique. A list (several allowed); [] means none.

- \`FLAIR\` (at most one of group IR_CONTRAST): fluid attenuated inversion recovery, dark fluid, darkfluid, T2 FLAIR, T1 FLAIR, FastFLAIR
- \`STIR\` (at most one of group IR_CONTRAST): short tau inversion recovery, short TI inversion recovery, FastSTIR
- \`DIR\` (at most one of group IR_CONTRAST): double inversion recovery, double IR
- \`PSIR\` (at most one of group IR_CONTRAST): phase sensitive inversion recovery
- \`IR\` (at most one of group IR_CONTRAST): inversion recovery, inversion prepared, IR prepared
- \`Radial\` (at most one of group TRAJECTORY): PROPELLER, BLADE, MultiVane, JET, radial, RADAR. rotating blades (PROPELLER, BLADE) or radial k-space
- \`Spiral\` (at most one of group TRAJECTORY): spiral
- \`FatSat\`: fat saturation, fat suppression, fat suppressed, fat sat, SPIR, SPAIR, ChemSat, FS
- \`WaterExcitation\` (vendor/v0 name WaterExc): water excitation, ProSet, WE, PASTA
- \`Dixon\`: Dixon, mDIXON, IDEAL, LAVA-Flex, Flex, VIBE-Dixon, two-point Dixon, WFS
- \`MT\`: magnetization transfer, MT pulse, MTC
- \`FlowComp\`: flow compensation, flow comp, gradient moment nulling, GMN
- \`BlackBlood\`: black blood, dark blood, DANTE, vessel wall
- \`BrightBlood\`: bright blood
- \`MoCo\`: motion corrected, MoCo

### construct
What the image is of beyond a plain acquisition (maps, projections, Dixon parts, MP2RAGE outputs, ND). A list; [] means none.

- \`ADC\`: apparent diffusion coefficient, ADC map
- \`eADC\`: exponential ADC, eADC
- \`FA\`: fractional anisotropy, FA map, color FA, colFA
- \`Trace\`: trace weighted, TRACEW, isotropic DWI, combined b, DIFFUSION_ISO
- \`MD\`: mean diffusivity
- \`CBF\`: cerebral blood flow, rCBF
- \`CBV\`: cerebral blood volume, rCBV
- \`MTT\`: mean transit time
- \`Tmax\`: time to maximum, Tmax
- \`TTP\`: time to peak
- \`PBP\`: the percentage of baseline at peak of a DSC bolus, the peak signal drop relative to baseline (Siemens inline perfusion), a surrogate of blood volume and no CBV; \`PBP\`, percentage of baseline
- \`K2\`: the leakage coefficient of a DSC, from a leakage-corrected fit; K2, rLeakage, leakage
- \`DeltaM\`: the ASL perfusion-weighted image, control minus label, subtracted by the scanner; \`SUB\`, perfusion_weighted, Siemens \`TTEST\` on an ASL output
- \`M0\`: the ASL M0 (equilibrium magnetisation) scan a CBF quantification divides by; M0, a proton-density reference pass of an ASL
- \`Water\`: Dixon water, water only
- \`Fat\`: Dixon fat, fat only
- \`InPhase\`: in phase, in-phase, IP
- \`OutPhase\`: opposed phase, out of phase, out-phase, OP
- \`T1map\` (at most one of group QUANT_MAP): T1 map, T1 mapping, T1 relaxometry
- \`T2map\` (at most one of group QUANT_MAP): T2 map, T2 mapping, T2 relaxometry
- \`R1map\` (at most one of group QUANT_MAP): R1 map
- \`R2map\` (at most one of group QUANT_MAP): R2 map
- \`PDmap\` (at most one of group QUANT_MAP): PD map, proton density map
- \`Qmap\` (at most one of group QUANT_MAP): quantitative map, qMap
- \`SyntheticT1w\`: synthetic T1, SyMRI T1
- \`SyntheticT2w\`: synthetic T2, SyMRI T2
- \`SyntheticFLAIR\`: synthetic FLAIR, SyMRI FLAIR
- \`SyntheticPDw\`: synthetic PD, SyMRI PD
- \`MyelinMap\`: myelin water fraction, MWF, myelin map, MyC
- \`QSM\`: quantitative susceptibility mapping, susceptibility map, QSM
- \`MIP\`: maximum intensity projection, MIP
- \`MinIP\`: minimum intensity projection, mIP, MinIP
- \`StdDevProj\`: a standard deviation projection through a volume; \`STDDEV_COR\`, \`STDDEV_SAG\`, \`STDDEV_TRA\`
- \`StdDevTime\`: the voxelwise standard deviation over the measurements or time points of a series, a temporal map and no spatial projection; Siemens \`STDDEV_TIME\`; ProjectionDerived, base none
- \`MPR\`: multiplanar reformat, MPR, reformat
- \`SBRef\`: the single-band reference image of a multiband EPI run; SBRef in the name or image type
- \`FieldmapRef\`: an EPI of a few volumes with the phase encoding reversed, for distortion correction; fieldmap, TOPUP, reverse, blip, pepolar, or a b=0 EPI of a few volumes reversed against the session's diffusion (DR7)
- \`B0map\`: B0 map, field map, fieldmap
- \`B1map\`: B1 map, flip angle map
- \`Composed\`: composed, composite, composing, stitched
- \`EchoCombined\`: echo combined, combined echoes
- \`TTestMap\`: t-test map, t map, statistical map
- \`Velocity\`: the velocity image of a phase-contrast acquisition, the phase difference scaled to velocity by the encoding velocity; base none; a phase contrast's velocity, VENC or phase image (not its magnitude)
- \`Speed\`: the angiogram of a phase-contrast acquisition, the magnitude of the velocity vector or the complex difference, neither a signed velocity component nor a tissue magnitude; the Philips PCA angiogram; base none
- \`Magnitude\`: magnitude, magnitude image
- \`Real\`: real, real part
- \`Imaginary\`: imaginary, imaginary part
- \`ORIG\`: original
- \`Filtered\`: filtered
- \`ND\`: no distortion correction, not distortion corrected
- \`INV1\`: first inversion, MP2RAGE INV1
- \`INV2\`: second inversion, MP2RAGE INV2
- \`Uniform\`: UNI, uniform image, MP2RAGE UNI
- \`UniformDenoised\` (vendor/v0 name Denoised): UNI-DEN, UNI denoised, MP2RAGE UNI-DEN
- \`SWI\`: susceptibility weighted imaging, SWI, SWAN, SWIp, VenoBOLD, FSBB, eFSBB, BSI
- \`Phase\`: phase, phase image
- \`R2starmap\`: R2* map, R2star map, R2* relaxation rate map
- \`SyntheticSTIR\`: synthetic STIR, SyMRI STIR
- \`SyntheticDIR\`: synthetic DIR, SyMRI DIR
- \`SyntheticPSIR\`: synthetic PSIR, SyMRI PSIR
- \`FatFraction\`: fat fraction, PDFF, proton density fat fraction
- \`MultiQmap\`: multiple quantitative maps, qmaps
- \`isoDWI\`: not used; the isotropic image is Trace (D9)

### base
The contrast weighting the image carries. Single value, or "none" where the axis has no value (MP2RAGE INV1 and INV2).

- \`DWI\`: diffusion weighted, DWI, DTI
- \`PWI\`: perfusion weighted, PWI, DSC, DCE, ASL
- \`SWI\`: susceptibility weighted, SWI, SWAN
- \`T1rho\`: T1 rho, spin lock
- \`T2rho\`: T2 rho
- \`T2starw\` (vendor/v0 name T2*w): T2*, T2 star, T2star weighted, GRE T2*
- \`T2w\`: T2, T2 weighted
- \`PDw\`: PD, proton density weighted
- \`T1w\`: T1, T1 weighted
- \`MTw\`: MT weighted, magnetization transfer weighted

### body_part
What the stack is centred on and covers. Single value.

- \`neck\`: neck, soft tissue neck
- \`spine\`: spine, spinal cord, cervical spine, thoracic spine, lumbar spine, C-spine, T-spine, L-spine
- \`brain\`: brain, head, neuro. the brain, the stack ending at or above C2
- \`brain-neck\`: head and neck, head-neck, brain and neck, brain and cervical spine. the brain and the neck: the stack covers the brain and reaches below C2
- \`chest\`: chest, thorax, lungs
- \`other\`: unknown, other body part, phantom, whole body. none of the others, or not known: another part of the body, a phantom, a stack over several parts, or one whose coverage cannot be named

### post_contrast
Whether a contrast agent had been given when the stack was acquired.

- \`given\`: post contrast, post-contrast, contrast enhanced, gadolinium, Gd, +C, CE, post gad
- \`not_given\`: pre contrast, pre-contrast, native, non-contrast, no contrast, plain, pre gad

## Rules the answer must obey (the pack's constraints)

Implications (if the left side holds, the right side must hold; an answer contradicting one is refused):
- if construct is INV1 or construct is INV2 or construct is Uniform or construct is UniformDenoised then technique is MP2RAGE
- if construct is Water or construct is Fat then modifier is Dixon
- if technique is MPRAGE then base is T1w
- if technique is MEMPRAGE then base is T1w
- if technique is MP2RAGE and not (construct is INV1) and not (construct is INV2) and not (construct is T1map) and not (construct is R1map) then base is T1w
- if technique is TOF-MRA then base is T1w
- if technique is comb-ME-GRE and not (construct is Phase) and not (construct is Velocity) and not (construct is SWI) and not (construct is MinIP) and not (construct is MIP) and not (construct is QSM) and not (construct is R2starmap) and not (construct is B0map) and not (provenance is SWIRecon) then base is T2starw
- if technique is DWI-EPI then base is DWI
- if technique is ASL and not (construct is M0) then base is PWI
- if technique is Perfusion-EPI and not (base is T2starw) then base is PWI
- if technique is DCE then base is PWI
- if construct is ADC or construct is eADC or construct is FA or construct is MD or construct is Trace or construct is isoDWI then base is DWI
- if construct is CBF or construct is CBV or construct is MTT or construct is Tmax or construct is TTP then base is PWI
- if construct is SWI then base is SWI
- if technique is Perfusion-EPI or technique is DCE then post_contrast is given
- if construct is INV1 or construct is INV2 then base is none

Exclusions (an answer holding both sides is refused):
- if construct is SWI then technique is not any of MDME, MAVRIC, 3D-TSE, SS-TSE, IR-TSE, ME-SE, VFA-TSE, TSE, SE (a susceptibility-weighted image needs gradient-echo phase, which a spin echo refocuses away)
- if base is SWI then technique is not any of MDME, MAVRIC, 3D-TSE, SS-TSE, IR-TSE, ME-SE, VFA-TSE, TSE, SE (a susceptibility-weighted image needs gradient-echo phase, which a spin echo refocuses away)
- if base is T2starw then technique is not any of MDME, MAVRIC, 3D-TSE, SS-TSE, IR-TSE, ME-SE, VFA-TSE, TSE, SE (T2* weighting is seen only with a gradient echo; the 180-degree pulse of a spin echo reverses it)
- if construct is QSM or construct is R2starmap then technique is not any of MDME, MAVRIC, 3D-TSE, SS-TSE, IR-TSE, ME-SE, VFA-TSE, TSE, SE (susceptibility and R2* maps are computed from gradient-echo phase or decay, which a spin echo refocuses away)
- if technique is TOF-MRA then base is not any of T2w (a time-of-flight angiogram is a short-TR spoiled gradient echo, never T2-weighted)
- if construct is MIP or construct is MinIP then provenance is not any of Localizer, RawRecon (an intensity projection is computed from a volume, so it is neither a raw reconstruction nor a localizer)

Groups: at most one value from each: modifier TRAJECTORY: Radial, Spiral; modifier IR_CONTRAST: FLAIR, STIR, DIR, PSIR, IR; construct QUANT_MAP: T1map, T2map, R1map, R2map, PDmap, Qmap

Hints (usual, not always; follow the header where it says otherwise):
- if technique is BOLD-EPI then usually base T2starw: gradient-echo BOLD is T2*-weighted; spin-echo BOLD (SE-EPI, 3D GRASE at 7 T) is T2-weighted
- if technique is ME-GRE and not (modifier is Dixon) and not (construct is InPhase) and not (construct is OutPhase) then usually base T2starw: a multi-echo GRE is usually T2*-weighted; a Dixon or an in and opposed phase one is T1-weighted
- if modifier is STIR then usually post_contrast not_given: STIR suppresses anything with a short T1, gadolinium-enhanced tissue too, so it is acquired before contrast; it is sometimes repeated after
- if technique is ASL then usually post_contrast not_given: gadolinium shortens the blood T1 the labelling relies on, so ASL is acquired before contrast
- if construct is SyntheticT1w or construct is SyntheticT2w or construct is SyntheticFLAIR or construct is SyntheticPDw or construct is SyntheticSTIR or construct is SyntheticDIR or construct is SyntheticPSIR then usually provenance SyMRI: a synthetic contrast is usually synthesised from quantitative maps (MDME, MAGiC, SyntAc, QALAS); MR fingerprinting and learned synthesis make them too
- if modifier is PSIR then usually base T1w: phase-sensitive inversion recovery is usually T1-weighted; a 3D real IR with a very long TR is heavily T2-weighted
- if modifier is DIR then usually base T2w: a double inversion recovery of the brain is T2-weighted (one source)
- if technique is SS-TSE then usually base T2w: a single-shot TSE (HASTE) is typically T2-weighted; an inversion-prepared one can be T1-weighted

## The answer

Answer with one JSON object and nothing else:

\`\`\`
{"provenance":    {"reason": "<one short sentence naming the header tags and values used>", "value": "<value or cant_tell>", "confidence": "high | medium | low"},
 "technique":     {"reason": "...", "value": "<value or cant_tell>", "confidence": "high | medium | low"},
 "modifier":      {"reason": "...", "value": ["<value>", ...] or "cant_tell", "confidence": "..."},
 "construct":     {"reason": "...", "value": ["<value>", ...] or "cant_tell", "confidence": "..."},
 "base":          {"reason": "...", "value": "<value, none or cant_tell>", "confidence": "..."},
 "body_part":     {"reason": "...", "value": "<value or cant_tell>", "confidence": "high | medium | low"},
 "post_contrast": {"reason": "...", "value": "given | not_given | cant_tell", "confidence": "..."},
 "unsure": false}
\`\`\`

Use the value names exactly as the vocabulary writes them (for example \`SP-GRE\`, not FLASH; \`IR-TSE\`, not TIRM; \`T2starw\`, not T2*). Write the reason first, then the value that follows from it, then your confidence in that value. The reason names the header facts you used, as tags with their values (for example \`ScanOptions FS\`, \`TI 2500\`, \`SequenceName *me2d1r3\`, \`ImageType ND\`, \`SeriesDescription "t1 +gd"\`), so a wrong answer can be traced to its cause; keep it under 30 words. Confidence is \`high\` when the header settles the value, \`medium\` when it points to it but a careful reader could hesitate, \`low\` when you lean one way on thin evidence; a value you cannot tell is \`cant_tell\` (confidence \`low\`), not a guess. Before you answer, check the traps section for every token and name in this header. Set "unsure" to true if you answered every axis but would not stake the stack on it.
`;

/** schema.json: the answer's JSON schema. */
export const SCHEMA_TEXT = `{
 "type": "object",
 "properties": {
  "provenance": {
   "type": "object",
   "properties": {
    "reason": {
     "type": "string"
    },
    "value": {
     "type": "string",
     "enum": [
      "SyMRI",
      "NeuroMix",
      "EPIMix",
      "STAGE",
      "SWIRecon",
      "DTIRecon",
      "PerfusionRecon",
      "ASLRecon",
      "BOLDRecon",
      "Calibration",
      "Localizer",
      "ProjectionDerived",
      "SubtractionDerived",
      "RawRecon",
      "cant_tell"
     ]
    },
    "confidence": {
     "type": "string",
     "enum": [
      "high",
      "medium",
      "low"
     ]
    }
   },
   "required": [
    "reason",
    "value",
    "confidence"
   ],
   "additionalProperties": false
  },
  "technique": {
   "type": "object",
   "properties": {
    "reason": {
     "type": "string"
    },
    "value": {
     "type": "string",
     "enum": [
      "MRS",
      "MS-EPI",
      "DWI-TSE",
      "DWI-EPI",
      "DWI-STEAM",
      "BOLD-EPI",
      "ZTE",
      "ASL",
      "DCE",
      "Perfusion-EPI",
      "GRASE",
      "SE-EPI",
      "GRE-EPI",
      "MRF",
      "MDME",
      "MAVRIC",
      "3D-TSE",
      "SS-TSE",
      "IR-TSE",
      "ME-SE",
      "VFA-TSE",
      "TSE",
      "SE",
      "QALAS",
      "MP2RAGE",
      "MEMPRAGE",
      "MPRAGE",
      "CE-MRA",
      "TOF-MRA",
      "PC-MRA",
      "comb-ME-GRE",
      "ME-GRE",
      "CISS",
      "bSSFP",
      "DESS",
      "SSFP",
      "VFA-GRE",
      "VI-GRE",
      "FSP-GRE",
      "SP-GRE",
      "SS-GRE",
      "GRE",
      "EPI",
      "cant_tell"
     ]
    },
    "confidence": {
     "type": "string",
     "enum": [
      "high",
      "medium",
      "low"
     ]
    }
   },
   "required": [
    "reason",
    "value",
    "confidence"
   ],
   "additionalProperties": false
  },
  "modifier": {
   "type": "object",
   "properties": {
    "reason": {
     "type": "string"
    },
    "value": {
     "anyOf": [
      {
       "type": "array",
       "items": {
        "type": "string",
        "enum": [
         "FLAIR",
         "STIR",
         "DIR",
         "PSIR",
         "IR",
         "Radial",
         "Spiral",
         "FatSat",
         "WaterExcitation",
         "Dixon",
         "MT",
         "FlowComp",
         "BlackBlood",
         "BrightBlood",
         "MoCo"
        ]
       },
       "uniqueItems": true
      },
      {
       "type": "string",
       "enum": [
        "cant_tell"
       ]
      }
     ]
    },
    "confidence": {
     "type": "string",
     "enum": [
      "high",
      "medium",
      "low"
     ]
    }
   },
   "required": [
    "reason",
    "value",
    "confidence"
   ],
   "additionalProperties": false
  },
  "construct": {
   "type": "object",
   "properties": {
    "reason": {
     "type": "string"
    },
    "value": {
     "anyOf": [
      {
       "type": "array",
       "items": {
        "type": "string",
        "enum": [
         "ADC",
         "eADC",
         "FA",
         "Trace",
         "MD",
         "CBF",
         "CBV",
         "MTT",
         "Tmax",
         "TTP",
         "PBP",
         "K2",
         "DeltaM",
         "M0",
         "Water",
         "Fat",
         "InPhase",
         "OutPhase",
         "T1map",
         "T2map",
         "R1map",
         "R2map",
         "PDmap",
         "Qmap",
         "SyntheticT1w",
         "SyntheticT2w",
         "SyntheticFLAIR",
         "SyntheticPDw",
         "MyelinMap",
         "QSM",
         "MIP",
         "MinIP",
         "StdDevProj",
         "StdDevTime",
         "MPR",
         "SBRef",
         "FieldmapRef",
         "B0map",
         "B1map",
         "Composed",
         "EchoCombined",
         "TTestMap",
         "Velocity",
         "Speed",
         "Magnitude",
         "Real",
         "Imaginary",
         "ORIG",
         "Filtered",
         "ND",
         "INV1",
         "INV2",
         "Uniform",
         "UniformDenoised",
         "SWI",
         "Phase",
         "R2starmap",
         "SyntheticSTIR",
         "SyntheticDIR",
         "SyntheticPSIR",
         "FatFraction",
         "MultiQmap",
         "isoDWI"
        ]
       },
       "uniqueItems": true
      },
      {
       "type": "string",
       "enum": [
        "cant_tell"
       ]
      }
     ]
    },
    "confidence": {
     "type": "string",
     "enum": [
      "high",
      "medium",
      "low"
     ]
    }
   },
   "required": [
    "reason",
    "value",
    "confidence"
   ],
   "additionalProperties": false
  },
  "base": {
   "type": "object",
   "properties": {
    "reason": {
     "type": "string"
    },
    "value": {
     "type": "string",
     "enum": [
      "DWI",
      "PWI",
      "SWI",
      "T1rho",
      "T2rho",
      "T2starw",
      "T2w",
      "PDw",
      "T1w",
      "MTw",
      "none",
      "cant_tell"
     ]
    },
    "confidence": {
     "type": "string",
     "enum": [
      "high",
      "medium",
      "low"
     ]
    }
   },
   "required": [
    "reason",
    "value",
    "confidence"
   ],
   "additionalProperties": false
  },
  "body_part": {
   "type": "object",
   "properties": {
    "reason": {
     "type": "string"
    },
    "value": {
     "type": "string",
     "enum": [
      "neck",
      "spine",
      "brain",
      "brain-neck",
      "chest",
      "other",
      "cant_tell"
     ]
    },
    "confidence": {
     "type": "string",
     "enum": [
      "high",
      "medium",
      "low"
     ]
    }
   },
   "required": [
    "reason",
    "value",
    "confidence"
   ],
   "additionalProperties": false
  },
  "post_contrast": {
   "type": "object",
   "properties": {
    "reason": {
     "type": "string"
    },
    "value": {
     "type": "string",
     "enum": [
      "given",
      "not_given",
      "cant_tell"
     ]
    },
    "confidence": {
     "type": "string",
     "enum": [
      "high",
      "medium",
      "low"
     ]
    }
   },
   "required": [
    "reason",
    "value",
    "confidence"
   ],
   "additionalProperties": false
  },
  "unsure": {
   "type": "boolean"
  }
 },
 "required": [
  "provenance",
  "technique",
  "modifier",
  "construct",
  "base",
  "body_part",
  "post_contrast",
  "unsure"
 ],
 "additionalProperties": false
}`;

/** constraints.json: the pack's constraints the answer must obey. */
export const CONSTRAINTS_TEXT = `{
 "implications": [
  {
   "rule": "implied_technique/construct:mp2rage",
   "then": [
    {
     "axis": "technique",
     "value": "MP2RAGE"
    }
   ],
   "when": {
    "any": [
     {
      "is": "INV1",
      "axis": "construct"
     },
     {
      "is": "INV2",
      "axis": "construct"
     },
     {
      "is": "Uniform",
      "axis": "construct"
     },
     {
      "is": "UniformDenoised",
      "axis": "construct"
     }
    ]
   }
  },
  {
   "rule": "implied_modifier/construct:dixon",
   "then": [
    {
     "axis": "modifier",
     "value": "Dixon"
    }
   ],
   "when": {
    "any": [
     {
      "is": "Water",
      "axis": "construct"
     },
     {
      "is": "Fat",
      "axis": "construct"
     }
    ]
   }
  },
  {
   "rule": "base/technique:MPRAGE",
   "then": [
    {
     "axis": "base",
     "value": "T1w"
    }
   ],
   "when": {
    "is": "MPRAGE",
    "axis": "technique"
   }
  },
  {
   "rule": "base/technique:MEMPRAGE",
   "then": [
    {
     "axis": "base",
     "value": "T1w"
    }
   ],
   "when": {
    "is": "MEMPRAGE",
    "axis": "technique"
   }
  },
  {
   "rule": "base/technique:MP2RAGE (2026-09-27; pack 0.25.0, round 5: no base on a T1 or R1 map)",
   "when": {
    "all": [
     {
      "axis": "technique",
      "is": "MP2RAGE"
     },
     {
      "not": {
       "axis": "construct",
       "is": "INV1"
      }
     },
     {
      "not": {
       "axis": "construct",
       "is": "INV2"
      }
     },
     {
      "not": {
       "axis": "construct",
       "is": "T1map"
      }
     },
     {
      "not": {
       "axis": "construct",
       "is": "R1map"
      }
     }
    ]
   },
   "then": [
    {
     "axis": "base",
     "value": "T1w"
    }
   ]
  },
  {
   "rule": "base/technique:TOF-MRA",
   "then": [
    {
     "axis": "base",
     "value": "T1w"
    }
   ],
   "when": {
    "is": "TOF-MRA",
    "axis": "technique"
   }
  },
  {
   "rule": "base/technique:comb-ME-GRE (2026-10-01; pack 0.25.0: an acquired echo combination only)",
   "then": [
    {
     "axis": "base",
     "value": "T2starw"
    }
   ],
   "when": {
    "all": [
     {
      "axis": "technique",
      "is": "comb-ME-GRE"
     },
     {
      "not": {
       "axis": "construct",
       "is": "Phase"
      }
     },
     {
      "not": {
       "axis": "construct",
       "is": "Velocity"
      }
     },
     {
      "not": {
       "axis": "construct",
       "is": "SWI"
      }
     },
     {
      "not": {
       "axis": "construct",
       "is": "MinIP"
      }
     },
     {
      "not": {
       "axis": "construct",
       "is": "MIP"
      }
     },
     {
      "not": {
       "axis": "construct",
       "is": "QSM"
      }
     },
     {
      "not": {
       "axis": "construct",
       "is": "R2starmap"
      }
     },
     {
      "not": {
       "axis": "construct",
       "is": "B0map"
      }
     },
     {
      "not": {
       "axis": "provenance",
       "is": "SWIRecon"
      }
     }
    ]
   }
  },
  {
   "rule": "base/technique:DWI-EPI",
   "then": [
    {
     "axis": "base",
     "value": "DWI"
    }
   ],
   "when": {
    "is": "DWI-EPI",
    "axis": "technique"
   }
  },
  {
   "rule": "base/technique:ASL (2026-10-01)",
   "then": [
    {
     "axis": "base",
     "value": "PWI"
    }
   ],
   "when": {
    "all": [
     {
      "axis": "technique",
      "is": "ASL"
     },
     {
      "not": {
       "axis": "construct",
       "is": "M0"
      }
     }
    ]
   }
  },
  {
   "rule": "base/technique:Perfusion-EPI (2026-10-01)",
   "then": [
    {
     "axis": "base",
     "value": "PWI"
    }
   ],
   "when": {
    "all": [
     {
      "axis": "technique",
      "is": "Perfusion-EPI"
     },
     {
      "not": {
       "axis": "base",
       "is": "T2starw"
      }
     }
    ]
   }
  },
  {
   "rule": "base/technique:DCE",
   "then": [
    {
     "axis": "base",
     "value": "PWI"
    }
   ],
   "when": {
    "is": "DCE",
    "axis": "technique"
   }
  },
  {
   "rule": "base/construct:diffusion",
   "then": [
    {
     "axis": "base",
     "value": "DWI"
    }
   ],
   "when": {
    "any": [
     {
      "is": "ADC",
      "axis": "construct"
     },
     {
      "is": "eADC",
      "axis": "construct"
     },
     {
      "is": "FA",
      "axis": "construct"
     },
     {
      "is": "MD",
      "axis": "construct"
     },
     {
      "is": "Trace",
      "axis": "construct"
     },
     {
      "is": "isoDWI",
      "axis": "construct"
     }
    ]
   }
  },
  {
   "rule": "base/construct:perfusion",
   "then": [
    {
     "axis": "base",
     "value": "PWI"
    }
   ],
   "when": {
    "any": [
     {
      "is": "CBF",
      "axis": "construct"
     },
     {
      "is": "CBV",
      "axis": "construct"
     },
     {
      "is": "MTT",
      "axis": "construct"
     },
     {
      "is": "Tmax",
      "axis": "construct"
     },
     {
      "is": "TTP",
      "axis": "construct"
     }
    ]
   }
  },
  {
   "rule": "base/construct:swi",
   "then": [
    {
     "axis": "base",
     "value": "SWI"
    }
   ],
   "when": {
    "is": "SWI",
    "axis": "construct"
   }
  },
  {
   "rule": "post_contrast/perfusion",
   "then": [
    {
     "axis": "post_contrast",
     "value": "given"
    }
   ],
   "when": {
    "any": [
     {
      "is": "Perfusion-EPI",
      "axis": "technique"
     },
     {
      "is": "DCE",
      "axis": "technique"
     }
    ]
   }
  },
  {
   "rule": "base/construct:inv1-inv2 (2026-09-27)",
   "when": {
    "any": [
     {
      "axis": "construct",
      "is": "INV1"
     },
     {
      "axis": "construct",
      "is": "INV2"
     }
    ]
   },
   "then": [
    {
     "axis": "base",
     "value": "none"
    }
   ]
  }
 ],
 "excludes": [
  {
   "id": "swi-construct-not-spin-echo",
   "why": "a susceptibility-weighted image needs gradient-echo phase, which a spin echo refocuses away",
   "axis": "technique",
   "when": {
    "is": "SWI",
    "axis": "construct"
   },
   "values": [
    "MDME",
    "MAVRIC",
    "3D-TSE",
    "SS-TSE",
    "IR-TSE",
    "ME-SE",
    "VFA-TSE",
    "TSE",
    "SE"
   ]
  },
  {
   "id": "swi-base-not-spin-echo",
   "why": "a susceptibility-weighted image needs gradient-echo phase, which a spin echo refocuses away",
   "axis": "technique",
   "when": {
    "is": "SWI",
    "axis": "base"
   },
   "values": [
    "MDME",
    "MAVRIC",
    "3D-TSE",
    "SS-TSE",
    "IR-TSE",
    "ME-SE",
    "VFA-TSE",
    "TSE",
    "SE"
   ]
  },
  {
   "id": "t2star-not-spin-echo",
   "why": "T2* weighting is seen only with a gradient echo; the 180-degree pulse of a spin echo reverses it",
   "axis": "technique",
   "when": {
    "is": "T2starw",
    "axis": "base"
   },
   "values": [
    "MDME",
    "MAVRIC",
    "3D-TSE",
    "SS-TSE",
    "IR-TSE",
    "ME-SE",
    "VFA-TSE",
    "TSE",
    "SE"
   ]
  },
  {
   "id": "qsm-r2star-not-spin-echo",
   "why": "susceptibility and R2* maps are computed from gradient-echo phase or decay, which a spin echo refocuses away",
   "axis": "technique",
   "when": {
    "any": [
     {
      "is": "QSM",
      "axis": "construct"
     },
     {
      "is": "R2starmap",
      "axis": "construct"
     }
    ]
   },
   "values": [
    "MDME",
    "MAVRIC",
    "3D-TSE",
    "SS-TSE",
    "IR-TSE",
    "ME-SE",
    "VFA-TSE",
    "TSE",
    "SE"
   ]
  },
  {
   "id": "tof-not-t2w",
   "why": "a time-of-flight angiogram is a short-TR spoiled gradient echo, never T2-weighted",
   "axis": "base",
   "when": {
    "is": "TOF-MRA",
    "axis": "technique"
   },
   "values": [
    "T2w"
   ]
  },
  {
   "id": "projection-not-raw",
   "why": "an intensity projection is computed from a volume, so it is neither a raw reconstruction nor a localizer",
   "axis": "provenance",
   "when": {
    "any": [
     {
      "is": "MIP",
      "axis": "construct"
     },
     {
      "is": "MinIP",
      "axis": "construct"
     }
    ]
   },
   "values": [
    "Localizer",
    "RawRecon"
   ]
  }
 ],
 "groups": {
  "modifier": {
   "TRAJECTORY": [
    "Radial",
    "Spiral"
   ],
   "IR_CONTRAST": [
    "FLAIR",
    "STIR",
    "DIR",
    "PSIR",
    "IR"
   ]
  },
  "construct": {
   "QUANT_MAP": [
    "T1map",
    "T2map",
    "R1map",
    "R2map",
    "PDmap",
    "Qmap"
   ]
  }
 },
 "values": {
  "base": [
   "DWI",
   "PWI",
   "SWI",
   "T1rho",
   "T2rho",
   "T2starw",
   "T2w",
   "PDw",
   "T1w",
   "MTw",
   "Unknown"
  ],
  "modifier": [
   "FLAIR",
   "STIR",
   "DIR",
   "PSIR",
   "IR",
   "Radial",
   "Spiral",
   "FatSat",
   "WaterExcitation",
   "Dixon",
   "MT",
   "FlowComp",
   "BlackBlood",
   "BrightBlood",
   "MoCo"
  ],
  "body_part": [
   "neck",
   "spine",
   "brain",
   "brain-neck",
   "chest",
   "other"
  ],
  "construct": [
   "ADC",
   "eADC",
   "FA",
   "Trace",
   "MD",
   "CBF",
   "CBV",
   "MTT",
   "Tmax",
   "TTP",
   "PBP",
   "K2",
   "DeltaM",
   "M0",
   "Water",
   "Fat",
   "InPhase",
   "OutPhase",
   "T1map",
   "T2map",
   "R1map",
   "R2map",
   "PDmap",
   "Qmap",
   "SyntheticT1w",
   "SyntheticT2w",
   "SyntheticFLAIR",
   "SyntheticPDw",
   "MyelinMap",
   "QSM",
   "MIP",
   "MinIP",
   "StdDevProj",
   "StdDevTime",
   "MPR",
   "SBRef",
   "FieldmapRef",
   "B0map",
   "B1map",
   "Composed",
   "EchoCombined",
   "TTestMap",
   "Velocity",
   "Speed",
   "Magnitude",
   "Real",
   "Imaginary",
   "ORIG",
   "Filtered",
   "ND",
   "INV1",
   "INV2",
   "Uniform",
   "UniformDenoised",
   "SWI",
   "Phase",
   "R2starmap",
   "SyntheticSTIR",
   "SyntheticDIR",
   "SyntheticPSIR",
   "FatFraction",
   "MultiQmap",
   "isoDWI"
  ],
  "technique": [
   "MRS",
   "MS-EPI",
   "DWI-TSE",
   "DWI-EPI",
   "DWI-STEAM",
   "BOLD-EPI",
   "ZTE",
   "ASL",
   "DCE",
   "Perfusion-EPI",
   "GRASE",
   "SE-EPI",
   "GRE-EPI",
   "MRF",
   "MDME",
   "MAVRIC",
   "3D-TSE",
   "SS-TSE",
   "IR-TSE",
   "ME-SE",
   "VFA-TSE",
   "TSE",
   "SE",
   "QALAS",
   "MP2RAGE",
   "MEMPRAGE",
   "MPRAGE",
   "CE-MRA",
   "TOF-MRA",
   "PC-MRA",
   "comb-ME-GRE",
   "ME-GRE",
   "CISS",
   "bSSFP",
   "DESS",
   "SSFP",
   "VFA-GRE",
   "VI-GRE",
   "FSP-GRE",
   "SP-GRE",
   "SS-GRE",
   "GRE",
   "EPI"
  ],
  "provenance": [
   "SyMRI",
   "NeuroMix",
   "EPIMix",
   "STAGE",
   "SWIRecon",
   "DTIRecon",
   "PerfusionRecon",
   "ASLRecon",
   "BOLDRecon",
   "Calibration",
   "Localizer",
   "ProjectionDerived",
   "SubtractionDerived",
   "RawRecon"
  ],
  "post_contrast": [
   "given",
   "not_given"
  ]
 }
}
`;
