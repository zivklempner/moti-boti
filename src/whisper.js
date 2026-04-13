const fs   = require("fs");
const os   = require("os");
const path = require("path");

// Import the OpenAI class — handle both CJS patterns (class as default vs named export)
const openaiPkg = require("openai");
const OpenAI = openaiPkg.OpenAI || openaiPkg.default || openaiPkg;

let _openai = null;

function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

/**
 * Transcribe a WhatsApp voice message (OGG/OPUS) using OpenAI Whisper.
 * Uses a temp file + fs.createReadStream to avoid File/toFile compatibility
 * issues on Node 18.
 *
 * @param {string} base64Data - Base64-encoded audio data
 * @param {string} mimeType   - MIME type, e.g. "audio/ogg; codecs=opus"
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeAudio(base64Data, mimeType) {
  const openai  = getOpenAI();
  const buffer  = Buffer.from(base64Data, "base64");
  const tmpPath = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);

  fs.writeFileSync(tmpPath, buffer);
  console.log(`Voice temp file: ${tmpPath} (${buffer.length} bytes, mime=${mimeType})`);

  try {
    const response = await openai.audio.transcriptions.create({
      file:            fs.createReadStream(tmpPath),
      model:           "whisper-1",
      language:        "he",
      response_format: "text",
    });

    // response_format:"text" returns a plain string in newer SDK versions
    return typeof response === "string" ? response.trim() : (response.text || "").trim();
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

module.exports = { transcribeAudio };
