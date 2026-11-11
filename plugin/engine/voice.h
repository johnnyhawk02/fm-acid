// The TB-303 voice, knob slew, de-click and the step sequencer (TB303Voice, ParamSlew, DeClick, TB303Engine in
// tb303-model.js), ported line for line. Keep the two in step (plugin/tests/parity.js checks they render the same).
#pragma once
#include "reverbs.h"
#include "effects.h"
#include <functional>

namespace tb303 {

constexpr int SQ_SUB = 4;
constexpr double OUT_TRIM = 0.4, Q20_VBE = 0.65, SQ_BR = 4;
constexpr int RAT_OS = 2;

inline double dacVoltage(int code, double vref, double R, double R2) {
    double vth = 0, rth = R2;
    for (int k = 0; k < 6; k++) {
        const double vb = (code >> k) & 1 ? vref : 0;
        vth = (vth / rth + vb / R2) / (1 / rth + 1 / R2);
        rth = (rth * R2) / (rth + R2);
        if (k < 5) rth += R;
    }
    return vth;
}
inline int revType(const Knobs& k) { return (int) jmax(0, jmin(3, jsround(or0(k.revtype) * 3))); }

struct Fx { bool rat = false, lex = false, dly = false, fold = false, flg = false; };

struct TB303Voice {
    double fsOut; int os = 2; double fs, h;
    Parts c; Knobs knobs; Fx fx; double bpm = 128;
    BossDS1 ds; TubeScreamer ts; Buchla259 b259; int drvT = 0;
    Lexicon224 lex; DattorroPlate plate; SpringReverb spring; ConvReverb conv; int revT = 0;
    DigitalDelay dly; BF2Flanger flg; Compactor cmp;
    struct Rt { double hin = 0, xin = 0, h1 = 0, h2 = 0, x1 = 0, fb = 0, y = 0, hc = 0, xc = 0, v = 0, f = 0, xp = 0, dco = 0, dci = 0; } rt;
    bool square = false; // waveform === 'square'
    double tuneCv[12] = {};
    double cvTarget, cv; bool slide = false, gate = false, accentNote = false;
    double vSaw, sawDelay;
    struct Sq { double s = 0, e = 0, vc = 0, b = 0, col = 0, hp = 0, hpIn = 0; } sq;
    double v[4] = {}, fbLp = 0;
    double envVcf = 0, envAttack = 0, envVca = 0, vcaAttack = 0, vAcc = 0, vWowC = 0, vWow = 0;
    uint32_t rng = 0x9e3779b9u;
    double hp14 = 0, hp14In = 0, hp38 = 0, hp38In = 0, hp49 = 0, hp49In = 0, hp76 = 0, hp76In = 0;
    Biquad decim[2];
    // derived
    double nVcf = 0, nOta = 0, nOut = 0; bool noiseOn = false;
    double swing = 0, iVcoRef = 0, tuneOct = 0, sqG10 = 0, sqG11 = 0, sqInA = 0, slideA = 0;
    double C[4] = {}, inAtt = 0, kFb = 0, fbA = 0, wCut = 0, wEnv = 0, wAcc = 0, wKt = 0, vCutPot = 0, envModFrac = 0;
    double envDecA = 0, envDecAccA = 0, envAtkA = 0, vcaAtkA = 0, vcaSoftA = 0, vcaDecA = 0, vcaRelA = 0;
    double accFrac = 0, accChgK = 0, accDisA = 0;
    struct Tap { double a, b, tgt, k; } wowOn {}, wowOff {};
    double hp14A = 0, hp49A = 0, hp76A = 0, hp38A = 0, vinDen = 0, q21I = 0, q21Swing = 0, vol = 0;
    bool ratLPMade = false; Biquad ratLP[3];
    double ratDcA = 0, ratRd = 0, ratInA = 0, ratA1 = 0, ratA2 = 0, ratFA = 0, ratGain = 0, ratK = 0, ratSlew = 0, ratRail = 0, ratCA = 0, ratN = 0, ratIs = 0, ratFltA = 0, ratLevel = 0;
    bool fxSwap = false; int retMode = 0;

    explicit TB303Voice(double sampleRate)
        : fsOut(sampleRate), fs(sampleRate * 2), h(1 / (sampleRate * 2)),
          ds(sampleRate * 2), ts(sampleRate * 2), b259(sampleRate * 2),
          lex(sampleRate), plate(sampleRate), spring(sampleRate), conv(sampleRate),
          dly(sampleRate), flg(sampleRate), cmp(sampleRate) {
        cvTarget = dacVoltage(33, c.VREF, c.R_DAC, c.R2_DAC);
        cv = cvTarget;
        vSaw = c.V_LO; sawDelay = vSaw;
        makeDecimator();
        derive();
    }

