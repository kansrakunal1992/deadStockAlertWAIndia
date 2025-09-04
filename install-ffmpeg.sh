#!/bin/bash
# Exit immediately if a command exits with a non-zero status
set -e

# Print commands and their arguments as they are executed
set -x

# Enable error handling
set -o pipefail

# Script metadata
SCRIPT_NAME="install-ffmpeg.sh"
SCRIPT_VERSION="1.1.0"
LOG_FILE="/tmp/ffmpeg-install.log"

# Logging function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Error handling function
error_exit() {
    log "ERROR: $1"
    exit 1
}

# Function to handle errors
handle_error() {
    local exit_code=$?
    local line_number=$1
    log "ERROR: Command failed with exit code $exit_code at line $line_number"
    cleanup
    exit $exit_code
}

# Set error trap
trap 'handle_error $LINENO' ERR

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

# Detect system information
ARCH=$(uname -m)
OS=$(uname -s)
KERNEL_VERSION=$(uname -r)
log "Detected architecture: $ARCH"
log "Detected OS: $OS"
log "Kernel version: $KERNEL_VERSION"

# Set packages based on architecture and OS
case "$OS" in
Linux)
    case "$ARCH" in
    x86_64)
        log "System: Linux x86_64"
        FFMPEG_PACKAGES="ffmpeg libavcodec-extra libavformat-dev libswscale-dev libavfilter-dev"
        ;;
    aarch64|arm64)
        log "System: Linux ARM64"
        FFMPEG_PACKAGES="ffmpeg libavcodec-extra libavformat-dev libswscale-dev"
        ;;
    armv7l|armv6l)
        log "System: Linux ARM (32-bit)"
        FFMPEG_PACKAGES="ffmpeg"
        ;;
    i386|i686)
        log "System: Linux 32-bit Intel"
        FFMPEG_PACKAGES="ffmpeg libavcodec-extra"
        ;;
    *)
        log "Unsupported architecture: $ARCH"
        log "Attempting to install basic FFmpeg package..."
        FFMPEG_PACKAGES="ffmpeg"
        ;;
    esac
    ;;
Darwin)
    log "System: macOS $ARCH"
    if command -v brew &> /dev/null; then
        log "Using Homebrew for installation"
        INSTALL_METHOD="brew"
        FFMPEG_PACKAGES="ffmpeg"
    else
        error_exit "Homebrew not found. Please install Homebrew first."
    fi
    ;;
*)
    log "Unsupported OS: $OS"
    error_exit "This script only supports Linux and macOS"
    ;;
esac

# Function to install packages
install_packages() {
    local packages="$1"
    
    case "$INSTALL_METHOD" in
    brew)
        log "Installing packages using Homebrew"
        for package in $packages; do
            log "Installing $package..."
            brew install "$package" || error_exit "Failed to install $package"
        done
        ;;
    *)
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
        ;;
    esac
}

