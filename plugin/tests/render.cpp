// Renders a scenario with the C++ engine, the same way tests/render.js does with the JS engine, and writes raw float32
// stereo. The scenario comes as the line format plugin/tests/parity.js writes (one command per line).
//   render <scenario.txt> <out.f32>
#include "../engine/voice.h"
#include <cstdio>
#include <fstream>
#include <sstream>
#include <iostream>

int main(int argc, char** argv) {
    if (argc < 3) { std::fprintf(stderr, "usage: render scenario.txt out.f32\n"); return 2; }
    std::ifstream in(argv[1]);
    double fs = 48000, seconds = 1; int block = 128; uint32_t seed = 0; double bpm = 128, sh = 0, gate = 0.5;
    std::vector<tb303::Step> pat;
    struct Ev { long long at; std::string kind, name; std::vector<double> vals; std::string str; };
    std::vector<Ev> evs;
    std::string line;
    while (std::getline(in, line)) {
        std::istringstream ss(line); std::string cmd; ss >> cmd;
        if (cmd == "fs") ss >> fs; else if (cmd == "seconds") ss >> seconds; else if (cmd == "block") ss >> block;
        else if (cmd == "seed") { long long s; ss >> s; seed = (uint32_t) s; }
        else if (cmd == "bpm") ss >> bpm; else if (cmd == "groove") ss >> sh >> gate;
        else if (cmd == "step") { tb303::Step s; int a, sl, g; ss >> s.code >> a >> sl >> g; s.accent = a; s.slide = sl; s.gate = g; pat.push_back(s); }
        else if (cmd == "ev") { Ev e; ss >> e.at >> e.kind; if (e.kind == "wave") ss >> e.str; else { if (e.kind != "tune" && e.kind != "seq" && e.kind != "note") ss >> e.name; double x; while (ss >> x) e.vals.push_back(x); } evs.push_back(e); }
    }
    tb303::TB303Engine e(fs);
    e.v.rng = seed;
    e.setBpm(bpm); e.groove(sh, gate); { auto p = pat; e.setPattern(std::move(p)); }
    const long long N = (long long) std::llround(fs * seconds);
    std::vector<float> L(N), R(N);
    size_t k = 0; bool started = false;
    for (long long i = 0; i < N; i += block) {
        while (k < evs.size() && evs[k].at <= i) {
            const Ev& x = evs[k++];
            if (x.kind == "knob") e.knob(x.name, x.vals[0]);
            else if (x.kind == "part") e.component(x.name, x.vals[0]);
            else if (x.kind == "fx") e.setFx(x.name, x.vals[0] != 0);
            else if (x.kind == "tune") e.tune(x.vals.data(), (int) x.vals.size());
            else if (x.kind == "wave") e.setWave(x.str);
            else if (x.kind == "seq") e.setSeq(x.vals[0] != 0);
            else if (x.kind == "note") e.note(x.vals[1] > 0, (int) x.vals[0], (int) x.vals[1]);
        }
        if (!started) { e.play(true); started = true; }
        const int n = (int) std::min<long long>(block, N - i);
        e.render(L.data() + i, R.data() + i, 0, n);
    }
    std::vector<float> out(2 * N); for (long long i = 0; i < N; i++) { out[2 * i] = L[i]; out[2 * i + 1] = R[i]; }
    std::FILE* f = std::fopen(argv[2], "wb"); std::fwrite(out.data(), 4, out.size(), f); std::fclose(f);
    return 0;
}
