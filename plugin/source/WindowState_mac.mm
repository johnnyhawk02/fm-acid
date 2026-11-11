// macOS half of WindowState.h
#import <Cocoa/Cocoa.h>
#include "WindowState.h"

bool tbWindowHidden (void* nativeHandle) {
    NSWindow* w = nativeHandle != nullptr ? [(NSView*) nativeHandle window] : nil;
    return w == nil || [w isMiniaturized] || ! [w isVisible];
}
