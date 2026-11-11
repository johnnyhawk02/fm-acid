#include "Processor.h"
#include "Editor.h"
#include <BinaryData.h>

namespace {
// page keys that belong to this instance (its project); everything else is the library every instance shares
bool isInstanceKey (const juce::String& k) {
    return k == "tb303.session" || k == "tb303.pattern" || k == "tb303.banks" || k == "tb303.bankSel" || k == "tb303.chain";
}
const char* kIRs[] = { "plate140", "plate140b", "drumroom", "silo", "garage", "musikverein", "star" };

const char* findResource (const juce::String& file, int& size) {
    for (int i = 0; i < BinaryData::namedResourceListSize; i++)
        if (file == BinaryData::originalFilenames[i]) return BinaryData::getNamedResource (BinaryData::namedResourceList[i], size);
    size = 0; return nullptr;
}
}

TB303Processor::TB303Processor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)) {
    auto add = [this] (Param::Kind kind, const char* name, const std::string& key, juce::RangedAudioParameter* p) {
        auto P = std::make_unique<Param>(); P->kind = kind; P->name = name; P->key = key; P->p = p;
        addParameter (p); paramByKey[key] = P.get(); params.push_back (std::move (P));
    };
    const auto attrs = juce::AudioParameterFloatAttributes().withStringFromValueFunction ([] (float v, int) { return juce::String (juce::roundToInt (v * 100)) + "%"; });
#define TB_ADD_KNOB(id, label, def) add (Param::Knob, #id, "k:" #id, new juce::AudioParameterFloat (juce::ParameterID { #id, 1 }, label, juce::NormalisableRange<float> (0.f, 1.f), (float) (def), attrs));
    TB_PARAM_KNOBS (TB_ADD_KNOB)
#undef TB_ADD_KNOB
#define TB_ADD_FX(id, label) add (Param::Fx, #id, "fx:" #id, new juce::AudioParameterBool (juce::ParameterID { "fx_" #id, 1 }, label, false));
    TB_PARAM_FX (TB_ADD_FX)
#undef TB_ADD_FX
    add (Param::Wave, "wave", "wave", new juce::AudioParameterBool (juce::ParameterID { "wave", 1 }, "Square wave", false));
    add (Param::Slot, "pattern", "slot", new juce::AudioParameterInt (juce::ParameterID { "pattern", 1 }, "Pattern", 1, 8, 1));
    slotParam = params.back().get();
    startTimerHz (20);
}

TB303Processor::~TB303Processor() {
    *alive = false;
    if (irThread) irThread->stopThread (2000);
    delete pendingEngine.exchange (nullptr);
    delete retiredEngine.exchange (nullptr);
}

bool TB303Processor::isBusesLayoutSupported (const BusesLayout& layouts) const {
    const auto out = layouts.getMainOutputChannelSet();
    return layouts.getMainInputChannelSet().isDisabled() && (out == juce::AudioChannelSet::stereo() || out == juce::AudioChannelSet::mono());
}

// ------------------------------------------------------------------------------------------------ messages
bool TB303Processor::parse (const juce::var& m, Msg& out, std::string& key) {
    const juce::String type = m["type"].toString();
    const std::string name = m["name"].toString().toStdString();
    auto num = [] (const juce::var& v, double& d) { if (!(v.isDouble() || v.isInt() || v.isInt64() || v.isBool())) return false; d = (double) v; return true; };
    if (type == "knob" || type == "component") {
        out.kind = type == "knob" ? Msg::Knob : Msg::Component; out.name = name;
        if (!num (m["value"], out.a)) out.a = NAN; // JSON has no NaN; a non-number is set at once, as ParamSlew does
        key = (type == "knob" ? "k:" : "c:") + name; return !name.empty();
    }
    if (type == "wave") { out.kind = Msg::Wave; out.name = m["value"].toString().toStdString(); key = "wave"; return true; }
    if (type == "tune") {
        out.kind = Msg::Tune; out.vals.clear();
        if (auto* a = m["value"].getArray()) for (auto& x : *a) { double d; out.vals.push_back (num (x, d) ? d : NAN); }
        key = "tune"; return true;
    }
    if (type == "fx") { out.kind = Msg::Fx; out.name = name; out.on = (bool) m["value"]; key = "fx:" + name; return !name.empty(); }
    if (type == "declick") { out.kind = Msg::Declick; out.on = (bool) m["on"]; if (!num (m["ms"], out.a)) out.a = 1.5; key = "declick"; return true; }
    if (type == "groove") {
        out.kind = Msg::Groove; if (!num (m["shuffle"], out.a)) out.a = 0; if (!num (m["gate"], out.b)) out.b = 0.5;
        key = "groove"; return true;
    }
    if (type == "seq") { out.kind = Msg::Seq; out.on = (bool) m["value"]; key = "seq"; return true; }
    if (type == "pattern") {
        out.kind = Msg::Pattern; out.steps.clear();
        if (auto* a = m["value"].getArray())
            for (auto& s : *a) {
                tb303::Step st; double c = 21; num (s["code"], c);
                st.code = (int) c; st.accent = (bool) s["accent"]; st.slide = (bool) s["slide"]; st.gate = (bool) s["gate"];
                out.steps.push_back (st);
            }
        key = "pattern"; return true;
    }
    return false; // bpm and play come from the DAW; ir from the plug-in itself
}

