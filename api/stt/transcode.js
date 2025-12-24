const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;

/**
 * Transcode WhatsApp .ogg (Opus) -> .flac (mono, 16 kHz).
 * Lossless audio improves recognition in noisy environments.   // [7](https://docs.pipecat.ai/server/services/stt/google)
 * @param {string} inputPath
 * @returns {Promise<string>} output FLAC path
 */
async function oggToFlac(inputPath) {
  const outPath = path.join('/tmp', `${path.basename(inputPath, '.ogg')}.flac`);
  await new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      '-y', '-i', inputPath,
      '-ac', '1',          // mono
      '-ar', '16000',      // 16 kHz default (good for STT)           // [7](https://docs.pipecat.ai/server/services/stt/google)
      outPath
    ]);
    ff.on('error', reject);
    ff.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`)));
  });
  return outPath;
}

module.exports = { oggToFlac };
