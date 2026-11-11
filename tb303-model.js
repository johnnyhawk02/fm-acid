/*
 * TB-303 component-level voice model
 * -----------------------------------
 * Built from the Roland TB-303 main board schematic (Feb 19, 1982).
 *
 * Every block below is driven by the part values in COMPONENTS. Change a
 * resistor or capacitor and the derived coefficients (time constants, cutoff
 * scaling, ramp slope...) are recomputed by voice.setComponent().
 *
 * Signal path (as on the schematic):
 *   IC9 4174 latch + R74-R90 R-2R ladder (5.333 V ref)  -> pitch CV
 *   IC12 4066 + R93/C35 RC lag                          -> slide
 *   Q26 2SC1583 expo converter + C33 integrator,
 *   Q27/Q28 reset at 12 V                               -> saw 5.5..12 V
 *   R35 || (C10 + R34) lead network into Q8 2SA733 PNP,
 *   R45/C11 self-biased emitter, R36 to the 5.333 V rail -> square 5.3..8 V
 *   Q12 diff pair + Q13-Q23 transistor/diode ladder,
 *   C18 (18n) C19/C24/C26 (33n), Q10/Q11 expo current   -> 4-pole VCF
 *   Q21/Q19 output amp, VR4 + C15 feedback (resonance)
 *   Q38/Q40 env: C62 charged, decays via R138 + VR6     -> VCF envelope
 *   VR7 + D27/R117 + accent cap ("sweep")               -> accent
 *   IC15 BA662A OTA, Q36 / C72 env                      -> VCA
 *
 * The voice runs at 2x oversampling. The VCF is integrated with an implicit
 * trapezoidal step, with each transistor pair's tanh() linearised around the
 * previous state, so it stays stable at any cutoff.
 *
 * Works in Node, in a browser, and inside an AudioWorklet (no DOM use).
 */

const VT = 0.02585; // thermal voltage at ~300 K
const SQ_SUB = 4;   // Q8 shaper steps per voice sample
const OUT_TRIM = 0.4; // mixer and line-out gain to digital full scale (set so a typical patch is as loud as before the Q21 stage was modelled)
const Q20_VBE = 0.65; // Q20 base-emitter drop at about 0.5 mA
const SQ_BR = 4;    // 2SA733 reverse current gain (only matters in saturation)

// source: 'schematic' = value printed on the 1982 sheet
//         'rat'       = standard ProCo RAT values
//         'lex'       = Lexicon 224 documentation or published specs
//         'td3'       = read from the Behringer TD-3 (clone) schematic
//         'estimate'  = not legible / not printed, chosen to match the
//                       behaviour the sheet documents (ramp levels, decay times)
const COMPONENTS = {
  // --- Pitch CV: IC9 4174 + R74..R90 matched R-2R ladder, 0.1% selected
  VREF:   { v: 5.333,   unit: 'V', block: 'CV',    source: 'schematic', note: 'IC9/IC10 supply; 5.333/64 = 1/12 V per step', range: [4, 6.5, 'lin'] },
  R_DAC:  { v: 100e3,   unit: 'Ω', block: 'CV',    source: 'schematic', note: 'R74-R90 series arms' },
  R2_DAC: { v: 200e3,   unit: 'Ω', block: 'CV',    source: 'schematic', note: 'R78 etc. 200K legs' },

  // --- Slide: IC12 4066 switch around RC lag
  R93:    { v: 100e3,   unit: 'Ω', block: 'Slide', source: 'schematic', note: 'slide resistor', mod: 'Slide time. The Devil Fish puts a pot here; bigger values give a lazier glide.' },
  C35:    { v: 0.22e-6, unit: 'F', block: 'Slide', source: 'schematic', note: 'slide cap (.22)', mod: 'Slide time cap. Swapping it is the simple slide-time mod; 1µ gives a long, smeary glide.' },

  // --- VCO
  C33:    { v: 0.01e-6, unit: 'F', block: 'VCO',   source: 'schematic', note: 'integrator timing cap' },
  V_LO:   { v: 5.5,     unit: 'V', block: 'VCO',   source: 'schematic', note: 'ramp bottom (scope trace)', range: [3, 8, 'lin'] },
  V_HI:   { v: 12.0,    unit: 'V', block: 'VCO',   source: 'schematic', note: 'ramp top / reset threshold (scope trace)', range: [9, 15, 'lin'] },
  F_TUNE: { v: 110,     unit: 'Hz',block: 'VCO',   source: 'schematic', note: 'TM4: 110 Hz at CV 2.75 V (A key)', range: [55, 220, 'log'] },
  CV_TUNE:{ v: 2.75,    unit: 'V', block: 'VCO',   source: 'schematic', note: 'CV out at A key', range: [1, 4, 'lin'] },
  VR2:    { v: 50e3,    unit: 'Ω', block: 'VCO',   source: 'schematic', note: 'TUNING 50K(B), ±1 oct assumed', fixed: true },

  // --- Square shaper (Q8 2SA733): the falling ramp drives Q8's base through R35 in parallel with C10 + R34. The
  // emitter sits on C11, fed from the supply by R45, so it settles wherever the average emitter current balances R45:
  // that self-bias sets the width. Q8 turns on part way down the ramp, saturates (output = emitter voltage, which sags
  // as C11 gives up charge) and the reset kicks it off through C10. The collector load goes to the 5.333 V rail.
  C10:    { v: 0.01e-6, unit: 'F', block: 'Square',source: 'schematic', note: 'C10 (.01): with R34, the fast path from the ramp to Q8 base; it snaps Q8 off at the reset' },
  R_SQS:  { v: 10e3,    unit: 'Ω', block: 'Square',source: 'schematic', note: 'R34 10K: in series with C10 (TD-3 R190)' },
  R_SQB:  { v: 100e3,   unit: 'Ω', block: 'Square',source: 'schematic', note: 'R35 100K: ramp to Q8 base, the DC path (TD-3 R191)' },
  R_SQV:  { v: 22e3,    unit: 'Ω', block: 'Square',source: 'schematic', note: 'R45 22K: supply to Q8 emitter (TD-3 R189)', mod: 'Square width. Lower values feed the emitter more current, so it sits higher and Q8 turns on earlier in the ramp: a wider, louder pulse.' },
  C_SQE:  { v: 1e-6,    unit: 'F', block: 'Square',source: 'schematic', note: 'C11 (1/50): holds Q8 emitter; it sags while Q8 conducts, which tilts the top of the square (TD-3 C122)' },
  R_SQC:  { v: 10e3,    unit: 'Ω', block: 'Square',source: 'schematic', note: 'R36 10K: collector load to the 5.333 V rail (VREF), which is the square\'s low level (TD-3 R175)' },
  V_SQ:   { v: 12,      unit: 'V', block: 'Square',source: 'estimate',  note: 'supply at R45 (the ramp tops out at 12 V)', range: [10, 15, 'lin'] },
  IS_Q8:  { v: 1e-14,   unit: 'A', block: 'Square',source: 'estimate',  note: '2SA733 saturation current', range: [1e-15, 1e-13, 'log'] },
  BF_Q8:  { v: 200,     unit: '×', block: 'Square',source: 'estimate',  note: '2SA733 current gain (hFE; P rank is 200 to 400)', range: [50, 600, 'log'] },
  C_IN:   { v: 1e-6,    unit: 'F', block: 'Square',source: 'td3',       note: 'waveform coupling into the filter, with R_IN and R98 (TD-3 C19 1/50): takes the square\'s DC off' },

  // --- VCF ladder
  C18:    { v: 0.018e-6,unit: 'F', block: 'VCF',   source: 'schematic', note: 'bottom stage cap (.018)', mod: 'Bottom ladder cap. Changing it toward 33n alters how the resonance sits; a popular experiment, not a standard mod.' },
  C19:    { v: 0.033e-6,unit: 'F', block: 'VCF',   source: 'schematic', note: 'stage 2 cap (.033)' },
  C24:    { v: 0.033e-6,unit: 'F', block: 'VCF',   source: 'schematic', note: 'stage 3 cap (.033)' },
  C26:    { v: 0.033e-6,unit: 'F', block: 'VCF',   source: 'schematic', note: 'top stage cap (.033)' },
  R_IN:   { v: 100e3,   unit: 'Ω', block: 'VCF',   source: 'td3',       note: 'waveform to Q12 base (TD-3 R27)', mod: 'Filter input level. Lowering it drives the ladder harder for grit, like the Devil Fish overdrive.' },
  R98:    { v: 2.2e3,   unit: 'Ω', block: 'VCF',   source: 'schematic', note: 'Q12 base to ground (input divider)' },
  C15:    { v: 1e-6,    unit: 'F', block: 'VCF',   source: 'schematic', note: 'resonance feedback coupling (1/50)' },
  VR4:    { v: 50e3,    unit: 'Ω', block: 'VCF',   source: 'schematic', note: 'RESONANCE 50K(B)', fixed: true },
  A_Q21:  { v: 16.5,    unit: '×', block: 'VCF',   source: 'estimate',  note: 'Q21/Q19 loop gain at VR4 max (k_crit = 17)', range: [0, 26, 'lin'], mod: 'Resonance range. The Devil Fish and many TD-3 mods raise feedback so the filter self-oscillates (k above 17 here).' },
  // expo converter Q10/Q11 summing node
  R73:    { v: 100e3,   unit: 'Ω', block: 'VCF',   source: 'schematic', note: 'cutoff pot to Q10 base' },
  R72:    { v: 220e3,   unit: 'Ω', block: 'VCF',   source: 'schematic', note: 'env mod to Q10 base', mod: 'Env mod depth. Lowering it is the usual more-envelope mod for bigger sweeps.' },
  R63:    { v: 100e3,   unit: 'Ω', block: 'VCF',   source: 'schematic', note: 'accent to Q10 base' },
  R71:    { v: 2.2e3,   unit: 'Ω', block: 'VCF',   source: 'schematic', note: 'Q10 base to ground' },
  V_CUT:  { v: 3.3,     unit: 'V', block: 'VCF',   source: 'estimate',  note: 'VR3 wiper span (R47 10K end stop)', range: [0.5, 6, 'lin'], mod: 'Cutoff knob range. Cutoff range mods (common on TD-3s) let the knob go lower and higher.' },
  KT:     { v: 0,       unit: '%', block: 'VCF',   source: 'estimate',  note: 'KEY TRACK pot (100K B) with click-off switch: buffered pitch CV minus V_KT, through R_KT into Q10 base. Not on a stock 303', range: [0, 1, 'lin'], mod: 'Filter key tracking, as on the TD-3-MO and Devil Fish. Feeds the pitch CV into the cutoff so higher notes open the filter. With the 36K R_KT about a third of the pot is exact 1 V/oct and full is about 300%, so low notes almost vanish, like a TD-3-MO turned up. 0 switches it out, which is the stock 303.' },
  R_KT:   { v: 36e3,    unit: 'Ω', block: 'VCF',   source: 'estimate',  note: 'key track pot wiper to Q10 base (114K = 100% at full pot, 36K about 300%)', range: [18e3, 300e3, 'log'], mod: 'Key track range. Lower values let the Key track pot go further past 1 V/oct.' },
  V_KT:   { v: 3.0,     unit: 'V', block: 'VCF',   source: 'estimate',  note: 'key track buffer reference: the note whose cutoff does not move (3 V = the C above the A tuning note); notes below it get darker', range: [1, 4, 'lin'] },
  I_REF:  { v: 3.1e-6, unit: 'A', block: 'VCF',   source: 'estimate',  note: 'TM3 FREQ trim: ladder current at 0 V', range: [1.55e-6, 6.2e-6, 'log'], mod: 'Filter frequency trimmer (TM3). Sets where the cutoff sits for a given knob position, about one octave either way.' },

  // --- VCF envelope (Q38/Q40/Q39 2SK30)
  C62:    { v: 1e-6,    unit: 'F', block: 'Env',   source: 'schematic', note: 'envelope cap (1/35)', mod: 'Envelope cap. Scales every decay time together; a smaller cap gives snappier envelopes.' },
  R138:   { v: 68e3,    unit: 'Ω', block: 'Env',   source: 'schematic', note: 'decay min resistor', mod: 'Sets the shortest decay and the accent decay. The Devil Fish adds separate Normal and Accent decay pots, reaching much shorter decays.' },
  VR6:    { v: 1e6,     unit: 'Ω', block: 'Env',   source: 'schematic', note: 'ENV.DECAY 1M(A): 200 ms .. 2.5 s', mod: 'Decay pot. Raising it (or adding a series pot) gives longer decays; it is the Normal decay control on a Devil Fish.' },
  R152:   { v: 100,     unit: 'Ω', block: 'Env',   source: 'td3',       note: 'attack charge path (TD-3 R125 = 100)' },
  V_ENV:  { v: 10.0,    unit: 'V', block: 'Env',   source: 'td3',       note: 'envelope peak: the decay graph is marked 10V = 100% (TD-3 sheet)' },
  VR5:    { v: 50e3,    unit: 'Ω', block: 'Env',   source: 'schematic', note: 'ENV.MOD 50K(A)', fixed: true },

  // --- Accent
  VR7:    { v: 50e3,    unit: 'Ω', block: 'Accent',source: 'schematic', note: 'ACCENT 50K(B)', fixed: true },
  R117:   { v: 22e3,    unit: 'Ω', block: 'Accent',source: 'schematic', note: 'charge resistor into sweep cap', mod: 'Accent charge resistor. Lower values give a harder, faster accent sweep.' },
  C_ACC:  { v: 1e-6,    unit: 'F', block: 'Accent',source: 'schematic', note: 'accent sweep cap C13 (1/50); TD-3 C62 1µ', mod: 'Accent sweep cap. The Devil Fish Sweep Speed control changes how fast this charges and bleeds, so stacked accents wah more or less.' },
  R_ACC:  { v: 47e3,    unit: 'Ω', block: 'Accent',source: 'schematic', note: 'sweep resistor R46 47K; TD-3 R39 47K', mod: 'Accent sweep bleed. Part of the Sweep Speed mod: higher values let consecutive accents build further.' },
  V_D:    { v: 0.55,    unit: 'V', block: 'Accent',source: 'estimate',  note: 'D27/D28 forward drop' },
  WOW:    { v: 0,       unit: '×', block: 'Accent',source: 'estimate',  note: 'blend toward the schematic accent sweep: D24 / R_ACC / second gang of VR4 / C_ACC, gang wiper to the filter', range: [0, 1, 'lin'], mod: 'Accent wow. Blends in the sweep as the cleaner schematic draws it: the second gang of the resonance pot taps the sweep cap, so at high resonance accents swell and build over back-to-back accents. 0 keeps the classic accent.' },

  // --- VCA (IC15 BA662A OTA)
  C67:    { v: 1e-6,    unit: 'F', block: 'VCA',   source: 'td3',       note: 'VCA env cap (TD-3 C67 1/35)', mod: 'VCA envelope cap; scales VCA decay and attack together.' },
  R49:    { v: 100,     unit: 'Ω', block: 'VCA',   source: 'td3',       note: 'VCA env attack (TD-3 R49)', mod: 'VCA attack. Related to the Devil Fish Soft Attack control, which slows the attack of non-accented notes.' },
  R_SOFT: { v: 3.3e3,   unit: 'Ω', block: 'VCA',   source: 'estimate',  note: 'soft attack on non-accented notes (about 3 ms with C67)', mod: 'Soft attack. The Devil Fish Soft Attack control varies this; stock 303 normal notes fade in over a few ms, accented notes bypass it and snap in. Lower it for more click, raise it for a slower swell.' },
  R52:    { v: 1.5e6,   unit: 'Ω', block: 'VCA',   source: 'td3',       note: 'VCA env decay (TD-3 R52 1.5M)', mod: 'VCA (VEG) decay. The Devil Fish VEG Decay control: shorter for gated plucks, longer for drones.' },
  R_VREL: { v: 4.7e3,   unit: 'Ω', block: 'VCA',   source: 'estimate',  note: 'gate-off discharge through T28' },
  V_VCA:  { v: 5.0,     unit: 'V', block: 'VCA',   source: 'estimate',  note: 'VCA env peak' },
  R105:   { v: 22e3,    unit: 'Ω', block: 'VCA',   source: 'td3',       note: 'env to OTA bias pin (Iabc) (TD-3 R105)' },
  R25:    { v: 22e3,    unit: 'Ω', block: 'VCA',   source: 'td3',       note: 'accent to VCA, with D8 (TD-3 R25)' },
  R26:    { v: 47e3,    unit: 'Ω', block: 'VCA',   source: 'td3',       note: 'accent to VCA (TD-3 R26, C26 .033)' },
  // Q21 2SC1583 diff pair reads the top ladder cap through C25/C27; its tail is Q20 with R108, biased from the
  // 5.333 V rail by R116 into R112/R109 (R113/R114 100K carry only base current). Gain Itail*R110/(4 VT), clipping at
  // +-Itail*R110/2.
  R110:   { v: 22e3,    unit: 'Ω', block: 'VCA',   source: 'schematic', note: 'Q21 collector load R110/R111 22K (TD-3 R83/R84)' },
  R108:   { v: 2.2e3,   unit: 'Ω', block: 'VCA',   source: 'schematic', note: 'Q20 tail emitter resistor (TD-3 R96)', mod: 'Filter output stage current. Lower values give the stage more gain and headroom, so it drives the VCA harder.' },
  R116:   { v: 10e3,    unit: 'Ω', block: 'VCA',   source: 'schematic', note: 'bias feed from the 5.333 V rail to the Q21/Q20 bias node' },
  R112:   { v: 10e3,    unit: 'Ω', block: 'VCA',   source: 'schematic', note: 'bias node to Q20 base' },
  R109:   { v: 10e3,    unit: 'Ω', block: 'VCA',   source: 'schematic', note: 'Q20 base to ground' },
  C14:    { v: 1e-6,    unit: 'F', block: 'VCA',   source: 'schematic', note: 'VCF output coupling (1/50)' },
  R85:    { v: 10e3,    unit: 'Ω', block: 'VCA',   source: 'td3',       note: 'output buffer load, HPF with C14 (TD-3 R85)' },
  C49:    { v: 0.01e-6, unit: 'F', block: 'VCA',   source: 'td3',       note: 'filter to VCA coupling (TD-3 C49)' },
  R88:    { v: 220e3,   unit: 'Ω', block: 'VCA',   source: 'td3',       note: 'filter to VCA input (TD-3 R88)' },
  C76:    { v: 0.01e-6, unit: 'F', block: 'VCA',   source: 'td3',       note: 'resonance compensation coupling (TD-3 C76)' },
  R100:   { v: 100e3,   unit: 'Ω', block: 'VCA',   source: 'td3',       note: 'resonance compensation into VCA (TD-3 R100)' },
  R101:   { v: 2.2e3,   unit: 'Ω', block: 'VCA',   source: 'td3',       note: 'OTA input to ground (TD-3 R101)' },
  R_OTA:  { v: 22e3,    unit: 'Ω', block: 'VCA',   source: 'estimate',  note: 'OTA output load' },
  C38:    { v: 1e-6,    unit: 'F', block: 'VCA',   source: 'schematic', note: 'VCA output coupling (1/50)' },
  R_OUT:  { v: 50e3,    unit: 'Ω', block: 'VCA',   source: 'schematic', note: 'VOLUME pot VR8 50K(A): the load on C38' },

  // --- Noise: the parts' own hiss, as white voltage noise densities at the points where it enters
  EN_VCF: { v: 15e-9,   unit: 'V/√Hz', block: 'Noise', source: 'estimate', note: 'ladder input noise: R98 2.2K thermal plus Q12 pair shot noise, referred to the Q12 base. Resonance rings it, but it sits far below the OTA hiss', range: [0, 150e-9, 'lin'] },
  EN_OTA: { v: 40e-9,   unit: 'V/√Hz', block: 'Noise', source: 'estimate', note: 'BA662 OTA input noise with R101 2.2K: the main hiss, which opens and closes with the VCA', range: [0, 400e-9, 'lin'] },
  EN_OUT: { v: 0.35e-6,    unit: 'V/√Hz', block: 'Noise', source: 'estimate', note: 'output stage floor (IC15 buffer, mixer): a constant hiss under everything, after the volume pot', range: [0, 3.5e-6, 'lin'] },
  NOISE:  { v: 0.15,    unit: '×', block: 'Noise', source: 'estimate', note: 'scales every noise source together (0 = silent background)', range: [0, 1, 'lin'], mod: 'Circuit noise. The hiss of the old transistors, OTA and output stage; 0.15 is a light hiss, 1 is a loud worn-out unit, 0 is studio-clean.' },

  // --- ProCo RAT
  RAT_CIN: { v: 22e-9,  unit: 'F', block: 'RAT',   source: 'rat', note: 'input coupling into 1M' },
  RAT_RD:  { v: 100e3,  unit: 'Ω', block: 'RAT',   source: 'rat', note: 'DISTORTION pot 100k(A) in the LM308 feedback' },
  RAT_CF:  { v: 100e-12,unit: 'F', block: 'RAT',   source: 'rat', note: 'cap across the distortion pot', mod: 'Raising it smooths the fizz at high gain.' },
  RAT_RG1: { v: 47,     unit: 'Ω', block: 'RAT',   source: 'rat', note: 'gain leg 1 resistor (with 2.2µ)' },
  RAT_CG1: { v: 2.2e-6, unit: 'F', block: 'RAT',   source: 'rat', note: 'gain leg 1 cap' },
  RAT_RG2: { v: 560,    unit: 'Ω', block: 'RAT',   source: 'rat', note: 'gain leg 2 resistor (with 4.7µ)', mod: 'Ruetz mod: add resistance here (or a pot) to tame the low-mid gain.' },
  RAT_CG2: { v: 4.7e-6, unit: 'F', block: 'RAT',   source: 'rat', note: 'gain leg 2 cap', mod: 'Smaller caps cut bass before clipping for a tighter sound.' },
  RAT_CC:  { v: 30e-12, unit: 'F', block: 'RAT',   source: 'rat', note: 'LM308 compensation cap; sets slew rate and bandwidth', mod: 'The LM308 slew limit is the RAT\'s character. Smaller cap = brighter; swapping in a faster op-amp loses it.' },
  RAT_GBW: { v: 1e6,    unit: 'Hz',block: 'RAT',   source: 'estimate', note: 'LM308 gain-bandwidth at 30p', range: [2e5, 5e6, 'log'] },
  RAT_SR:  { v: 0.3,    unit: 'V/µs', block: 'RAT', source: 'estimate', note: 'LM308 slew rate at 30p', range: [0.05, 5, 'log'] },
  RAT_RCL: { v: 1e3,    unit: 'Ω', block: 'RAT',   source: 'rat', note: 'resistor into the clipping diodes' },
  RAT_VF:  { v: 0.6,    unit: 'V', block: 'RAT',   source: 'rat', note: 'clipping diode drop at 1 mA (1N914 ≈ 0.6 V)', range: [0.2, 2.5, 'lin'], mod: 'Diode swap. Germanium about 0.3 V (softer), LEDs about 1.7 V (Turbo RAT: louder, more open), 2.5 V is close to no diodes.' },
  RAT_RF:  { v: 1.5e3,  unit: 'Ω', block: 'RAT',   source: 'rat', note: 'fixed filter resistor (in series with the 100k FILTER pot)' },
  RAT_CFLT:{ v: 3.3e-9, unit: 'F', block: 'RAT',   source: 'rat', note: 'filter cap', mod: 'Sets the FILTER range; larger caps make the filter darker overall.' },
  RAT_VS:  { v: 9,      unit: 'V', block: 'RAT',   source: 'rat', note: 'supply; op-amp swings to about ±(V/2 − 1)', range: [6, 18, 'lin'] },

  // --- Lexicon 224 (1978, David Griesinger). 'lex' = from Lexicon documentation or published specs.
  LEX_FS:   { v: 20000,  unit: 'Hz', block: '224', source: 'lex', note: 'internal sample rate (20 kHz, Dattorro 1997 and spec sheet)', range: [10000, 48000, 'log'], mod: 'The 224 ran at 20 kHz, which is why it is dark and grainy. Raise it to hear the same programs with modern bandwidth.' },
  LEX_BW:   { v: 9000,   unit: 'Hz', block: '224', source: 'estimate', note: 'anti-alias and reconstruction corner, 6-pole each side (spec: 20 Hz–8 kHz +1/−2 dB)', range: [3000, 20000, 'log'] },
  LEX_BITS: { v: 12,     unit: 'bit', block: '224', source: 'lex', note: 'converter resolution (12-bit, DAC80)', range: [6, 20, 'lin'], mod: 'The 12-bit gain-ranging converters are part of the grit. 16 or more gives a clean modern converter.' },
  LEX_RANGE:{ v: 24,     unit: 'dB', block: '224', source: 'lex', note: 'gain-ranging headroom, in 6 dB steps (12-bit + 24 dB ≈ 16-bit range)', range: [0, 42, 'lin'] },
  LEX_GREL: { v: 0.08,   unit: 's',  block: '224', source: 'estimate', note: 'gain-ranging release (how long the converter holds a coarse range)', range: [0.005, 1, 'log'] },
  LEX_WORD: { v: 16,     unit: 'bit', block: '224', source: 'lex', note: 'fixed-point word size in delay memory', range: [8, 24, 'lin'] },
  LEX_MEM:  { v: 32768,  unit: 'words', block: '224', source: 'lex', note: 'delay memory (16K at launch, doubled shortly after). Programs shrink to fit.', range: [8192, 131072, 'log'] },
  LEX_XSAT: { v: 1.6,    unit: 'V',  block: '224', source: 'estimate', note: 'input transformer saturation level', range: [0.3, 6, 'log'] },
};