void TB303Processor::apply (Engine& e, Msg& m, bool instant) {
    switch (m.kind) {
        case Msg::Knob: if (instant) e.v.setKnob (m.name, m.a); else e.knob (m.name, m.a); break;
        case Msg::Component: if (instant) e.v.setComponent (m.name, m.a); else e.component (m.name, m.a); break;
        case Msg::Wave: e.setWave (m.name); break;
        case Msg::Tune: e.tune (m.vals.data(), (int) m.vals.size()); break;
        case Msg::Fx: e.setFx (m.name, m.on); break;
        case Msg::Declick: e.declick (m.on, m.a); break;
        case Msg::Groove: e.groove (m.a, m.b); break;
        case Msg::Pattern: e.setPattern (std::move (m.steps)); break;
        case Msg::Seq: e.setSeq (m.on); break;
        case Msg::IR: e.setIR (m.name, m.ir); break;
    }
}

void TB303Processor::handleUiMessage (const juce::var& m) {
    const juce::String type = m["type"].toString();
    if (type == "store") {
        const juce::String k = m["key"].toString(); const juce::var v = m["value"];
        library->set (k, v);
        if (isInstanceKey (k)) { std::lock_guard<std::mutex> g (snapshotLock); if (v.isString()) instStore[k] = v.toString(); else instStore.erase (k); }
        return;
    }
    if (type == "save") { if (onSave) onSave (m["name"].toString(), m["text"].toString()); return; }
    std::string key;
    Msg msg;
    if (type == "slot") key = "slot";
    else if (!parse (m, msg, key)) return;
    else {
        { std::lock_guard<std::mutex> g (snapshotLock); snapshot[key] = m; }
        std::lock_guard<std::mutex> g (queueLock);
        queue.push_back (std::move (msg));
    }
    // a control moved on the screen: the DAW parameter follows (and records, in write mode)
    auto it = paramByKey.find (key);
    if (it != paramByKey.end()) {
        Param& P = *it->second; const float v = msgValue (P, m);
        P.ui = v;
        if (P.kind == Param::Slot) slotApplied = v;
        if (std::isfinite (v) && v != P.p->getValue()) {
            P.applied.store (v);
            if (!P.gesture) { P.p->beginChangeGesture(); P.gesture = true; }
            P.p->setValueNotifyingHost (v);
            P.touched = juce::Time::getMillisecondCounterHiRes();
        }
    }
}

float TB303Processor::msgValue (const Param& P, const juce::var& m) {
    const juce::var v = m["value"];
    if (P.kind == Param::Slot) { const double n = (double) m["n"]; return n >= 0 && n < 8 ? P.p->convertTo0to1 ((float) (std::floor (n) + 1)) : NAN; }
    if (P.kind == Param::Wave) return v.toString() == "square" ? 1.f : 0.f;
    if (P.kind == Param::Fx) return (bool) v ? 1.f : 0.f;
    return (v.isDouble() || v.isInt() || v.isInt64()) ? juce::jlimit (0.f, 1.f, (float) (double) v) : NAN;
}

