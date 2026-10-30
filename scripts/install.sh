#!/bin/sh
set -eu

REPO="ImFelipeOliveira/standwise"
BASE="https://github.com/${REPO}/releases/latest/download"
BIN_DIR="${HOME}/.local/bin"
TARGET="${BIN_DIR}/standwise"

fail() {
  echo "standwise install: $1" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) fail "unsupported operating system: $(uname -s). Download a binary from https://github.com/${REPO}/releases/latest" ;;
esac

case "$(uname -m)" in
  arm64 | aarch64) arch="arm64" ;;
  x86_64 | amd64) arch="x64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

asset="standwise-bun-${os}-${arch}"

if command -v curl >/dev/null 2>&1; then
  download() { curl --proto '=https' --tlsv1.2 -fsSL -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  download() { wget -q -O "$2" "$1"; }
else
  fail "curl or wget is required"
fi

if command -v sha256sum >/dev/null 2>&1; then
  hash_of() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then
  hash_of() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else
  fail "sha256sum or shasum is required"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
trap 'exit 1' INT TERM

echo "Downloading ${asset}"
download "${BASE}/${asset}" "${tmp}/${asset}" || fail "could not download ${asset}"
download "${BASE}/SHA256SUMS" "${tmp}/SHA256SUMS" || fail "could not download SHA256SUMS"

expected="$(awk -v name="$asset" '$2 == name { print $1 }' "${tmp}/SHA256SUMS")"
[ -n "$expected" ] || fail "${asset} is not listed in SHA256SUMS"
actual="$(hash_of "${tmp}/${asset}")"
[ "$expected" = "$actual" ] || fail "checksum mismatch for ${asset}: expected ${expected}, got ${actual}"

mkdir -p "$BIN_DIR"
cp "${tmp}/${asset}" "${TARGET}.new"
chmod +x "${TARGET}.new"
mv -f "${TARGET}.new" "$TARGET"

echo "Installed ${TARGET}"

case ":${PATH}:" in
  *":${BIN_DIR}:"*) ;;
  *)
    echo
    echo "${BIN_DIR} is not on your PATH. Add it with:"
    echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    echo "Put that line in ~/.zshrc, ~/.bashrc or ~/.profile to keep it."
    ;;
esac

echo
echo "Next: run 'standwise login'"
