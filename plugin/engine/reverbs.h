// The reverb slot: Lexicon 224, Dattorro plate, spring tank and convolution. A line-for-line port of the classes of
// the same names in tb303-model.js; keep the two in step (plugin/tests/parity.js checks they render the same).
#pragma once
#include "dsp_util.h"
#include "params.h"
#include <map>
#include <memory>

namespace tb303 {

// ---------------------------------------------------------------------------------------------- Lexicon 224
enum LexAlgId { ALG_PLATE, ALG_HALLB, ALG_HALLA, ALG_CHAMBER, ALG_ROOM, ALG_CDPLATE, ALG_CHORUS };
struct LexProgram { int n; LexAlgId alg; double size; double pre0, pre1; };
static const LexProgram LEX_PROGRAMS[9] = {
    { 1, ALG_HALLB, 1.2, 24, 152 }, { 2, ALG_PLATE, 1.0, 0, 107 }, { 3, ALG_HALLB, 1.85, 24, 152 },
    { 4, ALG_CHAMBER, 1.1, 25, 255 }, { 5, ALG_PLATE, 0.75, 0, 107 }, { 6, ALG_HALLA, 1.25, 24, 152 },
    { 7, ALG_ROOM, 0.5, 24, 255 }, { 8, ALG_CDPLATE, 1.0, 5, 185 }, { 9, ALG_CHORUS, 1, 0, 253 },
};
static const int LEX_TANK[8] = { 672, 4453, 1800, 3720, 908, 4217, 2656, 3163 };
static const int LEX_TAPS_L[7][3] = { { 5, 266, 1 }, { 5, 2974, 1 }, { 6, 1913, -1 }, { 7, 1996, 1 }, { 1, 1990, -1 }, { 2, 187, -1 }, { 3, 1066, -1 } };
static const int LEX_TAPS_R[7][3] = { { 1, 353, 1 }, { 1, 3627, 1 }, { 2, 1228, -1 }, { 3, 2673, 1 }, { 5, 2111, -1 }, { 6, 335, -1 }, { 7, 121, -1 } };
struct LexAlg { int nInd; int ind[6]; double mul[8]; bool hasAp3; int ap3[2]; double dd1, er; };
inline const LexAlg& lexAlg(LexAlgId id) {
    static const LexAlg plate   { 4, { 142, 107, 379, 277 }, { 1, 1, 1, 1, 1, 1, 1, 1 }, false, { 0, 0 }, 0.70, 0.25 };
    static const LexAlg hallB   { 4, { 142, 107, 379, 277 }, { 1.13, 1.07, 0.93, 1.11, 1.09, 0.97, 1.12, 1.04 }, true, { 1123, 1327 }, 0.65, 0.45 };
    static const LexAlg hallA   { 2, { 233, 571 }, { 1.21, 1.03, 1.07, 0.95, 0.89, 1.11, 0.97, 1.08 }, true, { 977, 1201 }, 0.60, 0.5 };
    static const LexAlg chamber { 3, { 113, 163, 293 }, { 0.83, 0.91, 1.17, 0.88, 0.95, 0.86, 1.21, 0.93 }, false, { 0, 0 }, 0.68, 0.7 };
    static const LexAlg room    { 2, { 101, 271 }, { 1, 1, 1, 1, 1, 1, 1, 1 }, false, { 0, 0 }, 0.62, 0.9 };
    static const LexAlg cdplate { 6, { 142, 107, 379, 277, 199, 151 }, { 1, 0.97, 1, 1.03, 1, 1.02, 1, 0.98 }, true, { 811, 947 }, 0.75, 0.15 };
    switch (id) {
        case ALG_HALLB: return hallB; case ALG_HALLA: return hallA; case ALG_CHAMBER: return chamber;
        case ALG_ROOM: return room; case ALG_CDPLATE: return cdplate; default: return plate;
    }
}
static const double LEX_CHORUS_MS[4] = { 9, 14, 19, 25 };

struct LexQ { int prog; double bass, mid, xover, treble, depth, diff, pre, me, pitch, pairs[4], wet; };
inline LexQ lexParams(const Knobs& k) {
    auto ex = [](double lo, double hi, double p) { return lo * std::pow(hi / lo, p); };
    LexQ q;
    q.prog = (int) jmax(0, jmin(8, jsround(k.lexprog * 8)));
    const LexProgram& P = LEX_PROGRAMS[q.prog];
    q.bass = ex(0.6, 70, k.lexbass); q.mid = ex(0.6, 70, k.lexmid);
    q.xover = ex(100, 10900, k.lexxover); q.treble = ex(100, 10900, k.lextreble);
    q.depth = jsround(k.lexdepth * 71); q.diff = jsround(k.lexdiff * 63);
    q.pre = P.pre0 + (P.pre1 - P.pre0) * k.lexpre;
    q.me = k.lexme < 0.03 ? 0 : 17 - jmax(1, jmin(16, std::ceil(k.lexme * 16)));
    q.pitch = 1 + jsround(k.lexpitch * 15);
    q.pairs[0] = k.lexbass; q.pairs[1] = k.lexmid; q.pairs[2] = k.lexxover; q.pairs[3] = k.lextreble;
    q.wet = 2 * audioTaper(k.lexmix);
    return q;
}

struct Lexicon224 {
    double fsHost;
    int F = 0, memWords = 0, prog = -1;
    double seed = 22477, L = 0, R = 0, yl = 0, yr = 0;
    double ph = 0, prev = 0, hx = 0, hxIn = 0;
    double envIn = 0, envL = 0, envR = 0, zl = 0, zr = 0;
    double bw = NAN, ratio = 0;
    Biquad aa[3], rcL[3], rcR[3];
    LexQ q {};
    double adcQ = 0; int steps = 0; double envRel = 0, wq = 0, xsat = 0, hxA = 0, wet = 0;
    int preD = 1; double gIn[6] = {}, dd2 = 0, gB[2] = {}, gM[2] = {}, cx = 0, tb = 0, depth = 0;
    int meT = 0; double pitch = 0, pairs[4] = {}, chDepth = 0; int chT = 1;
    // layout
    LexAlgId alg = ALG_PLATE;
    int preB = 0, chLen = 0, chB = 0;
    struct Seg { int b, len; };
    Seg chAp[4] {};
    struct ChW { double from, to; int ctr; };
    ChW chW[8] {};
    double scale = 1;
    std::vector<Seg> ind;
    int len[8] = {}, tb_[8] = {};
    bool ap3On = false; int ap3[2] = {}, ap3B[2] = {};
    double dd1 = 0, er = 0;
    int tapsL[7][3] {}, tapsR[7][3] {}, nearL[7][3] {}, nearR[7][3] {};
    struct Walk { double from, to; };
    Walk walk[4] {};
    int meCtr = 1;
    double lastL = 0, lastR = 0, xl[2] = {}, tr[2] = {};
    int words = 0;
    std::vector<double> mem; int mask = 0; int p = 0;

