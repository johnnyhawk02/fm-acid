#!/usr/bin/env bash
# Installs (or updates) the 303 Circuit Model plug-in from the latest GitHub release, on macOS or Linux:
#   curl -fsSL https://github.com/johnnyhawk02/tb303-circuit-model/releases/latest/download/install.sh | bash
# Remove it again:
#   curl -fsSL https://github.com/johnnyhawk02/tb303-circuit-model/releases/latest/download/install.sh | bash -s -- --uninstall
# macOS: VST3 to ~/Library/Audio/Plug-Ins/VST3 and AU to ~/Library/Audio/Plug-Ins/Components. The plug-in is signed ad hoc,
# not notarised; a file fetched with curl is not quarantined, so macOS opens it without the "damaged" warning.
# Linux: VST3 to ~/.vst3. Its screen needs WebKitGTK 4.1 (libwebkit2gtk-4.1).
set -euo pipefail
BASE="${TB303_BASE:-https://github.com/johnnyhawk02/tb303-circuit-model/releases/latest/download}"
NAME="303 Circuit Model"
case "$(uname -s)" in
  Darwin) ZIP="303-Circuit-Model-mac.zip"; VST3="$HOME/Library/Audio/Plug-Ins/VST3"; AU="$HOME/Library/Audio/Plug-Ins/Components"
          DOCS="$HOME/Library/Application Support/$NAME" ;;
  Linux)  ZIP="303-Circuit-Model-linux.zip"; VST3="$HOME/.vst3"; AU=""; DOCS="$HOME/.config/$NAME" ;;
  *) echo "This script is for macOS and Linux. On Windows, in PowerShell run:"
     echo "  irm https://github.com/johnnyhawk02/tb303-circuit-model/releases/latest/download/install.ps1 | iex"; exit 1 ;;
esac

if [ "${1:-}" = "--uninstall" ]; then
  rm -rf "$VST3/$NAME.vst3"; [ -n "$AU" ] && rm -rf "$AU/$NAME.component"
  echo "Removed $NAME. Your presets stay in $DOCS (delete that folder too to remove them)."; exit 0
fi

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
echo "Downloading $NAME..."
curl -fL --progress-bar "$BASE/$ZIP" -o "$TMP/plugin.zip"
mkdir "$TMP/x"
if command -v unzip >/dev/null; then unzip -q "$TMP/plugin.zip" -d "$TMP/x"
elif command -v bsdtar >/dev/null; then bsdtar -xf "$TMP/plugin.zip" -C "$TMP/x"
else python3 -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$TMP/plugin.zip" "$TMP/x"
     chmod -R u+rwX "$TMP/x"; fi

mkdir -p "$VST3" "$DOCS"
rm -rf "$VST3/$NAME.vst3"; cp -R "$TMP/x/$NAME.vst3" "$VST3/"
echo "Installed VST3: $VST3/$NAME.vst3"
if [ -n "$AU" ]; then
  mkdir -p "$AU"; rm -rf "$AU/$NAME.component"; cp -R "$TMP/x/$NAME.component" "$AU/"
  xattr -dr com.apple.quarantine "$VST3/$NAME.vst3" "$AU/$NAME.component" 2>/dev/null || true
  # so Logic and GarageBand see the new AU without a restart of the Mac
  killall -9 AudioComponentRegistrar 2>/dev/null || true
  echo "Installed AU:   $AU/$NAME.component"
fi
for f in LICENSE CREDITS.md OFL.txt; do [ -f "$TMP/x/$f" ] && cp "$TMP/x/$f" "$DOCS/"; done

if [ "$(uname -s)" = Linux ] && ! (ldconfig -p 2>/dev/null | grep -q 'libwebkit2gtk-4.1'); then
  echo
  echo "Note: the plug-in's screen needs WebKitGTK 4.1, which was not found. Install it, e.g."
  echo "  Debian/Ubuntu: sudo apt install libwebkit2gtk-4.1-0    Fedora: sudo dnf install webkit2gtk4.1"
  echo "  Arch: sudo pacman -S webkit2gtk-4.1"
fi
echo
echo "Done. Rescan plug-ins in your DAW (it is under \"$NAME\", maker \"303 Circuit\")."
