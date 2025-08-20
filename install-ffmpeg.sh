#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

# Print commands and their arguments as they are executed
set -x

# Function to log messages
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Function to handle errors
error_exit() {
    log "ERROR: $1"
    exit 1
}

# Check if script is run as root
if [[ $EUID -ne 0 ]]; then
   log "This script may need to be run as root for system-wide installation"
   log "Attempting to continue without root privileges..."
fi

log "=== FFmpeg Installation Check ==="

# Detect system architecture
ARCH=$(uname -m)
log "Detected architecture: $ARCH"

# Set packages based on architecture
case "$ARCH" in
    x86_64)
        log "System: x86_64"
        FFMPEG_PACKAGES="ffmpeg libavcodec-extra libavformat-dev libswscale-dev"
        ;;
    aarch64|arm64)
        log "System: ARM64"
        FFMPEG_PACKAGES="ffmpeg"
        ;;
    armv7l|armv6l)
        log "System: ARM (32-bit)"
        FFMPEG_PACKAGES="ffmpeg"
        ;;
    i386|i686)
        log "System: 32-bit Intel"
        FFMPEG_PACKAGES="ffmpeg libavcodec-extra libavformat-dev libswscale-dev"
        ;;
    *)
        log "Unsupported architecture: $ARCH"
        log "Attempting to install basic FFmpeg package..."
        FFMPEG_PACKAGES="ffmpeg"
        ;;
esac

# Function to install packages
install_packages() {
    local packages="$1"
    
    # Try different package managers
    if command -v apt-get &> /dev/null; then
        log "Using apt-get package manager"
        apt-get update -y || error_exit "Failed to update package lists"
        apt-get install -y $packages || error_exit "Failed to install packages: $packages"
    elif command -v yum &> /dev/null; then
        log "Using yum package manager"
        yum update -y || error_exit "Failed to update package lists"
        yum install -y $packages || error_exit "Failed to install packages: $packages"
    elif command -v dnf &> /dev/null; then
        log "Using dnf package manager"
        dnf update -y || error_exit "Failed to update package lists"
        dnf install -y $packages || error_exit "Failed to install packages: $packages"
    elif command -v apk &> /dev/null; then
        log "Using apk package manager"
        apk update || error_exit "Failed to update package lists"
        apk add $packages || error_exit "Failed to install packages: $packages"
    else
        error_exit "No supported package manager found (apt-get, yum, dnf, apk)"
    fi
}

# Check if FFmpeg is already installed
if command -v ffmpeg &> /dev/null; then
    log "FFmpeg is already installed:"
    ffmpeg -version | head -n 1
    
    # Check if required codecs are available
    log "Checking for required codecs..."
    ffmpeg -codecs 2>/dev/null | grep -E "(libopus|libvorbis|libmp3lame)" || log "Warning: Some required codecs may be missing"
    
    log "FFmpeg installation check completed successfully"
    exit 0
fi

log "FFmpeg not found, installing..."

# Install FFmpeg
log "Installing packages: $FFMPEG_PACKAGES"
install_packages "$FFMPEG_PACKAGES"

# Verify installation
if command -v ffmpeg &> /dev/null; then
    log "✓ FFmpeg installed successfully:"
    ffmpeg -version | head -n 1
    
    # Test FFmpeg functionality
    log "Testing FFmpeg functionality..."
    
    # Create a test directory
    TEST_DIR="/tmp/ffmpeg_test"
    mkdir -p "$TEST_DIR"
    
    # Create a silent test audio file
    ffmpeg -f lavfi -i "sine=frequency=1000:duration=1" -acodec pcm_s16le "$TEST_DIR/test.wav" -y 2>/dev/null || \
        error_exit "Failed to create test audio file"
    
    # Convert to FLAC
    ffmpeg -i "$TEST_DIR/test.wav" -acodec flac "$TEST_DIR/test.flac" -y 2>/dev/null || \
        error_exit "Failed to convert test audio to FLAC"
    
    # Check if conversion was successful
    if [ -f "$TEST_DIR/test.flac" ]; then
        log "✓ FLAC conversion test successful"
    else
        error_exit "FLAC conversion test failed"
    fi
    
    # Clean up test files
    rm -rf "$TEST_DIR"
    
    log "FFmpeg installation and functionality test completed successfully"
else
    error_exit "FFmpeg installation failed"
fi

log "=== FFmpeg Installation Completed ==="
exit 0