    void setComponent(const std::string& name, double value) { if (double* p = c.find(name)) { *p = value; derive(); } }
    void setFx(const std::string& name, bool on) {
        if (name == "rat") fx.rat = on; else if (name == "lex") fx.lex = on; else if (name == "dly") fx.dly = on;
        else if (name == "fold") fx.fold = on; else if (name == "flg") fx.flg = on;
    }
    void setKnob(const std::string& name, double value) { if (double* p = knobs.find(name)) { *p = value; derive(); } }
    void setTune(const double* cents, int n) { for (int i = 0; i < 12; i++) { const double ct = i < n && cents[i] == cents[i] ? cents[i] : 0; tuneCv[i] = ct / 1200; } }

    void derive() {
        const Knobs& k = knobs;
        cmp.derive(k); dly.derive(k, bpm); flg.derive(k);
        const double nb = std::sqrt(fs / 2) * c.NOISE;
        nVcf = c.EN_VCF * nb; nOta = c.EN_OTA * nb; nOut = c.EN_OUT * nb;
        noiseOn = nVcf + nOta + nOut > 0;
        swing = c.V_HI - c.V_LO;
        iVcoRef = c.F_TUNE * c.C33 * swing;
        tuneOct = (k.tuning - 0.5) * 2;
        { const double hs = h / SQ_SUB; sqG10 = c.C10 / hs; sqG11 = c.C_SQE / hs; }
        sqInA = std::exp(-1 / (c.C_IN * (c.R_IN + c.R98) * fs));
        slideA = std::exp(-1 / (c.R93 * c.C35 * fs));
        C[0] = c.C18; C[1] = c.C19; C[2] = c.C24; C[3] = c.C26;
        inAtt = c.R98 / (c.R_IN + c.R98);
        kFb = c.A_Q21 * k.resonance;
        fbA = std::exp(-1 / (c.C15 * c.R98 * fs));
        const double g73 = 1 / c.R73, g72 = 1 / c.R72, g63 = 1 / c.R63, g71 = 1 / c.R71, gKt = c.KT > 0 ? 1 / c.R_KT : 0;
        const double gs = g73 + g72 + g63 + g71 + gKt;
        wCut = g73 / gs; wEnv = g72 / gs; wAcc = g63 / gs; wKt = c.KT * gKt / gs;
        vCutPot = c.V_CUT * k.cutoff;
        envModFrac = audioTaper(k.envmod);
        const double rDecay = c.R138 + c.VR6 * audioTaper(k.decay);
        envDecA = std::exp(-1 / (rDecay * c.C62 * fs));
        envDecAccA = std::exp(-1 / (c.R138 * c.C62 * fs));
        envAtkA = std::exp(-1 / (c.R152 * c.C62 * fs));
        vcaAtkA = std::exp(-1 / (c.R49 * c.C67 * fs));
        vcaSoftA = std::exp(-1 / ((c.R49 + c.R_SOFT) * c.C67 * fs));
        vcaDecA = std::exp(-1 / (c.R52 * c.C67 * fs));
        vcaRelA = std::exp(-1 / (c.R_VREL * c.C67 * fs));
        accFrac = k.accent;
        accChgK = 1 / (c.R117 * c.C_ACC * fs);
        accDisA = std::exp(-1 / (c.R_ACC * c.C_ACC * fs));
        {
            const double ra = jmax(c.VR4 * k.resonance, 1), rb = jmax(c.VR4 * (1 - k.resonance), 1);
            const double rs = c.R_ACC + c.VR7 * k.accent * (1 - k.accent);
            const double gl = 1 / (c.R63 + 1 / (g73 + g72 + g71 + gKt)), gb = 1 / rb, dt = 1 / fs;
            auto tap = [&](double gsrc) { const double sum = gsrc + gb + gl; return Tap { gsrc / sum, gb / sum, gsrc / (gsrc + gl), std::exp(-dt * gb * (gsrc + gl) / sum / c.C_ACC) }; };
            wowOn = tap(1 / (rs + ra)); wowOff = tap(0);
        }
        hp14A = std::exp(-1 / (c.C14 * c.R85 * fs));
        hp49A = std::exp(-1 / (c.C49 * c.R88 * fs));
        hp76A = std::exp(-1 / (c.C76 * c.R100 * fs));
        hp38A = std::exp(-1 / (c.C38 * c.R_OUT * fs));
        vinDen = 1 / c.R88 + 1 / c.R100 + 1 / c.R101;
        q21I = jmax(c.VREF * c.R109 / (c.R116 + c.R112 + c.R109) - Q20_VBE, 0) / c.R108;
        q21Swing = q21I * c.R110 / 2;
        vol = audioTaper(k.volume);
        deriveFx();
    }