    explicit Lexicon224(double fsHost_) : fsHost(fsHost_) {}
    double rnd() { seed = (double) toU32(seed * 1103515245.0 + 12345.0); return seed / 4294967296.0; }

    void derive(const Parts& c, const Knobs& k) {
        q = lexParams(k);
        const int Fn = jsroundi(c.LEX_FS); const double fh = fsHost;
        const bool layoutChanged = Fn != F || jsroundi(c.LEX_MEM) != memWords || q.prog != prog;
        if (Fn != F || c.LEX_BW != bw) {
            F = Fn; bw = c.LEX_BW; ratio = F / fh;
            const double fc = jmin(c.LEX_BW, 0.45 * F), Qs[3] = { 0.5176, 0.7071, 1.9319 };
            for (int i = 0; i < 3; i++) { aa[i] = lexLowpass(fc, Qs[i], fh); rcL[i] = lexLowpass(fc, Qs[i], fh); rcR[i] = lexLowpass(fc, Qs[i], fh); }
        }
        memWords = jsroundi(c.LEX_MEM); prog = q.prog;
        if (layoutChanged) layout();
        adcQ = std::pow(2, jsround(c.LEX_BITS) - 1);
        steps = (int) jmax(0, jsround(c.LEX_RANGE / 6));
        envRel = std::exp(-1 / (c.LEX_GREL * F));
        wq = std::pow(2, jsround(c.LEX_WORD) - 1);
        xsat = c.LEX_XSAT;
        hxA = std::exp(-2 * PI * 12 / fh);
        wet = q.wet;
        preD = (int) jmax(1, jsround(q.pre * F / 1000));
        const double g1 = jmin(0.9, 0.75 * q.diff / 35);
        gIn[0] = g1; gIn[1] = g1; gIn[2] = g1 * 0.833; gIn[3] = g1 * 0.833; gIn[4] = g1 * 0.8; gIn[5] = g1 * 0.8;
        dd2 = jmin(0.7, 0.5 * q.diff / 35);
        if (alg != ALG_CHORUS) {
            auto half = [&](int o) { double s = 0; for (int i = 0; i < 4; i++) s += len[o + i]; return s; };
            const double hL = half(0) + (ap3On ? ap3[0] : 0), hR = half(4) + (ap3On ? ap3[1] : 0);
            auto g = [&](double rt, double h) { return std::pow(10, -3 * h / (rt * F)); };
            gB[0] = g(q.bass, hL); gB[1] = g(q.bass, hR); gM[0] = g(q.mid, hL); gM[1] = g(q.mid, hR);
        }
        cx = 1 - std::exp(-2 * PI * q.xover / F);
        tb = q.treble >= F / 2.0 ? 1 : 1 - std::exp(-2 * PI * q.treble / F);
        depth = q.depth / 71;
        meT = q.me != 0 ? (int) (q.me * 32) : 0;
        pitch = q.me != 0 ? q.pitch : 0;
        for (int i = 0; i < 4; i++) pairs[i] = q.pairs[i];
        chDepth = q.depth / 71 * 0.008 * F;
        chT = jsroundi((q.me != 0 ? q.me : 8) * 0.04 * F);
    }