function audioTaper(p) { return p <= 0 ? 0 : Math.pow(p, 2.74); } // 'A' pot, ~15% at mid

// 6-bit R-2R ladder solved by Thevenin reduction from the LSB end.
function dacVoltage(code, vref, R, R2) {
  let vth = 0, rth = R2; // termination leg to ground
  for (let k = 0; k < 6; k++) {
    const vb = (code >> k) & 1 ? vref : 0;
    vth = (vth / rth + vb / R2) / (1 / rth + 1 / R2);
    rth = (rth * R2) / (rth + R2);
    if (k < 5) rth += R;
  }
  return vth;
}

// ---------------------------------------------------------------------------
// Lexicon 224 digital reverb (1978, David Griesinger)
//
// What is documented (Lexicon 224 v4.4 manual, spec sheet, Dattorro 1997):
//   20 kHz sample rate, 20 Hz–8 kHz response, 12-bit DAC80 converters with
//   gain ranging for about 24 dB more range, 16-bit fixed-point words, 16K
//   words of delay memory at launch (soon 32K). Nine v4.4 programs (P1/P3 and
//   P2/P5 share algorithms). Controls: Bass and Mid decay (0.6–70 s) split at
//   Crossover (100 Hz–10.9 kHz), Treble decay (100 Hz–10.9 kHz), Depth (0–71,
//   close to far), Diffusion (0–63), Predelay (a per-program range), and Mode
//   Enhancement: random modulation of delay taps, Amount 1–16 (time between
//   tap updates, lower is stronger) and Pitch shift 1–16.
// What is estimated: the actual 224 microcode was never published. The core
// here is the "plate-class topology in the style of Griesinger" that Dattorro
// published (input allpass diffusers, then a figure-eight tank of two
// cross-coupled halves, each a modulated allpass, delay, decay filter,
// allpass, delay), with his delay lengths and output taps. The hall, chamber,
// room and constant-density variants, the depth mapping and the chorus voice
// timings are my estimates, shaped to the manual's descriptions.
//
// Like the hardware, all delay lines share one circular memory addressed by a
// single decrementing pointer, every write is rounded to the fixed-point word,
// and a program that does not fit in LEX_MEM is shrunk until it does.
const LEX_PROGRAMS = [
  { n: 1, name: 'Small Concert Hall B',     short: 'Small Hall B', alg: 'hallB',   size: 1.2,  pre: [24, 152] },
  { n: 2, name: 'Vocal Plate',              short: 'Vocal Plate',  alg: 'plate',   size: 1.0,  pre: [0, 107] },
  { n: 3, name: 'Large Concert Hall B',     short: 'Large Hall B', alg: 'hallB',   size: 1.85, pre: [24, 152] },
  { n: 4, name: 'Acoustic Chamber',         short: 'Chamber',      alg: 'chamber', size: 1.1,  pre: [25, 255] },
  { n: 5, name: 'Percussion Plate A',       short: 'Perc Plate',   alg: 'plate',   size: 0.75, pre: [0, 107] },
  { n: 6, name: 'Small Concert Hall A',     short: 'Small Hall A', alg: 'hallA',   size: 1.25, pre: [24, 152] },
  { n: 7, name: 'Room A',                   short: 'Room A',       alg: 'room',    size: 0.5,  pre: [24, 255] },
  { n: 8, name: 'Constant Density Plate A', short: 'CD Plate',     alg: 'cdplate', size: 1.0,  pre: [5, 185] },
  { n: 9, name: 'Chorus A',                 short: 'Chorus',       alg: 'chorus',  size: 1,    pre: [0, 253] },
];
// Dattorro's plate at 29761 Hz: tank lines [L modAP, L d1, L ap2, L d2, R modAP, R d1, R ap2, R d2]
const LEX_TANK = [672, 4453, 1800, 3720, 908, 4217, 2656, 3163];
// his output taps (Table 2): [line, position, sign]
const LEX_TAPS_L = [[5, 266, 1], [5, 2974, 1], [6, 1913, -1], [7, 1996, 1], [1, 1990, -1], [2, 187, -1], [3, 1066, -1]];
const LEX_TAPS_R = [[1, 353, 1], [1, 3627, 1], [2, 1228, -1], [3, 2673, 1], [5, 2111, -1], [6, 335, -1], [7, 121, -1]];
// algorithm shapes. Only 'plate' is Dattorro's published network; the rest are estimates.
const LEX_ALGS = {
  plate:   { ind: [142, 107, 379, 277], mul: [1, 1, 1, 1, 1, 1, 1, 1], ap3: null, dd1: 0.70, er: 0.25 },
  hallB:   { ind: [142, 107, 379, 277], mul: [1.13, 1.07, 0.93, 1.11, 1.09, 0.97, 1.12, 1.04], ap3: [1123, 1327], dd1: 0.65, er: 0.45 },
  hallA:   { ind: [233, 571], mul: [1.21, 1.03, 1.07, 0.95, 0.89, 1.11, 0.97, 1.08], ap3: [977, 1201], dd1: 0.60, er: 0.5 },
  chamber: { ind: [113, 163, 293], mul: [0.83, 0.91, 1.17, 0.88, 0.95, 0.86, 1.21, 0.93], ap3: null, dd1: 0.68, er: 0.7 },
  room:    { ind: [101, 271], mul: [1, 1, 1, 1, 1, 1, 1, 1], ap3: null, dd1: 0.62, er: 0.9 },
  cdplate: { ind: [142, 107, 379, 277, 199, 151], mul: [1, 0.97, 1, 1.03, 1, 1.02, 1, 0.98], ap3: [811, 947], dd1: 0.75, er: 0.15 },
};
const LEX_CHORUS_MS = [9, 14, 19, 25]; // base delay per voice pair (estimate)

// front-panel knobs (0..1) to the 224's own units
function lexParams(k) {
  const ex = (lo, hi, p) => lo * Math.pow(hi / lo, p);
  const prog = Math.max(0, Math.min(8, Math.round(k.lexprog * 8))), P = LEX_PROGRAMS[prog];
  return {
    prog, P,
    bass: ex(0.6, 70, k.lexbass), mid: ex(0.6, 70, k.lexmid),
    xover: ex(100, 10900, k.lexxover), treble: ex(100, 10900, k.lextreble),
    depth: Math.round(k.lexdepth * 71), diff: Math.round(k.lexdiff * 63),
    pre: P.pre[0] + (P.pre[1] - P.pre[0]) * k.lexpre,
    me: k.lexme < 0.03 ? 0 : 17 - Math.max(1, Math.min(16, Math.ceil(k.lexme * 16))),
    pitch: 1 + Math.round(k.lexpitch * 15),
    pairs: [k.lexbass, k.lexmid, k.lexxover, k.lextreble],
    wet: 2 * audioTaper(k.lexmix),
  };
}

function lexLowpass(fc, Q, fs) {
  const w = 2 * Math.PI * Math.min(fc, 0.45 * fs) / fs, al = Math.sin(w) / (2 * Q), cw = Math.cos(w), a0 = 1 + al;
  return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}
function lexBiq(f, x) {
  for (const s of f) {
    const y = s.b0 * x + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
    s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y; x = y;
  }
  return x;
}

class Lexicon224 {
  constructor(fsHost) {
    this.fsHost = fsHost;
    this.F = 0; this.memWords = 0; this.prog = -1;
    this.seed = 22477; this.L = 0; this.R = 0; this.yl = 0; this.yr = 0;
    this.ph = 0; this.prev = 0; this.hx = 0; this.hxIn = 0;
    this.envIn = 0; this.envL = 0; this.envR = 0; this.zl = 0; this.zr = 0;
  }
  _rand() { this.seed = (this.seed * 1103515245 + 12345) >>> 0; return this.seed / 4294967296; }

  derive(c, k) {
    const q = lexParams(k), F = Math.round(c.LEX_FS), fh = this.fsHost;
    const layoutChanged = F !== this.F || Math.round(c.LEX_MEM) !== this.memWords || q.prog !== this.prog;
    if (F !== this.F || c.LEX_BW !== this.bw) {
      this.F = F; this.bw = c.LEX_BW; this.ratio = F / fh;
      const fc = Math.min(c.LEX_BW, 0.45 * F), Qs = [0.5176, 0.7071, 1.9319];
      this.aa = Qs.map(Qv => lexLowpass(fc, Qv, fh));
      this.rcL = Qs.map(Qv => lexLowpass(fc, Qv, fh));
      this.rcR = Qs.map(Qv => lexLowpass(fc, Qv, fh));
    }
    this.memWords = Math.round(c.LEX_MEM); this.prog = q.prog; this.q = q;
    if (layoutChanged) this._layout();
    // converters and word size
    this.adcQ = Math.pow(2, Math.round(c.LEX_BITS) - 1);
    this.steps = Math.max(0, Math.round(c.LEX_RANGE / 6));
    this.envRel = Math.exp(-1 / (c.LEX_GREL * F));
    this.wq = Math.pow(2, Math.round(c.LEX_WORD) - 1);
    this.xsat = c.LEX_XSAT;
    this.hxA = Math.exp(-2 * Math.PI * 12 / fh); // transformer low end, estimate
    this.wet = q.wet;
    // program parameters
    this.preD = Math.max(1, Math.round(q.pre * F / 1000));
    const g1 = Math.min(0.9, 0.75 * q.diff / 35);
    this.gIn = [g1, g1, g1 * 0.833, g1 * 0.833, g1 * 0.8, g1 * 0.8];
    this.dd2 = Math.min(0.7, 0.5 * q.diff / 35);
    const half = (o) => { let s = 0; for (let i = 0; i < 4; i++) s += this.len[o + i]; return s; };
    if (this.alg !== 'chorus') {
      const hL = half(0) + (this.ap3 ? this.ap3[0] : 0), hR = half(4) + (this.ap3 ? this.ap3[1] : 0);
      const g = (rt, h) => Math.pow(10, -3 * h / (rt * F));
      this.gB = [g(q.bass, hL), g(q.bass, hR)]; this.gM = [g(q.mid, hL), g(q.mid, hR)];
    }
    this.cx = 1 - Math.exp(-2 * Math.PI * q.xover / F);
    this.tb = q.treble >= F / 2 ? 1 : 1 - Math.exp(-2 * Math.PI * q.treble / F);
    this.depth = q.depth / 71;
    this.meT = q.me ? q.me * 32 : 0; // ticks between tap updates (estimate: 1.6–26 ms at 20 kHz)
    this.pitch = q.me ? q.pitch : 0;
    this.pairs = q.pairs;
    this.chDepth = q.depth / 71 * 0.008 * F;
    this.chT = Math.round((q.me || 8) * 0.04 * F);
  }

