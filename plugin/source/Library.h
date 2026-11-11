// The page's storage that every instance of the plug-in shares (presets, favourites, colours, the last session):
// one JSON file per user, so it survives the DAW and the web view's own storage. Message thread only.
#pragma once
#include <JuceHeader.h>
#include <map>

struct TBLibrary : private juce::Timer {
    std::map<juce::String, juce::String> data;

    TBLibrary() { load(); }
    ~TBLibrary() override { if (isTimerRunning()) save(); }

    static juce::File file() {
       #if JUCE_MAC
        auto dir = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("Application Support");
       #else
        auto dir = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
       #endif
        return dir.getChildFile ("303 Circuit Model").getChildFile ("storage.json");
    }
    void load() {
        const auto v = juce::JSON::parse (file());
        if (auto* o = v.getDynamicObject())
            for (const auto& p : o->getProperties())
                if (p.value.isString()) data[p.name.toString()] = p.value.toString();
    }
    void save() {
        juce::DynamicObject::Ptr o = new juce::DynamicObject();
        for (const auto& [k, v] : data) o->setProperty (k, v);
        const auto f = file();
        f.getParentDirectory().createDirectory();
        f.replaceWithText (juce::JSON::toString (juce::var (o.get()), true));
    }
    void set (const juce::String& key, const juce::var& value) {
        if (value.isString()) data[key] = value.toString(); else data.erase (key);
        startTimer (1000);
    }

private:
    void timerCallback() override { stopTimer(); save(); }
};
