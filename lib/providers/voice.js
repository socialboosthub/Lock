const https = require("https");

function requestJSON(url, headers, body) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = https.request({
      hostname: target.hostname,
      path: target.pathname + target.search,
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers }
    }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
        catch { return reject(new Error("The voice provider returned an unreadable response.")); }
        if (res.statusCode >= 400) {
          const error = new Error(parsed.error?.message || `Gemini TTS failed (HTTP ${res.statusCode}).`);
          error.statusCode = res.statusCode;
          return reject(error);
        }
        resolve(parsed);
      });
    });
    req.on("error", reject);
    req.setTimeout(90000, () => req.destroy(new Error("AI voice generation timed out. Please try again.")));
    req.write(JSON.stringify(body));
    req.end();
  });
}

const ALLOWED_VOICES = new Set(["Kore", "Puck", "Charon", "Aoede", "Fenrir", "Zephyr", "Leda", "Orus"]);

async function generateFreeVoiceover({ text, voice = "Kore", style }) {
  const transcript = String(text || "").trim();
  if (!transcript) throw new Error("There is no narration text to speak.");
  if (transcript.length > 9000) throw new Error("Narration is too long for one free voice request. Shorten the story and try again.");
  if (!process.env.GEMINI_API_KEY) {
    const error = new Error("Free AI narration needs GEMINI_API_KEY configured on the server.");
    error.code = "VOICE_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  const selectedVoice = ALLOWED_VOICES.has(voice) ? voice : "Kore";
  const model = process.env.GEMINI_FREE_TTS_MODEL || "gemini-3.8-flash-lite-tts";
  const result = await requestJSON(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    { "x-goog-api-key": process.env.GEMINI_API_KEY },
    {
      model,
      input: [{
        type: "user_input",
        content: [{
          type: "text",
          text: transcript,
          annotations: [{
            type: "speech_metadata",
            style: String(style || "Expressive, natural cinematic narration with clear diction and emotional emphasis.").slice(0, 300)
          }]
        }]
      }],
      response_format: { type: "audio" },
      generation_config: { speech_config: [{ voice: selectedVoice }] }
    }
  );
  const audioBase64 = result.output_audio?.data;
  if (!audioBase64 || typeof audioBase64 !== "string") {
    throw new Error("Gemini TTS returned no audio data. Please retry or check the model quota.");
  }
  return {
    audioBase64,
    mimeType: result.output_audio?.mime_type || "audio/wav",
    model
  };
}

module.exports = { generateFreeVoiceover };
