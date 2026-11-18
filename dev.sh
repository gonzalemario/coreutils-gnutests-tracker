#!/usr/bin/env bash
set -e

# Directory paths
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COREUTILS_DIR="${COREUTILS_DIR:-$HOME/rust/coreutils}"
IMAGE_NAME="localhost/coreutils-gnutests-tracker:latest"

echo "=== Coreutils GNU Test Tracker Container Dev ==="
echo "Project Directory:   ${PROJECT_DIR}"
echo "Coreutils Directory: ${COREUTILS_DIR}"

# Check if image exists; if not, build it
if ! podman image exists "${IMAGE_NAME}"; then
    echo "Image ${IMAGE_NAME} not found. Building..."
    podman build -t "${IMAGE_NAME}" "${PROJECT_DIR}"
fi

# Run container with interactive terminal, port forwarding, and directory mounts
# :Z flag ensures correct SELinux volume labels if SELinux is active
exec podman run -it --rm \
    --name coreutils-gnutests-tracker-dev \
    -p 8787:8787 \
    -p 5173:5173 \
    -v "${PROJECT_DIR}:/app:Z" \
    -v "${COREUTILS_DIR}:/coreutils:ro,Z" \
    -w /app \
    "${IMAGE_NAME}" "$@"
