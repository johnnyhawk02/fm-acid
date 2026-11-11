// Whether the DAW window that holds the plug-in is minimised or hidden. The plug-in's own view is a child of that window,
// so JUCE's isShowing() doesn't see it go down to the Dock or the taskbar; the editor uses this to wake the web view up
// again when the window comes back (on Windows, WebView2 can stay white after a restore).
#pragma once
#if defined(__APPLE__) || defined(_WIN32)
bool tbWindowHidden (void* nativeHandle);   // NSView* on macOS, HWND on Windows
#else
inline bool tbWindowHidden (void*) { return false; }
#endif