juce::var TB303Processor::paramMessage (const Param& P, float v) const {
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    if (P.kind == Param::Slot) { o->setProperty ("type", "slot"); o->setProperty ("n", juce::roundToInt (P.p->convertFrom0to1 (v)) - 1); }
    else if (P.kind == Param::Wave) { o->setProperty ("type", "wave"); o->setProperty ("value", v >= 0.5f ? "square" : "saw"); }
    else if (P.kind == Param::Fx) { o->setProperty ("type", "fx"); o->setProperty ("name", juce::String (P.name)); o->setProperty ("value", v >= 0.5f); }
    else { o->setProperty ("type", "knob"); o->setProperty ("name", juce::String (P.name)); o->setProperty ("value", (double) v); }
    return juce::var (o.get());
}

// a parameter the DAW moved (automation, a generic editor) replaces the snapshot's message; one the page set to this
// value keeps the page's exact number
void TB303Processor::overlayParams() {
    for (auto& Pp : params) {
        const Param& P = *Pp; const float v = P.p->getValue();
        if (P.kind == Param::Slot) continue;
        auto s = snapshot.find (P.key);
        if (s != snapshot.end() && msgValue (P, s->second) == v) continue;
        if (s == snapshot.end() && P.kind != Param::Knob && v < 0.5f) continue; // off by default
        snapshot[P.key] = paramMessage (P, v);
    }
}

void TB303Processor::setParamsFromSnapshot() {
    for (auto& Pp : params) {
        Param& P = *Pp; float v;
        if (P.kind == Param::Slot) {
            v = P.p->convertTo0to1 ((float) (currentSlot() + 1)); slotApplied = v; P.ui = NAN;
            if (v != P.p->getValue()) P.p->setValueNotifyingHost (v);
            continue;
        }
        {
            std::lock_guard<std::mutex> g (snapshotLock);
            auto s = snapshot.find (P.key);
            v = s != snapshot.end() ? msgValue (P, s->second) : P.p->getDefaultValue();
        }
        if (!std::isfinite (v)) continue;
        P.applied.store (v); P.ui = NAN;
        if (v != P.p->getValue()) P.p->setValueNotifyingHost (v);
    }
}

void TB303Processor::uiOpened() { pageOpen = true; for (auto& P : params) P->ui = P->p->getValue(); }

void TB303Processor::endGestures() { pageOpen = false; for (auto& P : params) if (P->gesture) { P->p->endChangeGesture(); P->gesture = false; } }

int TB303Processor::currentSlot() const {
    std::lock_guard<std::mutex> g (snapshotLock);
    auto it = instStore.find ("tb303.bankSel");
    if (it == instStore.end()) return 0;
    const auto v = juce::JSON::parse (it->second);
    const int n = (int) v["n"];
    return v["g"].toString() == "A" && n >= 0 && n < 8 ? n : 0;
}

// with the window shut, the Pattern parameter loads the slot the way the page's loadSlot does
void TB303Processor::timerCallback() {
    if (!slotParam) return;
    // a MIDI note picked a pattern: it moves the Pattern parameter, which loads the slot (the page does it while it is open)
    if (const int n = midiSlot.exchange (-1); n >= 0) {
        const float v = slotParam->p->convertTo0to1 ((float) (n + 1));
        if (v != slotParam->p->getValue()) { slotParam->p->beginChangeGesture(); slotParam->p->setValueNotifyingHost (v); slotParam->p->endChangeGesture(); }
        else if (!pageOpen && n != currentSlot()) { slotApplied = v; loadSlotNatively (n); return; }
    }
    if (pageOpen) return;
    const float v = slotParam->p->getValue();
    if (v == slotApplied) return;
    slotApplied = v;
    const int n = juce::roundToInt (slotParam->p->convertFrom0to1 (v)) - 1;
    if (n != currentSlot()) loadSlotNatively (n);
}