    void deriveFx() {
        const Knobs& k = knobs; const double f2 = fs * RAT_OS;
        auto e = [f2](double tau) { return std::exp(-1 / (jmax(tau, 1e-12) * f2)); };
        if (!ratLPMade) {
            const double fc = 22000 / f2, w = 2 * PI * fc, Qs[3] = { 0.5176, 0.7071, 1.9319 };
            for (int i = 0; i < 3; i++) ratLP[i] = lpW(w, Qs[i]);
            ratLPMade = true;
        }
        ratDcA = std::exp(-2 * PI * 5 / fs);
        const double rd = c.RAT_RD * audioTaper(k.dist) + 1;
        ratRd = rd;
        ratInA = e(c.RAT_CIN * 1e6);
        ratA1 = e(c.RAT_RG1 * c.RAT_CG1); ratA2 = e(c.RAT_RG2 * c.RAT_CG2);
        ratFA = e(rd * c.RAT_CF);
        const double comp = 30e-12 / c.RAT_CC;
        const double gHf = 1 + rd * (1 / c.RAT_RG1 + 1 / c.RAT_RG2);
        ratGain = gHf;
        ratK = jmin(1, 2 * PI * c.RAT_GBW * comp / gHf / f2);
        ratSlew = c.RAT_SR * 1e6 * comp / f2;
        ratRail = jmax(c.RAT_VS / 2 - 1, 0.5);
        ratCA = e(4.7e-6 * (c.RAT_RCL + 1e3));
        ratN = 1.8 * VT;
        ratIs = 1e-3 / std::exp(c.RAT_VF / ratN);
        ratFltA = e((c.RAT_RF + 100e3 * k.filter) * c.RAT_CFLT);
        ratLevel = audioTaper(k.ratvol) * 6;
        ds.derive(k); ts.derive(k); b259.derive(k);
        drvT = (int) jmax(0, jmin(2, jsround(or0(k.drvtype) * 2)));
        fxSwap = or0(k.fxorder) >= 0.5;
        retMode = (int) jmax(0, jmin(2, jsround(or0(k.fxret) * 2)));
        lex.derive(c, k); plate.derive(k); spring.derive(k); conv.derive(k);
        const int t = revType(k);
        if (t != revT) { revT = t; if (t == 1) plate.reset(); else if (t == 2) spring.reset(); else if (t == 3) conv.reset(); }
    }

    // the unit on the reverb slot: run it and read its wet and L / R
    struct RevOut { double wet, L, R; };
    RevOut revRun(double x) {
        switch (revT) {
            case 1: plate.run(x); return { plate.wet, plate.L, plate.R };
            case 2: spring.run(x); return { spring.wet, spring.L, spring.R };
            case 3: conv.run(x); return { conv.wet, conv.L, conv.R };
            default: lex.run(x); return { lex.wet, lex.L, lex.R };
        }
    }

    double rat(double x) {
        const double x0 = rt.xp; rt.xp = x;
        double y = 0;
        for (int i = 1; i <= RAT_OS; i++) {
            double z = ratCore(x0 + (x - x0) * ((double) i / RAT_OS));
            z = biqRun(ratLP, 3, z);
            y = z;
        }
        rt.dco = ratDcA * (rt.dco + y - rt.dci); rt.dci = y;
        return rt.dco;
    }

    double ratCore(double x) {
        Rt& s = rt;
        s.hin = ratInA * (s.hin + x - s.xin); s.xin = x;
        const double u = s.hin;
        s.h1 = ratA1 * (s.h1 + u - s.x1); s.h2 = ratA2 * (s.h2 + u - s.x1); s.x1 = u;
        const double iv = (s.h1 / c.RAT_RG1 + s.h2 / c.RAT_RG2) * ratRd;
        s.fb = iv + ratFA * (s.fb - iv);
        const double target = u + s.fb;
        double dy = (target - s.y) * ratK;
        if (dy > ratSlew) dy = ratSlew; else if (dy < -ratSlew) dy = -ratSlew;
        s.y = jmax(-ratRail, jmin(ratRail, s.y + dy));
        s.hc = ratCA * (s.hc + s.y - s.xc); s.xc = s.y;
        const double w = s.hc, R = c.RAT_RCL, n = ratN, Is = ratIs;
        double lo = w < 0 ? w : 0, hi = w < 0 ? 0 : w;
        double vv = jmin(hi, jmax(lo, s.v));
        for (int i = 0; i < 40; i++) {
            const double t = jmin(jmax(vv / n, -80), 80), ee = std::exp(t), ei = 1 / ee;
            const double f = (w - vv) / R - Is * (ee - ei), df = -1 / R - Is * (ee + ei) / n;
            if (f > 0) lo = vv; else hi = vv;
            double nv = vv - f / df;
            if (!(nv > lo && nv < hi)) nv = 0.5 * (lo + hi);
            const double dv = nv - vv; vv = nv;
            if (dv < 1e-7 && dv > -1e-7) break;
        }
        s.v = vv;
        s.f = vv + ratFltA * (s.f - vv);
        return s.f * ratLevel;
    }

