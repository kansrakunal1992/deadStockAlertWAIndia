#!/bin/bash
echo "=== FFmpeg Installation Check ==="

# Check system type
if [[ "$(uname -m)" == "x86_64" ]]; then
    echo "System: x86_64"
    FFMPEG_PACKAGES="ffmpeg libavcodec-extra libavformat-dev libswscale-dev"
elif [[ "$(uname -m)" == "aarch64" ]]; then
    echo "System: ARM64"
    FFMPEG_PACKAGES="ffmpeg"
else
    echo "Unsupported architecture"
    exit 1
fi

# Install FFmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "→ Installing FFmpeg..."
    apt-get update -y && apt-get install -y $FFMPEG_PACKAGES
    if ! command -v ffmpeg &> /dev/null; then
        echo "✗ FFmpeg installation failed!" >&2
        exit 1
    fi
fi

echo "✓ FFmpeg installed:"
ffmpeg -version | head -n 1

exit 0