void TB303Processor::loadSlotNatively (int n) {
    juce::String banksJson, chainJson;
    {
        std::lock_guard<std::mutex> g (snapshotLock);
        if (auto it = instStore.find ("tb303.banks"); it != instStore.end()) banksJson = it->second;
        if (auto it = instStore.find ("tb303.chain"); it != instStore.end()) chainJson = it->second;
    }
    if (auto* ch = juce::JSON::parse (chainJson).getArray(); ch && ch->size() >= 2) return; // a chain plays several slots: leave it
    const juce::var slot = juce::JSON::parse (banksJson)[juce::Identifier ("A" + juce::String (n + 1))];
    juce::Array<juce::var> steps;
    if (auto* a = slot["pattern"].getArray(); a && a->size() >= 1 && a->size() <= 64)
        for (auto& st : *a) {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty ("code", juce::jlimit (0, 59, (int) st["code"])); o->setProperty ("gate", (bool) st["gate"]);
            o->setProperty ("accent", (bool) st["accent"]); o->setProperty ("slide", (bool) st["slide"]);
            steps.add (juce::var (o.get()));
        }
    if (steps.isEmpty()) // an empty slot is a blank 16-step pattern
        for (int i = 0; i < 16; i++) {
            juce::DynamicObject::Ptr o = new juce::DynamicObject();
            o->setProperty ("code", 24); o->setProperty ("gate", false); o->setProperty ("accent", false); o->setProperty ("slide", false);
            steps.add (juce::var (o.get()));
        }
    const double sh = slot["shuffle"].isDouble() || slot["shuffle"].isInt() ? (double) slot["shuffle"] : 0.0;
    double gt = slot["gate"].isDouble() || slot["gate"].isInt() ? (double) slot["gate"] : 0.5;
    if (!(gt >= 0.1 && gt <= 0.95)) gt = 0.5;
    auto msg = [] (std::initializer_list<std::pair<const char*, juce::var>> kv) {
        juce::DynamicObject::Ptr o = new juce::DynamicObject(); for (const auto& [k, v] : kv) o->setProperty (k, v); return juce::var (o.get());
    };
    juce::String sessionJson;
    { std::lock_guard<std::mutex> g (snapshotLock); if (auto it = instStore.find ("tb303.session"); it != instStore.end()) sessionJson = it->second; }
    if (auto sess = juce::JSON::parse (sessionJson); auto* so = sess.getDynamicObject()) { // the page restores its pattern from the session
        so->setProperty ("pattern", juce::var (steps)); so->setProperty ("shuffle", sh); so->setProperty ("gate", gt);
        handleUiMessage (msg ({ { "type", "store" }, { "key", "tb303.session" }, { "value", juce::JSON::toString (sess, true) } }));
    }
    juce::DynamicObject::Ptr sel = new juce::DynamicObject(); sel->setProperty ("g", "A"); sel->setProperty ("n", n);
    handleUiMessage (msg ({ { "type", "store" }, { "key", "tb303.bankSel" }, { "value", juce::JSON::toString (juce::var (sel.get()), true) } }));
    handleUiMessage (msg ({ { "type", "store" }, { "key", "tb303.pattern" }, { "value", juce::JSON::toString (juce::var (steps), true) } }));
    handleUiMessage (msg ({ { "type", "groove" }, { "shuffle", sh }, { "gate", gt } }));
    handleUiMessage (msg ({ { "type", "pattern" }, { "value", juce::var (steps) } }));
}

void TB303Processor::uiTick (const std::function<void (const juce::var&)>& toPage) {
    const double now = juce::Time::getMillisecondCounterHiRes();
    for (auto& Pp : params) {
        Param& P = *Pp;
        if (P.gesture && now - P.touched > 300) { P.p->endChangeGesture(); P.gesture = false; }
        const float v = P.p->getValue();
        if (v != P.ui) { P.ui = v; toPage (paramMessage (P, v)); }
    }
}

juce::var TB303Processor::pageInitData() const {
    juce::DynamicObject::Ptr store = new juce::DynamicObject();
    for (const auto& [k, v] : library->data) store->setProperty (k, v);
    {
        std::lock_guard<std::mutex> g (snapshotLock);
        for (const auto& [k, v] : instStore) store->setProperty (k, v);
    }
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty ("store", juce::var (store.get()));
    o->setProperty ("plugin", JucePlugin_VersionString);
    juce::Array<juce::var> eng; // what the engine plays now, which the page takes over its saved session (automation may have moved it)
    {
        std::lock_guard<std::mutex> g (snapshotLock);
        const_cast<TB303Processor*> (this)->overlayParams();
        for (const auto& [k, m] : snapshot) if (paramByKey.count (k)) eng.add (m);
    }
    if (slotParam) eng.add (paramMessage (*slotParam, slotParam->p->getValue()));
    o->setProperty ("engine", eng);
    return juce::var (o.get());
}

