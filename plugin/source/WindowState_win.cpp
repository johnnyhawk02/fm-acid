// Windows half of WindowState.h (no JUCE header: windows.h on its own)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include "WindowState.h"

bool tbWindowHidden (void* nativeHandle) {
    const HWND root = nativeHandle != nullptr ? GetAncestor ((HWND) nativeHandle, GA_ROOT) : nullptr;
    return root == nullptr || IsIconic (root) || ! IsWindowVisible (root);
}
