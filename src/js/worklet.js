// AudioWorklet processor: the shared TB303Engine (from the model, loaded into the worklet first) on the audio thread
class TB303Processor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.engine = new TB303Engine(sampleRate, (step) => this.port.postMessage({ type: 'step', step }));
    this.port.onmessage = (e) => this.engine.message(e.data);
  }
  process(inputs, outputs) {
    const out = outputs[0][0]; if (!out) return true;
    this.engine.render(out, outputs[0][1]);
    for (let c = 2; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('tb303', TB303Processor);