    void noteOn(int code, bool accent, bool sl) {
        code = code < 0 ? 0 : code > 63 ? 63 : code;
        cvTarget = dacVoltage(code, c.VREF, c.R_DAC, c.R2_DAC) + tuneCv[code % 12];
        const bool legato = gate && sl;
        slide = sl;
        if (!legato) {
            if (!slide) cv = cvTarget;
            accentNote = accent;
            envAttack = 1;
            vcaAttack = 1;
        }
        gate = true;
    }
    void noteOff() { gate = false; }

    void makeDecimator() {
        const double w = 2 * PI * 0.42 * fsOut / fs;
        decim[0] = lpW(w, 0.5412); decim[1] = lpW(w, 1.3066);
    }

    double vcfStep(double u, double Iladder) {
        const double h2 = h / 2, twoVt = 2 * VT, Ih = Iladder / 2, G0 = Iladder / (4 * VT);
        const double k = kFb;
        const double uEff = u + k * fbLp;
        const double v0 = v[0], v1 = v[1], v2 = v[2], v3 = v[3];
        const double b0 = uEff - k * v3, b1 = v0 - v1, b2 = v1 - v2, b3 = v2 - v3, b4 = v3;
        const double T0 = Ih * std::tanh(b0 / twoVt), T1 = Ih * std::tanh(b1 / twoVt), T2 = Ih * std::tanh(b2 / twoVt), T3 = Ih * std::tanh(b3 / twoVt), T4 = Ih * std::tanh(b4 / twoVt);
        const double G0_ = std::fabs(b0) > 1e-9 ? T0 / b0 : G0, G1 = std::fabs(b1) > 1e-9 ? T1 / b1 : G0, G2 = std::fabs(b2) > 1e-9 ? T2 / b2 : G0,
            G3 = std::fabs(b3) > 1e-9 ? T3 / b3 : G0, G4 = std::fabs(b4) > 1e-9 ? T4 / b4 : G0;
        const double C0 = C[0], C1 = C[1], C2 = C[2], C3 = C[3];
        double a00 = 1 + h2 * G1 / C0, a01 = -h2 * G1 / C0, a02 = 0, a03 = h2 * G0_ * k / C0;
        double a10 = -h2 * G1 / C1, a11 = 1 + h2 * (G1 + G2) / C1, a12 = -h2 * G2 / C1, a13 = 0;
        double a21 = -h2 * G2 / C2, a22 = 1 + h2 * (G2 + G3) / C2, a23 = -h2 * G3 / C2;
        double a32 = -h2 * G3 / C3, a33 = 1 + h2 * (G3 + G4) / C3;
        double r0 = v0 + h2 * (T0 - T1) / C0 + h2 * (G0_ / C0) * uEff, r1 = v1 + h2 * (T1 - T2) / C1, r2 = v2 + h2 * (T2 - T3) / C2, r3 = v3 + h2 * (T3 - T4) / C3;
        double m = a10 / a00;
        if (m != 0) { a11 -= m * a01; a12 -= m * a02; a13 -= m * a03; r1 -= m * r0; }
        m = a21 / a11;
        if (m != 0) { a22 -= m * a12; a23 -= m * a13; r2 -= m * r1; }
        m = a32 / a22;
        if (m != 0) { a33 -= m * a23; r3 -= m * r2; }
        const double n3 = r3 / a33;
        const double n2 = (r2 - a23 * n3) / a22;
        const double n1 = (r1 - a12 * n2 - a13 * n3) / a11;
        const double n0 = (r0 - a01 * n1 - a02 * n2 - a03 * n3) / a00;
        v[0] = n0; v[1] = n1; v[2] = n2; v[3] = n3;
        fbLp = n3 + fbA * (fbLp - n3);
        return n3;
    }