  _layout(fit = 1) {
    const P = LEX_PROGRAMS[this.prog], F = this.F, A = LEX_ALGS[P.alg];
    this.alg = P.alg;
    const maxPre = Math.ceil(P.pre[1] * F / 1000) + 2;
    let words = 0;
    const alloc = (len) => { const b = words; words += len + 2; return b; };
    this.preB = alloc(maxPre);
    if (P.alg === 'chorus') {
      this.chLen = Math.ceil(0.045 * F);
      this.chB = alloc(this.chLen);
      this.chAp = [0, 1, 2, 3].map(i => { const len = Math.round([0.0053, 0.0071, 0.0047, 0.0083][i] * F); return { b: alloc(len), len }; });
      this.chW = Array.from({ length: 8 }, () => ({ from: 0, to: 0, ctr: 1 + Math.floor(this._rand() * 2000) }));
      this.scale = 1;
    } else {
      const base = A.ind.reduce((a, b) => a + b, 0) + LEX_TANK.reduce((a, l, i) => a + l * A.mul[i], 0) + (A.ap3 ? A.ap3[0] + A.ap3[1] : 0);
      let sc = F / 29761 * P.size * fit;
      const room = this.memWords - maxPre - 3 * (A.ind.length + 12) - 80;
      if (base * sc > room) sc = Math.max(0.05, room / base);
      this.scale = sc / (F / 29761);
      const L = (n) => Math.max(2, Math.round(n * sc)) | 1;
      this.ind = A.ind.map(n => { const len = L(n); return { b: alloc(len), len }; });
      this.len = LEX_TANK.map((n, i) => L(n * A.mul[i]));
      this.tb_ = this.len.map((len, i) => alloc(len + ((i & 3) <= 1 ? 36 : 0)));
      this.ap3 = A.ap3 ? A.ap3.map(L) : null;
      this.ap3B = this.ap3 ? this.ap3.map(len => alloc(len)) : null;
      this.dd1 = A.dd1; this.er = A.er;
      const tap = (t, near) => { const [line, pos, sg] = t; return [line, Math.max(1, Math.round(pos / LEX_TANK[line] * this.len[line] * (near ? 0.3 : 1))), sg]; };
      this.tapsL = LEX_TAPS_L.map(t => tap(t)); this.tapsR = LEX_TAPS_R.map(t => tap(t));
      this.nearL = LEX_TAPS_L.map(t => tap(t, 1)); this.nearR = LEX_TAPS_R.map(t => tap(t, 1));
      this.walk = [0, 1, 2, 3].map(() => ({ from: 0, to: 0 })); this.meCtr = 1;
      this.lastL = 0; this.lastR = 0; this.xl = [0, 0]; this.tr = [0, 0];
    }
    this.words = words;
    if (words > this.memWords && fit > 0.5 && P.alg !== 'chorus') return this._layout(fit * (this.memWords - 8) / words);
    let size = 1024; while (size < words) size <<= 1;
    this.mem = new Float64Array(size); this.mask = size - 1; this.p = 0;
  }

  _w(a, v) { // write one fixed-point word, saturating. Magnitude truncation (estimate) lets tails die instead of limit-cycling.
    const q = this.wq; v = Math.trunc(v * q) / q;
    this.mem[a & this.mask] = v > 1 ? 1 : v < -1 ? -1 : v;
  }
  _r(a) { return this.mem[a & this.mask]; }
  _rf(a, d) { const i = Math.floor(d), f = d - i; return this._r(a + i) * (1 - f) + this._r(a + i + 1) * f; }
  _ap(b, len, g, x) { const p = this.p, vd = this._r(p + b + len), w = x + g * vd; this._w(p + b, w); return vd - g * w; }

  // gain-ranging 12-bit converter: the signal is boosted in 6 dB steps while it is small
  _conv(x, env) {
    let s = this.steps; while (s > 0 && env * (1 << s) >= 1) s--;
    const g = 1 << s; let y = x * g; y = y > 1 ? 1 : y < -1 ? -1 : y;
    return Math.round(y * this.adcQ) / this.adcQ / g;
  }

  _tick(x) {
    const p = this.p = (this.p - 1) & this.mask;
    this._w(p + this.preB, x);
    const u0 = this._r(p + this.preB + this.preD);
    if (this.alg === 'chorus') { this._chorus(u0); return; }
    // input diffusers
    let u = u0, uE = 0;
    for (let i = 0; i < this.ind.length; i++) { u = this._ap(this.ind[i].b, this.ind[i].len, this.gIn[i], u); if (i === this.ind.length - 2) uE = u; }
    // Mode Enhancement: each tap walks one sample at a time, at random, inside ±Pitch
    const W = this.walk;
    if (this.meT) {
      if (--this.meCtr <= 0) {
        this.meCtr = this.meT;
        for (const w of W) { w.from = w.to; let n = w.to + (this._rand() < 0.5 ? -1 : 1); if (Math.abs(n) > this.pitch) n = w.to - Math.sign(n - w.to); w.to = n; }
      }
    } else { this.meCtr = 1; for (const w of W) { w.from = w.to = 0; } }
    const ph = this.meT ? 1 - this.meCtr / this.meT : 0;
    const len = this.len, B = this.tb_;
    let out0 = 0, out1 = 0;
    for (let s = 0; s < 2; s++) {
      const o = s * 4;
      let a = u + (s ? this.lastL : this.lastR);
      // modulated allpass (decay diffusion 1)
      const vd = this._rf(p + B[o], len[o] + 16 + (W[s].from + (W[s].to - W[s].from) * ph)), g = -this.dd1, w = a + g * vd;
      this._w(p + B[o], w); a = vd - g * w;
      // delay 1, read through a wandering tap
      this._w(p + B[o + 1], a);
      let v = this._rf(p + B[o + 1], len[o + 1] + 16 + (W[2 + s].from + (W[2 + s].to - W[2 + s].from) * ph));
      // Bass / Mid decay split at Crossover, then Treble decay
      this.xl[s] += this.cx * (v - this.xl[s]);
      v = this.gB[s] * this.xl[s] + this.gM[s] * (v - this.xl[s]);
      this.tr[s] += this.tb * (v - this.tr[s]); v = this.tr[s];
      // allpass (decay diffusion 2), optional third allpass, delay 2
      v = this._ap(B[o + 2], len[o + 2], this.dd2, v);
      if (this.ap3) v = this._ap(this.ap3B[s], this.ap3[s], -this.dd2 * 0.8, v);
      this._w(p + B[o + 3], v);
      if (s) out1 = this._r(p + B[o + 3] + len[o + 3]); else out0 = this._r(p + B[o + 3] + len[o + 3]);
    }
    this.lastL = out0; this.lastR = out1;
    // output taps; Depth crossfades near taps (plus the diffused input) to the far ones
    const d = this.depth;
    this.yl = 0.6 * (d * this._sum(this.tapsL, p, B) + (1 - d) * (this._sum(this.nearL, p, B) + this.er * u));
    this.yr = 0.6 * (d * this._sum(this.tapsR, p, B) + (1 - d) * (this._sum(this.nearR, p, B) + this.er * uE));
  }
  _sum(T, p, B) { let y = 0; for (let i = 0; i < T.length; i++) { const t = T[i]; y += t[2] * this._r(p + B[t[0]] + t[1]); } return y;
  }

  // P9: eight voices, four per side, each delay wandering at random; diffusion on pairs 3 and 4
  _chorus(u) {
    const p = this.p; this._w(p + this.chB, u);
    const y = [0, 0];
    for (let v = 0; v < 8; v++) {
      const w = this.chW[v];
      if (--w.ctr <= 0) { w.from = w.to; w.to = this._rand() * 2 - 1; w.ctr = this.chT; }
      const t = 1 - w.ctr / this.chT, sm = w.from + (w.to - w.from) * (0.5 - 0.5 * Math.cos(Math.PI * t));
      const pair = v >> 1, side = v & 1;
      const dl = Math.min(this.chLen - 2, (LEX_CHORUS_MS[pair] + side * 1.3) * 0.001 * this.F + this.chDepth * sm);
      let s = this._rf(p + this.chB, Math.max(1, dl));
      if (pair >= 2) { const a = this.chAp[(pair - 2) * 2 + side]; s = this._ap(a.b, a.len, this.dd2 * 1.2, s); }
      y[side] += this.pairs[pair] * s;
    }
    this.yl = 0.5 * y[0]; this.yr = 0.5 * y[1];
  }

  // one host-rate sample in, sets this.L / this.R
  run(x) {
    // input transformer: low-end roll-off and soft saturation
    this.hx = this.hxA * (this.hx + x - this.hxIn); this.hxIn = x;
    let v = this.xsat * Math.tanh(this.hx / this.xsat);
    v = lexBiq(this.aa, v * 0.5); // anti-alias filter; converter full scale is about ±2 V
    this.ph += this.ratio;
    while (this.ph >= 1) {
      this.ph -= 1;
      const back = this.ph / this.ratio, xi = v - (v - this.prev) * Math.min(1, back);
      const a = Math.abs(xi); this.envIn = a > this.envIn ? a : this.envIn * this.envRel;
      this._tick(this._conv(xi, this.envIn)); const yl = this.yl, yr = this.yr;
      const al = Math.abs(yl), ar = Math.abs(yr);
      this.envL = al > this.envL ? al : this.envL * this.envRel; this.envR = ar > this.envR ? ar : this.envR * this.envRel;
      this.zl = this._conv(yl, this.envL); this.zr = this._conv(yr, this.envR); // DAC with zero-order hold
    }
    this.prev = v;
    this.L = lexBiq(this.rcL, this.zl) * 2; this.R = lexBiq(this.rcR, this.zr) * 2;
  }

  memoryUse() { return { words: this.words, of: this.memWords, scale: this.scale }; }
}

// ---------------------------------------------------------------------------
// The other reverbs on the reverb slot: a plate, a spring tank and a convolution reverb. Unlike the
// 224 these are not models of one unit; they are well-known published algorithms, run clean at the
// host rate. revType(k) picks one: 0 = Lexicon 224, 1 = plate, 2 = spring, 3 = convolution.
const REV_TYPES = [{ id: 'lex', name: 'Digital 224', short: '224' }, { id: 'plate', name: 'Plate', short: 'Plate' }, { id: 'spring', name: 'Spring', short: 'Spring' }, { id: 'conv', name: 'Convolution', short: 'Conv' }];
const revType = (k) => Math.max(0, Math.min(3, Math.round((k.revtype || 0) * 3)));
const revProg = (p, n) => Math.max(0, Math.min(n - 1, Math.round(p * (n - 1))));
const revEx = (lo, hi, p) => lo * Math.pow(hi / lo, p);
const onePoleA = (fc, fs) => Math.exp(-2 * Math.PI * Math.min(fc, 0.45 * fs) / fs);

// Plate: Jon Dattorro's network "in the style of Griesinger" (Effect Design Part 1, JAES 1997), as
// published: a bandwidth filter, four input allpass diffusers, then a figure-eight tank of two halves,
// each a modulated allpass, a delay, a damping filter, an allpass and a delay, with his output taps.
// The programs scale every length (Medium = his own lengths). Low cut on the input keeps the 303's
// bass out of the tank.
const PLATE_PROGRAMS = [
  { name: 'Tiny plate', short: 'Tiny', size: 0.5 }, { name: 'Small plate', short: 'Small', size: 0.72 },
  { name: 'Medium plate (Dattorro)', short: 'Medium', size: 1 }, { name: 'Large plate', short: 'Large', size: 1.3 },
  { name: 'Huge plate', short: 'Huge', size: 1.65 },
];
const PLATE_IN = [142, 107, 379, 277];
function plateParams(k) {
  const prog = revProg(k.plateprog, PLATE_PROGRAMS.length);
  return {
    prog, P: PLATE_PROGRAMS[prog],
    pre: 250 * k.platepre * k.platepre, rt: revEx(0.3, 20, k.platedecay),
    damp: revEx(1000, 20000, k.platedamp), bw: revEx(1000, 20000, k.platebw), lo: revEx(20, 1000, k.platelo),
    diff: k.platediff, mod: 2 * k.platemod, wet: 2 * audioTaper(k.platemix),
  };
}
class DattorroPlate {
  constructor(fs) { this.fs = fs; this.prog = -1; this.L = 0; this.R = 0; }
  derive(k) {
    const q = plateParams(k), fs = this.fs;
    if (q.prog !== this.prog) this._layout(q.prog);
    this.q = q; this.wet = q.wet;
    this.preD = Math.max(0, Math.round(q.pre * fs / 1000));
    this.bwA = onePoleA(q.bw, fs); this.dmA = onePoleA(q.damp, fs); this.hpA = Math.exp(-2 * Math.PI * q.lo / fs);
    this.g1 = 0.85 * q.diff; this.g2 = 0.708 * q.diff;
    const th = (this.half[0] + this.half[1]) / 2 / fs; // seconds round one half of the tank
    this.decay = Math.min(0.98, Math.pow(10, -1.5 * th / q.rt));
    this.exc = q.mod * 16 * this.sc; // modulated allpass excursion in samples
  }
  _layout(prog) {
    const fs = this.fs, sc = this.sc = fs / 29761 * PLATE_PROGRAMS[prog].size;
    this.prog = prog;
    const L = (n) => Math.max(2, Math.round(n * sc));
    const line = (n) => ({ b: new Float64Array(n + 1), n, w: 0 });
    this.pre = line(Math.ceil(0.25 * fs) + 2);
    this.ind = PLATE_IN.map(n => line(L(n)));
    this.len = LEX_TANK.map(L);
    this.tk = this.len.map((n, i) => line(n + ((i & 3) === 0 ? Math.ceil(4 * 16 * sc) + 4 : 0)));
    this.half = [0, 4].map(o => this.len[o] + this.len[o + 1] + this.len[o + 2] + this.len[o + 3]);
    const tap = (t) => [t[0], Math.max(1, Math.round(t[1] * sc)), t[2]];
    this.tapsL = LEX_TAPS_L.map(tap); this.tapsR = LEX_TAPS_R.map(tap);
    this.reset();
  }
  reset() {
    if (this.prog < 0) return;
    for (const l of [this.pre, ...this.ind, ...this.tk]) { l.b.fill(0); l.w = 0; }
    this.bwS = 0; this.hp = 0; this.hpIn = 0; this.dm = [0, 0]; this.fb = [0, 0]; this.ph = 0; this.L = this.R = 0;
  }
  // delay line: write x, read the sample d back (d <= n)
  static _rd(l, d) { let i = l.w - d; if (i < 0) i += l.b.length; return l.b[i]; }
  static _wr(l, x) { l.w = l.w + 1 === l.b.length ? 0 : l.w + 1; l.b[l.w] = x; }
  static _ap(l, g, x) { const vd = DattorroPlate._rd(l, l.n); let w = x + g * vd; if (w < 1e-30 && w > -1e-30) w = 0; DattorroPlate._wr(l, w); return vd - g * w; }
  run(x) {
    const rd = DattorroPlate._rd, wr = DattorroPlate._wr, ap = DattorroPlate._ap;
    this.hp = this.hpA * (this.hp + x - this.hpIn); this.hpIn = x;
    wr(this.pre, this.hp);
    let u = rd(this.pre, this.preD);
    this.bwS = u + this.bwA * (this.bwS - u); u = this.bwS;
    u = ap(this.ind[0], this.g1, u); u = ap(this.ind[1], this.g1, u); u = ap(this.ind[2], this.g2, u); u = ap(this.ind[3], this.g2, u);
    this.ph += 0.9 / this.fs; if (this.ph >= 1) this.ph -= 1;
    const lfo = [Math.sin(2 * Math.PI * this.ph), Math.cos(2 * Math.PI * this.ph)];
    const tk = this.tk, len = this.len, dec = this.decay;
    const f0 = this.fb[1], f1 = this.fb[0];
    for (let s = 0; s < 2; s++) {
      const o = s * 4;
      let a = u + dec * (s ? f1 : f0);
      // modulated allpass, read with linear interpolation
      const m = tk[o], dl = len[o] + this.exc * (1 + lfo[s]), di = Math.floor(dl), fr = dl - di;
      const vd = rd(m, di) * (1 - fr) + rd(m, di + 1) * fr, w = a - 0.7 * vd;
      wr(m, w); a = vd + 0.7 * w;
      wr(tk[o + 1], a);
      let v = rd(tk[o + 1], len[o + 1]);
      let d = v + this.dmA * (this.dm[s] - v); if (d < 1e-30 && d > -1e-30) d = 0; this.dm[s] = d; v = d * dec;
      v = ap(tk[o + 2], 0.5, v);
      wr(tk[o + 3], v);
      this.fb[s] = rd(tk[o + 3], len[o + 3]);
    }
    const sum = (T) => { let y = 0; for (let i = 0; i < T.length; i++) { const t = T[i]; y += t[2] * rd(tk[t[0]], t[1]); } return y; };
    this.L = 0.38 * sum(this.tapsL); this.R = 0.38 * sum(this.tapsR);
  }
}

