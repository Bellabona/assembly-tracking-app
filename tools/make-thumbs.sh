#!/usr/bin/env bash
#
# make-thumbs.sh - build small local WebP thumbnails for the dish tiles.
#
# WHY: DISH_IMAGES points at full-resolution S3 PNGs (~1.5 MB each, ~35 MB for a
# full week of 24 dishes) that the page renders into ~80px tiles. Kitchen staff
# load this on phones. This script pre-builds tiny local thumbs so index.html can
# serve those instead, falling back to the S3 URL when a thumb is missing.
#
# THUMBS ARE KEYED BY THE S3 UUID, NOT BY DISH LETTER.
# The weekly scheduled task reassigns letters to different dishes. Keying by
# letter would make a stale thumb show the WRONG dish photo - silently incorrect.
# Keyed by UUID, a brand-new dish simply has no thumb yet and index.html falls
# back to the original S3 URL: slow, but always the right picture.
#
# Safe to re-run any time, and safe to re-run right after the weekly task swaps
# the dishes: existing thumbs are skipped, new UUIDs are fetched. Old thumbs for
# dishes that rotated out are left in place (they cost bytes in git, not on the
# wire) - delete thumbs/ and re-run if you want to prune them.
#
# It also rewrites the THUMB_UUIDS manifest line in index.html (between the
# /* THUMB_UUIDS-BEGIN */ and /* THUMB_UUIDS-END */ sentinels) so the page only
# requests a thumb it knows is committed. A stale manifest therefore fails in the
# safe direction: unknown uuid -> request S3 directly, no 404, no broken tile.
#
# Usage:  tools/make-thumbs.sh          # skip uuids that already have a good thumb
#         FORCE=1 tools/make-thumbs.sh  # re-download and re-encode everything
#
# If one tile looks wrong on the live site:
#         rm thumbs/<uuid>.webp && tools/make-thumbs.sh
#
set -uo pipefail

WIDTH=240      # target thumbnail width in px (tiles render at ~80px, 3x for retina)
QUALITY=72     # cwebp quality
FORCE="${FORCE:-0}"   # FORCE=1 re-builds thumbs that already exist

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INDEX_HTML="$REPO_ROOT/index.html"
THUMBS_DIR="$REPO_ROOT/thumbs"