    double sqStep(double S, double g10, double g11) {
        Sq& q = sq; const double IS = c.IS_Q8, bf = 1 / c.BF_Q8, br = 1 / SQ_BR;
        const double g34 = 1 / c.R_SQS, gy = g10 * g34 / (g10 + g34), g35 = 1 / c.R_SQB, g45 = 1 / c.R_SQV, g36 = 1 / c.R_SQC;
        const double sy = S - q.vc, e0 = q.e;
        double B = q.b, E = q.e, Cc = q.col;
        for (int it = 0; it < 50; it++) {
            const double xe = std::exp(jmin((E - B) / VT, 40)), xc = std::exp(jmin((Cc - B) / VT, 40));
            const double Icc = IS * (xe - xc), Ibf = IS * bf * (xe - 1), Ibr = IS * br * (xc - 1);
            const double ge = IS * xe / VT, gc = IS * xc / VT;
            const double fB = gy * (sy - B) + g35 * (S - B) + Ibf + Ibr;
            const double fE = g45 * (c.V_SQ - E) - Icc - Ibf - g11 * (E - e0);
            const double fC = Icc - Ibr - g36 * (Cc - c.VREF);
            const double bE = ge * bf, bC = gc * br, eE = ge * (1 + bf), cC = gc * (1 + br);
            const double a00 = -gy - g35 - bE - bC, a01 = bE, a02 = bC;
            const double a10 = eE - gc, a11 = -g45 - g11 - eE, a12 = gc;
            const double a20 = cC - ge, a21 = ge, a22 = -cC - g36;
            const double r0 = -fB, r1 = -fE, r2 = -fC;
            const double det = a00 * (a11 * a22 - a12 * a21) - a01 * (a10 * a22 - a12 * a20) + a02 * (a10 * a21 - a11 * a20);
            double dB = (r0 * (a11 * a22 - a12 * a21) - a01 * (r1 * a22 - a12 * r2) + a02 * (r1 * a21 - a11 * r2)) / det;
            double dE = (a00 * (r1 * a22 - a12 * r2) - r0 * (a10 * a22 - a12 * a20) + a02 * (a10 * r2 - r1 * a20)) / det;
            double dC = (a00 * (a11 * r2 - r1 * a21) - a01 * (a10 * r2 - r1 * a20) + r0 * (a10 * a21 - a11 * a20)) / det;
            const double m = jmax(jmax(std::fabs(dB), std::fabs(dE)), std::fabs(dC));
            if (m > 0.2) { const double kk = 0.2 / m; dB *= kk; dE *= kk; dC *= kk; }
            B += dB; E += dE; Cc += dC;
            if (m < 1e-9) break;
        }
        q.vc = S - (B + gy * (sy - B) / g34);
        q.b = B; q.e = E; q.col = Cc;
        return Cc;
    }

    void sqSettle(double s1) {
        Sq& q = sq;
        q.e = c.V_SQ - 3; q.b = s1; q.vc = 0; q.col = c.VREF;
        const double f = iVcoRef * std::pow(2, cv - c.CV_TUNE + tuneOct) / (c.C33 * swing);
        const double hs = 1 / (20 * f), g10 = c.C10 / hs, g11 = c.C_SQE / hs; const int tail = 20;
        const int n = (int) jmax(std::ceil(0.08 * f), 3) * 20; const double dr = swing * f * hs;
        double r = s1 + std::fmod(n * dr, swing), sum = 0;
        if (r > c.V_HI) r -= swing;
        q.s = r;
        for (int i = 0; i < n; i++) {
            r -= dr; if (r <= c.V_LO) r += swing;
            const double vv = sqStep(r, g10, g11);
            if (i >= n - tail) sum += vv;
        }
        q.s = r; q.hp = 0; q.hpIn = sum / tail;
    }

    double noise() {
        double a = 0;
        for (int i = 0; i < 4; i++) { uint32_t x = rng; x ^= x << 13; x ^= x >> 17; x ^= x << 5; rng = x; a += (double) x / 4294967296.0; }
        return (a - 2) * 1.7320508;
    }