// Spring: a dispersive delay-line model after Välimäki, Parker and Abel ("Parametric spring
// reverberation effect", JAES 2010). Each spring is a feedback loop around a delay (the transit time)
// and a cascade of stretched first-order allpasses, A(z) = (a + z^-K) / (1 + a z^-K), which delays
// high frequencies more than low ones: every trip round the loop smears the echo into the falling
// "drip" chirp. K puts the chirp's top near 4.3 kHz, where real springs stop passing sound. Dwell is
// the drive into the tank (as on a Fender reverb), Tension sets the allpass coefficient (longer chirp).
const SPRING_PROGRAMS = [
  { name: 'One spring', short: '1 spring', ms: [36] },
  { name: 'Two springs', short: '2 springs', ms: [31.5, 37.3] },
  { name: 'Three springs', short: '3 springs', ms: [33.1, 37.7, 41.9] },
  { name: 'Long tank', short: 'Long tank', ms: [44.3, 51.1, 58.7] },
];
const SPRING_STAGES = 48;
function springParams(k) {
  const prog = revProg(k.sprprog, SPRING_PROGRAMS.length);
  return {
    prog, P: SPRING_PROGRAMS[prog],
    dwell: revEx(0.5, 8, k.sprdwell), rt: revEx(0.4, 6, k.sprdecay), a: 0.45 + 0.33 * k.sprtension,
    tone: revEx(1500, 6000, k.sprtone), lo: revEx(50, 1000, k.sprlo), wet: 2 * audioTaper(k.sprmix),
  };
}
class SpringReverb {
  constructor(fs) { this.fs = fs; this.K = Math.max(1, Math.round(fs / (2 * 4300))); this.prog = -1; this.L = 0; this.R = 0; }
  derive(k) {
    const q = springParams(k), fs = this.fs;
    if (q.prog !== this.prog) this._layout(q.prog);
    this.q = q; this.wet = q.wet;
    this.dw = q.dwell; this.dwN = 1 / Math.sqrt(q.dwell);
    this.a = q.a; this.lpA = onePoleA(q.tone, fs); this.hpA = Math.exp(-2 * Math.PI * q.lo / fs);
    // loop time: the transit delay plus the chirp's mean group delay
    const gd = SPRING_STAGES * this.K * 0.5 * ((1 - q.a) / (1 + q.a) + (1 + q.a) / (1 - q.a));
    this.g = this.sp.map(s => Math.pow(10, -3 * (s.d + gd) / fs / q.rt));
  }
  _layout(prog) {
    const fs = this.fs, K = this.K; this.prog = prog;
    this.sp = SPRING_PROGRAMS[prog].ms.map(ms => {
      const d = Math.round(ms * 0.001 * fs);
      return { d, buf: new Float64Array(d + 1), w: 0, xh: new Float64Array(SPRING_STAGES * K), yh: new Float64Array(SPRING_STAGES * K), lp1: 0, lp2: 0, fb: 0 };
    });
    // the stretched allpasses repeat their pattern above fs / 2K; cut that mirror image off the output
    const fc = 0.85 * fs / (2 * K);
    this.olL = [lexLowpass(fc, 0.5412, fs), lexLowpass(fc, 1.3066, fs)]; this.olR = [lexLowpass(fc, 0.5412, fs), lexLowpass(fc, 1.3066, fs)];
    this.reset();
  }
  reset() {
    if (this.prog < 0) return;
    for (const f of [...this.olL, ...this.olR]) f.x1 = f.x2 = f.y1 = f.y2 = 0;
    for (const s of this.sp) { s.buf.fill(0); s.xh.fill(0); s.yh.fill(0); s.w = 0; s.lp1 = s.lp2 = s.fb = 0; }
    this.j = 0; this.hp = 0; this.hpIn = 0; this.dc = [0, 0, 0, 0]; this.L = this.R = 0;
  }
  run(x) {
    this.hp = this.hpA * (this.hp + x - this.hpIn); this.hpIn = x;
    const u = Math.tanh(this.hp * this.dw) * this.dwN;
    const K = this.K, a = this.a, j = this.j, lpA = this.lpA, n = this.sp.length;
    let l = 0, r = 0;
    for (let i = 0; i < n; i++) {
      const s = this.sp[i], xh = s.xh, yh = s.yh;
      let v = u + this.g[i] * s.fb;
      for (let m = 0, o = j; m < SPRING_STAGES; m++, o += K) { let y = a * v + xh[o] - a * yh[o]; if (y < 1e-30 && y > -1e-30) y = 0; xh[o] = v; yh[o] = y; v = y; }
      s.lp1 = v + lpA * (s.lp1 - v); s.lp2 = s.lp1 + lpA * (s.lp2 - s.lp1);
      s.w = s.w + 1 === s.buf.length ? 0 : s.w + 1; s.buf[s.w] = s.lp2;
      let ri = s.w - s.d; if (ri < 0) ri += s.buf.length;
      s.fb = s.buf[ri];
      if (n === 1) { l += s.fb; r += s.fb; } else if (i === 2) { l += 0.5 * s.fb; r += 0.5 * s.fb; } else if (i & 1) r += s.fb; else l += s.fb;
    }
    this.j = j + 1 === K ? 0 : j + 1;
    // DC blockers on the outputs
    this.dc[0] = 0.9995 * (this.dc[0] + l - this.dc[1]); this.dc[1] = l;
    this.dc[2] = 0.9995 * (this.dc[2] + r - this.dc[3]); this.dc[3] = r;
    this.L = 0.75 * lexBiq(this.olL, this.dc[0]); this.R = 0.75 * lexBiq(this.olR, this.dc[2]);
  }
}