die() { printf 'make-thumbs: ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf 'make-thumbs: %s\n' "$*"; }

# -- Hard preconditions: fail loudly, before touching anything ----------------
command -v sips  >/dev/null 2>&1 || die "sips not found. This script requires macOS (/usr/bin/sips)."
command -v cwebp >/dev/null 2>&1 || die "cwebp not found. Install it with: brew install webp"
command -v curl  >/dev/null 2>&1 || die "curl not found."
[ -f "$INDEX_HTML" ] || die "index.html not found at $INDEX_HTML"

mkdir -p "$THUMBS_DIR" || die "cannot create $THUMBS_DIR"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/make-thumbs.XXXXXXXX")" || die "mktemp -d failed"
cleanup() { [ -n "${WORK:-}" ] && rm -rf "$WORK"; }
trap cleanup EXIT INT TERM

# A nonzero file size is NOT proof of a usable thumb: an interrupted download or
# a half-written encode leaves bytes the browser cannot decode, and the old
# `[ -s "$out" ]` test would then skip it forever. Ask sips for the pixel width;
# a corrupt or truncated WebP reports "pixelWidth: <nil>" instead of a number.
thumb_is_valid() {
  local f="$1" w
  [ -s "$f" ] || return 1
  w="$(sips -g pixelWidth "$f" 2>/dev/null \
       | sed -nE 's/^[[:space:]]*pixelWidth:[[:space:]]*([0-9]+)$/\1/p')"
  [ -n "$w" ] || return 1
  [ "$w" -gt 0 ] 2>/dev/null || return 1
  return 0
}

# -- Parse the DISH_IMAGES block out of index.html ----------------------------
# No hardcoded URL list: index.html is the single source of truth, and the
# weekly task rewrites that block. We only READ it, never reshape it.
PAIRS="$WORK/pairs.txt"
awk '
  /const[ \t]+DISH_IMAGES[ \t]*=[ \t]*\{/ { inblock = 1; next }
  inblock && /^[ \t]*\}[ \t]*;/           { inblock = 0; exit }
  inblock                                 { print }
' "$INDEX_HTML" \
| sed -nE 's#^[[:space:]]*([A-Z])[[:space:]]*:[[:space:]]*"([^"]+)".*$#\1 \2#p' \
> "$PAIRS"

total=$(grep -c . "$PAIRS" 2>/dev/null || true)
[ "${total:-0}" -gt 0 ] || die "parsed 0 entries from the DISH_IMAGES block in $INDEX_HTML - did its shape change?"
log "parsed $total dish image URL(s) from index.html"

generated=0
skipped=0
failed=0
FAILURES="$WORK/failures.txt"
: > "$FAILURES"

while read -r letter url; do
  [ -n "$letter" ] || continue

  # UUID = the path segment right after /ProductImages/.
  # Keep this extraction logic in sync with thumbPathFor() in index.html.
  # Lowercased on both sides: GitHub Pages is case-sensitive, macOS is not, so an
  # uppercase-hex uuid would otherwise work locally and 404 in production.
  uuid="$(printf '%s' "$url" | sed -nE 's#^.*/ProductImages/([0-9a-fA-F-]+)/.*$#\1#p' | tr 'A-Z' 'a-z')"
  if [ -z "$uuid" ]; then
    log "  $letter: SKIP - could not extract a uuid from $url"
    printf '%s: no uuid in URL (%s)\n' "$letter" "$url" >> "$FAILURES"
    failed=$((failed + 1))
    continue
  fi

  out="$THUMBS_DIR/$uuid.webp"
  if [ "$FORCE" != "1" ] && thumb_is_valid "$out"; then
    log "  $letter: skip (thumbs/$uuid.webp exists and decodes)"
    skipped=$((skipped + 1))
    continue
  fi
  if [ -e "$out" ] && ! thumb_is_valid "$out"; then
    log "  $letter: thumbs/$uuid.webp is present but does not decode - rebuilding"
    rm -f "$out"
  fi

  src="$WORK/$uuid.src"     # no extension on purpose: sips sniffs content, and
  mid="$WORK/$uuid.mid.png" # some S3 URLs end in a bare dot with no extension
  tmpout="$WORK/$uuid.webp"
  rm -f "$src" "$mid" "$tmpout"

  # A single 404 / dead URL must not abort the whole run.
  if ! curl -fsSL --retry 2 --retry-delay 1 --max-time 120 -o "$src" "$url" 2>"$WORK/curl.err"; then
    log "  $letter: FAILED download - $(tr -d '\n' < "$WORK/curl.err" | cut -c1-160)"
    printf '%s: download failed (%s)\n' "$letter" "$url" >> "$FAILURES"
    failed=$((failed + 1))
    continue
  fi
  if [ ! -s "$src" ]; then
    log "  $letter: FAILED - downloaded 0 bytes"
    printf '%s: empty download (%s)\n' "$letter" "$url" >> "$FAILURES"
    failed=$((failed + 1))
    continue
  fi

  if ! sips --resampleWidth "$WIDTH" -s format png "$src" --out "$mid" >/dev/null 2>"$WORK/sips.err"; then
    log "  $letter: FAILED resize - $(tr -d '\n' < "$WORK/sips.err" | cut -c1-160)"
    printf '%s: sips resize failed (%s)\n' "$letter" "$url" >> "$FAILURES"
    failed=$((failed + 1))
    continue
  fi

  if ! cwebp -quiet -q "$QUALITY" "$mid" -o "$tmpout" 2>"$WORK/cwebp.err"; then
    log "  $letter: FAILED webp encode - $(tr -d '\n' < "$WORK/cwebp.err" | cut -c1-160)"
    printf '%s: cwebp failed (%s)\n' "$letter" "$url" >> "$FAILURES"
    failed=$((failed + 1))
    continue
  fi

  # Move into place only once fully written, so an interrupted run never leaves
  # a truncated thumb that a later run would happily "skip".
  mv -f "$tmpout" "$out"
  bytes=$(wc -c < "$out" | tr -d ' ')
  srcbytes=$(wc -c < "$src" | tr -d ' ')
  log "  $letter: generated thumbs/$uuid.webp (${bytes} B, from ${srcbytes} B)"
  generated=$((generated + 1))

  rm -f "$src" "$mid"
done < "$PAIRS"

# -- Rewrite the THUMB_UUIDS manifest inside index.html -----------------------
# The manifest lists every uuid that has a committed, decodable thumb. index.html
# only requests thumbs/<uuid>.webp for a uuid in this list, so a stale manifest
# costs speed (straight to S3) instead of 24 404s and a broken-image flash.
#
# The replacement is confined to the lines between the two sentinels, which live
# in the safe zone between <script> and const SCRIPT_URL. It never touches the
# EMPLOYEES / DISH_NAMES / DISH_IMAGES blocks that the weekly task rewrites.
manifest_line="$(find "$THUMBS_DIR" -type f -name '*.webp' -exec basename {} .webp \; \
  | tr 'A-Z' 'a-z' | LC_ALL=C sort -u \
  | awk '{ printf "%s\"%s\":1", (NR > 1 ? "," : ""), $0 } END { printf "\n" }' \
  | sed 's/^/const THUMB_UUIDS = {/; s/$/};/')"