    double tick() {
        if (slide) cv = cvTarget + slideA * (cv - cvTarget);
        else cv = cvTarget;
        const double I = iVcoRef * std::pow(2, cv - c.CV_TUNE + tuneOct);
        const double dv = I / c.C33 * h;
        vSaw += dv;
        double corrNow = 0;
        if (vSaw >= c.V_HI) {
            vSaw -= swing;
            const double ph = jmin(jmax((vSaw - c.V_LO) / dv, 0), 1);
            sawDelay -= 0.5 * swing * ph * ph;
            corrNow = 0.5 * swing * (1 - ph) * (1 - ph);
        }
        const double saw = sawDelay;
        sawDelay = vSaw + corrNow;

        double wave;
        if (square) {
            const double s1 = c.V_LO + c.V_HI - saw; Sq& q = sq;
            if (!(q.e > 0)) sqSettle(s1);
            double acc = 0;
            for (int j = 1; j <= SQ_SUB; j++) acc += sqStep(q.s + (s1 - q.s) * j / SQ_SUB, sqG10, sqG11);
            q.s = s1;
            const double vout = acc / SQ_SUB;
            q.hp = sqInA * (q.hp + vout - q.hpIn); q.hpIn = vout;
            wave = q.hp;
        } else {
            sq.e = 0;
            wave = saw - (c.V_LO + c.V_HI) / 2;
        }

        if (envAttack > 0) {
            envVcf = c.V_ENV + envAtkA * (envVcf - c.V_ENV);
            if (envVcf > 0.99 * c.V_ENV) envAttack = 0;
        } else {
            envVcf *= accentNote ? envDecAccA : envDecA;
        }
        if (gate) {
            if (vcaAttack > 0) {
                envVca = 1 + (accentNote ? vcaAtkA : vcaSoftA) * (envVca - 1);
                if (envVca > 0.99) vcaAttack = 0;
            } else envVca *= vcaDecA;
        } else envVca *= vcaRelA;
        const double vAccIn = accentNote ? envVcf * accFrac : 0;
        const double drive = vAccIn - c.V_D - vAcc;
        if (drive > 0) vAcc += drive * accChgK;
        vAcc *= accDisA;
        if (c.WOW > 0 || vWowC > 1e-6) {
            const double vs = vAccIn - c.V_D; const bool on = vs > wowOff.b * vWowC; const Tap& t = on ? wowOn : wowOff;
            vWow = t.a * vs + t.b * vWowC;
            const double tgt = on ? t.tgt * vs : 0;
            vWowC = tgt + t.k * (vWowC - tgt);
        }
        const double vAccF = c.WOW > 0 ? vAcc + c.WOW * (vWow - vAcc) : vAcc;

        const double vEnvMod = accentNote ? 0 : envVcf * envModFrac;
        double vb = wCut * vCutPot + wEnv * vEnvMod + wAcc * vAccF;
        if (wKt > 0) vb += wKt * (cv - c.V_KT);
        const double Il = jmin(c.I_REF * std::exp(vb / VT), 2e-3);

        double nV = 0, nO = 0, nX = 0;
        if (noiseOn) { nV = noise() * nVcf; nO = noise() * nOta; nX = noise() * nOut; }
        const double y = vcfStep(wave * inAtt + nV, Il);

        const double ya = q21Swing * std::tanh(y / (2 * VT));
        hp14 = hp14A * (hp14 + ya - hp14In); hp14In = ya;
        const double vo = hp14;
        hp49 = hp49A * (hp49 + vo - hp49In); hp49In = vo;
        const double vr = vo * knobs.resonance;
        hp76 = hp76A * (hp76 + vr - hp76In); hp76In = vr;
        const double vin = (hp49 / c.R88 + hp76 / c.R100) / vinDen + nO;
        const double Iabc = jmax(envVca * c.V_VCA - 0.6, 0) / c.R105 + jmax(vAcc - 0.6, 0) / (c.R25 + c.R26);
        const double iout = Iabc * std::tanh(vin / (2 * VT));
        const double vout = iout * c.R_OTA;
        hp38 = hp38A * (hp38 + vout - hp38In); hp38In = vout;
        double o = hp38 * vol * OUT_TRIM + nX * 4.0;
        auto drive_ = [&](double x) { return drvT == 1 ? ds.run(x) : drvT == 2 ? ts.run(x) : rat(x); };
        if (fxSwap) {
            if (fx.rat) o = drive_(o);
            if (fx.fold) o = b259.run(o);
        } else {
            if (fx.fold) o = b259.run(o);
            if (fx.rat) o = drive_(o);
        }
        return 0.95 * std::tanh(o / 0.95);
    }

    void fxOut(double y, float* out, float* outR, int n) {
        if (fx.flg) y = flg.run(y);
        const bool lexOn = fx.lex, dlyOn = fx.dly;
        double wl = 0, wr = 0;
        if (lexOn && dlyOn && retMode == 1) {
            dly.run(y); wl += dly.l; wr += dly.r;
            const RevOut r = revRun(y + 0.5 * (dly.l + dly.r)); wl += r.wet * r.L; wr += r.wet * r.R;
        } else if (lexOn && dlyOn && retMode == 2) {
            const RevOut r = revRun(y); const double rl = r.wet * r.L, rr = r.wet * r.R; wl += rl; wr += rr;
            dly.run(y + 0.5 * (rl + rr)); wl += dly.l; wr += dly.r;
        } else {
            if (lexOn) { const RevOut r = revRun(y); wl += r.wet * r.L; wr += r.wet * r.R; }
            if (dlyOn) { dly.run(y); wl += dly.l; wr += dly.r; }
        }
        const double g = cmp.run(y, wl, wr);
        out[n] = (float) (0.98 * std::tanh((y + cmp.l * g) / 0.98));
        if (outR) outR[n] = (float) (0.98 * std::tanh((y + cmp.r * g) / 0.98));
    }

    double decimate(double x) { return biqRun(decim, 2, x); }

