const https = require("https");

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers }
    }, res => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(Buffer.concat(chunks).toString("utf8")));
        resolve(Buffer.concat(chunks));
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

async function generateVoice({ script }) {
  if (process.env.DEMO_MODE === "true" || !process.env.ELEVENLABS_API_KEY || !process.env.ELEVENLABS_VOICE_ID) {
    return {
      mode: "demo",
      voiceId: null,
      audioUrl: null,
      note: "Connect your voice provider and saved voice ID for real narration."
    };
  }

  // The app expects a provider voice ID created/authorized outside this code.
  // Your secret API key stays server-side.
  const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`;
  const audio = await post(endpoint, {
    "xi-api-key": process.env.ELEVENLABS_API_KEY,
    Accept: "audio/mpeg"
  }, {
    text: script,
    model_id: "eleven_multilingual_v2",
    voice_settings: { stability: 0.55, similarity_boost: 0.8 }
  });

  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..", "..", "data", "audio");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}.mp3`);
  fs.writeFileSync(file, audio);
  return { mode: "elevenlabs", voiceId: process.env.ELEVENLABS_VOICE_ID, localFile: file };
}

module.exports = { generateVoice };