// Convolution: uniformly partitioned overlap-save FFT convolution (512-sample blocks), with the work
// for the older partitions spread across each block so no single sample does it all. L and R share
// one complex FFT (hL + i hR). The wet signal is one block (about 11 ms) late, which counts toward
// the predelay. Two kinds of impulse response:
//  - recorded ones (ir: an id in irs/irs.json), handed in with setIR() as decoded samples at the host
//    rate and scaled by CNV_IR_GAIN; Length trims them (a fade over the last 30%), full at the top.
//  - generated ones: seeded noise, band-split so the highs die first, a density build-up and early
//    reflections, the same every time. Decay (or Gate) is applied per partition, so turning it is free.
const CNV_B = 512, CNV_N = 1024, CNV_SECS = 3, CNV_BUILD = 8, CNV_IR_GAIN = 0.17752 * 1.15;
const CNV_PROGRAMS = [
  { name: '140 plate', short: 'Plate 140', ir: 'plate140' },
  { name: '140 plate, bright', short: 'Plate 140 Br', ir: 'plate140b' },
  { name: 'Drum room', short: 'Drum room', ir: 'drumroom' },
  { name: 'Grain silo', short: 'Silo', ir: 'silo' },
  { name: 'Concrete garage', short: 'Garage', ir: 'garage' },
  { name: 'Musikverein, Vienna', short: 'Musikverein', ir: 'musikverein' },
  { name: 'On a Star', short: 'On a Star', ir: 'star' },
  { name: 'Church (generated)', short: 'Church', build: 0.08, hf: 0.33, er: [[29, 0.22, 0.4], [47, -0.2, -0.6], [71, 0.16, 0.7], [97, -0.12, -0.3]] },
  { name: 'Gated, 1980s (generated)', short: 'Gated', build: 0.003, hf: 0.75, gate: true, er: [] },
];
function convParams(k) {
  const prog = revProg(k.cnvprog, CNV_PROGRAMS.length), P = CNV_PROGRAMS[prog];
  return {
    prog, P, pre: 250 * k.cnvpre * k.cnvpre, full: !!P.ir && k.cnvdecay >= 0.99,
    rt: P.ir ? revEx(0.2, 3, k.cnvdecay) : P.gate ? revEx(0.12, 1, k.cnvdecay) : revEx(0.2, 4, k.cnvdecay),
    tone: revEx(1000, 20000, k.cnvtone), lo: revEx(20, 1000, k.cnvlo), width: 1.5 * k.cnvwidth, wet: 2 * audioTaper(k.cnvmix),
  };
}
function cnvFFT(re, im, inv, cs, sn) { // in place, radix 2, N = re.length
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const h = len >> 1, st = N / len;
    for (let i = 0; i < N; i += len) for (let k = 0; k < h; k++) {
      const wr = cs[k * st], wi = inv ? sn[k * st] : -sn[k * st];
      const a = i + k, b = a + h, xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
      re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
    }
  }
}
class ConvReverb {
  constructor(fs) { this.fs = fs; this.prog = -1; this.L = 0; this.R = 0; this.ready = false; this.P = Math.ceil(CNV_SECS * fs / CNV_B); this.rt = -1; this.mode = ''; this.ext = {}; }
  // a recorded impulse response, decoded at the host rate (Float32Array per channel)
  setIR(id, L, R) {
    this.ext[id] = { L, R: R || L };
    if (this.prog >= 0 && CNV_PROGRAMS[this.prog].ir === id) this.dirty = true;
  }
  derive(k) {
    const q = convParams(k), fs = this.fs;
    this.q = q; this.wet = q.wet;
    if (q.prog !== this.prog) { this.prog = q.prog; this.dirty = true; }
    this.preD = Math.max(0, Math.round(q.pre * fs / 1000 - CNV_B));
    this.lpA = onePoleA(q.tone, fs); this.hpA = Math.exp(-2 * Math.PI * q.lo / fs); this.width = q.width;
    const mode = q.P.ir ? (q.full ? 'full' : 'len') : q.P.gate ? 'gate' : 'exp';
    if (q.rt !== this.rt || mode !== this.mode) {
      this.rt = q.rt; this.mode = mode;
      this.pg = this.pg || new Float64Array(this.P); let n = 0;
      for (let p = 0; p < this.P; p++) {
        const t = (p + 0.5) * CNV_B / fs;
        const g = mode === 'full' ? 1 : mode === 'exp' ? Math.exp(-6.9078 * t / q.rt)
          : mode === 'gate' ? (t < q.rt * 0.8 ? 1 : Math.max(0, 1 - (t - q.rt * 0.8) / (q.rt * 0.2)))
          : (t < q.rt * 0.7 ? 1 : Math.max(0, 1 - (t - q.rt * 0.7) / (q.rt * 0.3)));
        this.pg[p] = g; if (g > 1e-4) n = p + 1;
      }
      this.nG = n;
    }
  }
  _alloc() {
    const P = this.P, N = CNV_N;
    this.cs = new Float64Array(N / 2); this.sn = new Float64Array(N / 2);
    for (let i = 0; i < N / 2; i++) { this.cs[i] = Math.cos(2 * Math.PI * i / N); this.sn[i] = Math.sin(2 * Math.PI * i / N); }
    this.hr = new Float32Array(P * N); this.hi = new Float32Array(P * N);
    this.xr = new Float32Array(P * N); this.xi = new Float32Array(P * N);
    this.ar = new Float64Array(N); this.ai = new Float64Array(N); this.fr = new Float64Array(N); this.fi = new Float64Array(N);
    this.inb = new Float64Array(N); this.outL = new Float64Array(CNV_B); this.outR = new Float64Array(CNV_B);
    this.pre = new Float64Array(Math.ceil(0.25 * this.fs) + 2);
    this.ready = true; this.reset();
  }
  reset() {
    if (!this.ready) return;
    this.xr.fill(0); this.xi.fill(0); this.ar.fill(0); this.ai.fill(0); this.inb.fill(0); this.outL.fill(0); this.outR.fill(0); this.pre.fill(0);
    this.i = 0; this.slot = 0; this.next = 1; this.nAct = 0; this.pw = 0; this.hp = 0; this.hpIn = 0; this.lpL = this.lpR = 0; this.L = this.R = 0;
  }
  // start a new impulse response; it is built a few partitions per block (see _buildSome)
  _startIR() {
    this.dirty = false; this.built = 0; this.seed = [0x9e3779b9 + this.prog * 7919, 0x85ebca6b + this.prog * 104729];
    this.gs = [[0, 0], [0, 0]]; // per channel: two one-pole states for the band split
    const fs = this.fs, P = CNV_PROGRAMS[this.prog];
    // a recorded IR: nothing to build until its samples arrive (setIR marks it dirty again)
    this.src = P.ir ? this.ext[P.ir] || null : null;
    this.nIR = P.ir ? (this.src ? Math.min(this.P, Math.ceil(this.src.L.length / CNV_B)) : 0) : this.P;
    if (P.ir) return;
    this.g0 = Math.sqrt(13.8 * 3 / (fs * 1.5)); // unit energy at 1.5 s
    this.aLo = onePoleA(400, fs); this.aHi = onePoleA(3500, fs);
    this.hfK = 3.4539 * (1 / P.hf - 1); // the highs die faster: extra decay per second, relative to 2 s
    this.erT = P.er.map(e => [Math.round(e[0] * 0.001 * fs), e[1] * 18 * this.g0, e[2]]);
  }
  _rand(c) { // mulberry32 per channel, -1..1
    let t = this.seed[c] = (this.seed[c] + 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  }
  _buildSome() {
    const N = CNV_N, B = CNV_B, fs = this.fs, P = CNV_PROGRAMS[this.prog], fr = this.fr, fi = this.fi;
    for (let c = 0; c < CNV_BUILD && this.built < this.nIR; c++) {
      const p = this.built;
      if (this.src) {
        const sL = this.src.L, sR = this.src.R, o = p * B, m = Math.min(B, sL.length - o);
        for (let n = 0; n < m; n++) { fr[n] = sL[o + n] * CNV_IR_GAIN; fi[n] = (o + n < sR.length ? sR[o + n] : 0) * CNV_IR_GAIN; }
        for (let n = m; n < N; n++) { fr[n] = 0; fi[n] = 0; }
        cnvFFT(fr, fi, false, this.cs, this.sn);
        this.hr.set(fr, p * N); this.hi.set(fi, p * N);
        this.built++;
        continue;
      }
      for (let n = 0; n < B; n++) {
        const s = p * B + n, t = s / fs;
        const env = this.g0 * (1 - Math.exp(-t / P.build)), eh = Math.exp(-this.hfK * t);
        for (let ch = 0; ch < 2; ch++) {
          const u = this._rand(ch), g = this.gs[ch];
          g[0] = u + this.aLo * (g[0] - u); g[1] = u + this.aHi * (g[1] - u);
          let h = env * (g[1] + eh * (u - g[1]));
          for (const e of this.erT) if (e[0] === s) h += e[1] * (ch ? 1 + e[2] : 1 - e[2]);
          if (ch) fi[n] = h; else fr[n] = h;
        }
      }
      for (let n = B; n < N; n++) { fr[n] = 0; fi[n] = 0; }
      cnvFFT(fr, fi, false, this.cs, this.sn);
      this.hr.set(fr, p * N); this.hi.set(fi, p * N);
      this.built++;
    }
  }
  _mac(p, s) { // acc += X(slot s) * H(p) * gain(p)
    const N = CNV_N, P = this.P, g = this.pg[p];
    if (s < 0) s += P;
    const xo = s * N, ho = p * N, xr = this.xr, xi = this.xi, hr = this.hr, hi = this.hi, ar = this.ar, ai = this.ai;
    for (let k = 0; k < N; k++) {
      const a = xr[xo + k], b = xi[xo + k], c = hr[ho + k], d = hi[ho + k];
      ar[k] += g * (a * c - b * d); ai[k] += g * (a * d + b * c);
    }
  }
  run(x) {
    if (!this.ready) this._alloc();
    if (this.dirty) { this._startIR(); this.reset(); }
    const B = CNV_B, N = CNV_N;
    this.hp = this.hpA * (this.hp + x - this.hpIn); this.hpIn = x;
    const pl = this.pre.length; this.pw = this.pw + 1 === pl ? 0 : this.pw + 1; this.pre[this.pw] = this.hp;
    let ri = this.pw - this.preD; if (ri < 0) ri += pl;
    const i = this.i;
    this.inb[B + i] = this.pre[ri];
    // the older partitions, a share each sample, for the output due at the end of this block
    const target = 1 + Math.floor((i + 1) * (this.nAct - 1) / B);
    while (this.next < target) { this._mac(this.next, this.slot + 1 - this.next); this.next++; }
    let yl = this.outL[i], yr = this.outR[i];
    if (++this.i === B) {
      this.i = 0;
      // new input spectrum from [last block, this block]
      const fr = this.fr, fi = this.fi, inb = this.inb;
      for (let n = 0; n < N; n++) { fr[n] = inb[n]; fi[n] = 0; }
      for (let n = 0; n < B; n++) inb[n] = inb[B + n];
      cnvFFT(fr, fi, false, this.cs, this.sn);
      this.slot = this.slot + 1 === this.P ? 0 : this.slot + 1;
      this.xr.set(fr, this.slot * N); this.xi.set(fi, this.slot * N);
      if (this.nAct > 0) this._mac(0, this.slot);
      const ar = this.ar, ai = this.ai;
      for (let n = 0; n < N; n++) { fr[n] = ar[n]; fi[n] = ai[n]; ar[n] = 0; ai[n] = 0; }
      cnvFFT(fr, fi, true, this.cs, this.sn);
      for (let n = 0; n < B; n++) { this.outL[n] = fr[B + n] / N; this.outR[n] = fi[B + n] / N; }
      if (this.built < this.nIR) this._buildSome();
      this.nAct = Math.min(this.built, this.nG); this.next = 1;
    }
    // tone, then width (mid/side)
    this.lpL = yl + this.lpA * (this.lpL - yl); this.lpR = yr + this.lpA * (this.lpR - yr);
    const m = 0.5 * (this.lpL + this.lpR), sd = 0.5 * (this.lpL - this.lpR) * this.width;
    this.L = m + sd; this.R = m - sd;
  }
}

// zero subnormal-bound numbers in an object's own state (plain numbers, small arrays, nested state objects)
const FLUSH_SKIP = new Set(['c', 'knobs', 'fx', 'lex', 'plate', 'spring', 'conv', 'mem', 'C', 'ds', 'ts', 'b259']);
function flushTiny(o, depth) {
  if (Array.isArray(o) || ArrayBuffer.isView(o)) {
    if (o.length > 64) return;
    for (let i = 0; i < o.length; i++) { const x = o[i]; if (typeof x === 'number') { if (x !== 0 && x < 1e-150 && x > -1e-150) o[i] = 0; } else if (x && typeof x === 'object' && depth < 2) flushTiny(x, depth + 1); }
    return;
  }
  for (const k in o) {
    const x = o[k];
    if (typeof x === 'number') { if (x !== 0 && x < 1e-150 && x > -1e-150) o[k] = 0; }
    else if (x && typeof x === 'object' && depth < 2 && !FLUSH_SKIP.has(k)) flushTiny(x, depth + 1);
  }
}

const RAT_OS = 2; // the RAT runs at 2x the voice rate (4x the host rate)

// ---------------------------------------------------------------------------
// Three more units from published schematics, ported unchanged from Johnny's Shyoy (johnnyhawk02/sh101 cde59c9, v0.11.0):
// a Boss DS-1 and an Ibanez TS808 Tube Screamer on the
// drive slot beside the RAT, and the Buchla 259 timbre wavefolder ahead of it. Part values are from ElectroSmash's
// circuit analyses (electrosmash.com/boss-ds1-analysis, /tube-screamer-analysis) and from Esqueda, Pöntynen,
// Välimäki & Parker, "Virtual Analog Buchla 259 Wavefolder" (DAFx-17). Each runs at 4x the host rate like the RAT
// (the constructor takes the voice rate, 2x the host), with the RAT's 22 kHz decimation filter and 5 Hz DC block.
// Input is taken as volts, as for the RAT.
const DIODE_1N4148 = { Is: 2.52e-9, n: 1.752 }; // 1N4148 / 1N914 SPICE values
const PEDAL_PARTS = {
  // Boss DS-1 (ElectroSmash part list, "DS1-A")
  DS_C3: 47e-9, DS_R5: 100e3,            // booster input HPF, 33 Hz
  DS_GAIN: 56, DS_R7: 470e3, DS_C4: 250e-12, // Q2 2SC2240: 10k/22R with R7||C4 collector-base feedback, 35 dB
  DS_VC: 5.8, DS_VSAT: 0.3,              // Q2 collector bias and saturation, on a 9 V rail
  DS_C5: 68e-9, DS_R10: 100e3,           // op-amp input HPF, 23 Hz
  DS_R13: 4.7e3, DS_C8: 0.47e-6, DS_VR1: 100e3, DS_C7: 100e-12, // gain 1 + VR1/(R13 + 1/sC8), C7 across VR1
  DS_OPHI: 3.0, DS_OPLO: 4.3,            // NJM2904 output swing about the 4.5 V bias (not rail to rail)
  DS_R14: 2.2e3, DS_C10: 10e-9,          // series R into D4/D5 1N4148 to AC ground, with C10 across them
  DS_R16: 6.8e3, DS_C12: 0.1e-6,         // tone LPF, 234 Hz
  DS_C11: 22e-9, DS_R17: 6.8e3,          // tone HPF, 1063 Hz
  // Ibanez TS808 (ElectroSmash)
  TS_C2: 1e-6, TS_R5: 10e3,              // input coupling to the 4.5 V bias, 16 Hz
  TS_R4: 4.7e3, TS_C3: 47e-9,            // gain leg to the bias, 720 Hz
  TS_R6: 51e3, TS_P1: 500e3, TS_C4: 51e-12, // feedback: R6 + Drive (500k log) || C4 || D1/D2
  TS_RAIL: 3.5,                          // JRC4558 swing about 4.5 V
  TS_R7: 1e3, TS_C5: 0.22e-6,            // passive LPF, 723 Hz
  TS_P2: 20e3, TS_R8: 220, TS_C6: 0.22e-6, TS_RF: 1e3, // tone: wiper to ground through 220R + 0.22u, 1k feedback
  // Buchla 259 (DAFx-17, Table 1): [R1, R2, R3] per folding cell, Vs = 6 V CA3160 rails
  B259_VS: 6,
  B259_CELLS: [[10e3, 100e3, 100e3], [49.9e3, 100e3, 43.2e3], [91e3, 100e3, 56e3], [30e3, 100e3, 68e3], [68e3, 100e3, 33e3]],
  B259_W: [-12.000, -27.777, -21.428, 17.647, 36.363], B259_WIN: 5.000, // mixer weights, Eq. 18
  B259_RF2: 1.2e6, B259_C: 100e-12,      // output pole, 1.33 kHz
};
const PEDAL_OS = 2; // they run inside the voice (already 2x), so 2x that = 4x the host rate, as the RAT

// shared by the three: linear upsampling, a third-order 22 kHz Butterworth down filter and a DC block
class OsUnit {
  constructor(fs) {
    this.fs = fs; this.fo = fs * PEDAL_OS; this.dt = 1 / this.fo; this.xp = 0; this.dco = 0; this.dci = 0;
    const w = 2 * Math.PI * 22000 / this.fo, cs = Math.cos(w);
    this.lp = [0.5176, 0.7071, 1.9319].map(Q => { const al = Math.sin(w) / (2 * Q), a0 = 1 + al; return { b0: (1 - cs) / 2 / a0, b1: (1 - cs) / a0, b2: (1 - cs) / 2 / a0, a1: -2 * cs / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 }; });
    this.dcA = Math.exp(-2 * Math.PI * 5 / fs);
  }
  e(tau) { return Math.exp(-this.dt / Math.max(tau, 1e-12)); } // one-pole coefficient for a time constant
  run(x) {
    const x0 = this.xp; this.xp = x; let y = 0;
    for (let i = 1; i <= PEDAL_OS; i++) {
      let z = this.core(x0 + (x - x0) * (i / PEDAL_OS));
      for (const q of this.lp) { const o = q.b0 * z + q.b1 * q.x1 + q.b2 * q.x2 - q.a1 * q.y1 - q.a2 * q.y2; q.x2 = q.x1; q.x1 = z; q.y2 = q.y1; q.y1 = o; z = o; }
      y = z;
    }
    this.dco = this.dcA * (this.dco + y - this.dci); this.dci = y;
    return this.dco;
  }
}
// implicit (backward Euler) node with a 1N4148 pair to ground: solves g(w - v) + i0 = C(v - vp)/dt + 2 Is sinh(v/nVt)
// for v by the RAT's safeguarded Newton (bracketed, bisects when a step would leave the bracket).
// gw: conductance times drive voltage plus any injected current; G: total linear conductance to the node
function diodeNode(gw, G, vp, Is, nVt) {
  const lin = gw / G; // the root lies between 0 and the diodes-off solution
  let lo = lin < 0 ? lin : 0, hi = lin < 0 ? 0 : lin, v = Math.min(hi, Math.max(lo, vp));
  for (let i = 0; i < 40; i++) {
    const t = Math.min(Math.max(v / nVt, -80), 80), ex = Math.exp(t), ei = 1 / ex;
    const f = gw - G * v - Is * (ex - ei), df = -G - Is * (ex + ei) / nVt;
    if (f > 0) lo = v; else hi = v;
    let nv = v - f / df;
    if (!(nv > lo && nv < hi)) nv = 0.5 * (lo + hi);
    const dv = nv - v; v = nv;
    if (dv < 1e-7 && dv > -1e-7) break;
  }
  return v;
}
// smooth limit into [-lo, hi] (a transistor or op-amp running into its rails)
const softRail = (v, hi, lo) => v > 0 ? hi * Math.tanh(v / hi) : lo * Math.tanh(v / lo);

// Boss DS-1: Q2 booster, op-amp gain stage, R14 into a diode pair to ground with C10, the Big Muff-style tone, level
class BossDS1 extends OsUnit {
  constructor(fs) { super(fs); this.s = { h0: 0, x0: 0, b: 0, h1: 0, x1: 0, hl: 0, xl: 0, vf: 0, v: 0, lp: 0, hp: 0, xh: 0 }; }
  derive(k) {
    const c = PEDAL_PARTS;
    this.aIn = this.e(c.DS_C3 * c.DS_R5);
    this.aB = this.e(c.DS_R7 * c.DS_C4);
    this.aOp = this.e(c.DS_C5 * c.DS_R10);
    this.aLeg = this.e(c.DS_R13 * c.DS_C8);
    this.vr1 = c.DS_VR1 * k.dsdist + 1;                 // VR1 100KB, linear
    this.aF = this.e(this.vr1 * c.DS_C7);
    this.gC = 1 / c.DS_R14; this.cdt = c.DS_C10 / this.dt;
    this.aLp = this.e(c.DS_R16 * c.DS_C12); this.aHp = this.e(c.DS_C11 * c.DS_R17);
    this.tone = k.dstone;                               // VR3 20KB: LPF output at 0, HPF output at full
    this.level = audioTaper(k.dslevel) * 12;            // VR2 100KB into the output buffer; set so it sits as loud as the RAT
    this.nVt = DIODE_1N4148.n * VT;
  }
  core(x) {
    const s = this.s, c = PEDAL_PARTS;
    s.h0 = this.aIn * (s.h0 + x - s.x0); s.x0 = x;                 // C3/R5 into Q2's base
    const tb = -c.DS_GAIN * s.h0;                                  // inverting common emitter, 35 dB
    s.b = tb + this.aB * (s.b - tb);                               // R7 || C4 feedback rolls off the top
    const q = softRail(s.b, 9 - c.DS_VC, c.DS_VC - c.DS_VSAT);     // collector swings between the 9 V rail and saturation
    s.h1 = this.aOp * (s.h1 + q - s.x1); s.x1 = q;                 // C5/R10 to the op-amp + input
    const u = s.h1;
    s.hl = this.aLeg * (s.hl + u - s.xl); s.xl = u;                // gain leg R13 + C8: current = hl / R13
    const vf = s.hl / c.DS_R13 * this.vr1;                         // across VR1, with C7 in parallel
    s.vf = vf + this.aF * (s.vf - vf);
    const o = softRail(u + s.vf, c.DS_OPHI, c.DS_OPLO);
    s.v = diodeNode(this.gC * o + this.cdt * s.v, this.gC + this.cdt, s.v, DIODE_1N4148.Is, this.nVt); // R14, C10, D4/D5
    s.lp = s.v + this.aLp * (s.lp - s.v);                          // R16/C12
    s.hp = this.aHp * (s.hp + s.v - s.xh); s.xh = s.v;             // C11/R17
    return ((1 - this.tone) * s.lp + this.tone * s.hp) * this.level;
  }
}

// Ibanez TS808: non-inverting clipping amp with D1/D2 in the feedback, R7/C5, the active tone stage, level
class TubeScreamer extends OsUnit {
  constructor(fs) { super(fs); this.s = { h0: 0, x0: 0, hl: 0, xl: 0, vf: 0, z1: 0, z2: 0, w1: 0, w2: 0 }; }
  derive(k) {
    const c = PEDAL_PARTS, fo = this.fo;
    this.aIn = this.e(c.TS_C2 * c.TS_R5);
    this.aLeg = this.e(c.TS_R4 * c.TS_C3);
    this.rf = c.TS_R6 + c.TS_P1 * audioTaper(k.tsdrive); // Drive 500k log
    this.gF = 1 / this.rf; this.cdt = c.TS_C4 / this.dt;
    this.nVt = DIODE_1N4148.n * VT;
    // R7/C5 into the second op-amp (+), the tone pot between its (+) and (-) inputs, the wiper to ground through R8 + C6,
    // RF from the output to (-). With the inputs at one voltage the two pot halves Ra (+ side) and Rb (- side) share the
    // wiper current: the Ra part loads the (+) node, the Rb part comes through RF and lifts the output. Solved in s:
    //   H(s) = (1 + s C6 (Rs + kb RF)) / ((1 + s C5 R7)(1 + s C6 Rs) + ka s C6 R7),  Rs = Ra || Rb + R8,
    //   ka = Rb / P2, kb = Ra / P2.  Tone at 0 (bass end, Ra = 0) adds a low-pass; at full (Rb = 0) a treble shelf.
    const t = Math.min(0.999, Math.max(0.001, k.tstone)), Ra = c.TS_P2 * t, Rb = c.TS_P2 * (1 - t);
    const Rs = Ra * Rb / (Ra + Rb) + c.TS_R8, ka = Rb / c.TS_P2, kb = Ra / c.TS_P2;
    const R7 = c.TS_R7, C5 = c.TS_C5, C6 = c.TS_C6;
    const n0 = 1, n1 = C6 * (Rs + kb * c.TS_RF), n2 = 0;
    const d0 = 1, d1 = C5 * R7 + C6 * Rs + ka * C6 * R7, d2 = C5 * R7 * C6 * Rs;
    const K = 2 * fo, K2 = K * K, a0 = d0 + d1 * K + d2 * K2; // bilinear
    this.tb = [(n0 + n1 * K + n2 * K2) / a0, (2 * n0 - 2 * n2 * K2) / a0, (n0 - n1 * K + n2 * K2) / a0];
    this.ta = [(2 * d0 - 2 * d2 * K2) / a0, (d0 - d1 * K + d2 * K2) / a0];
    this.level = audioTaper(k.tslevel) * 13;            // Level 100k into the output buffer; x13 here (x9 in Shyoy) so it sits as loud as the RAT on the 303
  }
  core(x) {
    const s = this.s, c = PEDAL_PARTS;
    s.h0 = this.aIn * (s.h0 + x - s.x0); s.x0 = x;                 // C2/R5
    const u = s.h0;
    s.hl = this.aLeg * (s.hl + u - s.xl); s.xl = u;                // R4 + C3: the leg current is hl / R4
    const i = s.hl / c.TS_R4;                                      // ...and all of it flows through the feedback network
    s.vf = diodeNode(i + this.cdt * s.vf, this.gF + this.cdt, s.vf, DIODE_1N4148.Is, this.nVt); // (R6 + Drive) || C4 || D1/D2
    const o = softRail(u + s.vf, c.TS_RAIL, c.TS_RAIL);
    const b = this.tb, a = this.ta;                                 // tone stage, transposed direct form II
    const y = b[0] * o + s.z1; s.z1 = b[1] * o - a[0] * y + s.z2; s.z2 = b[2] * o - a[1] * y;
    return y * this.level;
  }
}

// Buchla 259 timbre circuit: five CA3160 folding cells and a direct path summed (Eq. 18), then RF2·C (1.33 kHz).
// Timbre is the input gain into the cells (the paper sweeps 0..10 V peak); Symmetry adds a DC offset ahead of them,
// as the 259's own Symmetry control does. First-order antiderivative anti-aliasing on top of the 4x oversampling.
// Around it, outside the circuit (Johnny found the straight port loud and subtle on the 303, whose notes peak near 0.6 V
// and decay fast): a peak follower (instant attack, 200 ms release) scales the input so every note reaches the cells
// at Timbre's level, and puts the note's envelope back on the output; the output is then scaled by the folding curve's
// swing at this Timbre and Symmetry, so turning Timbre up changes the tone, not the level.
const B259_REL = 0.2, B259_FLOOR = 0.005; // follower release (s) and floor (V)
class Buchla259 extends OsUnit {
  constructor(fs) {
    super(fs); this.s = { xa: 0, Fa: 0, y: 0, env: 0 };
    const c = PEDAL_PARTS, Vs = c.B259_VS;
    // cell k: 0 inside |v| <= T, else a v - b sgn(v) (continuous, a T = b); weights folded in, plus the direct path
    this.cells = c.B259_CELLS.map(([R1, R2, R3], i) => {
      const D = R1 * R3 + R2 * R3 + R1 * R2, a = R2 * R3 / D, b = R1 * R3 * Vs / D, T = R1 / R2 * Vs, w = c.B259_W[i];
      return { T, a: w * a, b: w * b, C: w * (a * T * T / 2 - b * T) };
    });
    this.relA = this.e(B259_REL);
  }
  f(v) { let y = PEDAL_PARTS.B259_WIN * v; for (const q of this.cells) { const m = v < 0 ? -v : v; if (m > q.T) y += q.a * v - (v < 0 ? -q.b : q.b); } return y; }
  F(v) { let y = 0.5 * PEDAL_PARTS.B259_WIN * v * v; for (const q of this.cells) { const m = v < 0 ? -v : v; if (m > q.T) y += q.a * v * v / 2 - q.b * m - q.C; } return y; }
  derive(k) {
    const c = PEDAL_PARTS;
    this.gain = 0.5 + 9.5 * k.fldtimbre * k.fldtimbre;  // 0.5 .. 10 V at the cells for a full-level note
    this.off = (k.fldsym - 0.5) * 4;                     // ±2 V
    this.aOut = this.e(c.B259_RF2 * c.B259_C);
    // the curve's offset at rest (taken off so Symmetry leaves no DC to thump with the envelope) and its largest swing
    this.f0 = this.f(this.off);
    let pk = 1e-9;
    for (let i = 0; i <= 256; i++) { const y = this.f(this.off + this.gain * (i / 128 - 1)) - this.f0; const m = y < 0 ? -y : y; if (m > pk) pk = m; }
    // level: between the curve's peak (pk) and its small-signal gain (WIN x gain), weighted against the 303 so the
    // level stays within about 3 dB across Timbre; Level at noon matches the dry synth at Timbre 0
    this.norm = audioTaper(k.fldlevel) * 6.7 / (Math.pow(c.B259_WIN * this.gain, 0.3) * Math.pow(pk, 0.7));
  }
  core(x) {
    const s = this.s, ax = x < 0 ? -x : x;
    s.env = ax > s.env ? ax : s.env * this.relA;                   // peak follower
    const en = s.env > B259_FLOOR ? s.env : B259_FLOOR;
    const v = x / en * this.gain + this.off, Fv = this.F(v), d = v - s.xa;
    const y = (d > 1e-6 || d < -1e-6) ? (Fv - s.Fa) / d : this.f(0.5 * (v + s.xa));
    s.xa = v; s.Fa = Fv;
    s.y = y + this.aOut * (s.y - y);                               // RF2 with C, 1.33 kHz
    return (s.y - this.f0) * en * this.norm;
  }
}

// Simple digital delay (outside the circuit): tempo-synced time, feedback, and a low cut and high cut
// inside the feedback loop, so every repeat gets thinner and darker. Clean digital repeats, no saturation.
// Ping-pong (default): the synth goes into the left line only and each line feeds the other, so repeats
// alternate left, right, left. Mono: one line, the same repeats on both sides.
const DLY_DIVS = [['1/32', 1 / 8], ['1/16T', 1 / 6], ['1/16', 1 / 4], ['1/8T', 1 / 3], ['1/16D', 3 / 8], ['1/8', 1 / 2], ['1/4T', 2 / 3], ['1/8D', 3 / 4], ['1/4', 1], ['1/4D', 3 / 2], ['1/2', 2]];
const dlyDiv = (p) => DLY_DIVS[Math.min(DLY_DIVS.length - 1, Math.round(p * (DLY_DIVS.length - 1)))];
const dlyLo = (p) => 20 * Math.pow(50, p);        // 20 Hz .. 1 kHz
const dlyHi = (p) => 1000 * Math.pow(20, p);      // 1 kHz .. 20 kHz
class DigitalDelay {
  constructor(fs) {
    this.fs = fs; this.buf = new Float32Array(Math.ceil(fs * 2.6)); this.bufR = new Float32Array(this.buf.length); this.w = 0;
    this.d = fs * 0.25; this.dT = this.d; this.lp = 0; this.hp = 0; this.hpIn = 0; this.lpR = 0; this.hpR = 0; this.hpInR = 0;
    this.l = 0; this.r = 0; this.pp = true;
  }
  derive(k, bpm) {
    const fs = this.fs;
    this.dT = Math.min(this.buf.length - 4, dlyDiv(k.dlytime)[1] * 60 / bpm * fs);
    this.fb = 0.95 * k.dlyfb;
    this.lpA = Math.exp(-2 * Math.PI * Math.min(dlyHi(k.dlyhi), 0.45 * fs) / fs);
    this.hpA = Math.exp(-2 * Math.PI * dlyLo(k.dlylo) / fs);
    this.mix = k.dlymix * k.dlymix * 1.2; // return level, roughly even in loudness
    this.slewA = 1 - Math.exp(-1 / (0.06 * fs)); // time changes glide over ~60 ms instead of clicking
    const pp = k.dlypp >= 0.5; if (pp !== this.pp) { this.pp = pp; this.bufR.fill(0); }
  }
  run(x) {
    const b = this.buf, B = this.bufR, N = b.length;
    this.d += (this.dT - this.d) * this.slewA;
    let r = this.w - this.d; if (r < 0) r += N;
    const i = Math.floor(r), f = r - i, j = i + 1 === N ? 0 : i + 1;
    let y = b[i] + (b[j] - b[i]) * f;
    // tone: one-pole low cut and high cut on what comes back
    this.hp = this.hpA * (this.hp + y - this.hpIn); this.hpIn = y; y = this.hp;
    this.lp = y + this.lpA * (this.lp - y); y = this.lp;
    if (this.pp) {
      let z = B[i] + (B[j] - B[i]) * f;
      this.hpR = this.hpA * (this.hpR + z - this.hpInR); this.hpInR = z; z = this.hpR;
      this.lpR = z + this.lpA * (this.lpR - z); z = this.lpR;
      b[this.w] = x + this.fb * z; B[this.w] = y; // left takes the input and the right's repeats; right takes the left's
      this.l = y * this.mix; this.r = z * this.mix;
    } else {
      b[this.w] = x + this.fb * y;
      this.l = this.r = y * this.mix;
    }
    this.w = this.w + 1 === N ? 0 : this.w + 1;
    return this.l;
  }
}

// Flanger after the Boss BF-2: a 1024-stage bucket brigade (MN3207) clocked by a VCO (MN3102), so the delay is
// 1024 / (2 f_clk). The clock runs from about 500 kHz down to 40 kHz, which is 1 to 12.8 ms; the clock is linear in the
// control voltage, so the delay sweeps as 1/f and lingers at the long end. Manual sets the voltage, the triangle LFO
// sweeps around it (Depth, Rate), Res feeds the BBD output back to its input through a soft clip. The BBD sits between
// two fixed 8 kHz low-pass filters (anti-alias and reconstruction), and the output is the dry and delayed signals mixed
// equally, which gives the comb. Chorus mode: no feedback, longer delays and a shallower sweep. Estimated from the
// BF-2 service notes' block diagram; the BBD's sample-and-hold grit and noise are not modelled.
const FLG_STAGES = 1024, FLG_FHI = 500e3, FLG_FLO = 40e3, FLG_LPF = 8000;
const flgRate = (p) => 0.1 * Math.pow(100, p); // 0.1-10 Hz
const flgMs = (v) => 1000 * FLG_STAGES / (2 * (FLG_FHI - v * (FLG_FHI - FLG_FLO)));
class BF2Flanger {
  constructor(fs) {
    this.fs = fs; this.buf = new Float32Array(Math.ceil(fs * 0.016) + 4); this.w = 0; this.ph = 0; this.y = 0; this.g = 0.62;
    const K = Math.tan(Math.PI * Math.min(FLG_LPF, 0.45 * fs) / fs), Q = Math.SQRT1_2, n = 1 / (1 + K / Q + K * K);
    this.b0 = K * K * n; this.a1 = 2 * (K * K - 1) * n; this.a2 = (1 - K / Q + K * K) * n;
    this.i1 = 0; this.i2 = 0; this.j1 = 0; this.j2 = 0; this.o1 = 0; this.o2 = 0; this.p1 = 0; this.p2 = 0;
  }
  derive(k) {
    this.chorus = k.flgmode >= 0.5;
    this.inc = flgRate(k.flgrate) / this.fs;
    this.man = k.flgman; this.dep = k.flgdep;
    this.fb = this.chorus ? 0 : 0.9 * k.flgres;
    this.g = this.chorus ? 0.72 : 0.62; // the equal mix, raised so switching it on keeps roughly the dry loudness (the comb and the 8 kHz filter take about 3 dB)
  }
  run(x) {
    this.ph += this.inc; if (this.ph >= 1) this.ph -= 1;
    const tri = this.ph < 0.5 ? 4 * this.ph - 1 : 3 - 4 * this.ph;
    let v = this.chorus ? 0.55 + 0.45 * this.man + 0.15 * this.dep * tri : this.man + 0.5 * this.dep * tri;
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    const d = FLG_STAGES / (2 * (FLG_FHI - v * (FLG_FHI - FLG_FLO))) * this.fs;
    // anti-alias filter into the BBD, with the feedback
    const u = x + this.fb * Math.tanh(this.y);
    const a = this.b0 * (u + 2 * this.i1 + this.i2) - this.a1 * this.j1 - this.a2 * this.j2;
    this.i2 = this.i1; this.i1 = u; this.j2 = this.j1; this.j1 = a;
    const b = this.buf, N = b.length;
    b[this.w] = a;
    let r = this.w - d; if (r < 0) r += N;
    const i = Math.floor(r), f = r - i, j = i + 1 === N ? 0 : i + 1;
    const z = b[i] + (b[j] - b[i]) * f;
    this.w = this.w + 1 === N ? 0 : this.w + 1;
    // reconstruction filter after it
    const y = this.b0 * (z + 2 * this.o1 + this.o2) - this.a1 * this.p1 - this.a2 * this.p2;
    this.o2 = this.o1; this.o1 = z; this.p2 = this.p1; this.p1 = y;
    this.y = y;
    return this.g * (x + y);
  }
}

// Sidechain on the effect returns, after the Kilohearts Compactor (a limiter/ducker that works at sample
// level). The key is the dry synth. Two controls: Amount and Release. Amount sets both how deep the duck
// goes (0 = off, about 70% = full duck) and how sensitive it is (the key level that ducks fully goes from
// -10 dB to -30 dB). The rest is fixed: a linear key law, 3 ms lookahead (the returns are delayed by it
// so the ramp lands ahead of the transient), no hold, and a per-sample peak detector.
// Release brings the returns back (0 to 1 s); at 0 the gain follows the key waveform (ring-mod sidechaining).
// Our reading of the published control descriptions; Kilohearts does not publish its gain law.
const cmpThrDb = (a) => -10 - 20 * a;       // key level that gives a full duck
const cmpMix = (a) => Math.min(1, 1.4 * a); // duck depth
const cmpRelMs = (p) => 1000 * p * p;
const CMP_ATK_MS = 3;
class Compactor {
  constructor(fs) {
    this.fs = fs; this.L = new Float32Array(Math.ceil(fs * 0.011)); this.R = new Float32Array(this.L.length); this.w = 0;
    this.env = 0; this.l = 0; this.r = 0; this.g = 1;
  }
  derive(k) {
    const fs = this.fs;
    this.inv = Math.pow(10, -cmpThrDb(k.cmpamt) / 20);
    this.D = Math.min(this.L.length - 1, Math.round(CMP_ATK_MS * 1e-3 * fs));
    this.atkA = 1 - Math.exp(-3 / this.D);
    const rel = cmpRelMs(k.cmprel) * 1e-3 * fs;
    this.relA = rel > 0.5 ? Math.exp(-1 / rel) : 0;
    this.mix = cmpMix(k.cmpamt);
  }
  // key y, returns wl/wr: stores the delayed returns in l/r and gives the gain for them
  run(y, wl, wr) {
    let a = Math.abs(y) * this.inv; if (a > 1) a = 1; // duck amount, 1 = silence at the threshold
    if (a >= this.env) this.env += (a - this.env) * this.atkA;
    else this.env = a + (this.env - a) * this.relA;
    // lookahead: the returns come out D samples late, so the ramp lands on time
    const N = this.L.length; let ri = this.w - this.D; if (ri < 0) ri += N;
    this.L[this.w] = wl; this.R[this.w] = wr; this.l = this.L[ri]; this.r = this.R[ri]; this.w = this.w + 1 === N ? 0 : this.w + 1;
    this.g = 1 - this.mix * this.env;
    return this.g;
  }
}

class TB303Voice {
  constructor(sampleRate, components) {
    this.fsOut = sampleRate;
    this.os = 2;
    this.fs = sampleRate * this.os;
    this.h = 1 / this.fs;
    this.c = {};
    for (const k in COMPONENTS) this.c[k] = (components && k in components) ? components[k] : COMPONENTS[k].v;

    // front panel (0..1)
    this.knobs = { tuning: 0.5, cutoff: 0.35, resonance: 0.7, envmod: 0.6, decay: 0.3, accent: 0.7, volume: 0.8, dist: 0.5, filter: 0.4, ratvol: 0.5,
      drvtype: 0, dsdist: 0.5, dstone: 0.5, dslevel: 0.5, tsdrive: 0.5, tstone: 0.5, tslevel: 0.5, fldtimbre: 0.5, fldsym: 0.5, fldlevel: 0.5,
      lexprog: 0.125, lexbass: 0.3, lexmid: 0.27, lexxover: 0.443, lextreble: 0.834, lexdepth: 0.5, lexdiff: 0.55, lexpre: 0.2, lexme: 0.5, lexpitch: 0.2, lexmix: 0.5,
      revtype: 0, plateprog: 0.5, platepre: 0.2, platedecay: 0.45, platedamp: 0.6, platebw: 0.75, platelo: 0.35, platediff: 0.88, platemod: 0.5, platemix: 0.5,
      sprprog: 2 / 3, sprdwell: 0.4, sprdecay: 0.5, sprtension: 0.5, sprtone: 0.5, sprlo: 0.4, sprmix: 0.5,
      cnvprog: 0, cnvpre: 0.2, cnvdecay: 1, cnvtone: 0.7, cnvlo: 0.3, cnvwidth: 2 / 3, cnvmix: 0.5,
      cmpamt: 0.3, cmprel: 0.5,
      dlypp: 1, dlytime: 0.7, dlyfb: 0.35, dlylo: 0.3, dlyhi: 0.55, dlymix: 0.35, fxorder: 0, fxret: 0,
      flgman: 0.5, flgdep: 0.5, flgrate: 0.3, flgres: 0.5, flgmode: 0 };
    this.fx = { rat: false, lex: false, dly: false, fold: false, flg: false }; // rat switches the drive slot (RAT, DS-1 or TS808)
    this.bpm = 128;
    this.ds = new BossDS1(this.fs); this.ts = new TubeScreamer(this.fs); this.b259 = new Buchla259(this.fs); this.drvT = 0;
    this.lex = new Lexicon224(sampleRate);
    this.plate = new DattorroPlate(sampleRate); this.spring = new SpringReverb(sampleRate); this.conv = new ConvReverb(sampleRate); this.revT = 0;
    this.dly = new DigitalDelay(sampleRate);
    this.flg = new BF2Flanger(sampleRate);
    this.cmp = new Compactor(sampleRate);
    this.rt = { hin: 0, xin: 0, h1: 0, h2: 0, x1: 0, fb: 0, y: 0, hc: 0, xc: 0, v: 0, f: 0, xp: 0, dco: 0, dci: 0 };
    this.waveform = 'saw';
    // microtuning: an offset per note of the scale (C..B, every octave), in volts on the 1 V/oct CV, so 1 cent = 1/1200 V
    this.tuneCv = new Float64Array(12);

    // state
    this.cvTarget = dacVoltage(33, this.c.VREF, this.c.R_DAC, this.c.R2_DAC);
    this.cv = this.cvTarget;
    this.slide = false;
    this.gate = false;
    this.accentNote = false;
    this.vSaw = this.c.V_LO;
    this.sawDelay = this.vSaw; // one-sample delay for polyBLEP
    this.sq = { s: 0, e: 0, vc: 0, b: 0, col: 0, hp: 0, hpIn: 0 }; // Q8 shaper: ramp in, C11, C10, base, collector, C_IN coupling
    this.v = new Float64Array(4); // ladder cap voltages
    this.fbLp = 0;
    this.envVcf = 0; this.envAttack = 0;
    this.envVca = 0; this.vcaAttack = 0;
    this.vAcc = 0; this.vWowC = 0; this.vWow = 0;
    this.rng = 0x9e3779b9 ^ ((Math.random() * 0x7fffffff) | 0); // per-voice xorshift32 for the noise sources
    this.hp14 = 0; this.hp14In = 0; this.hp38 = 0; this.hp38In = 0;
    this.hp49 = 0; this.hp49In = 0; this.hp76 = 0; this.hp76In = 0;
    this.dc = { z1: 0, z2: 0, z3: 0, z4: 0 };
    this.decim = this._makeDecimator();
    this._derive();
  }