    void process(float* out, int start, int end, float* outR) {
        const bool f = fx.lex || fx.dly || fx.flg;
        for (int n = start; n < end; n++) {
            double y = 0;
            for (int o = 0; o < os; o++) y = decimate(tick());
            if (f) fxOut(y, out, outR, n);
            else { out[n] = (float) y; if (outR) outR[n] = (float) y; }
        }
    }
};

// knob and part changes glide over ~15 ms (one-pole), ticked every 32 samples while anything is moving
struct ParamSlew {
    TB303Voice& v; double fs, tau;
    struct E { char kind; std::string name; double value; bool log; };
    std::vector<E> t;
    ParamSlew(TB303Voice& voice, double fs_, double tau_ = 0.015) : v(voice), fs(fs_), tau(tau_) { t.reserve(128); }
    static bool endsWith(const std::string& s, const char* suf) { const size_t n = std::strlen(suf); return s.size() >= n && s.compare(s.size() - n, n, suf) == 0; }
    static bool instant(const std::string& name) {
        return endsWith(name, "prog") || name == "revtype" || name == "drvtype" || name == "fxorder" || name == "fxret" || name == "flgmode" || name.rfind("LEX_", 0) == 0;
    }
    void erase(char kind, const std::string& name) { for (size_t i = 0; i < t.size(); i++) if (t[i].kind == kind && t[i].name == name) { t.erase(t.begin() + (long) i); return; } }
    void set(char kind, const std::string& name, double value) {
        if (instant(name) || !std::isfinite(value)) { erase(kind, name); kind == 'k' ? v.setKnob(name, value) : v.setComponent(name, value); return; }
        double* cur = kind == 'k' ? v.knobs.find(name) : v.c.find(name);
        if (!cur) return;
        const bool lg = kind == 'c' && value > 0 && *cur > 0;
        for (auto& e : t) if (e.kind == kind && e.name == name) { e.value = value; e.log = lg; return; }
        t.push_back({ kind, name, value, lg });
    }
    bool active() const { return !t.empty(); }
    void tick(int n) {
        if (t.empty()) return;
        const double a = 1 - std::exp(-n / (tau * fs));
        for (size_t i = 0; i < t.size();) {
            E& e = t[i];
            double* cur = e.kind == 'k' ? v.knobs.find(e.name) : v.c.find(e.name);
            double nx = e.log ? std::exp(std::log(*cur) + (std::log(e.value) - std::log(*cur)) * a) : *cur + (e.value - *cur) * a;
            bool done = false;
            if (std::fabs(nx - e.value) <= 1e-4 * jmax(1e-9, std::fabs(e.value)) || (!e.log && std::fabs(nx - e.value) < 1e-5)) { nx = e.value; done = true; }
            *cur = nx;
            if (done) t.erase(t.begin() + (long) i); else i++;
        }
        v.derive();
    }
};

// eases the output to zero and back around each retrigger, a few ms late (see DeClick in tb303-model.js)
struct DeClick {
    TB303Voice& v; double fs; int D; std::vector<float> bufL; int w = 0;
    long long t = 0; std::vector<long long> ev; bool offs, on; int F = 1;
    DeClick(TB303Voice& voice, double fs_, bool on_ = true, double fadeMs = 1.5, double lookMs = 3, bool offs_ = false)
        : v(voice), fs(fs_), D((int) jmax(1, jsround(lookMs * 1e-3 * fs_))), offs(offs_), on(on_) {
        bufL.assign(D, 0.f); ev.reserve(256); setFade(fadeMs);
    }
    void setFade(double ms) { F = (int) jmax(1, jmin(D, jsround(ms * 1e-3 * fs))); }
    void setOn(bool o) { if (o == on) return; on = o; std::fill(bufL.begin(), bufL.end(), 0.f); ev.clear(); }
    void mark() { if (on && ev.size() < 4096) ev.push_back(t); }
    // the voice's noteOn / noteOff, wrapped as DeClick wraps them in the web engine
    void noteOn(int code, bool accent, bool slide) { if (!(v.gate && slide)) mark(); v.noteOn(code, accent, slide); }
    void noteOff() { if (v.gate && offs) mark(); v.noteOff(); }
    void process(float* out, int start, int end, float* outR) {
        if (!on) { v.process(out, start, end, outR); t += end - start; return; }
        const bool lex = v.fx.lex, dly = v.fx.dly, flg = v.fx.flg, fx = lex || dly || flg;
        v.fx.lex = v.fx.dly = v.fx.flg = false; v.process(out, start, end, nullptr); v.fx.lex = lex; v.fx.dly = dly; v.fx.flg = flg;
        float* L = bufL.data();
        for (int n = start; n < end; n++, t++) {
            double y = L[w]; L[w] = out[n]; w = w + 1 == D ? 0 : w + 1;
            const long long tt = t - D;
            size_t drop = 0; while (drop < ev.size() && ev[drop] <= tt - F) drop++;
            if (drop) ev.erase(ev.begin(), ev.begin() + (long) drop);
            if (!ev.empty()) {
                double g = 1;
                for (size_t i = 0; i < ev.size(); i++) {
                    const double d = std::fabs((double) (tt - ev[i])); if (d < F) { const double s = 0.5 - 0.5 * std::cos(PI * d / F); if (s < g) g = s; }
                }
                y *= g;
            }
            if (fx) v.fxOut(y, out, outR, n);
            else { out[n] = (float) y; if (outR) outR[n] = (float) y; }
        }
    }
};

struct Step { int code = 21; bool accent = false, slide = false, gate = false; };

// the player: slew, de-click and the step sequencer that walks the pattern
struct TB303Engine {
    double fs; std::function<void(int)> onStep;
    TB303Voice v; ParamSlew slew; DeClick dc;
    bool playing = false; double bpm = 128; std::vector<Step> pattern; double shuffle = 0, gateLen = 0.5;
    int step = -1; long long ctr = 0, stepLen = 1, gateOffAt = -1;
    int transpose = 0; // semitones the pattern plays up (the root note from MIDI)
    bool seqOn = true; int held[32] = {}; int nHeld = 0; // with the sequencer off: the MIDI notes held down, the last one sounding

