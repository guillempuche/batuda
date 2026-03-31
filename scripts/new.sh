#!/bin/sh
# Exit immediately if a command exits with a non-zero status.
set -e

# --- 1. VALIDATE INPUT ---
# Check if a package directory name (e.g., "motion-studio") was provided.
if [ -z "$1" ]; then
  echo "❌ Error: You must provide a package name as an argument."
  echo "Usage: ./scripts/new.sh <package-name>"
  exit 1
fi

PACKAGE_SUBDIR="$1"
PACKAGE_PATH="../$PACKAGE_SUBDIR"
# Get the actual monorepo root (script is in scripts/, so go up one level)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Check if the package directory actually exists.
if [ ! -d "$PACKAGE_PATH" ]; then
  echo "❌ Error: Package directory not found at '$PACKAGE_PATH'"
  exit 1
fi

echo "🚀 Starting private publish process for '${PACKAGE_SUBDIR}'..."

# --- 2. GET PACKAGE DETAILS ---
# Read details from the target package's package.json.
# Note: We use node's -p flag to execute a script and print the result.
PACKAGE_NAME=$(node -p "require('./${PACKAGE_PATH}/package.json').name")
PACKAGE_VERSION=$(node -p "require('./${PACKAGE_PATH}/package.json').version")
TARBALL_NAME="${PACKAGE_NAME}-${PACKAGE_VERSION}.tgz"
BUCKET_NAME="motion-plus-registry" # Change this to your R2 bucket name

echo "📦 Preparing to publish ${TARBALL_NAME}..."

# --- 3. CREATE THE TARBALL ---
# We run 'npm pack' from within the package directory to ensure files are included correctly.
# Then move the resulting .tgz file to the monorepo root directory.
cd "$PACKAGE_PATH"
npm pack
# Check if the tarball already exists in the monorepo root
if [ -f "$MONOREPO_ROOT/${TARBALL_NAME}" ]; then
  echo "❌ Error: Tarball already exists at '$MONOREPO_ROOT/${TARBALL_NAME}'"
  exit 1
fi
mv "${TARBALL_NAME}" "$MONOREPO_ROOT/"
cd "$MONOREPO_ROOT"

# --- 4. UPLOAD TO R2 ---
echo "☁️ Uploading to Cloudflare R2 bucket: ${BUCKET_NAME}..."
# Upload the tarball that was just created in the root.
npx wrangler r2 object put "${BUCKET_NAME}/${TARBALL_NAME}" --file="${TARBALL_NAME}" --remote

# --- 5. CLEAN UP ---
# Removes the local tarball from the root directory after a successful upload.
rm "${TARBALL_NAME}"

# --- 6. PUSH GIT CHANGES (This is a repo-wide action) ---
# Pushes the commit and tags created by 'lerna version'.
echo "🔀 Git pushing commit and tags..."
git push && git push --tags

# --- 7. GENERATE CHANGELOG CSV ---
# Generate changelog.csv from CHANGELOG.md for website integration
echo "📊 Generating changelog CSV..."
node ./scripts/generate-changelog-csv.js

echo "✅ Successfully published ${TARBALL_NAME} from '${PACKAGE_PATH}'."