std::optional<juce::WebBrowserComponent::Resource> TB303Processor::getResource (const juce::String& url) const {
    juce::String path = url.upToFirstOccurrenceOf ("?", false, false).fromFirstOccurrenceOf ("/", false, false);
    if (path.isEmpty() || path == "index.html") path = "index.html";
    const juce::String file = path.fromLastOccurrenceOf ("/", false, false);
    int size = 0; const char* data = findResource (file, size);
    if (!data) return std::nullopt;
    const juce::String ext = file.fromLastOccurrenceOf (".", false, false).toLowerCase();
    const juce::String mime = ext == "html" ? "text/html; charset=utf-8" : ext == "json" ? "application/json; charset=utf-8" : ext == "ttf" ? "font/ttf"
                            : ext == "flac" ? "audio/flac" : "application/octet-stream";
    std::vector<std::byte> bytes ((size_t) size);
    std::memcpy (bytes.data(), data, (size_t) size);
    return juce::WebBrowserComponent::Resource { std::move (bytes), mime };
}

bool TB303Processor::popMidi (int& status, int& d1, int& d2) {
    int s1, n1, s2, n2; midiFifo.prepareToRead (1, s1, n1, s2, n2);
    if (n1 + n2 < 1) return false;
    const auto& m = midiBuf[(size_t) (n1 ? s1 : s2)]; status = m[0]; d1 = m[1]; d2 = m[2];
    midiFifo.finishedRead (1);
    return true;
}

// ------------------------------------------------------------------------------------------------ engines
std::unique_ptr<TB303Processor::Engine> TB303Processor::makeEngine (double fs) {
    auto e = std::make_unique<Engine> (fs);
    e->v.rng = (uint32_t) juce::Random::getSystemRandom().nextInt(); // the web voice seeds its noise at random too
    e->onStep = [this] (int step) { stepForUi.store (step); firedG = pendingG; pendingG++; }; // audio thread
    e->v.conv.alloc(); // up front, so choosing Conv later never allocates on the audio thread (same state as the lazy alloc)
    std::lock_guard<std::mutex> g (snapshotLock);
    overlayParams();
    // the same order the page sends them in when audio starts: knobs, parts, wave, tuning, pattern, groove, fx, de-click, seq
    static const char* order[] = { "k:", "c:", "wave", "tune", "pattern", "groove", "fx:", "declick", "seq" };
    for (const char* pre : order)
        for (const auto& [key, m] : snapshot)
            if (key.rfind (pre, 0) == 0) { Msg msg; std::string k; if (parse (m, msg, k)) apply (*e, msg, true); }
    if (irsRate == fs) for (const auto& [id, d] : irs) e->setIR (id, d);
    return e;
}

void TB303Processor::installEngine (std::unique_ptr<Engine> e) {
    delete pendingEngine.exchange (e.release());
}

void TB303Processor::handleAsyncUpdate() { delete retiredEngine.exchange (nullptr); }

void TB303Processor::startIRLoad (double fs) {
    if (irThread) irThread->stopThread (4000);
    // decode the FLACs from the web app's irs/ at this rate (the page decodes them at the audio rate the same way)
    struct Loader : juce::Thread {
        TB303Processor& p; double fs;
        Loader (TB303Processor& p_, double fs_) : juce::Thread ("303 IRs"), p (p_), fs (fs_) {}
        void run() override {
            juce::FlacAudioFormat flac;
            std::map<std::string, std::shared_ptr<tb303::IRData>> out;
            for (const char* id : kIRs) {
                if (threadShouldExit()) return;
                int size = 0; const char* data = findResource (juce::String (id) + ".flac", size);
                if (!data) continue;
                std::unique_ptr<juce::AudioFormatReader> r (flac.createReaderFor (new juce::MemoryInputStream (data, (size_t) size, false), true));
                if (!r || r->lengthInSamples <= 0) continue;
                const int n = (int) r->lengthInSamples, ch = (int) juce::jmin (2u, r->numChannels);
                juce::AudioBuffer<float> b (ch, n); r->read (&b, 0, n, 0, true, ch > 1);
                auto d = std::make_shared<tb303::IRData>();
                const double ratio = r->sampleRate / fs;
                for (int c = 0; c < ch; c++) {
                    std::vector<float>& dst = c ? d->R : d->L;
                    if (std::abs (ratio - 1) < 1e-9) dst.assign (b.getReadPointer (c), b.getReadPointer (c) + n);
                    else {
                        const int m = (int) std::ceil (n / ratio);
                        std::vector<float> src (b.getReadPointer (c), b.getReadPointer (c) + n); src.resize ((size_t) n + 256, 0.f);
                        dst.assign ((size_t) m, 0.f);
                        juce::Interpolators::WindowedSinc ws; ws.process (ratio, src.data(), dst.data(), m);
                    }
                }
                out[id] = d;
            }
            juce::MessageManager::callAsync ([&p = p, fs = fs, out, alive = p.alive] {
                if (!*alive) return;
                { std::lock_guard<std::mutex> g (p.snapshotLock); p.irs = out; p.irsRate = fs; }
                if (p.sampleRate != fs) return;
                std::lock_guard<std::mutex> g (p.queueLock);
                for (const auto& [id, d] : out) { Msg m; m.kind = Msg::IR; m.name = id; m.ir = d; p.queue.push_back (std::move (m)); }
            });
        }
    };
    irThread = std::make_unique<Loader> (*this, fs);
    irThread->startThread();
}

