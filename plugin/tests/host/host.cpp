// tbhost <plugin.vst3> render <state.json> <seconds> <out.f32> [bpm] [startPpq]
// tbhost <plugin.vst3> editor <seconds> <state-out.json>   opens the screen, waits, writes the plug-in's state
#include <JuceHeader.h>
#include <cstdio>
#include <dlfcn.h>
// no window manager under Xvfb: some atoms do not exist and Xlib's default handler would exit on the error
static int ignoreXError (void*, void* e) { std::fprintf (stderr, "X error ignored (code %d)\n", (int) ((unsigned char*) e)[sizeof (int) + sizeof (void*) * 2 + sizeof (unsigned long)]); return 0; }
using namespace juce;
struct PH : AudioPlayHead {
    double ppq = 0, bpm = 128; bool playing = true;
    Optional<PositionInfo> getPosition() const override {
        PositionInfo p; p.setIsPlaying (playing); p.setBpm (bpm); p.setPpqPosition (ppq); p.setTimeSignature (TimeSignature { 4, 4 });
        return p;
    }
};
int main (int argc, char** argv) {
    ScopedJuceInitialiser_GUI init;
    if (argc < 3) return 2;
    AudioPluginFormatManager fm; fm.addFormat (std::make_unique<VST3PluginFormat>());
    OwnedArray<PluginDescription> descs; VST3PluginFormat f; f.findAllTypesForFile (descs, argv[1]);
    if (descs.isEmpty()) { std::fprintf (stderr, "no plug-in in %s\n", argv[1]); return 1; }
    String err; auto inst = fm.createPluginInstance (*descs[0], 48000, 512, err);
    if (!inst) { std::fprintf (stderr, "load failed: %s\n", err.toRawUTF8()); return 1; }
    const String mode = argv[2];
    PH ph; inst->setPlayHead (&ph);
    auto pump = [] (int ms) { MessageManager::getInstance()->runDispatchLoopUntil (ms); };
    if (mode == "params") { // the DAW parameters: count, a few names, and that a host move reaches the saved state
        auto ps = inst->getParameters();
        std::printf ("%d parameters\n", ps.size());
        for (int i : { 0, 1, 8, 75, ps.size() - 1 }) if (i < ps.size()) std::printf ("  %s = %s\n", ps[i]->getName (40).toRawUTF8(), ps[i]->getCurrentValueAsText().toRawUTF8());
        inst->setPlayConfigDetails (0, 2, 48000, 512); inst->prepareToPlay (48000, 512);
        if (argc > 3) { // a saved state, then the Pattern parameter to slot 3 with the window shut
            const String st = File (argv[3]).loadFileAsString();
            XmlElement x ("VST3PluginState"); MemoryBlock raw (st.toRawUTF8(), st.getNumBytesAsUTF8());
            x.createNewChildElement ("IComponent")->addTextElement (raw.toBase64Encoding());
            MemoryBlock wrapped; AudioProcessor::copyXmlToBinary (x, wrapped);
            inst->setStateInformation (wrapped.getData(), (int) wrapped.getSize()); pump (300);
            for (auto* q : ps) if (q->getName (20) == "Pattern") { std::printf ("Pattern was %s\n", q->getCurrentValueAsText().toRawUTF8()); q->setValueNotifyingHost (q->getValueForText ("3")); }
            pump (300);
        }
        ps[1]->setValueNotifyingHost (0.9f); ps[ps.size() - 1]->setValueNotifyingHost (1.f);
        AudioBuffer<float> b (2, 512); MidiBuffer mb; inst->processBlock (b, mb);
        MemoryBlock st; inst->getStateInformation (st);
        auto x = AudioProcessor::getXmlFromBinary (st.getData(), (int) st.getSize());
        if (x) if (auto* c = x->getChildByName ("IComponent")) { MemoryBlock raw; raw.fromBase64Encoding (c->getAllSubText()); std::printf ("%s\n", raw.toString().toRawUTF8()); }
        return 0;
    }
    if (mode == "render") {
        const String st = File (argv[3]).loadFileAsString();
        const double secs = atof (argv[4]); ph.bpm = argc > 6 ? atof (argv[6]) : 128; ph.ppq = argc > 7 ? atof (argv[7]) : 0;
        inst->setPlayConfigDetails (0, 2, 48000, 512);
        inst->prepareToPlay (48000, 512);
        // the hosted VST3 wants its own wrapper: the plug-in's state, base64, in a VST3PluginState element
        XmlElement x ("VST3PluginState"); MemoryBlock raw (st.toRawUTF8(), st.getNumBytesAsUTF8());
        x.createNewChildElement ("IComponent")->addTextElement (raw.toBase64Encoding());
        MemoryBlock wrapped; AudioProcessor::copyXmlToBinary (x, wrapped);
        inst->setStateInformation (wrapped.getData(), (int) wrapped.getSize());
        pump (1500); // IRs decode and the new engine is handed over
        const int N = (int) (secs * 48000); std::vector<float> out ((size_t) N * 2);
        AudioBuffer<float> b (2, 512); MidiBuffer mb;
        for (int i = 0; i < N; i += 512) {
            const int n = std::min (512, N - i); b.setSize (2, n, false, false, true); b.clear();
            inst->processBlock (b, mb);
            for (int k = 0; k < n; k++) { out[(size_t) (i + k) * 2] = b.getSample (0, k); out[(size_t) (i + k) * 2 + 1] = b.getSample (1, k); }
            ph.ppq += n * ph.bpm / 60.0 / 48000;
        }
        FILE* fo = std::fopen (argv[5], "wb"); std::fwrite (out.data(), 4, out.size(), fo); std::fclose (fo);
        return 0;
    }
    if (mode == "editor") {
        if (void* x = dlopen ("libX11.so.6", RTLD_NOW | RTLD_GLOBAL)) if (auto set = (void* (*) (int (*) (void*, void*))) dlsym (x, "XSetErrorHandler")) set (ignoreXError);
        inst->prepareToPlay (48000, 512);
        std::unique_ptr<AudioProcessorEditor> ed (inst->createEditorIfNeeded());
        ed->setOpaque (true); ed->addToDesktop (0); ed->setVisible (true);
        AudioBuffer<float> b (2, 512); MidiBuffer mb;
        const double secs = atof (argv[3]);
        for (int t = 0; t < secs * 20; t++) { pump (50); inst->processBlock (b, mb); ph.ppq += 512 * ph.bpm / 60.0 / 48000; }
        MemoryBlock m; inst->getStateInformation (m);
        if (auto x = AudioProcessor::getXmlFromBinary (m.getData(), (int) m.getSize()))
            if (auto* c = x->getChildByName ("IComponent")) { MemoryBlock raw; raw.fromBase64Encoding (c->getAllSubText()); File (argv[4]).replaceWithData (raw.getData(), raw.getSize()); }
        ed->removeFromDesktop(); ed.reset();
        return 0;
    }
    return 2;
}
