#!/bin/sh
# release.sh — cut a release of the colab-handbook ITSELF, then reconcile the fleet.
#
# The handbook deliberately ships NO .github/workflows/release-tag.yml of its own
# (release-tag.yml is a TEMPLATE it hands to other repos, not something it runs on itself).
# THIS SCRIPT IS THE HANDBOOK'S RELEASE PATH: it tags, pushes the tag, publishes a GitHub
# Release whose body is built by `colab release-notes`, and then — the whole point — runs the
# fleet audit as a reconciliation report so a release is also the moment the fleet is checked.
#
# Usage:
#   sh scripts/release.sh vX.Y.Z ["optional headline sentence"]
#   sh scripts/release.sh vX.Y.Z --dry        # run every guard + print the plan, change nothing
#
# The release SUCCEEDS even when the fleet audit reports findings: findings are the deliverable
# of the reconciliation step, not a failure of the release. Exit is 0 when the release steps
# themselves succeeded.
#
# No `set -e`: the audit intentionally exits non-zero when it has findings, and we must not let
# that abort the run. Every real step is checked explicitly via die().

set -u

# Resolve the handbook root from THIS script's location, not the caller's cwd.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

die() { echo "release.sh: $1" >&2; exit 1; }

# ---- parse args: a version, an optional headline, and --dry (order-independent) ------------
DRY=0
VER=""
HEADLINE=""
HEADLINE_SET=0
for a in "$@"; do
  case "$a" in
    --dry) DRY=1 ;;
    -*)    die "unknown flag: $a (usage: sh scripts/release.sh vX.Y.Z [\"headline\"] [--dry])" ;;
    *)
      if [ -z "$VER" ]; then VER="$a"
      elif [ "$HEADLINE_SET" -eq 0 ]; then HEADLINE="$a"; HEADLINE_SET=1
      else die "too many arguments (got extra: $a)"
      fi
      ;;
  esac
done

# ---- guards, in order, each with a clear error --------------------------------------------

[ -n "$VER" ] || die "no version given (usage: sh scripts/release.sh vX.Y.Z [\"headline\"] [--dry])"

echo "$VER" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' \
  || die "version must look like vX.Y.Z (got: $VER)"

# If the tag exists WITHOUT a published Release, a prior run died between the tag push and
# `gh release create` (it happened: a transient API failure orphaned v1.1.0). That state is
# resumable — refusing it with "pick a new version" would force a bogus version bump.
RESUME=0
if git -C "$ROOT" rev-parse -q --verify "refs/tags/$VER" >/dev/null 2>&1; then
  if ( cd "$ROOT" && gh release view "$VER" >/dev/null 2>&1 ); then
    die "tag $VER already exists AND its Release is published — pick a new version"
  fi
  echo "tag $VER exists but has no Release — resuming from the publish step."
  RESUME=1
fi

if [ "$RESUME" -eq 0 ]; then
  # Tagging-safety guards — only meaningful when we are about to create the tag.
  if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]; then
    die "working tree has uncommitted tracked changes — commit or stash before releasing"
  fi

  BRANCH="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
  [ "$BRANCH" = "main" ] || die "releases are cut from main, but HEAD is on '$BRANCH'"

  git -C "$ROOT" fetch origin main >/dev/null 2>&1 \
    || die "git fetch origin main failed — check the remote and your network/credentials"

  LOCAL_SHA="$(git -C "$ROOT" rev-parse main 2>/dev/null || echo local)"
  REMOTE_SHA="$(git -C "$ROOT" rev-parse origin/main 2>/dev/null || echo remote)"
  [ "$LOCAL_SHA" = "$REMOTE_SHA" ] \
    || die "local main ($LOCAL_SHA) and origin/main ($REMOTE_SHA) differ — push or pull to sync first"
fi