void TB303Processor::prepareToPlay (double sr, int samplesPerBlock) {
    sampleRate = sr;
    scratchR.assign ((size_t) juce::jmax (1, samplesPerBlock) * 2, 0.f);
    if (!engine || engine->fs != sr) {
        delete pendingEngine.exchange (nullptr);
        engine = makeEngine (sr);
        { std::lock_guard<std::mutex> g (queueLock); queue.clear(); } // the snapshot already has them
        playing = false; lastBpm = 0; expectPpq = NAN; firedG = LLONG_MIN;
    }
    bool need; { std::lock_guard<std::mutex> g (snapshotLock); need = irsRate != sr; }
    if (need) startIRLoad (sr);
}

// ------------------------------------------------------------------------------------------------ audio
// The DAW drives the sequencer: play and stop follow its transport, the tempo its tempo, and every 16th (with the
// pattern's shuffle on the odd ones) lands on the DAW's grid, counted from the start of the song.
void TB303Processor::syncToHost (Engine& e, int numSamples) {
    auto* ph = getPlayHead(); if (!ph) return;
    const auto pos = ph->getPosition(); if (!pos) return;
    const bool hostPlaying = pos->getIsPlaying();
    double bpm = pos->getBpm().orFallback (lastBpm > 0 ? lastBpm : 120.0);
    bpm = juce::jlimit (20.0, 999.0, bpm);
    if (std::abs (bpm - lastBpm) > 1e-9) { e.setBpm (bpm); lastBpm = bpm; bpmForUi.store (bpm); }
    if (hostPlaying != playing) {
        playing = hostPlaying; e.play (playing); firedG = LLONG_MIN; expectPpq = NAN;
        if (!playing) stepForUi.store (-1);
    }
    if (!playing) return;
    const auto ppqOpt = pos->getPpqPosition(); if (!ppqOpt) return; // no song position: the engine keeps its own count
    const double ppq = *ppqOpt, fs = e.fs;
    if (!(std::abs (ppq - expectPpq) < 1e-3)) firedG = LLONG_MIN; // a jump (loop, locate): start counting afresh
    expectPpq = ppq + numSamples * bpm / (60.0 * fs);
    const int n = (int) e.pattern.size(); if (!n) return;
    const double sh = e.shuffle, spq = fs * 60 / bpm / 4, q = ppq * 4, eps = 0.5 / spq;
    auto start = [sh] (long long g) { return (double) g + ((g & 1) ? sh : 0.0); };
    const long long g = (long long) std::floor (q);
    long long next = start (g) >= q - eps ? g : g + 1;
    if (firedG != LLONG_MIN && next <= firedG) next = firedG + 1;
    const double toNext = juce::jmax (0.0, (start (next) - q) * spq);
    e.step = (int) (((next - 1) % n + n) % n);
    e.ctr = (long long) std::llround (toNext);
    pendingG = next;
}

