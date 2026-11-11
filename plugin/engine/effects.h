// Drive-slot pedals (DS-1, TS808), the Buchla 259 folder, the delay, the BF-2 flanger and the Compactor.
// A line-for-line port of tb303-model.js; keep the two in step (plugin/tests/parity.js checks they render the same).
#pragma once
#include "dsp_util.h"
#include "params.h"

namespace tb303 {

constexpr double DIODE_IS = 2.52e-9, DIODE_N = 1.752;
constexpr int PEDAL_OS = 2;

struct OsUnit {
    double fs, fo, dt, xp = 0, dco = 0, dci = 0, dcA;
    Biquad lp[3];
    explicit OsUnit(double fs_) : fs(fs_), fo(fs_ * PEDAL_OS), dt(1 / (fs_ * PEDAL_OS)) {
        const double w = 2 * PI * 22000 / fo, Qs[3] = { 0.5176, 0.7071, 1.9319 };
        for (int i = 0; i < 3; i++) lp[i] = lpW(w, Qs[i]);
        dcA = std::exp(-2 * PI * 5 / fs);
    }
    double e(double tau) const { return std::exp(-dt / jmax(tau, 1e-12)); }
    template <class Core> double runWith(double x, Core&& core) {
        const double x0 = xp; xp = x; double y = 0;
        for (int i = 1; i <= PEDAL_OS; i++) {
            double z = core(x0 + (x - x0) * ((double) i / PEDAL_OS));
            z = biqRun(lp, 3, z);
            y = z;
        }
        dco = dcA * (dco + y - dci); dci = y;
        return dco;
    }
};

inline double diodeNode(double gw, double G, double vp, double Is, double nVt) {
    const double lin = gw / G;
    double lo = lin < 0 ? lin : 0, hi = lin < 0 ? 0 : lin, v = jmin(hi, jmax(lo, vp));
    for (int i = 0; i < 40; i++) {
        const double t = jmin(jmax(v / nVt, -80), 80), ex = std::exp(t), ei = 1 / ex;
        const double f = gw - G * v - Is * (ex - ei), df = -G - Is * (ex + ei) / nVt;
        if (f > 0) lo = v; else hi = v;
        double nv = v - f / df;
        if (!(nv > lo && nv < hi)) nv = 0.5 * (lo + hi);
        const double dv = nv - v; v = nv;
        if (dv < 1e-7 && dv > -1e-7) break;
    }
    return v;
}
inline double softRail(double v, double hi, double lo) { return v > 0 ? hi * std::tanh(v / hi) : lo * std::tanh(v / lo); }

struct BossDS1 : OsUnit {
    struct S { double h0 = 0, x0 = 0, b = 0, h1 = 0, x1 = 0, hl = 0, xl = 0, vf = 0, v = 0, lp = 0, hp = 0, xh = 0; } s;
    double aIn = 0, aB = 0, aOp = 0, aLeg = 0, vr1 = 0, aF = 0, gC = 0, cdt = 0, aLp = 0, aHp = 0, tone = 0, level = 0, nVt = 0;
    explicit BossDS1(double fs_) : OsUnit(fs_) {}
    void derive(const Knobs& k) {
        using namespace pedal;
        aIn = e(DS_C3 * DS_R5); aB = e(DS_R7 * DS_C4); aOp = e(DS_C5 * DS_R10); aLeg = e(DS_R13 * DS_C8);
        vr1 = DS_VR1 * k.dsdist + 1;
        aF = e(vr1 * DS_C7);
        gC = 1 / DS_R14; cdt = DS_C10 / dt;
        aLp = e(DS_R16 * DS_C12); aHp = e(DS_C11 * DS_R17);
        tone = k.dstone;
        level = audioTaper(k.dslevel) * 12;
        nVt = DIODE_N * VT;
    }
    double core(double x) {
        using namespace pedal;
        s.h0 = aIn * (s.h0 + x - s.x0); s.x0 = x;
        const double tb = -DS_GAIN * s.h0;
        s.b = tb + aB * (s.b - tb);
        const double q = softRail(s.b, 9 - DS_VC, DS_VC - DS_VSAT);
        s.h1 = aOp * (s.h1 + q - s.x1); s.x1 = q;
        const double u = s.h1;
        s.hl = aLeg * (s.hl + u - s.xl); s.xl = u;
        const double vf = s.hl / DS_R13 * vr1;
        s.vf = vf + aF * (s.vf - vf);
        const double o = softRail(u + s.vf, DS_OPHI, DS_OPLO);
        s.v = diodeNode(gC * o + cdt * s.v, gC + cdt, s.v, DIODE_IS, nVt);
        s.lp = s.v + aLp * (s.lp - s.v);
        s.hp = aHp * (s.hp + s.v - s.xh); s.xh = s.v;
        return ((1 - tone) * s.lp + tone * s.hp) * level;
    }
    double run(double x) { return runWith(x, [this](double z) { return core(z); }); }
};

struct TubeScreamer : OsUnit {
    struct S { double h0 = 0, x0 = 0, hl = 0, xl = 0, vf = 0, z1 = 0, z2 = 0, w1 = 0, w2 = 0; } s;
    double aIn = 0, aLeg = 0, rf = 0, gF = 0, cdt = 0, nVt = 0, tb[3] = {}, ta[2] = {}, level = 0;
    explicit TubeScreamer(double fs_) : OsUnit(fs_) {}
    void derive(const Knobs& k) {
        using namespace pedal;
        aIn = e(TS_C2 * TS_R5); aLeg = e(TS_R4 * TS_C3);
        rf = TS_R6 + TS_P1 * audioTaper(k.tsdrive);
        gF = 1 / rf; cdt = TS_C4 / dt;
        nVt = DIODE_N * VT;
        const double t = jmin(0.999, jmax(0.001, k.tstone)), Ra = TS_P2 * t, Rb = TS_P2 * (1 - t);
        const double Rs = Ra * Rb / (Ra + Rb) + TS_R8, ka = Rb / TS_P2, kb = Ra / TS_P2;
        const double R7 = TS_R7, C5 = TS_C5, C6 = TS_C6;
        const double n0 = 1, n1 = C6 * (Rs + kb * TS_RF), n2 = 0;
        const double d0 = 1, d1 = C5 * R7 + C6 * Rs + ka * C6 * R7, d2 = C5 * R7 * C6 * Rs;
        const double K = 2 * fo, K2 = K * K, a0 = d0 + d1 * K + d2 * K2;
        tb[0] = (n0 + n1 * K + n2 * K2) / a0; tb[1] = (2 * n0 - 2 * n2 * K2) / a0; tb[2] = (n0 - n1 * K + n2 * K2) / a0;
        ta[0] = (2 * d0 - 2 * d2 * K2) / a0; ta[1] = (d0 - d1 * K + d2 * K2) / a0;
        level = audioTaper(k.tslevel) * 13;
    }
    double core(double x) {
        using namespace pedal;
        s.h0 = aIn * (s.h0 + x - s.x0); s.x0 = x;
        const double u = s.h0;
        s.hl = aLeg * (s.hl + u - s.xl); s.xl = u;
        const double i = s.hl / TS_R4;
        s.vf = diodeNode(i + cdt * s.vf, gF + cdt, s.vf, DIODE_IS, nVt);
        const double o = softRail(u + s.vf, TS_RAIL, TS_RAIL);
        const double y = tb[0] * o + s.z1; s.z1 = tb[1] * o - ta[0] * y + s.z2; s.z2 = tb[2] * o - ta[1] * y;
        return y * level;
    }
    double run(double x) { return runWith(x, [this](double z) { return core(z); }); }
};

constexpr double B259_REL = 0.2, B259_FLOOR = 0.005;
struct Buchla259 : OsUnit {
    struct S { double xa = 0, Fa = 0, y = 0, env = 0; } s;
    struct Cell { double T, a, b, C; } cells[5];
    double relA, gain = 0, off = 0, aOut = 0, f0 = 0, norm = 0;
    explicit Buchla259(double fs_) : OsUnit(fs_) {
        using namespace pedal;
        const double Vs = B259_VS;
        for (int i = 0; i < 5; i++) {
            const double R1 = B259_CELLS[i][0], R2 = B259_CELLS[i][1], R3 = B259_CELLS[i][2];
            const double D = R1 * R3 + R2 * R3 + R1 * R2, a = R2 * R3 / D, b = R1 * R3 * Vs / D, T = R1 / R2 * Vs, w = B259_W[i];
            cells[i] = { T, w * a, w * b, w * (a * T * T / 2 - b * T) };
        }
        relA = e(B259_REL);
    }
    double f(double v) const { double y = pedal::B259_WIN * v; for (const auto& q : cells) { const double m = v < 0 ? -v : v; if (m > q.T) y += q.a * v - (v < 0 ? -q.b : q.b); } return y; }
    double F(double v) const { double y = 0.5 * pedal::B259_WIN * v * v; for (const auto& q : cells) { const double m = v < 0 ? -v : v; if (m > q.T) y += q.a * v * v / 2 - q.b * m - q.C; } return y; }
    void derive(const Knobs& k) {
        using namespace pedal;
        gain = 0.5 + 9.5 * k.fldtimbre * k.fldtimbre;
        off = (k.fldsym - 0.5) * 4;
        aOut = e(B259_RF2 * B259_C);
        f0 = f(off);
        double pk = 1e-9;
        for (int i = 0; i <= 256; i++) { const double y = f(off + gain * ((double) i / 128 - 1)) - f0; const double m = y < 0 ? -y : y; if (m > pk) pk = m; }
        norm = audioTaper(k.fldlevel) * 6.7 / (std::pow(B259_WIN * gain, 0.3) * std::pow(pk, 0.7));
    }
    double core(double x) {
        const double ax = x < 0 ? -x : x;
        s.env = ax > s.env ? ax : s.env * relA;
        const double en = s.env > B259_FLOOR ? s.env : B259_FLOOR;
        const double v = x / en * gain + off, Fv = F(v), d = v - s.xa;
        const double y = (d > 1e-6 || d < -1e-6) ? (Fv - s.Fa) / d : f(0.5 * (v + s.xa));
        s.xa = v; s.Fa = Fv;
        s.y = y + aOut * (s.y - y);
        return (s.y - f0) * en * norm;
    }
    double run(double x) { return runWith(x, [this](double z) { return core(z); }); }
};

// ---------------------------------------------------------------------------------------------- delay
static const double DLY_DIVS[11] = { 1.0 / 8, 1.0 / 6, 1.0 / 4, 1.0 / 3, 3.0 / 8, 1.0 / 2, 2.0 / 3, 3.0 / 4, 1, 3.0 / 2, 2 };
inline double dlyDiv(double p) { return DLY_DIVS[(int) jmin(10, jsround(p * 10))]; }
inline double dlyLo(double p) { return 20 * std::pow(50, p); }
inline double dlyHi(double p) { return 1000 * std::pow(20, p); }
struct DigitalDelay {
    double fs; std::vector<float> buf, bufR; int w = 0;
    double d, dT, lp = 0, hp = 0, hpIn = 0, lpR = 0, hpR = 0, hpInR = 0, l = 0, r = 0; bool pp = true;
    double fb = 0, lpA = 0, hpA = 0, mix = 0, slewA = 0;
    explicit DigitalDelay(double fs_) : fs(fs_) {
        buf.assign((size_t) std::ceil(fs * 2.6), 0.f); bufR.assign(buf.size(), 0.f);
        d = fs * 0.25; dT = d;
    }
    void derive(const Knobs& k, double bpm) {
        dT = jmin((double) buf.size() - 4, dlyDiv(k.dlytime) * 60 / bpm * fs);
        fb = 0.95 * k.dlyfb;
        lpA = std::exp(-2 * PI * jmin(dlyHi(k.dlyhi), 0.45 * fs) / fs);
        hpA = std::exp(-2 * PI * dlyLo(k.dlylo) / fs);
        mix = k.dlymix * k.dlymix * 1.2;
        slewA = 1 - std::exp(-1 / (0.06 * fs));
        const bool p_ = k.dlypp >= 0.5; if (p_ != pp) { pp = p_; std::fill(bufR.begin(), bufR.end(), 0.f); }
    }
    double run(double x) {
        float* b = buf.data(); float* B = bufR.data(); const int N = (int) buf.size();
        d += (dT - d) * slewA;
        double rr = w - d; if (rr < 0) rr += N;
        const double fi = std::floor(rr); const int i = (int) fi; const double f = rr - fi; const int j = i + 1 == N ? 0 : i + 1;
        double y = b[i] + ((double) b[j] - b[i]) * f;
        hp = hpA * (hp + y - hpIn); hpIn = y; y = hp;
        lp = y + lpA * (lp - y); y = lp;
        if (pp) {
            double z = B[i] + ((double) B[j] - B[i]) * f;
            hpR = hpA * (hpR + z - hpInR); hpInR = z; z = hpR;
            lpR = z + lpA * (lpR - z); z = lpR;
            b[w] = (float) (x + fb * z); B[w] = (float) y;
            l = y * mix; r = z * mix;
        } else {
            b[w] = (float) (x + fb * y);
            l = r = y * mix;
        }
        w = w + 1 == N ? 0 : w + 1;
        return l;
    }
};

// ---------------------------------------------------------------------------------------------- BF-2 flanger
constexpr double FLG_STAGES = 1024, FLG_FHI = 500e3, FLG_FLO = 40e3, FLG_LPF = 8000;
inline double flgRate(double p) { return 0.1 * std::pow(100, p); }
struct BF2Flanger {
    double fs; std::vector<float> buf; int w = 0; double ph = 0, y = 0, g = 0.62;
    double b0, a1, a2, i1 = 0, i2 = 0, j1 = 0, j2 = 0, o1 = 0, o2 = 0, p1 = 0, p2 = 0;
    bool chorus = false; double inc = 0, man = 0, dep = 0, fb = 0;
    explicit BF2Flanger(double fs_) : fs(fs_) {
        buf.assign((size_t) std::ceil(fs * 0.016) + 4, 0.f);
        const double K = std::tan(PI * jmin(FLG_LPF, 0.45 * fs) / fs), Q = 0.7071067811865476, n = 1 / (1 + K / Q + K * K);
        b0 = K * K * n; a1 = 2 * (K * K - 1) * n; a2 = (1 - K / Q + K * K) * n;
    }
    void derive(const Knobs& k) {
        chorus = k.flgmode >= 0.5;
        inc = flgRate(k.flgrate) / fs;
        man = k.flgman; dep = k.flgdep;
        fb = chorus ? 0 : 0.9 * k.flgres;
        g = chorus ? 0.72 : 0.62;
    }
    double run(double x) {
        ph += inc; if (ph >= 1) ph -= 1;
        const double tri = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph;
        double v = chorus ? 0.55 + 0.45 * man + 0.15 * dep * tri : man + 0.5 * dep * tri;
        v = v < 0 ? 0 : v > 1 ? 1 : v;
        const double d = FLG_STAGES / (2 * (FLG_FHI - v * (FLG_FHI - FLG_FLO))) * fs;
        const double u = x + fb * std::tanh(y);
        const double a = b0 * (u + 2 * i1 + i2) - a1 * j1 - a2 * j2;
        i2 = i1; i1 = u; j2 = j1; j1 = a;
        float* b = buf.data(); const int N = (int) buf.size();
        b[w] = (float) a;
        double rr = w - d; if (rr < 0) rr += N;
        const double fi = std::floor(rr); const int i = (int) fi; const double f = rr - fi; const int j = i + 1 == N ? 0 : i + 1;
        const double z = b[i] + ((double) b[j] - b[i]) * f;
        w = w + 1 == N ? 0 : w + 1;
        const double yy = b0 * (z + 2 * o1 + o2) - a1 * p1 - a2 * p2;
        o2 = o1; o1 = z; p2 = p1; p1 = yy;
        y = yy;
        return g * (x + yy);
    }
};

// ---------------------------------------------------------------------------------------------- Compactor
inline double cmpThrDb(double a) { return -10 - 20 * a; }
inline double cmpMix(double a) { return jmin(1, 1.4 * a); }
inline double cmpRelMs(double p) { return 1000 * p * p; }
constexpr double CMP_ATK_MS = 3;
struct Compactor {
    double fs; std::vector<float> L, R; int w = 0; double env = 0, l = 0, r = 0, g = 1;
    double inv = 1, atkA = 0, relA = 0, mix = 0; int D = 1;
    explicit Compactor(double fs_) : fs(fs_) { L.assign((size_t) std::ceil(fs * 0.011), 0.f); R.assign(L.size(), 0.f); }
    void derive(const Knobs& k) {
        inv = std::pow(10, -cmpThrDb(k.cmpamt) / 20);
        D = (int) jmin((double) L.size() - 1, jsround(CMP_ATK_MS * 1e-3 * fs));
        atkA = 1 - std::exp(-3.0 / D);
        const double rel = cmpRelMs(k.cmprel) * 1e-3 * fs;
        relA = rel > 0.5 ? std::exp(-1 / rel) : 0;
        mix = cmpMix(k.cmpamt);
    }
    double run(double y, double wl, double wr) {
        double a = std::fabs(y) * inv; if (a > 1) a = 1;
        if (a >= env) env += (a - env) * atkA;
        else env = a + (env - a) * relA;
        const int N = (int) L.size(); int ri = w - D; if (ri < 0) ri += N;
        L[w] = (float) wl; R[w] = (float) wr; l = L[ri]; r = R[ri]; w = w + 1 == N ? 0 : w + 1;
        g = 1 - mix * env;
        return g;
    }
};

} // namespace tb303
