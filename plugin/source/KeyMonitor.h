// Cmd+C, Cmd+V and Cmd+Z in the plug-in window. A DAW's Edit menu takes these before the web view sees them, so on macOS
// the editor watches key presses in its own window and hands them to the page (plugin.js) as keydowns.
#pragma once
#include <functional>
#if defined(__APPLE__)   // not JUCE_MAC: KeyMonitor.mm includes no JUCE header
void* tbAddKeyMonitor (void* nsView, std::function<bool (const char* key, bool shift)> onCmdKey); // true = swallow it
void tbRemoveKeyMonitor (void* monitor);
#else
inline void* tbAddKeyMonitor (void*, std::function<bool (const char*, bool)>) { return nullptr; }
inline void tbRemoveKeyMonitor (void*) {}
#endif
