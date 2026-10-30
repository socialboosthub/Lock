const https = require("https");

function postJSON(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json" }
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          return reject(new Error(`Story provider returned non-JSON (HTTP ${res.statusCode}).`));
        }
        if (res.statusCode >= 400) {
          return reject(new Error(parsed.error?.message || `Gemini request failed (HTTP ${res.statusCode}).`));
        }
        resolve(parsed);
      });
    });
    req.on("error", reject);
    req.setTimeout(45000, () => req.destroy(new Error("Story request timed out. Please try again.")));
    req.write(JSON.stringify(body));
    req.end();
  });
}

function isStoryProviderConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

function extractJson(text) {
  const cleaned = String(text || "").trim()
    .replace(/^\`\`\`(?:json)?\s*/i, "")
    .replace(/\s*\`\`\`$/, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Gemini did not return a valid story package.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function generateStoryPackage(idea, targetDuration = "natural", previousStories = []) {
  if (!isStoryProviderConfigured()) {
    const error = new Error("Story AI is not connected yet. Add GEMINI_API_KEY in Vercel Environment Variables.");
    error.code = "STORY_PROVIDER_NOT_CONFIGURED";
    throw error;
  }

  const system = `You are AHM Studio's autonomous short-form cinematic story director.
Create a complete production-ready story for a vertical 9:16 stylized 3D cinematic short.
Style: expressive consistent characters, dramatic cinematic environments, dynamic camera shots,
fast pacing, strong first-second hook, escalation, surprising payoff, and a memorable final beat.
The narration is external voice-over; characters do not need lip-sync.
Choose a natural duration from 30 to 120 seconds based on the story. Never pad, force a duration,
or split into episodes. Write the full narration and detailed visual instructions for every scene.
Keep character appearance, clothing, age, and identifying details consistent across all scenes.
Return only valid JSON with this structure:
{
 "title":"string",
 "durationSec":45,
 "hook":"string",
 "narration":"complete voice-over",
 "kicker":"string",
 "characters":[{"id":"char_1","name":"string","description":"specific visual identity and personality"}],
 "environments":[{"id":"env_1","name":"string","description":"specific visual environment"}],
 "props":[{"id":"prop_1","name":"string","description":"visual description"}],
 "scenes":[{"id":1,"start":0,"end":7,"narration":"spoken lines for this scene","action":"what visibly happens","camera":"shot size, angle and movement","visualPrompt":"detailed standalone 3D video-generation prompt including character continuity"}],
 "beats":[{"time":3,"effect":"zoom"}]
}
Scene times must cover the whole video without gaps or overlaps. Use 5-14 scenes as appropriate.
Every scene needs a visualPrompt that can be sent to a video model independently.`;

  const user = [
    `Story idea: ${String(idea || "").trim() || "Invent an original high-retention story with a surprising but satisfying twist."}`,
    `Duration preference: ${targetDuration || "natural story length, 30-120 seconds"}.`,
    `Avoid repeating these recent story concepts: ${JSON.stringify(previousStories.slice(0, 10))}`,
    "Make the story emotionally engaging, visually clear, and suitable for a broad audience."
  ].join("\n");

  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
  const response = await postJSON(url, {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: {
      temperature: 0.85,
      responseMimeType: "application/json"
    }
  });

  const text = response.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "").join("");
  if (!text) {
    const reason = response.promptFeedback?.blockReason;
    throw new Error(reason ? `Story request was blocked: ${reason}.` : "Gemini returned an empty story.");
  }

  const story = extractJson(text);
  if (!story.title || !story.narration || !Array.isArray(story.scenes) || !story.scenes.length) {
    throw new Error("Gemini returned an incomplete story. Please try again.");
  }

  const duration = Number(story.durationSec);
  if (!Number.isFinite(duration) || duration < 30 || duration > 120) {
    throw new Error("Gemini returned an invalid video duration. Please try again.");
  }

  return story;
}

module.exports = { generateStoryPackage, isStoryProviderConfigured };
