#import <Cocoa/Cocoa.h>
#include <memory>
#include "KeyMonitor.h"

void* tbAddKeyMonitor (void* nsView, std::function<bool (const char*, bool)> onCmdKey) {
    NSView* view = (NSView*) nsView;
    auto fn = std::make_shared<std::function<bool (const char*, bool)>> (std::move (onCmdKey));
    id m = [NSEvent addLocalMonitorForEventsMatchingMask: NSEventMaskKeyDown handler: ^NSEvent* (NSEvent* e) {
        const NSUInteger fl = e.modifierFlags & NSEventModifierFlagDeviceIndependentFlagsMask;
        if (! (fl & NSEventModifierFlagCommand) || (fl & (NSEventModifierFlagOption | NSEventModifierFlagControl))) return e;
        if (view.window == nil || e.window != view.window) return e;
        NSString* k = e.charactersIgnoringModifiers.lowercaseString;
        if (k.length != 1) return e;
        return (*fn) (k.UTF8String, (fl & NSEventModifierFlagShift) != 0) ? nil : e;
    }];
    [m retain];
    return (void*) m;
}

void tbRemoveKeyMonitor (void* monitor) {
    if (monitor == nullptr) return;
    [NSEvent removeMonitor: (id) monitor];
    [(id) monitor release];
}