  setComponent(name, value) { if (name in this.c) { this.c[name] = value; this._derive(); } }
  setFx(name, on) { if (name in this.fx) this.fx[name] = !!on; }
  setKnob(name, value) { if (name in this.knobs) { this.knobs[name] = value; this._derive(); } }
  // cents: 12 offsets, C first; the next note picks it up (a held note keeps its pitch)
  setTune(cents) { for (let i = 0; i < 12; i++) { const c = +(cents && cents[i]) || 0; this.tuneCv[i] = c / 1200; } }

  _derive() {
    const c = this.c, k = this.knobs;
    this.cmp.derive(k); this.dly.derive(k, this.bpm); this.flg.derive(k);
    // noise: density * sqrt(bandwidth) at the oversampled rate gives the rms per sample
    const nb = Math.sqrt(this.fs / 2) * c.NOISE;
    this.nVcf = c.EN_VCF * nb; this.nOta = c.EN_OTA * nb; this.nOut = c.EN_OUT * nb;
    this.noiseOn = this.nVcf + this.nOta + this.nOut > 0;
    // VCO: expo converter calibrated (TM4/TM5) to F_TUNE at CV_TUNE, 1 V/oct.
    // Ramp slope dV/dt = I/C33, frequency = I / (C33 * (V_HI - V_LO)).
    this.swing = c.V_HI - c.V_LO;
    this.iVcoRef = c.F_TUNE * c.C33 * this.swing; // collector current at CV_TUNE
    this.tuneOct = (k.tuning - 0.5) * 2; // VR2 50K(B) linear, ±1 oct
    // square shaper: Q8 steps at SQ_SUB times the voice rate (backward Euler); C_IN coupling into the filter
    { const hs = this.h / SQ_SUB; this.sqG10 = c.C10 / hs; this.sqG11 = c.C_SQE / hs; }
    this.sqInA = Math.exp(-1 / (c.C_IN * (c.R_IN + c.R98) * this.fs));
    // slide
    this.slideA = Math.exp(-1 / (c.R93 * c.C35 * this.fs));
    // VCF
    this.C = [c.C18, c.C19, c.C24, c.C26];
    this.inAtt = c.R98 / (c.R_IN + c.R98);
    this.kFb = c.A_Q21 * k.resonance; // VR4 linear (B) taper
    this.fbA = Math.exp(-1 / (c.C15 * c.R98 * this.fs)); // feedback HPF corner (~72 Hz)
    // Millman sum at Q10 base: G = 1/R
    // key track (KT > 0 closes the pot's switch): op-amp buffer drives KT * (CV - V_KT) into R_KT
    const g73 = 1 / c.R73, g72 = 1 / c.R72, g63 = 1 / c.R63, g71 = 1 / c.R71, gKt = c.KT > 0 ? 1 / c.R_KT : 0;
    const gs = g73 + g72 + g63 + g71 + gKt;
    this.wCut = g73 / gs; this.wEnv = g72 / gs; this.wAcc = g63 / gs; this.wKt = c.KT * gKt / gs;
    this.vCutPot = c.V_CUT * k.cutoff;
    this.envModFrac = audioTaper(k.envmod);
    // envelopes
    const rDecay = c.R138 + c.VR6 * audioTaper(k.decay);
    this.envDecA = Math.exp(-1 / (rDecay * c.C62 * this.fs));
    this.envDecAccA = Math.exp(-1 / (c.R138 * c.C62 * this.fs)); // IC12 shorts VR6 on accent
    this.envAtkA = Math.exp(-1 / (c.R152 * c.C62 * this.fs));
    this.vcaAtkA = Math.exp(-1 / (c.R49 * c.C67 * this.fs));                // accented: fast
    this.vcaSoftA = Math.exp(-1 / ((c.R49 + c.R_SOFT) * c.C67 * this.fs)); // normal: soft attack
    this.vcaDecA = Math.exp(-1 / (c.R52 * c.C67 * this.fs));
    this.vcaRelA = Math.exp(-1 / (c.R_VREL * c.C67 * this.fs));
    // accent sweep
    this.accFrac = k.accent; // VR7 linear
    this.accChgK = 1 / (c.R117 * c.C_ACC * this.fs);
    this.accDisA = Math.exp(-1 / (c.R_ACC * c.C_ACC * this.fs));
    // wow: VR7 -> D24 -> R_ACC -> VR4 gang 2 track -> C_ACC; the gang wiper drives the filter. Resonance picks the tap:
    // low takes the fast end (a sharp accent), high the cap end (a swell that builds over consecutive accents).
    {
      const ra = Math.max(c.VR4 * k.resonance, 1), rb = Math.max(c.VR4 * (1 - k.resonance), 1);
      const rs = c.R_ACC + c.VR7 * k.accent * (1 - k.accent);
      const gl = 1 / (c.R63 + 1 / (g73 + g72 + g71 + gKt)), gb = 1 / rb, dt = 1 / this.fs;
      const tap = (gsrc) => { const sum = gsrc + gb + gl; return { a: gsrc / sum, b: gb / sum, tgt: gsrc / (gsrc + gl), k: Math.exp(-dt * gb * (gsrc + gl) / sum / c.C_ACC) }; };
      this.wowOn = tap(1 / (rs + ra)); this.wowOff = tap(0);
    }
    // couplings
    this.hp14A = Math.exp(-1 / (c.C14 * c.R85 * this.fs));
    this.hp49A = Math.exp(-1 / (c.C49 * c.R88 * this.fs));
    this.hp76A = Math.exp(-1 / (c.C76 * c.R100 * this.fs));
    this.hp38A = Math.exp(-1 / (c.C38 * c.R_OUT * this.fs));
    this.vinDen = 1 / c.R88 + 1 / c.R100 + 1 / c.R101;
    // Q21 output stage: tail current from the bias divider, half of it swings each collector
    this.q21I = Math.max(c.VREF * c.R109 / (c.R116 + c.R112 + c.R109) - Q20_VBE, 0) / c.R108;
    this.q21Swing = this.q21I * c.R110 / 2;
    this.vol = audioTaper(k.volume);
    this._deriveFx();
  }

