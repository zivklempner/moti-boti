const axios    = require("axios");
const FormData = require("form-data");
const fs       = require("fs");
const os       = require("os");
const path     = require("path");

/**
 * Transcribe a WhatsApp voice message (OGG/OPUS) using OpenAI Whisper.
 * Uses axios directly instead of the OpenAI SDK to get clearer network errors.
 *
 * @param {string} base64Data - Base64-encoded audio data
 * @param {string} mimeType   - MIME type, e.g. "audio/ogg; codecs=opus"
 * @returns {Promise<string>} Transcribed text
 */
async function transcribeAudio(base64Data, mimeType) {
  const apiKey  = process.env.OPENAI_API_KEY;
  const buffer  = Buffer.from(base64Data, "base64");
  const tmpPath = path.join(os.tmpdir(), `voice_${Date.now()}.ogg`);

  fs.writeFileSync(tmpPath, buffer);
  console.log(`Voice temp file: ${tmpPath} (${buffer.length} bytes)`);

  try {
    const form = new FormData();
    form.append("file", fs.createReadStream(tmpPath), {
      filename:    "voice.ogg",
      contentType: "audio/ogg",
    });
    form.append("model",           "whisper-1");
    form.append("language",        "he");
    form.append("response_format", "text");

    const response = await axios.post(
      "https://api.openai.com/v1/audio/transcriptions",
      form,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...form.getHeaders(),
        },
        timeout: 30000,
      }
    );

    // response_format:"text" → response.data is a plain string
    return (response.data || "").toString().trim();
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

module.exports = { transcribeAudio };
