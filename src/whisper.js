const OpenAI = require("openai");

let _openai = null;

function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

/**
 * Transcribe a WhatsApp voice message (OGG/OPUS) using OpenAI Whisper.
 * @param {string} base64Data - Base64-encoded audio data
 * @param {string} mimeType   - MIME type, e.g. "audio/ogg; codecs=opus"
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeAudio(base64Data, mimeType) {
  const openai = getOpenAI();
  const buffer = Buffer.from(base64Data, "base64");

  // toFile wraps the buffer so Whisper knows the filename/type
  const file = await OpenAI.toFile(buffer, "voice.ogg", { type: mimeType || "audio/ogg" });

  const response = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "he",          // Force Hebrew; Whisper still handles mixed Hebrew/English fine
    response_format: "text",
  });

  return typeof response === "string" ? response.trim() : (response.text || "").trim();
}

module.exports = { transcribeAudio };