  _deriveFx() {
    const c = this.c, k = this.knobs, fs = this.fs * RAT_OS, e = (tau) => Math.exp(-1 / (Math.max(tau, 1e-12) * fs));
    // RAT: LM308 non-inverting stage. It runs RAT_OS times faster than the voice, because the rail clip,
    // slew limit and diodes turn a loud resonant peak into harmonics far above 20 kHz that otherwise fold
    // back down as inharmonic whine.
    if (!this.ratLP) {
      const fc = 22000 / fs, w = 2 * Math.PI * fc, cs = Math.cos(w);
      this.ratLP = [0.5176, 0.7071, 1.9319].map(Q => { const al = Math.sin(w) / (2 * Q), a0 = 1 + al; return { b0: (1 - cs) / 2 / a0, b1: (1 - cs) / a0, b2: (1 - cs) / 2 / a0, a1: -2 * cs / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 }; });
    }
    this.ratDcA = Math.exp(-2 * Math.PI * 5 / this.fs); // output coupling: blocks the DC that asymmetric clipping leaves
    const rd = c.RAT_RD * audioTaper(k.dist) + 1;
    this.ratRd = rd;
    this.ratInA = e(c.RAT_CIN * 1e6);
    this.ratA1 = e(c.RAT_RG1 * c.RAT_CG1); this.ratA2 = e(c.RAT_RG2 * c.RAT_CG2);
    this.ratFA = e(rd * c.RAT_CF);
    const comp = 30e-12 / c.RAT_CC;
    const gHf = 1 + rd * (1 / c.RAT_RG1 + 1 / c.RAT_RG2);
    this.ratGain = gHf;
    this.ratK = Math.min(1, 2 * Math.PI * c.RAT_GBW * comp / gHf / fs);
    this.ratSlew = c.RAT_SR * 1e6 * comp / fs;
    this.ratRail = Math.max(c.RAT_VS / 2 - 1, 0.5);
    this.ratCA = e(4.7e-6 * (c.RAT_RCL + 1e3));
    this.ratN = 1.8 * VT;
    this.ratIs = 1e-3 / Math.exp(c.RAT_VF / this.ratN);
    this.ratFltA = e((c.RAT_RF + 100e3 * k.filter) * c.RAT_CFLT);
    this.ratLevel = audioTaper(k.ratvol) * 6;
    this.ds.derive(k); this.ts.derive(k); this.b259.derive(k);
    this.drvT = Math.max(0, Math.min(2, Math.round((k.drvtype || 0) * 2))); // drive slot: 0 = RAT, 1 = DS-1, 2 = TS808
    // FX routing: fxorder swaps the folder and the drive slot; fxret is how the delay and reverb returns connect
    // (0 = parallel, 1 = delay into reverb, 2 = reverb into delay)
    this.fxSwap = (k.fxorder || 0) >= 0.5;
    this.retMode = Math.max(0, Math.min(2, Math.round((k.fxret || 0) * 2)));
    this.lex.derive(c, k); this.plate.derive(k); this.spring.derive(k); this.conv.derive(k);
    const t = revType(k);
    if (t !== this.revT) { this.revT = t; this.rev.reset?.(); }
  }
  // the unit on the reverb slot (fx.lex switches it on)
  get rev() { return this.revT === 1 ? this.plate : this.revT === 2 ? this.spring : this.revT === 3 ? this.conv : this.lex; }

  _rat(x) {
    const s = this.rt, x0 = s.xp; s.xp = x;
    let y = 0;
    for (let i = 1; i <= RAT_OS; i++) {
      let z = this._ratCore(x0 + (x - x0) * (i / RAT_OS));
      for (const q of this.ratLP) { const o = q.b0 * z + q.b1 * q.x1 + q.b2 * q.x2 - q.a1 * q.y1 - q.a2 * q.y2; q.x2 = q.x1; q.x1 = z; q.y2 = q.y1; q.y1 = o; z = o; }
      y = z;
    }
    s.dco = this.ratDcA * (s.dco + y - s.dci); s.dci = y;
    return s.dco;
  }

  _ratCore(x) {
    const s = this.rt, c = this.c;
    s.hin = this.ratInA * (s.hin + x - s.xin); s.xin = x;
    const u = s.hin;
    // current through the two RC gain legs (inverting input follows u)
    s.h1 = this.ratA1 * (s.h1 + u - s.x1); s.h2 = this.ratA2 * (s.h2 + u - s.x1); s.x1 = u;
    const iv = (s.h1 / c.RAT_RG1 + s.h2 / c.RAT_RG2) * this.ratRd;
    s.fb = iv + this.ratFA * (s.fb - iv);                        // pot || 100p
    const target = u + s.fb;
    let dy = (target - s.y) * this.ratK;                         // gain-bandwidth limit
    if (dy > this.ratSlew) dy = this.ratSlew; else if (dy < -this.ratSlew) dy = -this.ratSlew; // slew limit
    s.y = Math.max(-this.ratRail, Math.min(this.ratRail, s.y + dy));
    s.hc = this.ratCA * (s.hc + s.y - s.xc); s.xc = s.y;         // 4.7µ output coupling
    // diode pair to ground through RAT_RCL: (w - v)/R = 2 Is sinh(v / nVt)
    const w = s.hc, R = c.RAT_RCL, n = this.ratN, Is = this.ratIs;
    // Safeguarded Newton: the root lies between 0 and w, so keep it bracketed and bisect whenever a Newton
    // step would leave the bracket. Plain Newton from the last sample could not follow a fast swing into
    // the diodes' exponential region in 4 steps and left v volts off, which was heard as spitting and fizz.
    let lo = w < 0 ? w : 0, hi = w < 0 ? 0 : w;
    let v = Math.min(hi, Math.max(lo, s.v));
    for (let i = 0; i < 40; i++) {
      const t = Math.min(Math.max(v / n, -80), 80), e = Math.exp(t), ei = 1 / e;
      const f = (w - v) / R - Is * (e - ei), df = -1 / R - Is * (e + ei) / n;
      if (f > 0) lo = v; else hi = v;
      let nv = v - f / df;
      if (!(nv > lo && nv < hi)) nv = 0.5 * (lo + hi);
      const dv = nv - v; v = nv;
      if (dv < 1e-7 && dv > -1e-7) break;
    }
    s.v = v;
    s.f = v + this.ratFltA * (s.f - v);                          // FILTER: (1.5k + pot) with 3.3n
    return s.f * this.ratLevel;
  }

  // note: 0..63 DAC code (33 = A, 110 Hz)
  noteOn(code, accent, slide) {
    code = Math.max(0, Math.min(63, code | 0));
    this.cvTarget = dacVoltage(code, this.c.VREF, this.c.R_DAC, this.c.R2_DAC) + this.tuneCv[code % 12];
    const legato = this.gate && slide;
    this.slide = !!slide;
    if (!legato) {
      if (!this.slide) this.cv = this.cvTarget;
      this.accentNote = !!accent;
      this.envAttack = 1; // trigger VCF env (gate edge into Q38)
      this.vcaAttack = 1;
    }
    this.gate = true;
  }
  setSlide(on) { this.slide = !!on; }
  noteOff() { this.gate = false; }

