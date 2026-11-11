# The 303 Circuit Model VST3: the web app's engine in C++ (engine/) with the web app's own page as its screen.
# Before configuring, make the page:  node build.js && node plugin/tools/make-page.js plugin/build/page [version]
#   cmake -S plugin -B plugin/build -DCMAKE_BUILD_TYPE=Release && cmake --build plugin/build --config Release
cmake_minimum_required(VERSION 3.22)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "")
project(TB303CircuitModel VERSION 1.0.0 LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)

set(TB_PAGE_DIR "${CMAKE_CURRENT_BINARY_DIR}/page" CACHE PATH "where make-page.js wrote index.html")
if(NOT EXISTS "${TB_PAGE_DIR}/index.html")
  message(FATAL_ERROR "No plug-in page at ${TB_PAGE_DIR}/index.html. Run: node build.js && node plugin/tools/make-page.js ${TB_PAGE_DIR}")
endif()

include(FetchContent)
FetchContent_Declare(juce GIT_REPOSITORY https://github.com/juce-framework/JUCE.git GIT_TAG 8.0.12 GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(juce)

# VST3 everywhere, plus an Audio Unit on the Mac (Logic and GarageBand only load AUs)
if(APPLE)
  set(TB_FORMATS VST3 AU)
else()
  set(TB_FORMATS VST3)
endif()

juce_add_plugin(TB303CircuitModel
  COMPANY_NAME "303 Circuit"
  BUNDLE_ID com.johnnyhawk02.tb303circuitmodel
  PLUGIN_MANUFACTURER_CODE Tb3c
  PLUGIN_CODE T3cm
  FORMATS ${TB_FORMATS}
  PRODUCT_NAME "303 Circuit Model"
  IS_SYNTH TRUE
  NEEDS_MIDI_INPUT TRUE
  NEEDS_MIDI_OUTPUT FALSE
  IS_MIDI_EFFECT FALSE
  NEEDS_WEB_BROWSER TRUE
  NEEDS_WEBVIEW2 TRUE
  AU_MAIN_TYPE kAudioUnitType_MusicDevice
  VST3_CATEGORIES Instrument Synth
  COPY_PLUGIN_AFTER_BUILD FALSE)

set(TB_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/..")
juce_add_binary_data(TB303Data SOURCES
  "${TB_PAGE_DIR}/index.html"
  "${TB_ROOT}/irs/irs.json"
  "${TB_ROOT}/irs/plate140.flac" "${TB_ROOT}/irs/plate140b.flac" "${TB_ROOT}/irs/drumroom.flac" "${TB_ROOT}/irs/silo.flac"
  "${TB_ROOT}/irs/garage.flac" "${TB_ROOT}/irs/musikverein.flac" "${TB_ROOT}/irs/star.flac"
  "${TB_ROOT}/fonts/VT323-Regular.ttf")
set_target_properties(TB303Data PROPERTIES POSITION_INDEPENDENT_CODE ON)

juce_generate_juce_header(TB303CircuitModel)
target_sources(TB303CircuitModel PRIVATE source/Processor.cpp)
if(APPLE)
  enable_language(OBJCXX)
  target_sources(TB303CircuitModel PRIVATE source/KeyMonitor.mm source/WindowState_mac.mm)
elseif(WIN32)
  target_sources(TB303CircuitModel PRIVATE source/WindowState_win.cpp)
endif()
target_compile_definitions(TB303CircuitModel PUBLIC
  JUCE_WEB_BROWSER=1 JUCE_USE_CURL=0 JUCE_VST3_CAN_REPLACE_VST2=0 JUCE_USE_FLAC=1
  JUCE_DISPLAY_SPLASH_SCREEN=0)
# the engine must do its arithmetic exactly as JavaScript does: no fused multiply-add, no fast-math
# (MSVC's /fp:precise does not contract a*b+c into an FMA unless /fp:contract is given)
if(MSVC)
  target_compile_options(TB303CircuitModel PRIVATE /fp:precise /utf-8)
  # the WebView2 loader is linked in, so the plug-in is one file and needs no WebView2Loader.dll beside it
  target_compile_definitions(TB303CircuitModel PUBLIC JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1)
else()
  target_compile_options(TB303CircuitModel PRIVATE -ffp-contract=off)
endif()
target_link_libraries(TB303CircuitModel
  PRIVATE TB303Data juce::juce_audio_utils juce::juce_audio_formats juce::juce_gui_extra
  PUBLIC juce::juce_recommended_config_flags juce::juce_recommended_lto_flags)
