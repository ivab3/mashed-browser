#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd -- "$script_dir/../.." && pwd)"

crossover_app="${CROSSOVER_APP:-/Applications/CrossOver.app}"
bottle_name="${MASHED_BOTTLE:-Mashed-Fully-Loaded}"
bottle_dir="${MASHED_BOTTLE_DIR:-$HOME/Library/Application Support/CrossOver/Bottles/$bottle_name}"
game_dir="${MASHED_GAME_DIR:-$bottle_dir/drive_c/Games/Mashed Fully Loaded/App_Executables}"
desktop_size="${MASHED_DESKTOP_SIZE:-1280x720}"
video_select="${MASHED_VIDEO_SELECT:-0}"
log_path="${MASHED_CX_LOG:-$repo_root/reference/captures/crossover-launch.log}"
wine_bin="$crossover_app/Contents/SharedSupport/CrossOver/bin/wine"
lav_video="$bottle_dir/drive_c/Program Files (x86)/LAV Filters/x86/LAVVideo.ax"

usage() {
  printf '%s\n' \
    'Usage: run-crossover.sh [--configure-video]' \
    '' \
    '  --configure-video  show the game video-mode selector before launch'
}

case "${1:-}" in
  --configure-video)
    video_select=1
    shift
    ;;
  --help|-h)
    usage
    exit 0
    ;;
esac

if (($#)); then
  printf 'Unknown argument: %s\n' "$1" >&2
  usage >&2
  exit 2
fi

case "$video_select" in
  0|1) ;;
  *)
    printf 'MASHED_VIDEO_SELECT must be 0 or 1, got: %s\n' "$video_select" >&2
    exit 2
    ;;
esac

if [[ ! -x "$wine_bin" ]]; then
  printf 'CrossOver wine launcher not found: %s\n' "$wine_bin" >&2
  exit 1
fi

if [[ ! -f "$game_dir/MFL.exe" ]]; then
  printf 'MFL.exe not found: %s\n' "$game_dir/MFL.exe" >&2
  exit 1
fi

if [[ ! -f "$lav_video" ]]; then
  printf '%s\n' 'Warning: x86 LAV Filters not found; original MPEG-1 intros may block startup in CrossOver.' >&2
fi

mkdir -p "$(dirname -- "$log_path")"

LC_ALL=C LANG=C "$wine_bin" \
  --bottle "$bottle_name" \
  --workdir "$game_dir" \
  --no-wait \
  --cx-log "$log_path" \
  explorer.exe "/desktop=Mashed,$desktop_size" \
  "$game_dir/MFL.exe" \
  "-VS$video_select" -CS0 -L0