  _makeDecimator() {
    // 2 cascaded biquads (4th-order Butterworth) at 0.42 * fsOut, running at fs
    const mk = (Q) => {
      const w = 2 * Math.PI * 0.42 * this.fsOut / this.fs;
      const al = Math.sin(w) / (2 * Q), cs = Math.cos(w), a0 = 1 + al;
      return { b0: (1 - cs) / 2 / a0, b1: (1 - cs) / a0, b2: (1 - cs) / 2 / a0, a1: -2 * cs / a0, a2: (1 - al) / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
    };
    return [mk(0.5412), mk(1.3066)];
  }

  _vcfStep(u, Iladder) {
    // ladder states v[0..3]; branch b0 = input pair diff voltage x,
    // b1..b3 = differences between stages, b4 = top stage to fixed bases.
    // Same maths as before, written out without per-sample array allocation (it was most of the voice's CPU).
    const v = this.v, C = this.C, h2 = this.h / 2, twoVt = 2 * VT, Ih = Iladder / 2, G0 = Iladder / (4 * VT);
    const k = this.kFb;
    const uEff = u + k * this.fbLp;           // x = u - k*(v4 - LP(v4)) = uEff - k*v4
    const v0 = v[0], v1 = v[1], v2 = v[2], v3 = v[3];
    const b0 = uEff - k * v3, b1 = v0 - v1, b2 = v1 - v2, b3 = v2 - v3, b4 = v3;
    const T0 = Ih * Math.tanh(b0 / twoVt), T1 = Ih * Math.tanh(b1 / twoVt), T2 = Ih * Math.tanh(b2 / twoVt), T3 = Ih * Math.tanh(b3 / twoVt), T4 = Ih * Math.tanh(b4 / twoVt);
    const G0_ = Math.abs(b0) > 1e-9 ? T0 / b0 : G0, G1 = Math.abs(b1) > 1e-9 ? T1 / b1 : G0, G2 = Math.abs(b2) > 1e-9 ? T2 / b2 : G0,
      G3 = Math.abs(b3) > 1e-9 ? T3 / b3 : G0, G4 = Math.abs(b4) > 1e-9 ? T4 / b4 : G0;
    const C0 = C[0], C1 = C[1], C2 = C[2], C3 = C[3];
    // A = I - h/2 M (M linearised with feedback folded in), r = v + h/2 (f + B uEff)
    let a00 = 1 + h2 * G1 / C0, a01 = -h2 * G1 / C0, a02 = 0, a03 = h2 * G0_ * k / C0;
    let a10 = -h2 * G1 / C1, a11 = 1 + h2 * (G1 + G2) / C1, a12 = -h2 * G2 / C1, a13 = 0;
    let a20 = 0, a21 = -h2 * G2 / C2, a22 = 1 + h2 * (G2 + G3) / C2, a23 = -h2 * G3 / C2;
    let a30 = 0, a31 = 0, a32 = -h2 * G3 / C3, a33 = 1 + h2 * (G3 + G4) / C3;
    let r0 = v0 + h2 * (T0 - T1) / C0 + h2 * (G0_ / C0) * uEff, r1 = v1 + h2 * (T1 - T2) / C1, r2 = v2 + h2 * (T2 - T3) / C2, r3 = v3 + h2 * (T3 - T4) / C3;
    // Gaussian elimination (well-conditioned, diagonally dominant); zero entries skipped as before
    let m = a10 / a00;
    if (m !== 0) { a11 -= m * a01; a12 -= m * a02; a13 -= m * a03; r1 -= m * r0; }
    m = a21 / a11;
    if (m !== 0) { a22 -= m * a12; a23 -= m * a13; r2 -= m * r1; }
    m = a32 / a22;
    if (m !== 0) { a33 -= m * a23; r3 -= m * r2; }
    const n3 = r3 / a33;
    const n2 = (r2 - a23 * n3) / a22;
    const n1 = (r1 - a12 * n2 - a13 * n3) / a11;
    const n0 = (r0 - a01 * n1 - a02 * n2 - a03 * n3) / a00;
    v[0] = n0; v[1] = n1; v[2] = n2; v[3] = n3;
    // feedback-path HPF (C15) tracked as LP of v4
    this.fbLp = n3 + this.fbA * (this.fbLp - n3);
    return n3;
  }

  // Q8 shaper, one backward-Euler step with ramp voltage S. Nodes: base B, emitter E (on C11), collector C (R36 to
  // VREF); C10 + R34 is folded into a conductance from S to B. Ebers-Moll PNP, solved by Newton from the last step.
  _sqStep(S, g10 = this.sqG10, g11 = this.sqG11) {
    const c = this.c, q = this.sq, IS = c.IS_Q8, bf = 1 / c.BF_Q8, br = 1 / SQ_BR;
    const g34 = 1 / c.R_SQS, gy = g10 * g34 / (g10 + g34), g35 = 1 / c.R_SQB, g45 = 1 / c.R_SQV, g36 = 1 / c.R_SQC;
    const sy = S - q.vc, e0 = q.e;
    let B = q.b, E = q.e, C = q.col;
    for (let it = 0; it < 50; it++) {
      const xe = Math.exp(Math.min((E - B) / VT, 40)), xc = Math.exp(Math.min((C - B) / VT, 40));
      const Icc = IS * (xe - xc), Ibf = IS * bf * (xe - 1), Ibr = IS * br * (xc - 1);
      const ge = IS * xe / VT, gc = IS * xc / VT;
      // currents into each node
      const fB = gy * (sy - B) + g35 * (S - B) + Ibf + Ibr;
      const fE = g45 * (c.V_SQ - E) - Icc - Ibf - g11 * (E - e0);
      const fC = Icc - Ibr - g36 * (C - c.VREF);
      const bE = ge * bf, bC = gc * br, eE = ge * (1 + bf), cC = gc * (1 + br);
      const a00 = -gy - g35 - bE - bC, a01 = bE, a02 = bC;
      const a10 = eE - gc, a11 = -g45 - g11 - eE, a12 = gc;
      const a20 = cC - ge, a21 = ge, a22 = -cC - g36;
      // J d = -f by Cramer's rule
      const r0 = -fB, r1 = -fE, r2 = -fC;
      const det = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
      let dB = (r0 * (a11 * a22 - a12 * a21) - a01 * (r1 * a22 - a12 * r2) + a02 * (r1 * a21 - a11 * r2)) / det;
      let dE = (a00 * (r1 * a22 - a12 * r2) - r0 * (a10 * a22 - a12 * a20) + a02 * (a10 * r2 - r1 * a20)) / det;
      let dC = (a00 * (a11 * r2 - r1 * a21) - a01 * (a10 * r2 - r1 * a20) + r0 * (a10 * a21 - a11 * a20)) / det;
      const m = Math.max(Math.abs(dB), Math.abs(dE), Math.abs(dC));
      if (m > 0.2) { const k = 0.2 / m; dB *= k; dE *= k; dC *= k; } // junction limiting
      B += dB; E += dE; C += dC;
      if (m < 1e-9) break;
    }
    q.vc = S - (B + gy * (sy - B) / g34); // C10's voltage: S minus the C10/R34 junction
    q.b = B; q.e = E; q.col = C;
    return C;
  }
  // On a real 303 the shaper runs all the time; here it only runs while the square is picked, so when it comes in it
  // first runs at least 80 ms (about 4 C11 time constants) and 3 cycles of ramp at the current pitch, in coarse steps
  // (20 a cycle, so it costs well under a millisecond), then the C_IN coupling starts from its mean over whole cycles.
  _sqSettle(s1) {
    const c = this.c, q = this.sq;
    q.e = c.V_SQ - 3; q.b = s1; q.vc = 0; q.col = c.VREF;
    const f = this.iVcoRef * Math.pow(2, this.cv - c.CV_TUNE + this.tuneOct) / (c.C33 * this.swing);
    const hs = 1 / (20 * f), g10 = c.C10 / hs, g11 = c.C_SQE / hs, tail = 20;
    const n = Math.max(Math.ceil(0.08 * f), 3) * 20, dr = this.swing * f * hs;
    let r = s1 + (n * dr) % this.swing, sum = 0; // phased so the run ends where the ramp is now
    if (r > c.V_HI) r -= this.swing;
    q.s = r;
    for (let i = 0; i < n; i++) {
      r -= dr; if (r <= c.V_LO) r += this.swing;
      const v = this._sqStep(r, g10, g11);
      if (i >= n - tail) sum += v;
    }
    q.s = r; q.hp = 0; q.hpIn = sum / tail;
  }

  // one sample at the oversampled rate
  _tick() {
    const c = this.c;
    // --- slide / CV
    if (this.slide) this.cv = this.cvTarget + this.slideA * (this.cv - this.cvTarget);
    else this.cv = this.cvTarget;

    // --- VCO: I = Iref * 2^(CV - CV_TUNE + tune)
    const I = this.iVcoRef * Math.pow(2, this.cv - c.CV_TUNE + this.tuneOct);
    const dv = I / c.C33 * this.h;
    this.vSaw += dv;
    // polyBLEP around the reset: output is delayed one sample so the sample
    // before the step can be corrected too.
    let corrNow = 0;
    if (this.vSaw >= c.V_HI) {
      // Q27/Q28 discharge: fast reset, placed with sub-sample accuracy
      this.vSaw -= this.swing;
      const ph = Math.min(Math.max((this.vSaw - c.V_LO) / dv, 0), 1); // samples since crossing
      this.sawDelay -= 0.5 * this.swing * ph * ph;
      corrNow = 0.5 * this.swing * (1 - ph) * (1 - ph);
    }
    const saw0 = this.sawDelay;
    this.sawDelay = this.vSaw + corrNow;
    const saw = saw0;

    let wave;
    if (this.waveform === 'square') {
      // the real ramp at Q28 falls from V_HI to V_LO and jumps back up (this model's saw rises; the filter can't tell)
      const s1 = c.V_LO + c.V_HI - saw, q = this.sq;
      if (!(q.e > 0)) this._sqSettle(s1);
      let acc = 0;
      for (let j = 1; j <= SQ_SUB; j++) acc += this._sqStep(q.s + (s1 - q.s) * j / SQ_SUB);
      q.s = s1;
      const vout = acc / SQ_SUB; // the substeps averaged: the edges land between samples
      q.hp = this.sqInA * (q.hp + vout - q.hpIn); q.hpIn = vout;
      wave = q.hp;
    } else {
      this.sq.e = 0; // re-settle when the square comes back
      wave = saw - (c.V_LO + c.V_HI) / 2;
    }

    // --- envelopes
    // VCF env: gate edge charges C62 through R152, then decays via R138+VR6
    if (this.envAttack > 0) {
      this.envVcf = c.V_ENV + this.envAtkA * (this.envVcf - c.V_ENV);
      if (this.envVcf > 0.99 * c.V_ENV) this.envAttack = 0;
    } else {
      this.envVcf *= this.accentNote ? this.envDecAccA : this.envDecA;
    }
    // VCA env: C67 charges via R49 while gated, decays via R52, released on gate off
    if (this.gate) {
      if (this.vcaAttack > 0) {
        this.envVca = 1 + (this.accentNote ? this.vcaAtkA : this.vcaSoftA) * (this.envVca - 1);
        if (this.envVca > 0.99) this.vcaAttack = 0;
      } else this.envVca *= this.vcaDecA;
    } else this.envVca *= this.vcaRelA;
    // accent sweep: VCF env * VR7 through D27/R117 into C_ACC, bled by R_ACC
    const vAccIn = this.accentNote ? this.envVcf * this.accFrac : 0;
    const drive = vAccIn - c.V_D - this.vAcc;
    if (drive > 0) this.vAcc += drive * this.accChgK;
    this.vAcc *= this.accDisA;
    if (c.WOW > 0 || this.vWowC > 1e-6) {
      const vs = vAccIn - c.V_D, t = vs > this.wowOff.b * this.vWowC ? this.wowOn : this.wowOff;
      this.vWow = t.a * vs + t.b * this.vWowC;
      const tgt = t === this.wowOn ? t.tgt * vs : 0;
      this.vWowC = tgt + t.k * (this.vWowC - tgt);
    }
    const vAccF = c.WOW > 0 ? this.vAcc + c.WOW * (this.vWow - this.vAcc) : this.vAcc;

    // --- VCF control: Millman sum at Q10 base, expo current
    const vEnvMod = this.accentNote ? 0 : this.envVcf * this.envModFrac;
    let vb = this.wCut * this.vCutPot + this.wEnv * vEnvMod + this.wAcc * vAccF;
    if (this.wKt > 0) vb += this.wKt * (this.cv - c.V_KT);
    const Il = Math.min(c.I_REF * Math.exp(vb / VT), 2e-3);

    // approx. unit gaussian from four uniforms (xorshift32), one per source
    let nV = 0, nO = 0, nX = 0;
    if (this.noiseOn) {
      const g = () => { let a = 0; for (let i = 0; i < 4; i++) { let x = this.rng; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.rng = x; a += (x >>> 0) / 4294967296; } return (a - 2) * 1.7320508; };
      nV = g() * this.nVcf; nO = g() * this.nOta; nX = g() * this.nOut;
    }
    const y = this._vcfStep(wave * this.inAtt + nV, Il);

    // --- output amp -> C14 coupling -> OTA VCA
    const ya = this.q21Swing * Math.tanh(y / (2 * VT)); // Q21 diff pair -> Q19 output buffer
    this.hp14 = this.hp14A * (this.hp14 + ya - this.hp14In); this.hp14In = ya;
    const vo = this.hp14;
    // into the OTA: filter via C49/R88 plus resonance compensation (VR4 wiper) via C76/R100
    this.hp49 = this.hp49A * (this.hp49 + vo - this.hp49In); this.hp49In = vo;
    const vr = vo * this.knobs.resonance;
    this.hp76 = this.hp76A * (this.hp76 + vr - this.hp76In); this.hp76In = vr;
    const vin = (this.hp49 / c.R88 + this.hp76 / c.R100) / this.vinDen + nO;
    const Iabc = Math.max(this.envVca * c.V_VCA - 0.6, 0) / c.R105 + Math.max(this.vAcc - 0.6, 0) / (c.R25 + c.R26);
    const iout = Iabc * Math.tanh(vin / (2 * VT));
    const vout = iout * c.R_OTA;
    this.hp38 = this.hp38A * (this.hp38 + vout - this.hp38In); this.hp38In = vout;
    let o = this.hp38 * this.vol * OUT_TRIM + nX * 4.0; // the output floor hiss keeps its level
    if (this.fxSwap) { // routing: drive slot first, then the folder
      if (this.fx.rat) o = this.drvT === 1 ? this.ds.run(o) : this.drvT === 2 ? this.ts.run(o) : this._rat(o);
      if (this.fx.fold) o = this.b259.run(o);
    } else {
      if (this.fx.fold) o = this.b259.run(o);                     // Buchla 259 folder, ahead of the drive slot
      if (this.fx.rat) o = this.drvT === 1 ? this.ds.run(o) : this.drvT === 2 ? this.ts.run(o) : this._rat(o);
    }
    return 0.95 * Math.tanh(o / 0.95); // output stage headroom
  }

  // the effects after the dry signal y: the reverb and the delay are returns, both ducked by the Compactor keyed
  // from y, summed with y, then the output soft clip. Routed in parallel (both fed from y), or in series: the second
  // one is fed y plus the first one's return (in mono), and both returns are heard.
  _fxOut(y, out, outR, n) {
    if (this.fx.flg) y = this.flg.run(y); // the flanger, on the synth ahead of the returns and the dry path
    const lex = this.fx.lex ? this.rev : null, dly = this.fx.dly ? this.dly : null;
    let wl = 0, wr = 0;
    if (lex && dly && this.retMode === 1) { // delay into reverb
      dly.run(y); wl += dly.l; wr += dly.r;
      lex.run(y + 0.5 * (dly.l + dly.r)); wl += lex.wet * lex.L; wr += lex.wet * lex.R;
    } else if (lex && dly && this.retMode === 2) { // reverb into delay
      lex.run(y); const rl = lex.wet * lex.L, rr = lex.wet * lex.R; wl += rl; wr += rr;
      dly.run(y + 0.5 * (rl + rr)); wl += dly.l; wr += dly.r;
    } else {
      if (lex) { lex.run(y); wl += lex.wet * lex.L; wr += lex.wet * lex.R; }
      if (dly) { dly.run(y); wl += dly.l; wr += dly.r; }
    }
    const g = this.cmp.run(y, wl, wr);
    out[n] = 0.98 * Math.tanh((y + this.cmp.l * g) / 0.98);
    if (outR) outR[n] = 0.98 * Math.tanh((y + this.cmp.r * g) / 0.98);
  }

  _decimate(x) {
    for (const s of this.decim) {
      const y = s.b0 * x + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
      s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y; x = y;
    }
    return x;
  }

  // Decaying filter and envelope states eventually reach subnormal floats, which run many times
  // slower on most CPUs (CPU climbed 3x over 15 s of silence). Snap anything that small to zero once
  // per block. 1e-150 is far below any audible level and far below every component value.
  _flush() { flushTiny(this, 0); if (this.lex) flushTiny(this.lex, 0); flushTiny(this.plate, 0); flushTiny(this.spring, 0); flushTiny(this.conv, 0); flushTiny(this.dly, 0); flushTiny(this.flg, 0); flushTiny(this.cmp, 0); flushTiny(this.ds.s, 0); flushTiny(this.ts.s, 0); flushTiny(this.b259.s, 0); }

  // out is mono, or the left channel when outR is given
  process(out, start = 0, end = out.length, outR) {
    this._flush();
    const fx = this.fx.lex || this.fx.dly || this.fx.flg;
    for (let n = start; n < end; n++) {
      let y = 0;
      for (let o = 0; o < this.os; o++) y = this._decimate(this._tick());
      if (fx) this._fxOut(y, out, outR, n);
      else { out[n] = y; if (outR) outR[n] = y; }
    }
  }

  // diagnostics
  vcfResonantHz(vb) { // linear-theory peak for given base voltage
    const I = this.c.I_REF * Math.exp(vb / VT);
    return 1.3838 * (I / (4 * VT)) / (2 * Math.PI * this.c.C19);
  }
}

// Knob and part changes glide to their new value (one-pole, ~15 ms) instead of jumping, so turning a
// control, MIDI CC steps or a preset load do not zipper the sound. This sits outside the circuit:
// it only decides what value the voice sees each 32-sample tick. Discrete controls switch at once.
class ParamSlew {
  constructor(voice, fs, tau = 0.015) { this.v = voice; this.fs = fs; this.tau = tau; this.t = new Map(); }
  static instant(kind, name) { return name.endsWith('prog') || name === 'revtype' || name === 'drvtype' || name === 'fxorder' || name === 'fxret' || name === 'flgmode' || name.startsWith('LEX_'); }
  set(kind, name, value) {
    const v = this.v;
    if (ParamSlew.instant(kind, name) || !isFinite(value)) { this.t.delete(kind + name); kind === 'k' ? v.setKnob(name, value) : v.setComponent(name, value); return; }
    const cur = kind === 'k' ? v.knobs[name] : v.c[name];
    if (cur === undefined) return;
    this.t.set(kind + name, { kind, name, value, log: kind === 'c' && value > 0 && cur > 0 });
  }
  get active() { return this.t.size > 0; }
  tick(n) {
    if (!this.t.size) return;
    const v = this.v, a = 1 - Math.exp(-n / (this.tau * this.fs));
    for (const [key, e] of this.t) {
      const obj = e.kind === 'k' ? v.knobs : v.c, cur = obj[e.name];
      let nx = e.log ? Math.exp(Math.log(cur) + (Math.log(e.value) - Math.log(cur)) * a) : cur + (e.value - cur) * a;
      if (Math.abs(nx - e.value) <= 1e-4 * Math.max(1e-9, Math.abs(e.value)) || (!e.log && Math.abs(nx - e.value) < 1e-5)) { nx = e.value; this.t.delete(key); }
      obj[e.name] = nx;
    }
    v._derive();
  }
}

// De-click: an output stage outside the circuit. The real 303 clicks where the VCA opens in about
// 0.1 ms (accented notes skip the soft attack) and where a retrigger lands on a ringing tail. The
// sequencer knows exactly when each retrigger happens, so the output is delayed by a few ms and the
// level eases to zero and back over `fadeMs` around each retrigger. Between retriggers the signal
// passes through untouched. Slides (no retrigger) are left alone. Note-offs are optional: the VCA
// already releases over about 5 ms there, so they are skipped unless `offs` is set.
class DeClick {
  constructor(voice, fs, { on = true, fadeMs = 1.5, lookMs = 3, offs = false } = {}) {
    this.v = voice; this.fs = fs; this.D = Math.max(1, Math.round(lookMs * 1e-3 * fs));
    this.bufL = new Float32Array(this.D); this.w = 0;
    this.t = 0; this.ev = []; this.offs = offs; this.on = on; this.setFade(fadeMs);
    const on0 = voice.noteOn.bind(voice), off0 = voice.noteOff.bind(voice);
    voice.noteOn = (code, accent, slide) => { if (!(voice.gate && slide)) this.mark(); on0(code, accent, slide); };
    voice.noteOff = () => { if (voice.gate && this.offs) this.mark(); off0(); };
  }
  setFade(ms) { this.F = Math.max(1, Math.min(this.D, Math.round(ms * 1e-3 * this.fs))); }
  setOn(on) { if (on === this.on) return; this.on = on; this.bufL.fill(0); this.ev.length = 0; }
  mark() { if (this.on) this.ev.push(this.t); }
  process(out, start = 0, end = out.length, outR) {
    const v = this.v;
    if (!this.on) { v.process(out, start, end, outR); this.t += end - start; return; }
    // run the voice dry and do the returns here, after the fade, so a retrigger never dips the reverb or delay tails
    const lex = v.fx.lex, dly = v.fx.dly, flg = v.fx.flg, fx = lex || dly || flg;
    v.fx.lex = v.fx.dly = v.fx.flg = false; v.process(out, start, end); v.fx.lex = lex; v.fx.dly = dly; v.fx.flg = flg;
    const D = this.D, F = this.F, L = this.bufL, ev = this.ev;
    for (let n = start; n < end; n++, this.t++) {
      let y = L[this.w]; L[this.w] = out[n]; this.w = this.w + 1 === D ? 0 : this.w + 1;
      // yl/yr belong to time t - D; ease the level around any retrigger within F of it
      const tt = this.t - D;
      while (ev.length && ev[0] <= tt - F) ev.shift();
      if (ev.length) {
        let g = 1;
        for (let i = 0; i < ev.length; i++) {
          const d = Math.abs(tt - ev[i]); if (d < F) { const s = 0.5 - 0.5 * Math.cos(Math.PI * d / F); if (s < g) g = s; }
        }
        y *= g;
      }
      if (fx) v._fxOut(y, out, outR, n);
      else { out[n] = y; if (outR) outR[n] = y; }
    }
  }
}

// The player around the voice: parameter slew, de-click, and the step sequencer that walks a pattern.
// The AudioWorklet and the main-thread fallback both run this, so they sound the same.
// Messages: knob, component, wave, tune, fx, declick, pattern, transpose, bpm, groove (shuffle, gate length), play,
// seq (the step sequencer on or off) and note (a MIDI note, played straight on the voice while the sequencer is off).
class TB303Engine {
  constructor(fs, onStep = () => {}) {
    this.fs = fs; this.onStep = onStep;
    this.v = new TB303Voice(fs); this.slew = new ParamSlew(this.v, fs); this.dc = new DeClick(this.v, fs);
    this.playing = false; this.bpm = 128; this.pattern = []; this.shuffle = 0; this.gate = 0.5;
    this.transpose = 0; // semitones the pattern plays up (the root note from MIDI)
    this.step = -1; this.ctr = 0; this.stepLen = 1; this.gateOffAt = -1;
    this.seqOn = true; this.held = []; // with the sequencer off: the MIDI notes held down, the last one sounding
  }
  // Seq off: a mono MIDI synth. The newest held note sounds; a note pressed while another is held slides to it without
  // retriggering (as a slide step does), letting go falls back to the note still held. Velocity 100 and up is an accent.
  // MIDI note 45 (A2) is code 33, 110 Hz, the pattern's A; notes outside the DAC's 64 codes are folded in by octaves.
  _noteCode(n) { let c = (n | 0) - 12; while (c < 0) c += 12; while (c > 63) c -= 12; return c; }
  _note(on, n, vel) {
    const h = this.held, i = h.indexOf(n);
    if (i >= 0) h.splice(i, 1);
    if (on) { const legato = h.length > 0; h.push(n); this.v.noteOn(this._noteCode(n), vel >= 100, legato); }
    else if (i === h.length && h.length) this.v.noteOn(this._noteCode(h[h.length - 1]), false, true); // the note let go was sounding
    else if (!h.length && i >= 0) this.v.noteOff();
  }
  message(m) {
    const v = this.v;
    if (m.type === 'knob') this.slew.set('k', m.name, m.value);
    else if (m.type === 'component') this.slew.set('c', m.name, m.value);
    else if (m.type === 'wave') v.waveform = m.value;
    else if (m.type === 'tune') v.setTune(m.value);
    else if (m.type === 'fx') v.setFx(m.name, m.value);
    else if (m.type === 'declick') { this.dc.setOn(!!m.on); this.dc.setFade(m.ms); }
    else if (m.type === 'pattern') this.pattern = m.value;
    else if (m.type === 'transpose') this.transpose = m.value | 0;
    else if (m.type === 'bpm') { this.bpm = m.value; v.bpm = m.value; v.dly.derive(v.knobs, m.value); }
    else if (m.type === 'groove') { this.shuffle = m.shuffle; this.gate = m.gate; }
    else if (m.type === 'ir') v.conv.setIR(m.id, m.L, m.R);
    else if (m.type === 'play') { this.playing = m.value; this.step = -1; this.ctr = 0; if (!m.value && this.seqOn) v.noteOff(); }
    else if (m.type === 'seq') {
      const on = !!m.value; if (on === this.seqOn) return;
      this.seqOn = on; this.held = []; this.step = -1; this.ctr = 0; this.gateOffAt = -1; v.noteOff();
    }
    else if (m.type === 'note') { if (!this.seqOn) this._note(!!m.on, m.note | 0, m.vel | 0); }
  }
  // a 16th note; shuffle lengthens the even steps and shortens the odd ones. Returns its length in samples.
  _startStep() {
    const P = this.pattern, n = P.length; if (!n) return 0;
    this.step = (this.step + 1) % n;
    const s = P[this.step], prev = P[(this.step - 1 + n) % n];
    const len = Math.round(this.fs * 60 / this.bpm / 4 * (1 + (this.step & 1 ? -this.shuffle : this.shuffle)));
    if (s.gate) {
      this.v.noteOn(s.code + this.transpose, s.accent, prev.gate && prev.slide);
      this.gateOffAt = s.slide ? -1 : Math.max(1, Math.round(len * this.gate));
    } else { this.v.noteOff(); this.gateOffAt = -1; }
    this.onStep(this.step);
    return len;
  }
  // fills out[s..e) (and outR, if given), split into runs at step starts, gate-offs and every 32 samples while slewing
  render(out, outR, s = 0, e = out.length) {
    let i = s; const seq = this.playing && this.seqOn;
    while (i < e) {
      if (seq && this.ctr <= 0) { this.stepLen = this._startStep() || 1; this.ctr = this.stepLen; }
      let run = e - i;
      if (this.slew.active) { run = Math.min(run, 32); this.slew.tick(run); }
      if (seq) {
        run = Math.min(run, this.ctr);
        const elapsed = this.stepLen - this.ctr;
        if (this.gateOffAt > elapsed) run = Math.min(run, this.gateOffAt - elapsed);
        else if (this.gateOffAt === elapsed) { this.v.noteOff(); this.gateOffAt = -1; }
      }
      this.dc.process(out, i, i + run, outR);
      i += run; if (seq) this.ctr -= run;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = { DigitalDelay, Compactor, DLY_DIVS, dlyDiv, dlyLo, dlyHi, cmpThrDb, cmpMix, cmpRelMs, TB303Voice, ParamSlew, BossDS1, TubeScreamer, Buchla259, PEDAL_PARTS, PEDAL_OS, DeClick, TB303Engine, COMPONENTS, dacVoltage, VT, Lexicon224, LEX_PROGRAMS, lexParams, REV_TYPES, revType, DattorroPlate, PLATE_PROGRAMS, plateParams, SpringReverb, SPRING_PROGRAMS, springParams, ConvReverb, CNV_PROGRAMS, convParams, CNV_IR_GAIN };
