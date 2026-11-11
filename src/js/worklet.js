// AudioWorklet processor: the shared SynthEngine (src/synth.js, loaded into the worklet first with the voice and the effects) on the audio thread
class SynthProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new SynthEngine(sampleRate, (step) => this.port.postMessage({ type: 'step', step }));
    this.port.onmessage = (e) => this.engine.message(e.data);
  }
  process(inputs, outputs) {
    const out = outputs[0][0]; if (!out) return true;
    this.engine.render(out, outputs[0][1]);
    for (let c = 2; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('fmacid', SynthProcessor);