# ---- compute the notes range (previous tag .. this version) --------------------------------
if [ "$RESUME" -eq 1 ]; then
  # HEAD may have moved past the tag since the failed run — derive PREV from the tag's own
  # ancestry, not from HEAD, so the notes cover exactly what the tag covers.
  PREV="$(git -C "$ROOT" describe --tags --abbrev=0 "$VER^" 2>/dev/null || true)"
else
  # describe finds the most recent tag reachable from HEAD; empty on the very first release.
  PREV="$(git -C "$ROOT" describe --tags --abbrev=0 2>/dev/null || true)"
fi
if [ -n "$PREV" ]; then
  RANGE="$PREV..$VER"
else
  RANGE="$VER"   # first release: whole history up to the new tag
fi

# ---- print the plan (shown in both dry and real runs) --------------------------------------
echo "Release plan — colab-handbook:"
echo "  version:    $VER"
echo "  prev tag:   ${PREV:-<none> (first release)}"
echo "  notes range: $RANGE"
[ "$HEADLINE_SET" -eq 1 ] && echo "  headline:   $HEADLINE"
if [ "$RESUME" -eq 1 ]; then
  echo "  steps:      (resume) gh release create $VER -> node audit/audit.mjs (reconcile)"
else
  echo "  steps:      git tag $VER -> git push origin $VER -> gh release create $VER -> node audit/audit.mjs (reconcile)"
fi

if [ "$DRY" -eq 1 ]; then
  echo ""
  echo "[--dry] all guards passed. No tag created, nothing pushed, no release, audit not run."
  exit 0
fi

# ---- real release steps --------------------------------------------------------------------

if [ "$RESUME" -eq 0 ]; then
  git -C "$ROOT" tag "$VER"            || die "git tag $VER failed"
  git -C "$ROOT" push origin "$VER"    || die "git push origin $VER failed (tag was created locally — delete it with: git tag -d $VER)"
else
  # Idempotent: make sure the remote has the tag (no-op when it already does).
  git -C "$ROOT" push origin "$VER" >/dev/null 2>&1 || true
fi

# Build the grouped notes with `colab release-notes` and publish via gh. We materialize the
# notes to a temp file rather than piping straight into gh so a release-notes failure is caught
# here instead of being masked by the pipe's exit status. `node tools/colab` (not the exec bit)
# so this works even on a checkout where the +x bit was lost.
NOTES_FILE="$(mktemp "${TMPDIR:-/tmp}/colab-notes.XXXXXX")" || die "mktemp failed"
if [ "$HEADLINE_SET" -eq 1 ]; then
  node "$ROOT/tools/colab" release-notes "$RANGE" --repo "$ROOT" --headline "$HEADLINE" > "$NOTES_FILE" \
    || die "colab release-notes failed"
else
  node "$ROOT/tools/colab" release-notes "$RANGE" --repo "$ROOT" > "$NOTES_FILE" \
    || die "colab release-notes failed"
fi

( cd "$ROOT" && gh release create "$VER" --title "$VER" --notes-file "$NOTES_FILE" --generate-notes ) \
  || die "gh release create $VER failed (the tag is pushed; re-run just the release step once fixed)"
rm -f "$NOTES_FILE"

echo ""
echo "Released colab-handbook $VER."

# ---- fleet reconciliation — the point of doing this here -----------------------------------
# Default registry resolution (~/.colab/repos.txt). Findings are advisory: the release above
# already succeeded, so we report and still exit 0.
echo ""
echo "── Reconciliation @ $VER ──"
node "$ROOT/audit/audit.mjs"
AUDIT_STATUS=$?
echo ""
case "$AUDIT_STATUS" in
  0) echo "Reconciliation: fleet clean — no findings against $VER." ;;
  1) echo "Reconciliation: fleet has findings (see above) — advisory only; $VER released successfully." ;;
  *) echo "Reconciliation: audit could not run cleanly (exit $AUDIT_STATUS) — advisory only; $VER released successfully." ;;
esac

exit 0