    explicit TB303Engine(double fs_, std::function<void(int)> cb = {})
        : fs(fs_), onStep(std::move(cb)), v(fs_), slew(v, fs_), dc(v, fs_) { pattern.reserve(64); }

    void knob(const std::string& name, double value) { slew.set('k', name, value); }
    void component(const std::string& name, double value) { slew.set('c', name, value); }
    void setWave(const std::string& w) { v.square = w == "square"; }
    void tune(const double* cents, int n) { v.setTune(cents, n); }
    void setFx(const std::string& name, bool on) { v.setFx(name, on); }
    void declick(bool on, double ms) { dc.setOn(on); dc.setFade(ms); }
    void setPattern(std::vector<Step>&& p) { pattern.swap(p); }
    void setBpm(double b) { bpm = b; v.bpm = b; v.dly.derive(v.knobs, b); }
    void groove(double sh, double g) { shuffle = sh; gateLen = g; }
    void setIR(const std::string& id, std::shared_ptr<IRData> d) { v.conv.setIR(id, std::move(d)); }
    void play(bool on) { playing = on; step = -1; ctr = 0; if (!on && seqOn) dc.noteOff(); }
    void setSeq(bool on) {
        if (on == seqOn) return;
        seqOn = on; nHeld = 0; step = -1; ctr = 0; gateOffAt = -1; dc.noteOff();
    }
    // Seq off: a mono MIDI synth, as TB303Engine._note in tb303-model.js. The newest held note sounds; a note pressed while
    // another is held slides to it, letting go falls back to the note still held; velocity 100 and up is an accent.
    static int noteCode(int n) { int c = n - 12; while (c < 0) c += 12; while (c > 63) c -= 12; return c; }
    void note(bool on, int n, int vel) {
        if (seqOn) return;
        int i = 0; while (i < nHeld && held[i] != n) i++;
        const bool found = i < nHeld;
        if (found) { for (int j = i; j < nHeld - 1; j++) held[j] = held[j + 1]; nHeld--; }
        if (on) {
            const bool legato = nHeld > 0;
            if (nHeld == 32) { for (int j = 0; j < 31; j++) held[j] = held[j + 1]; nHeld--; }
            held[nHeld++] = n; dc.noteOn(noteCode(n), vel >= 100, legato);
        }
        else if (found && i == nHeld && nHeld) dc.noteOn(noteCode(held[nHeld - 1]), false, true);
        else if (found && !nHeld) dc.noteOff();
    }

    long long startStep() {
        const int n = (int) pattern.size(); if (!n) return 0;
        step = (step + 1) % n;
        const Step& s = pattern[step]; const Step& prev = pattern[(step - 1 + n) % n];
        const long long len = (long long) jsround(fs * 60 / bpm / 4 * (1 + (step & 1 ? -shuffle : shuffle)));
        if (s.gate) {
            dc.noteOn(s.code + transpose, s.accent, prev.gate && prev.slide);
            gateOffAt = s.slide ? -1 : (long long) jmax(1, jsround(len * gateLen));
        } else { dc.noteOff(); gateOffAt = -1; }
        if (onStep) onStep(step);
        return len;
    }

    void render(float* out, float* outR, int s, int e) {
        int i = s; const bool seq = playing && seqOn;
        while (i < e) {
            if (seq && ctr <= 0) { const long long l = startStep(); stepLen = l ? l : 1; ctr = stepLen; }
            int run = e - i;
            if (slew.active()) { run = run < 32 ? run : 32; slew.tick(run); }
            if (seq) {
                if (ctr < run) run = (int) ctr;
                const long long elapsed = stepLen - ctr;
                if (gateOffAt > elapsed) { if (gateOffAt - elapsed < run) run = (int) (gateOffAt - elapsed); }
                else if (gateOffAt == elapsed) { dc.noteOff(); gateOffAt = -1; }
            }
            dc.process(out, i, i + run, outR);
            i += run; if (seq) ctr -= run;
        }
    }
};

} // namespace tb303