# Check if FFmpeg is already installed
if command -v ffmpeg &> /dev/null; then
    log "FFmpeg is already installed:"
    ffmpeg -version | head -n 1
    
    # Check FFmpeg version
    FFMPEG_VERSION=$(ffmpeg -version | grep -oP 'ffmpeg version \K[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
    log "FFmpeg version: $FFMPEG_VERSION"
    
    # Check if required codecs are available
    log "Checking for required codecs..."
    REQUIRED_CODECS=("libopus" "libvorbis" "libmp3lame" "libx264" "libx265")
    MISSING_CODECS=()
    
    for codec in "${REQUIRED_CODECS[@]}"; do
        if ffmpeg -codecs 2>/dev/null | grep -q "$codec"; then
            log "✓ $codec is available"
        else
            log "⚠ $codec is missing"
            MISSING_CODECS+=("$codec")
        fi
    done
    
    if [ ${#MISSING_CODECS[@]} -gt 0 ]; then
        log "Warning: Some required codecs are missing: ${MISSING_CODECS[*]}"
        log "Attempting to install missing codecs..."
        install_packages "${MISSING_CODECS[*]}"
    fi
    
    log "FFmpeg installation check completed successfully"
    exit 0
fi

log "FFmpeg not found, installing..."
log "Installing packages: $FFMPEG_PACKAGES"

# Create temporary directory for installation
TEMP_DIR=$(mktemp -d)
log "Created temporary directory: $TEMP_DIR"

# Change to temporary directory
cd "$TEMP_DIR" || error_exit "Failed to change to temporary directory"

# Install FFmpeg
install_packages "$FFMPEG_PACKAGES"

# Verify installation
if command -v ffmpeg &> /dev/null; then
    log "✓ FFmpeg installed successfully:"
    ffmpeg -version | head -n 1
    
    # Get FFmpeg version
    FFMPEG_VERSION=$(ffmpeg -version | grep -oP 'ffmpeg version \K[0-9]+\.[0-9]+\.[0-9]+' | head -n1)
    log "FFmpeg version: $FFMPEG_VERSION"
    
    # Test FFmpeg functionality
    log "Testing FFmpeg functionality..."
    
    # Create test directory
    TEST_DIR="/tmp/ffmpeg_test_$$"
    mkdir -p "$TEST_DIR" || error_exit "Failed to create test directory"
    
    # Test audio conversion
    log "Testing audio conversion..."
    ffmpeg -f lavfi -i "sine=frequency=1000:duration=1" -acodec pcm_s16le "$TEST_DIR/test.wav" -y 2>/dev/null || \
        error_exit "Failed to create test audio file"
    
    # Convert to FLAC
    ffmpeg -i "$TEST_DIR/test.wav" -acodec flac "$TEST_DIR/test.flac" -y 2>/dev/null || \
        error_exit "Failed to convert test audio to FLAC"
    
    # Test video conversion
    log "Testing video conversion..."
    ffmpeg -f lavfi -i "testsrc=duration=1:size=320x240:rate=1" -c:v libx264 "$TEST_DIR/test.mp4" -y 2>/dev/null || \
        error_exit "Failed to create test video file"
    
    # Check if conversions were successful
    if [ -f "$TEST_DIR/test.flac" ] && [ -f "$TEST_DIR/test.mp4" ]; then
        log "✓ Audio and video conversion tests successful"
        
        # Get file sizes for logging
        AUDIO_SIZE=$(stat -c%s "$TEST_DIR/test.flac" 2>/dev/null || echo 0)
        VIDEO_SIZE=$(stat -c%s "$TEST_DIR/test.mp4" 2>/dev/null || echo 0)
        log "Audio file size: $AUDIO_SIZE bytes"
        log "Video file size: $VIDEO_SIZE bytes"
    else
        error_exit "Conversion tests failed"
    fi
    
    # Test codec availability
    log "Testing codec availability..."
    ffmpeg -codecs 2>/dev/null | grep -E "(libopus|libvorbis|libmp3lame|libx264|libx265)" | while read codec; do
        log "✓ Available codec: $codec"
    done
    
    # Clean up test files
    rm -rf "$TEST_DIR"
    log "FFmpeg installation and functionality test completed successfully"
    
    # Create installation marker
    echo "$(date): FFmpeg $FFMPEG_VERSION installed successfully" > /tmp/ffmpeg_install.marker
    log "Installation marker created at /tmp/ffmpeg_install.marker"
else
    error_exit "FFmpeg installation failed"
fi

# Cleanup function
cleanup() {
    log "Cleaning up temporary files..."
    
    # Clean up temporary directory if it exists
    if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
        rm -rf "$TEMP_DIR"
        log "Removed temporary directory: $TEMP_DIR"
    fi
    
    # Clean up any stray test files
    find /tmp -name "ffmpeg_test_*" -type d -mtime +0 -exec rm -rf {} \; 2>/dev/null || true
    log "Cleaned up stray test files"
}

# Set cleanup trap
trap cleanup EXIT

log "=== FFmpeg Installation Completed ==="
log "Script version: $SCRIPT_VERSION"
log "Installation log saved to: $LOG_FILE"

# Display summary
echo ""
echo "FFmpeg Installation Summary:"
echo "- Version: $(ffmpeg -version | grep -oP 'ffmpeg version \K[0-9]+\.[0-9]+\.[0-9]+' | head -n1)"
echo "- Architecture: $ARCH"
echo "- OS: $OS"
echo "- Installation date: $(date)"
echo "- Log file: $LOG_FILE"
echo ""

exit 0
