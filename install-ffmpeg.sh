#!/bin/bash
# install-ffmpeg.sh
echo "Checking for FFmpeg installation..."
if ! command -v ffmpeg &> /dev/null; then
    echo "FFmpeg not found. Installing..."
    
    # Update package lists
    apt-get update -y
    
    # Install FFmpeg with dependencies
    apt-get install -y \
        ffmpeg \
        libavcodec-extra \
        libavformat-dev \
        libswscale-dev
        
    # Verify installation
    if command -v ffmpeg &> /dev/null; then
        echo "FFmpeg successfully installed:"
        ffmpeg -version | head -n 1
    else
        echo "FFmpeg installation failed!" >&2
        exit 1
    fi
else
    echo "FFmpeg is already installed:"
    ffmpeg -version | head -n 1
fi