    void layout(double fit = 1) {
        const LexProgram& P = LEX_PROGRAMS[prog];
        alg = P.alg;
        const int maxPre = (int) std::ceil(P.pre1 * F / 1000) + 2;
        words = 0;
        auto alloc = [&](int n) { const int b = words; words += n + 2; return b; };
        preB = alloc(maxPre);
        if (P.alg == ALG_CHORUS) {
            chLen = (int) std::ceil(0.045 * F);
            chB = alloc(chLen);
            const double apS[4] = { 0.0053, 0.0071, 0.0047, 0.0083 };
            for (int i = 0; i < 4; i++) { const int n = jsroundi(apS[i] * F); chAp[i].b = alloc(n); chAp[i].len = n; }
            for (int i = 0; i < 8; i++) { chW[i].from = 0; chW[i].to = 0; chW[i].ctr = 1 + (int) std::floor(rnd() * 2000); }
            scale = 1;
        } else {
            const LexAlg& A = lexAlg(P.alg);
            double indSum = 0; for (int i = 0; i < A.nInd; i++) indSum = indSum + A.ind[i];
            double tankSum = 0; for (int i = 0; i < 8; i++) tankSum = tankSum + LEX_TANK[i] * A.mul[i];
            const double base = indSum + tankSum + (A.hasAp3 ? A.ap3[0] + A.ap3[1] : 0);
            double sc = F / 29761.0 * P.size * fit;
            const double room = memWords - maxPre - 3 * (A.nInd + 12) - 80;
            if (base * sc > room) sc = jmax(0.05, room / base);
            scale = sc / (F / 29761.0);
            auto Ln = [&](double n) { return ((int) jmax(2, jsround(n * sc))) | 1; };
            ind.assign(A.nInd, Seg { 0, 0 });
            for (int i = 0; i < A.nInd; i++) { const int n = Ln(A.ind[i]); ind[i].b = alloc(n); ind[i].len = n; }
            for (int i = 0; i < 8; i++) len[i] = Ln(LEX_TANK[i] * A.mul[i]);
            for (int i = 0; i < 8; i++) tb_[i] = alloc(len[i] + ((i & 3) <= 1 ? 36 : 0));
            ap3On = A.hasAp3;
            if (ap3On) { ap3[0] = Ln(A.ap3[0]); ap3[1] = Ln(A.ap3[1]); ap3B[0] = alloc(ap3[0]); ap3B[1] = alloc(ap3[1]); }
            dd1 = A.dd1; er = A.er;
            auto tap = [&](const int t[3], int out[3], bool nr) {
                out[0] = t[0]; out[1] = (int) jmax(1, jsround((double) t[1] / LEX_TANK[t[0]] * len[t[0]] * (nr ? 0.3 : 1))); out[2] = t[2];
            };
            for (int i = 0; i < 7; i++) { tap(LEX_TAPS_L[i], tapsL[i], false); tap(LEX_TAPS_R[i], tapsR[i], false); }
            for (int i = 0; i < 7; i++) { tap(LEX_TAPS_L[i], nearL[i], true); tap(LEX_TAPS_R[i], nearR[i], true); }
            for (auto& w : walk) w = { 0, 0 };
            meCtr = 1;
            lastL = 0; lastR = 0; xl[0] = xl[1] = 0; tr[0] = tr[1] = 0;
        }
        if (words > memWords && fit > 0.5 && P.alg != ALG_CHORUS) { layout(fit * (memWords - 8) / words); return; }
        int size = 1024; while (size < words) size <<= 1;
        mem.assign(size, 0.0); mask = size - 1; p = 0;
    }

    inline void w_(int a, double v) { v = std::trunc(v * wq) / wq; mem[a & mask] = v > 1 ? 1 : v < -1 ? -1 : v; }
    inline double r_(int a) const { return mem[a & mask]; }
    inline double rf(int a, double d) const { const double fi = std::floor(d); const int i = (int) fi; const double f = d - fi; return r_(a + i) * (1 - f) + r_(a + i + 1) * f; }
    inline double ap(int b, int n, double g, double x) { const double vd = r_(p + b + n), w = x + g * vd; w_(p + b, w); return vd - g * w; }

    double conv(double x, double env) const {
        int s = steps; while (s > 0 && env * (double) (1 << s) >= 1) s--;
        const double g = (double) (1 << s); double y = x * g; y = y > 1 ? 1 : y < -1 ? -1 : y;
        return jsround(y * adcQ) / adcQ / g;
    }

    double sum(const int T[7][3], int pp) const { double y = 0; for (int i = 0; i < 7; i++) y += T[i][2] * r_(pp + tb_[T[i][0]] + T[i][1]); return y; }

    void tick(double x) {
        p = (p - 1) & mask; const int pp = p;
        w_(pp + preB, x);
        const double u0 = r_(pp + preB + preD);
        if (alg == ALG_CHORUS) { chorus(u0); return; }
        double u = u0, uE = 0;
        const int nI = (int) ind.size();
        for (int i = 0; i < nI; i++) { u = ap(ind[i].b, ind[i].len, gIn[i], u); if (i == nI - 2) uE = u; }
        Walk* W = walk;
        if (meT) {
            if (--meCtr <= 0) {
                meCtr = meT;
                for (auto& w : walk) { w.from = w.to; double n = w.to + (rnd() < 0.5 ? -1 : 1); if (std::fabs(n) > pitch) n = w.to - jsign(n - w.to); w.to = n; }
            }
        } else { meCtr = 1; for (auto& w : walk) { w.from = w.to = 0; } }
        const double ph_ = meT ? 1 - (double) meCtr / meT : 0;
        double out0 = 0, out1 = 0;
        for (int s = 0; s < 2; s++) {
            const int o = s * 4;
            double a = u + (s ? lastL : lastR);
            const double vd = rf(pp + tb_[o], len[o] + 16 + (W[s].from + (W[s].to - W[s].from) * ph_)), g = -dd1, w = a + g * vd;
            w_(pp + tb_[o], w); a = vd - g * w;
            w_(pp + tb_[o + 1], a);
            double v = rf(pp + tb_[o + 1], len[o + 1] + 16 + (W[2 + s].from + (W[2 + s].to - W[2 + s].from) * ph_));
            xl[s] += cx * (v - xl[s]);
            v = gB[s] * xl[s] + gM[s] * (v - xl[s]);
            tr[s] += tb * (v - tr[s]); v = tr[s];
            v = ap(tb_[o + 2], len[o + 2], dd2, v);
            if (ap3On) v = ap(ap3B[s], ap3[s], -dd2 * 0.8, v);
            w_(pp + tb_[o + 3], v);
            if (s) out1 = r_(pp + tb_[o + 3] + len[o + 3]); else out0 = r_(pp + tb_[o + 3] + len[o + 3]);
        }
        lastL = out0; lastR = out1;
        const double d = depth;
        yl = 0.6 * (d * sum(tapsL, pp) + (1 - d) * (sum(nearL, pp) + er * u));
        yr = 0.6 * (d * sum(tapsR, pp) + (1 - d) * (sum(nearR, pp) + er * uE));
    }

