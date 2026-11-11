// Small helpers that give C++ the same numeric behaviour as the JavaScript in tb303-model.js.
// Build with -ffp-contract=off (no fused multiply-add) and without fast-math, or results drift from the web app.
#pragma once
#include <cmath>
#include <cstdint>
#include <vector>
#include <string>
#include <algorithm>

namespace tb303 {

constexpr double PI = 3.141592653589793;

// Math.round: halves go up
inline double jsround(double x) { return std::floor(x + 0.5); }
inline int jsroundi(double x) { return (int) std::floor(x + 0.5); }
// Math.min / Math.max with two arguments (NaN wins, as in JS)
inline double jmin(double a, double b) { if (a != a || b != b) return NAN; return a < b ? a : b; }
inline double jmax(double a, double b) { if (a != a || b != b) return NAN; return a > b ? a : b; }
inline double jsign(double x) { return x > 0 ? 1.0 : x < 0 ? -1.0 : x; }
// x || 0 for a number
inline double or0(double x) { return (x != x || x == 0) ? 0.0 : x; }
// ToUint32 of a double (JS >>> 0)
inline uint32_t toU32(double x) {
    if (!std::isfinite(x)) return 0;
    double m = std::fmod(std::trunc(x), 4294967296.0);
    if (m < 0) m += 4294967296.0;
    return (uint32_t) m;
}

inline double audioTaper(double p) { return p <= 0 ? 0 : std::pow(p, 2.74); }

struct Biquad { double b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0, x1 = 0, x2 = 0, y1 = 0, y2 = 0; };

inline Biquad lexLowpass(double fc, double Q, double fs) {
    const double w = 2 * PI * jmin(fc, 0.45 * fs) / fs, al = std::sin(w) / (2 * Q), cw = std::cos(w), a0 = 1 + al;
    Biquad f; f.b0 = (1 - cw) / 2 / a0; f.b1 = (1 - cw) / a0; f.b2 = (1 - cw) / 2 / a0; f.a1 = -2 * cw / a0; f.a2 = (1 - al) / a0;
    return f;
}
// the "{ b0: (1 - cs) / 2 / a0, ... }" low-pass written inline in several places (w, Q given)
inline Biquad lpW(double w, double Q) {
    const double cs = std::cos(w), al = std::sin(w) / (2 * Q), a0 = 1 + al;
    Biquad f; f.b0 = (1 - cs) / 2 / a0; f.b1 = (1 - cs) / a0; f.b2 = (1 - cs) / 2 / a0; f.a1 = -2 * cs / a0; f.a2 = (1 - al) / a0;
    return f;
}
inline double biqRun(Biquad* f, int n, double x) {
    for (int i = 0; i < n; i++) {
        Biquad& s = f[i];
        const double y = s.b0 * x + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
        s.x2 = s.x1; s.x1 = x; s.y2 = s.y1; s.y1 = y; x = y;
    }
    return x;
}

inline double revEx(double lo, double hi, double p) { return lo * std::pow(hi / lo, p); }
inline double onePoleA(double fc, double fs) { return std::exp(-2 * PI * jmin(fc, 0.45 * fs) / fs); }
inline int revProg(double p, int n) { return (int) jmax(0, jmin(n - 1, jsround(p * (n - 1)))); }

constexpr double VT = 0.02585;

} // namespace tb303