void TB303Processor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals;
    if (auto* e = pendingEngine.exchange (nullptr)) {
        Engine* old = engine.release(); engine.reset (e);
        playing = false; lastBpm = 0; expectPpq = NAN; firedG = LLONG_MIN;
        delete retiredEngine.exchange (old);
        triggerAsyncUpdate();
    }
    const int n = buffer.getNumSamples();
    if (!engine) { buffer.clear(); return; }
    Engine& e = *engine;
    {
        std::unique_lock<std::mutex> lk (queueLock, std::try_to_lock);
        if (lk.owns_lock() && !queue.empty()) inbox.swap (queue);
    }
    for (auto& m : inbox) apply (e, m, false);
    inbox.clear();
    for (auto& Pp : params) { // DAW automation
        Param& P = *Pp; if (P.kind == Param::Slot) continue;
        const float v = P.p->getValue();
        if (v == P.applied.load (std::memory_order_relaxed)) continue;
        P.applied.store (v, std::memory_order_relaxed);
        if (P.kind == Param::Knob) e.knob (P.name, v);
        else if (P.kind == Param::Fx) e.setFx (P.name, v >= 0.5f);
        else { static const std::string sq = "square", saw = "saw"; e.setWave (v >= 0.5f ? sq : saw); }
    }
    syncToHost (e, n);
    float* L = buffer.getWritePointer (0);
    float* R = buffer.getNumChannels() > 1 ? buffer.getWritePointer (1) : nullptr;
    if (!R) { if ((int) scratchR.size() < n) { buffer.clear(); return; } R = scratchR.data(); }
    // MIDI from the track. Seq on (as on the page, C3 = 60): C0-G0 pick pattern 1-8, C1-C3 set the root note (C1 = as
    // written). Seq off: every note plays the voice, at its own sample in the block. CC goes to the page's MIDI map.
    int at = 0;
    for (const auto meta : midi) {
        const auto msg = meta.getMessage();
        if (msg.isNoteOnOrOff()) {
            const int nn = msg.getNoteNumber();
            if (! e.seqOn) {
                const int pos = juce::jlimit (at, n, meta.samplePosition);
                if (pos > at) { e.render (L, R, at, pos); at = pos; }
                e.note (msg.isNoteOn(), nn, msg.getVelocity());
            }
            else if (msg.isNoteOn()) {
                if (nn >= 24 && nn < 32) midiSlot.store (nn - 24);
                else if (nn >= 36 && nn <= 60) { transposeNow = nn - 36; e.transpose = transposeNow; }
            }
        }
        else if (msg.isController()) {
            int s1, n1, s2, n2; midiFifo.prepareToWrite (1, s1, n1, s2, n2);
            if (n1 + n2 > 0) { midiBuf[(size_t) (n1 ? s1 : s2)] = { 0xB0 | (msg.getChannel() - 1), msg.getControllerNumber(), msg.getControllerValue() }; midiFifo.finishedWrite (1); }
        }
    }
    e.transpose = transposeNow;
    if (at < n) e.render (L, R, at, n);
    for (int c = 2; c < buffer.getNumChannels(); c++) buffer.copyFrom (c, 0, buffer, 0, 0, n);
}

// ------------------------------------------------------------------------------------------------ state
void TB303Processor::getStateInformation (juce::MemoryBlock& dest) {
    juce::DynamicObject::Ptr o = new juce::DynamicObject(), st = new juce::DynamicObject();
    juce::Array<juce::var> msgs;
    {
        std::lock_guard<std::mutex> g (snapshotLock);
        overlayParams();
        for (const auto& [k, m] : snapshot) msgs.add (m);
        for (const auto& [k, v] : instStore) st->setProperty (k, v);
    }
    o->setProperty ("format", 1);
    o->setProperty ("engine", msgs);
    o->setProperty ("store", juce::var (st.get()));
    const auto json = juce::JSON::toString (juce::var (o.get()), true);
    dest.replaceAll (json.toRawUTF8(), json.getNumBytesAsUTF8());
}

void TB303Processor::setStateInformation (const void* data, int size) {
    const char* text = (const char*) data; int len = 0;
    while (len < size && text[len] != 0) len++; // the JSON, without anything a host or wrapper put after it
    const auto v = juce::JSON::parse (juce::String::fromUTF8 (text, len));
    if (!v.isObject()) return;
    {
        std::lock_guard<std::mutex> g (snapshotLock);
        snapshot.clear(); instStore.clear();
        if (auto* a = v["engine"].getArray())
            for (auto& m : *a) { Msg msg; std::string key; if (parse (m, msg, key)) snapshot[key] = m; }
        if (auto* s = v["store"].getDynamicObject())
            for (const auto& p : s->getProperties()) if (p.value.isString()) instStore[p.name.toString()] = p.value.toString();
    }
    setParamsFromSnapshot();
    if (sampleRate > 0) installEngine (makeEngine (sampleRate));
    { std::lock_guard<std::mutex> g (queueLock); queue.clear(); }
    juce::MessageManager::callAsync ([this, alive = alive] { if (*alive && onStateLoaded) onStateLoaded(); });
}

juce::AudioProcessorEditor* TB303Processor::createEditor() { return new TB303Editor (*this); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new TB303Processor(); }