    void chorus(double u) {
        const int pp = p; w_(pp + chB, u);
        double y[2] = { 0, 0 };
        for (int v = 0; v < 8; v++) {
            ChW& w = chW[v];
            if (--w.ctr <= 0) { w.from = w.to; w.to = rnd() * 2 - 1; w.ctr = chT; }
            const double t = 1 - (double) w.ctr / chT, sm = w.from + (w.to - w.from) * (0.5 - 0.5 * std::cos(PI * t));
            const int pair = v >> 1, side = v & 1;
            const double dl = jmin(chLen - 2, (LEX_CHORUS_MS[pair] + side * 1.3) * 0.001 * F + chDepth * sm);
            double s = rf(pp + chB, jmax(1, dl));
            if (pair >= 2) { const Seg& a = chAp[(pair - 2) * 2 + side]; s = ap(a.b, a.len, dd2 * 1.2, s); }
            y[side] += pairs[pair] * s;
        }
        yl = 0.5 * y[0]; yr = 0.5 * y[1];
    }

    void run(double x) {
        hx = hxA * (hx + x - hxIn); hxIn = x;
        double v = xsat * std::tanh(hx / xsat);
        v = biqRun(aa, 3, v * 0.5);
        ph += ratio;
        while (ph >= 1) {
            ph -= 1;
            const double back = ph / ratio, xi = v - (v - prev) * jmin(1, back);
            const double a = std::fabs(xi); envIn = a > envIn ? a : envIn * envRel;
            tick(conv(xi, envIn)); const double l = yl, r = yr;
            const double al = std::fabs(l), ar = std::fabs(r);
            envL = al > envL ? al : envL * envRel; envR = ar > envR ? ar : envR * envRel;
            zl = conv(l, envL); zr = conv(r, envR);
        }
        prev = v;
        L = biqRun(rcL, 3, zl) * 2; R = biqRun(rcR, 3, zr) * 2;
    }
};

// ---------------------------------------------------------------------------------------------- Dattorro plate
static const double PLATE_SIZES[5] = { 0.5, 0.72, 1, 1.3, 1.65 };
static const int PLATE_IN[4] = { 142, 107, 379, 277 };
struct PlateQ { int prog; double pre, rt, damp, bw, lo, diff, mod, wet; };
inline PlateQ plateParams(const Knobs& k) {
    PlateQ q;
    q.prog = revProg(k.plateprog, 5);
    q.pre = 250 * k.platepre * k.platepre; q.rt = revEx(0.3, 20, k.platedecay);
    q.damp = revEx(1000, 20000, k.platedamp); q.bw = revEx(1000, 20000, k.platebw); q.lo = revEx(20, 1000, k.platelo);
    q.diff = k.platediff; q.mod = 2 * k.platemod; q.wet = 2 * audioTaper(k.platemix);
    return q;
}
struct DLine { std::vector<double> b; int n = 0; int w = 0; void make(int n_) { b.assign(n_ + 1, 0.0); n = n_; w = 0; } };
struct DattorroPlate {
    double fs; int prog = -1; double L = 0, R = 0;
    PlateQ q {}; double wet = 0; int preD = 0; double bwA = 0, dmA = 0, hpA = 0, g1 = 0, g2 = 0, decay = 0, exc = 0, sc = 1;
    DLine pre, ind[4], tk[8]; int len[8] = {}; double half[2] = {};
    int tapsL[7][3] {}, tapsR[7][3] {};
    double bwS = 0, hp = 0, hpIn = 0, dm[2] = {}, fb[2] = {}, ph = 0;
    explicit DattorroPlate(double fs_) : fs(fs_) {}
    void derive(const Knobs& k) {
        q = plateParams(k);
        if (q.prog != prog) layout(q.prog);
        wet = q.wet;
        preD = (int) jmax(0, jsround(q.pre * fs / 1000));
        bwA = onePoleA(q.bw, fs); dmA = onePoleA(q.damp, fs); hpA = std::exp(-2 * PI * q.lo / fs);
        g1 = 0.85 * q.diff; g2 = 0.708 * q.diff;
        const double th = (half[0] + half[1]) / 2 / fs;
        decay = jmin(0.98, std::pow(10, -1.5 * th / q.rt));
        exc = q.mod * 16 * sc;
    }
    void layout(int pg) {
        sc = fs / 29761 * PLATE_SIZES[pg];
        prog = pg;
        auto Ln = [&](double n) { return (int) jmax(2, jsround(n * sc)); };
        pre.make((int) std::ceil(0.25 * fs) + 2);
        for (int i = 0; i < 4; i++) ind[i].make(Ln(PLATE_IN[i]));
        for (int i = 0; i < 8; i++) len[i] = Ln(LEX_TANK[i]);
        for (int i = 0; i < 8; i++) tk[i].make(len[i] + ((i & 3) == 0 ? (int) std::ceil(4 * 16 * sc) + 4 : 0));
        for (int s = 0; s < 2; s++) { const int o = s * 4; half[s] = len[o] + len[o + 1] + len[o + 2] + len[o + 3]; }
        for (int i = 0; i < 7; i++) {
            tapsL[i][0] = LEX_TAPS_L[i][0]; tapsL[i][1] = (int) jmax(1, jsround(LEX_TAPS_L[i][1] * sc)); tapsL[i][2] = LEX_TAPS_L[i][2];
            tapsR[i][0] = LEX_TAPS_R[i][0]; tapsR[i][1] = (int) jmax(1, jsround(LEX_TAPS_R[i][1] * sc)); tapsR[i][2] = LEX_TAPS_R[i][2];
        }
        reset();
    }
    void reset() {
        if (prog < 0) return;
        auto z = [](DLine& l) { std::fill(l.b.begin(), l.b.end(), 0.0); l.w = 0; };
        z(pre); for (auto& l : ind) z(l); for (auto& l : tk) z(l);
        bwS = 0; hp = 0; hpIn = 0; dm[0] = dm[1] = 0; fb[0] = fb[1] = 0; ph = 0; L = R = 0;
    }
    static inline double rd(const DLine& l, int d) { int i = l.w - d; if (i < 0) i += (int) l.b.size(); return l.b[i]; }
    static inline void wr(DLine& l, double x) { l.w = l.w + 1 == (int) l.b.size() ? 0 : l.w + 1; l.b[l.w] = x; }
    static inline double ap(DLine& l, double g, double x) { const double vd = rd(l, l.n); double w = x + g * vd; if (w < 1e-30 && w > -1e-30) w = 0; wr(l, w); return vd - g * w; }
    void run(double x) {
        hp = hpA * (hp + x - hpIn); hpIn = x;
        wr(pre, hp);
        double u = rd(pre, preD);
        bwS = u + bwA * (bwS - u); u = bwS;
        u = ap(ind[0], g1, u); u = ap(ind[1], g1, u); u = ap(ind[2], g2, u); u = ap(ind[3], g2, u);
        ph += 0.9 / fs; if (ph >= 1) ph -= 1;
        const double lfo[2] = { std::sin(2 * PI * ph), std::cos(2 * PI * ph) };
        const double dec = decay;
        const double f0 = fb[1], f1 = fb[0];
        for (int s = 0; s < 2; s++) {
            const int o = s * 4;
            double a = u + dec * (s ? f1 : f0);
            DLine& m = tk[o]; const double dl = len[o] + exc * (1 + lfo[s]); const double fdi = std::floor(dl); const int di = (int) fdi; const double fr = dl - fdi;
            const double vd = rd(m, di) * (1 - fr) + rd(m, di + 1) * fr, w = a - 0.7 * vd;
            wr(m, w); a = vd + 0.7 * w;
            wr(tk[o + 1], a);
            double v = rd(tk[o + 1], len[o + 1]);
            double d = v + dmA * (dm[s] - v); if (d < 1e-30 && d > -1e-30) d = 0; dm[s] = d; v = d * dec;
            v = ap(tk[o + 2], 0.5, v);
            wr(tk[o + 3], v);
            fb[s] = rd(tk[o + 3], len[o + 3]);
        }
        auto sum = [&](const int T[7][3]) { double y = 0; for (int i = 0; i < 7; i++) y += T[i][2] * rd(tk[T[i][0]], T[i][1]); return y; };
        L = 0.38 * sum(tapsL); R = 0.38 * sum(tapsR);
    }
};

// ---------------------------------------------------------------------------------------------- spring
constexpr int SPRING_STAGES = 48;
static const int SPRING_N[4] = { 1, 2, 3, 3 };
static const double SPRING_MS[4][3] = { { 36, 0, 0 }, { 31.5, 37.3, 0 }, { 33.1, 37.7, 41.9 }, { 44.3, 51.1, 58.7 } };
struct SpringQ { int prog; double dwell, rt, a, tone, lo, wet; };
inline SpringQ springParams(const Knobs& k) {
    SpringQ q;
    q.prog = revProg(k.sprprog, 4);
    q.dwell = revEx(0.5, 8, k.sprdwell); q.rt = revEx(0.4, 6, k.sprdecay); q.a = 0.45 + 0.33 * k.sprtension;
    q.tone = revEx(1500, 6000, k.sprtone); q.lo = revEx(50, 1000, k.sprlo); q.wet = 2 * audioTaper(k.sprmix);
    return q;
}
struct SpringReverb {
    double fs; int K; int prog = -1; double L = 0, R = 0;
    SpringQ q {}; double wet = 0, dw = 0, dwN = 0, a = 0, lpA = 0, hpA = 0;
    struct Sp { int d; std::vector<double> buf; int w; std::vector<double> xh, yh; double lp1, lp2, fb; };
    std::vector<Sp> sp; double g[3] = {};
    Biquad olL[2], olR[2];
    int j = 0; double hp = 0, hpIn = 0, dc[4] = {};
    explicit SpringReverb(double fs_) : fs(fs_), K((int) jmax(1, jsround(fs_ / (2 * 4300)))) {}
    void derive(const Knobs& k) {
        q = springParams(k);
        if (q.prog != prog) layout(q.prog);
        wet = q.wet;
        dw = q.dwell; dwN = 1 / std::sqrt(q.dwell);
        a = q.a; lpA = onePoleA(q.tone, fs); hpA = std::exp(-2 * PI * q.lo / fs);
        const double gd = SPRING_STAGES * K * 0.5 * ((1 - q.a) / (1 + q.a) + (1 + q.a) / (1 - q.a));
        for (size_t i = 0; i < sp.size(); i++) g[i] = std::pow(10, -3 * (sp[i].d + gd) / fs / q.rt);
    }
    void layout(int pg) {
        prog = pg; sp.clear();
        for (int i = 0; i < SPRING_N[pg]; i++) {
            const int d = jsroundi(SPRING_MS[pg][i] * 0.001 * fs);
            Sp s; s.d = d; s.buf.assign(d + 1, 0.0); s.w = 0; s.xh.assign(SPRING_STAGES * K, 0.0); s.yh.assign(SPRING_STAGES * K, 0.0); s.lp1 = s.lp2 = s.fb = 0;
            sp.push_back(std::move(s));
        }
        const double fc = 0.85 * fs / (2 * K);
        olL[0] = lexLowpass(fc, 0.5412, fs); olL[1] = lexLowpass(fc, 1.3066, fs); olR[0] = lexLowpass(fc, 0.5412, fs); olR[1] = lexLowpass(fc, 1.3066, fs);
        reset();
    }
    void reset() {
        if (prog < 0) return;
        for (Biquad* f : { &olL[0], &olL[1], &olR[0], &olR[1] }) f->x1 = f->x2 = f->y1 = f->y2 = 0;
        for (auto& s : sp) { std::fill(s.buf.begin(), s.buf.end(), 0.0); std::fill(s.xh.begin(), s.xh.end(), 0.0); std::fill(s.yh.begin(), s.yh.end(), 0.0); s.w = 0; s.lp1 = s.lp2 = s.fb = 0; }
        j = 0; hp = 0; hpIn = 0; dc[0] = dc[1] = dc[2] = dc[3] = 0; L = R = 0;
    }
    void run(double x) {
        hp = hpA * (hp + x - hpIn); hpIn = x;
        const double u = std::tanh(hp * dw) * dwN;
        const int n = (int) sp.size();
        double l = 0, r = 0;
        for (int i = 0; i < n; i++) {
            Sp& s = sp[i]; double* xh = s.xh.data(); double* yh = s.yh.data();
            double v = u + g[i] * s.fb;
            for (int m = 0, o = j; m < SPRING_STAGES; m++, o += K) { double y = a * v + xh[o] - a * yh[o]; if (y < 1e-30 && y > -1e-30) y = 0; xh[o] = v; yh[o] = y; v = y; }
            s.lp1 = v + lpA * (s.lp1 - v); s.lp2 = s.lp1 + lpA * (s.lp2 - s.lp1);
            s.w = s.w + 1 == (int) s.buf.size() ? 0 : s.w + 1; s.buf[s.w] = s.lp2;
            int ri = s.w - s.d; if (ri < 0) ri += (int) s.buf.size();
            s.fb = s.buf[ri];
            if (n == 1) { l += s.fb; r += s.fb; } else if (i == 2) { l += 0.5 * s.fb; r += 0.5 * s.fb; } else if (i & 1) r += s.fb; else l += s.fb;
        }
        j = j + 1 == K ? 0 : j + 1;
        dc[0] = 0.9995 * (dc[0] + l - dc[1]); dc[1] = l;
        dc[2] = 0.9995 * (dc[2] + r - dc[3]); dc[3] = r;
        L = 0.75 * biqRun(olL, 2, dc[0]); R = 0.75 * biqRun(olR, 2, dc[2]);
    }
};

// ---------------------------------------------------------------------------------------------- convolution
constexpr int CNV_B = 512, CNV_N = 1024, CNV_BUILD = 8;
constexpr double CNV_SECS = 3, CNV_IR_GAIN = 0.17752 * 1.15;
struct CnvEr { double ms, g, pan; };
struct CnvProgram { const char* ir; double build, hf; bool gate; int nEr; CnvEr er[4]; };
static const CnvProgram CNV_PROGRAMS[9] = {
    { "plate140", 0, 0, false, 0, {} }, { "plate140b", 0, 0, false, 0, {} }, { "drumroom", 0, 0, false, 0, {} },
    { "silo", 0, 0, false, 0, {} }, { "garage", 0, 0, false, 0, {} }, { "musikverein", 0, 0, false, 0, {} }, { "star", 0, 0, false, 0, {} },
    { nullptr, 0.08, 0.33, false, 4, { { 29, 0.22, 0.4 }, { 47, -0.2, -0.6 }, { 71, 0.16, 0.7 }, { 97, -0.12, -0.3 } } },
    { nullptr, 0.003, 0.75, true, 0, {} },
};
struct ConvQ { int prog; double pre; bool full; double rt, tone, lo, width, wet; };
inline ConvQ convParams(const Knobs& k) {
    ConvQ q;
    q.prog = revProg(k.cnvprog, 9); const CnvProgram& P = CNV_PROGRAMS[q.prog];
    q.pre = 250 * k.cnvpre * k.cnvpre; q.full = P.ir != nullptr && k.cnvdecay >= 0.99;
    q.rt = P.ir ? revEx(0.2, 3, k.cnvdecay) : P.gate ? revEx(0.12, 1, k.cnvdecay) : revEx(0.2, 4, k.cnvdecay);
    q.tone = revEx(1000, 20000, k.cnvtone); q.lo = revEx(20, 1000, k.cnvlo); q.width = 1.5 * k.cnvwidth; q.wet = 2 * audioTaper(k.cnvmix);
    return q;
}
inline void cnvFFT(double* re, double* im, int N, bool inv, const double* cs, const double* sn) {
    for (int i = 1, j = 0; i < N; i++) {
        int bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit;
        if (i < j) { double t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (int len = 2; len <= N; len <<= 1) {
        const int h = len >> 1, st = N / len;
        for (int i = 0; i < N; i += len) for (int k = 0; k < h; k++) {
            const double wr = cs[k * st], wi = inv ? sn[k * st] : -sn[k * st];
            const int a = i + k, b = a + h; const double xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
            re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
    }
}
struct IRData { std::vector<float> L, R; };
struct ConvReverb {
    enum Mode { M_NONE, M_FULL, M_LEN, M_GATE, M_EXP };
    double fs; int prog = -1; double L = 0, R = 0; bool ready = false; int P; double rt = -1; Mode mode = M_NONE;
    std::map<std::string, std::shared_ptr<IRData>> ext;
    bool dirty = false;
    ConvQ q {}; double wet = 0; int preD = 0; double lpA = 0, hpA = 0, width = 0;
    std::vector<double> pg; int nG = 0;
    std::vector<double> cs, sn, ar, ai, fr, fi, inb, outL, outR, pre;
    std::vector<float> hr, hi, xr, xi;
    int i = 0, slot = 0, next = 1, nAct = 0, pw = 0; double hp = 0, hpIn = 0, lpL = 0, lpR = 0;
    int built = 0, nIR = 0; uint32_t seed[2] = {}; double gs[2][2] = {};
    std::shared_ptr<IRData> src;
    double g0 = 0, aLo = 0, aHi = 0, hfK = 0;
    struct ErT { int at; double g, pan; }; std::vector<ErT> erT;

    explicit ConvReverb(double fs_) : fs(fs_), P((int) std::ceil(CNV_SECS * fs_ / CNV_B)) {}
    void setIR(const std::string& id, std::shared_ptr<IRData> d) {
        if (d->R.empty()) d->R = d->L;
        ext[id] = std::move(d);
        if (prog >= 0 && CNV_PROGRAMS[prog].ir && id == CNV_PROGRAMS[prog].ir) dirty = true;
    }
    void derive(const Knobs& k) {
        q = convParams(k);
        wet = q.wet;
        if (q.prog != prog) { prog = q.prog; dirty = true; }
        preD = (int) jmax(0, jsround(q.pre * fs / 1000 - CNV_B));
        lpA = onePoleA(q.tone, fs); hpA = std::exp(-2 * PI * q.lo / fs); width = q.width;
        const CnvProgram& Pp = CNV_PROGRAMS[q.prog];
        const Mode md = Pp.ir ? (q.full ? M_FULL : M_LEN) : Pp.gate ? M_GATE : M_EXP;
        if (q.rt != rt || md != mode) {
            rt = q.rt; mode = md;
            if (pg.empty()) pg.assign(P, 0.0);
            int n = 0;
            for (int p = 0; p < P; p++) {
                const double t = (p + 0.5) * CNV_B / fs;
                const double g = md == M_FULL ? 1 : md == M_EXP ? std::exp(-6.9078 * t / q.rt)
                    : md == M_GATE ? (t < q.rt * 0.8 ? 1 : jmax(0, 1 - (t - q.rt * 0.8) / (q.rt * 0.2)))
                    : (t < q.rt * 0.7 ? 1 : jmax(0, 1 - (t - q.rt * 0.7) / (q.rt * 0.3)));
                pg[p] = g; if (g > 1e-4) n = p + 1;
            }
            nG = n;
        }
    }
    void alloc() {
        const int N = CNV_N;
        cs.assign(N / 2, 0.0); sn.assign(N / 2, 0.0);
        for (int k = 0; k < N / 2; k++) { cs[k] = std::cos(2 * PI * k / N); sn[k] = std::sin(2 * PI * k / N); }
        hr.assign((size_t) P * N, 0.f); hi.assign((size_t) P * N, 0.f); xr.assign((size_t) P * N, 0.f); xi.assign((size_t) P * N, 0.f);
        ar.assign(N, 0.0); ai.assign(N, 0.0); fr.assign(N, 0.0); fi.assign(N, 0.0);
        inb.assign(N, 0.0); outL.assign(CNV_B, 0.0); outR.assign(CNV_B, 0.0);
        pre.assign((size_t) std::ceil(0.25 * fs) + 2, 0.0);
        ready = true; reset();
    }
    void reset() {
        if (!ready) return;
        std::fill(xr.begin(), xr.end(), 0.f); std::fill(xi.begin(), xi.end(), 0.f); std::fill(ar.begin(), ar.end(), 0.0); std::fill(ai.begin(), ai.end(), 0.0);
        std::fill(inb.begin(), inb.end(), 0.0); std::fill(outL.begin(), outL.end(), 0.0); std::fill(outR.begin(), outR.end(), 0.0); std::fill(pre.begin(), pre.end(), 0.0);
        i = 0; slot = 0; next = 1; nAct = 0; pw = 0; hp = 0; hpIn = 0; lpL = lpR = 0; L = R = 0;
    }
    void startIR() {
        dirty = false; built = 0;
        seed[0] = (uint32_t) (0x9e3779b9u + (uint32_t) prog * 7919u); seed[1] = (uint32_t) (0x85ebca6bu + (uint32_t) prog * 104729u);
        gs[0][0] = gs[0][1] = gs[1][0] = gs[1][1] = 0;
        const CnvProgram& Pp = CNV_PROGRAMS[prog];
        src.reset();
        if (Pp.ir) { auto it = ext.find(Pp.ir); if (it != ext.end()) src = it->second; }
        nIR = Pp.ir ? (src ? (int) jmin(P, std::ceil((double) src->L.size() / CNV_B)) : 0) : P;
        if (Pp.ir) return;
        g0 = std::sqrt(13.8 * 3 / (fs * 1.5));
        aLo = onePoleA(400, fs); aHi = onePoleA(3500, fs);
        hfK = 3.4539 * (1 / Pp.hf - 1);
        erT.clear();
        for (int e = 0; e < Pp.nEr; e++) erT.push_back({ jsroundi(Pp.er[e].ms * 0.001 * fs), Pp.er[e].g * 18 * g0, Pp.er[e].pan });
    }
    double rnd(int c) {
        uint32_t t = seed[c] = seed[c] + 0x6D2B79F5u;
        t = (uint32_t) ((uint32_t) (t ^ (t >> 15)) * (uint32_t) (t | 1u));
        t ^= t + (uint32_t) ((uint32_t) (t ^ (t >> 7)) * (uint32_t) (t | 61u));
        return ((double) (uint32_t) (t ^ (t >> 14)) / 4294967296.0) * 2 - 1;
    }
    void buildSome() {
        const int N = CNV_N, B = CNV_B; const CnvProgram& Pp = CNV_PROGRAMS[prog];
        double* frp = fr.data(); double* fip = fi.data();
        for (int c = 0; c < CNV_BUILD && built < nIR; c++) {
            const int p = built;
            if (src) {
                const std::vector<float>& sL = src->L; const std::vector<float>& sR = src->R;
                const int o = p * B, m = (int) jmin(B, (double) sL.size() - o);
                for (int n = 0; n < m; n++) { frp[n] = sL[o + n] * CNV_IR_GAIN; fip[n] = (o + n < (int) sR.size() ? (double) sR[o + n] : 0.0) * CNV_IR_GAIN; }
                for (int n = m; n < N; n++) { frp[n] = 0; fip[n] = 0; }
                cnvFFT(frp, fip, N, false, cs.data(), sn.data());
                for (int n = 0; n < N; n++) { hr[(size_t) p * N + n] = (float) frp[n]; hi[(size_t) p * N + n] = (float) fip[n]; }
                built++;
                continue;
            }
            for (int n = 0; n < B; n++) {
                const int s = p * B + n; const double t = s / fs;
                const double env = g0 * (1 - std::exp(-t / Pp.build)), eh = std::exp(-hfK * t);
                for (int ch = 0; ch < 2; ch++) {
                    const double u = rnd(ch); double* g = gs[ch];
                    g[0] = u + aLo * (g[0] - u); g[1] = u + aHi * (g[1] - u);
                    double h = env * (g[1] + eh * (u - g[1]));
                    for (const auto& e : erT) if (e.at == s) h += e.g * (ch ? 1 + e.pan : 1 - e.pan);
                    if (ch) fip[n] = h; else frp[n] = h;
                }
            }
            for (int n = B; n < N; n++) { frp[n] = 0; fip[n] = 0; }
            cnvFFT(frp, fip, N, false, cs.data(), sn.data());
            for (int n = 0; n < N; n++) { hr[(size_t) p * N + n] = (float) frp[n]; hi[(size_t) p * N + n] = (float) fip[n]; }
            built++;
        }
    }
    void mac(int p, int s) {
        const int N = CNV_N; const double g = pg[p];
        if (s < 0) s += P;
        const size_t xo = (size_t) s * N, ho = (size_t) p * N;
        const float* xrp = xr.data() + xo; const float* xip = xi.data() + xo; const float* hrp = hr.data() + ho; const float* hip = hi.data() + ho;
        double* arp = ar.data(); double* aip = ai.data();
        for (int k = 0; k < N; k++) {
            const double a = xrp[k], b = xip[k], c = hrp[k], d = hip[k];
            arp[k] += g * (a * c - b * d); aip[k] += g * (a * d + b * c);
        }
    }
    void run(double x) {
        if (!ready) alloc();
        if (dirty) { startIR(); reset(); }
        const int B = CNV_B, N = CNV_N;
        hp = hpA * (hp + x - hpIn); hpIn = x;
        const int pl = (int) pre.size(); pw = pw + 1 == pl ? 0 : pw + 1; pre[pw] = hp;
        int ri = pw - preD; if (ri < 0) ri += pl;
        const int ii = i;
        inb[B + ii] = pre[ri];
        const int target = 1 + (int) std::floor((double) (ii + 1) * (nAct - 1) / B);
        while (next < target) { mac(next, slot + 1 - next); next++; }
        const double yl = outL[ii], yr = outR[ii];
        if (++i == B) {
            i = 0;
            for (int n = 0; n < N; n++) { fr[n] = inb[n]; fi[n] = 0; }
            for (int n = 0; n < B; n++) inb[n] = inb[B + n];
            cnvFFT(fr.data(), fi.data(), N, false, cs.data(), sn.data());
            slot = slot + 1 == P ? 0 : slot + 1;
            for (int n = 0; n < N; n++) { xr[(size_t) slot * N + n] = (float) fr[n]; xi[(size_t) slot * N + n] = (float) fi[n]; }
            if (nAct > 0) mac(0, slot);
            for (int n = 0; n < N; n++) { fr[n] = ar[n]; fi[n] = ai[n]; ar[n] = 0; ai[n] = 0; }
            cnvFFT(fr.data(), fi.data(), N, true, cs.data(), sn.data());
            for (int n = 0; n < B; n++) { outL[n] = fr[B + n] / N; outR[n] = fi[B + n] / N; }
            if (built < nIR) buildSome();
            nAct = (int) jmin(built, nG); next = 1;
        }
        lpL = yl + lpA * (lpL - yl); lpR = yr + lpA * (lpR - yr);
        const double m = 0.5 * (lpL + lpR), sd = 0.5 * (lpL - lpR) * width;
        L = m + sd; R = m - sd;
    }
};

} // namespace tb303
