// The voice's front-panel knobs (0..1) and parts table, by name, with the web app's defaults (tables.h).
#pragma once
#include "tables.h"
#include <string>
#include <cstring>

namespace tb303 {

struct Knobs {
#define TB_K_FIELD(n, v) double n = v;
    TB_KNOBS(TB_K_FIELD)
#undef TB_K_FIELD
    double* find(const std::string& name) {
#define TB_K_FIND(n, v) if (name == #n) return &n;
        TB_KNOBS(TB_K_FIND)
#undef TB_K_FIND
        return nullptr;
    }
};

struct Parts {
#define TB_C_FIELD(n, v) double n = v;
    TB_COMPONENTS(TB_C_FIELD)
#undef TB_C_FIELD
    double* find(const std::string& name) {
#define TB_C_FIND(n, v) if (name == #n) return &n;
        TB_COMPONENTS(TB_C_FIND)
#undef TB_C_FIND
        return nullptr;
    }
};

} // namespace tb303
