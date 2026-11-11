// The plug-in: the web app's engine (ported to C++ in plugin/engine) played from the DAW's transport and tempo.
// The screen is the web app's own page (Editor.h); it sends the engine the same messages it sends its AudioWorklet.
#pragma once
#include <JuceHeader.h>
#include "../engine/voice.h"
#include "Library.h"
#include <mutex>
#include <atomic>
#include <map>
#include <climits>

class TB303Processor : public juce::AudioProcessor, private juce::AsyncUpdater, private juce::Timer {
public:
    TB303Processor();
    ~TB303Processor() override;

    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    using AudioProcessor::processBlock;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}
    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    // ---- for the editor (message thread)
    void handleUiMessage (const juce::var& m);       // a message from the page
    juce::var pageInitData() const;                  // what the page starts with: its storage and the version
    std::optional<juce::WebBrowserComponent::Resource> getResource (const juce::String& url) const;
    int uiStep() const { return stepForUi.load(); }
    double uiBpm() const { return bpmForUi.load(); }
    bool popMidi (int& status, int& d1, int& d2);    // CC from the DAW track, for the page's MIDI map
    // DAW parameters (every knob, the effect switches, the wave switch), kept in step with the page both ways
    void uiTick (const std::function<void (const juce::var&)>& toPage); // ends idle gestures, sends automation moves to the page
    void uiOpened();                                   // the page has just started with pageInitData's values
    void endGestures();                                // the editor closes

    std::function<void()> onStateLoaded;             // the editor rebuilds its page when the DAW loads a project
    std::function<void (const juce::String&, const juce::String&)> onSave; // the page exported a file

private:
    using Engine = tb303::TB303Engine;
    // one engine message, parsed on the message thread and applied on the audio thread
    struct Msg {
        enum Kind { Knob, Component, Wave, Tune, Fx, Declick, Pattern, Groove, Seq, IR } kind = Knob;
        std::string name; double a = 0, b = 0; bool on = false;
        std::vector<double> vals; std::vector<tb303::Step> steps; std::shared_ptr<tb303::IRData> ir;
    };
    static bool parse (const juce::var& m, Msg& out, std::string& key);
    static void apply (Engine& e, Msg& m, bool instant);
    std::unique_ptr<Engine> makeEngine (double fs);     // a new engine at this rate, set from the snapshot
    void installEngine (std::unique_ptr<Engine> e);     // hand a new engine to the audio thread
    void handleAsyncUpdate() override;                  // deletes engines the audio thread has finished with
    void startIRLoad (double fs);
    void syncToHost (Engine& e, int numSamples);

    // DAW parameters
    struct Param {
        enum Kind { Knob, Fx, Wave, Slot } kind; std::string name, key; juce::RangedAudioParameter* p;
        std::atomic<float> applied { NAN };      // the value the audio thread last gave the engine
        float ui = NAN; bool gesture = false; double touched = 0; // message thread
    };
    std::vector<std::unique_ptr<Param>> params;
    std::map<std::string, Param*> paramByKey;          // "k:cutoff", "fx:rat", "wave"
    static float msgValue (const Param& P, const juce::var& m);
    juce::var paramMessage (const Param& P, float v) const;
    void overlayParams();                              // snapshotLock held: automation moves into the snapshot
    void setParamsFromSnapshot();
    // the Pattern parameter picks pattern slot 1-8: the page does it while it is open, the plug-in from the saved slots otherwise
    Param* slotParam = nullptr; bool pageOpen = false; float slotApplied = NAN;
    int currentSlot() const;                           // 0-7, from the page's saved selection
    void timerCallback() override;
    void loadSlotNatively (int n);

    // audio thread
    std::unique_ptr<Engine> engine;
    std::vector<Msg> inbox;
    bool playing = false; double lastBpm = 0, expectPpq = NAN;
    long long firedG = LLONG_MIN, pendingG = 0;
    std::vector<float> scratchR;
    // handed between threads
    std::atomic<Engine*> pendingEngine { nullptr }, retiredEngine { nullptr };
    std::mutex queueLock; std::vector<Msg> queue;
    std::atomic<int> stepForUi { -1 }; std::atomic<double> bpmForUi { 120 };
    std::atomic<int> midiSlot { -1 };                   // a pattern a MIDI note picked, for the timer to load
    int transposeNow = 0;                               // audio thread: the root note from MIDI, semitones above C1
    juce::AbstractFifo midiFifo { 256 }; std::array<std::array<int, 3>, 256> midiBuf {};
    // message thread (snapshotLock also guards it for prepareToPlay and state calls from other threads)
    mutable std::mutex snapshotLock;
    std::map<std::string, juce::var> snapshot;          // the latest engine message of each kind: replayed into new engines
    std::map<juce::String, juce::String> instStore;     // this instance's saved page state (its project)
    std::map<std::string, std::shared_ptr<tb303::IRData>> irs; double irsRate = 0;
    double sampleRate = 0;
    std::unique_ptr<juce::Thread> irThread;
    juce::SharedResourcePointer<TBLibrary> library;
    std::shared_ptr<bool> alive = std::make_shared<bool> (true); // async callbacks check it (message thread)

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (TB303Processor)
};