manifest_count=$(find "$THUMBS_DIR" -type f -name '*.webp' | wc -l | tr -d ' ')

begin_count=$(grep -c 'THUMB_UUIDS-BEGIN' "$INDEX_HTML" || true)
end_count=$(grep -c 'THUMB_UUIDS-END' "$INDEX_HTML" || true)
manifest_written="no"
if [ "${begin_count:-0}" -ne 1 ] || [ "${end_count:-0}" -ne 1 ]; then
  log "WARNING: expected exactly one THUMB_UUIDS-BEGIN/END sentinel pair in index.html"
  log "         (found $begin_count / $end_count) - leaving the manifest alone."
  log "         The page still renders correctly: it falls back to the S3 URLs."
else
  awk -v newline="$manifest_line" '
    /THUMB_UUIDS-BEGIN/ { print; print newline; inblock = 1; next }
    /THUMB_UUIDS-END/   { inblock = 0; print; next }
    inblock             { next }
                        { print }
  ' "$INDEX_HTML" > "$WORK/index.new"

  # Refuse to install a rewrite that lost anything we care about.
  if [ ! -s "$WORK/index.new" ] \
     || [ "$(grep -c 'const EMPLOYEES = \[' "$WORK/index.new" || true)" -ne 1 ] \
     || [ "$(grep -c 'const DISH_NAMES' "$WORK/index.new" || true)" -ne 1 ] \
     || [ "$(grep -c 'const DISH_IMAGES' "$WORK/index.new" || true)" -ne 1 ] \
     || [ "$(grep -c 'const THUMB_UUIDS' "$WORK/index.new" || true)" -ne 1 ] \
     || [ "$(grep -c '</script>' "$WORK/index.new" || true)" -ne 1 ]; then
    log "WARNING: manifest rewrite failed its own sanity check - index.html left untouched."
  elif cmp -s "$WORK/index.new" "$INDEX_HTML"; then
    log "manifest already up to date ($manifest_count uuid(s))"
    manifest_written="unchanged"
  else
    mv -f "$WORK/index.new" "$INDEX_HTML"
    log "manifest rewritten in index.html"
    manifest_written="yes"
  fi
fi

# -- Summary ------------------------------------------------------------------
thumb_count=$(find "$THUMBS_DIR" -type f -name '*.webp' | wc -l | tr -d ' ')
thumb_bytes=$(find "$THUMBS_DIR" -type f -name '*.webp' -exec wc -c {} \; 2>/dev/null \
  | awk '{ s += $1 } END { print s + 0 }')

printf '\n'
log "------------ summary ------------"
log "generated : $generated"
log "skipped   : $skipped (already present)"
log "failed    : $failed"
log "thumbs/   : $thumb_count file(s), $thumb_bytes bytes total"
log "manifest  : $manifest_written ($manifest_count uuid(s) listed in index.html)"
if [ "$failed" -gt 0 ]; then
  log "failures:"
  while read -r line; do log "  - $line"; done < "$FAILURES"
fi

# -- Commit reminder ----------------------------------------------------------
# A generated thumb that never gets committed 404s for every visitor while
# looking perfect on this machine. There is deliberately no .gitignore in this
# repo; do not add one, and never exclude thumbs/. Commit thumbs/ AND index.html
# in the SAME commit, so a deployed index.html never lists an undeployed thumb.
if command -v git >/dev/null 2>&1 && git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  pending="$(git -C "$REPO_ROOT" status --short -- thumbs/ index.html)"
  printf '\n'
  if [ -n "$pending" ]; then
    log "uncommitted changes:"
    printf '%s\n' "$pending" | while read -r line; do log "  $line"; done
    changes=$(printf '%s\n' "$pending" | grep -c . || true)
    log "$changes path(s) to commit -- run: git add thumbs/ index.html && git commit && git push"
  else
    log "nothing to commit: thumbs/ and index.html match HEAD"
  fi
fi

# Individual image failures are reported but do not fail the run - index.html
# falls back to the S3 URL for any dish without a thumb.
exit 0
