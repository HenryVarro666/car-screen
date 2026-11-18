#!/bin/sh
# Link this repo into the skill folders of Claude Code and Codex.
# Usage: ./install.sh            link into every skills folder that exists
#        ./install.sh --remove   remove the links
set -eu

name="car-screen"
here="$(cd "$(dirname "$0")" && pwd)"

for root in "$HOME/.claude/skills" "$HOME/.codex/skills"; do
  [ -d "$root" ] || continue
  target="$root/$name"
  if [ "${1:-}" = "--remove" ]; then
    if [ -L "$target" ]; then rm "$target"; echo "removed $target"; fi
    continue
  fi
  if [ -L "$target" ]; then
    rm "$target"
  elif [ -e "$target" ]; then
    echo "skipped $target: it exists and is not a link" >&2
    continue
  fi
  ln -s "$here" "$target"
  echo "linked $target -> $here"
done
