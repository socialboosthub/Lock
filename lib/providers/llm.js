const https = require("https");

function requestJSON(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { "x-goog-api-key": process.env.GEMINI_API_KEY };
    if (body) headers["Content-Type"] = "application/json";
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers
    }, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(data); }
        catch { return reject(new Error(`Gemini returned non-JSON (HTTP ${res.statusCode}).`)); }
        if (res.statusCode >= 400) {
          return reject(new Error(parsed.error?.message || `Gemini request failed (HTTP ${res.statusCode}).`));
        }
        resolve(parsed);
      });
    });
    req.on("error", reject);
    req.setTimeout(12000, () => req.destroy(new Error("Gemini connection timed out. Please try again.")));
    if (body) req.write(JSON.stringify(body));
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

const STORY_SYSTEM = `You are AHM Studio's autonomous short-form cinematic story director.
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

function isStoryProviderConfigured() {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function startStoryGeneration(idea, targetDuration = "natural") {
  if (!isStoryProviderConfigured()) {
    const error = new Error("Story AI is not connected. GEMINI_API_KEY is missing from this deployment.");
    error.code = "STORY_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const input = [
    STORY_SYSTEM,
    "",
    "STORY IDEA:",
    String(idea || "").trim() || "Invent an original high-retention story with a surprising but satisfying twist.",
    "",
    "DURATION PREFERENCE: " + (targetDuration || "natural story length, 30-120 seconds"),
    "Make the story emotionally engaging, visually clear, and suitable for a broad audience.",
    "Return only the JSON object. Do not wrap it in markdown."
  ].join("\n");
  const result = await requestJSON("POST", "https://generativelanguage.googleapis.com/v1beta/interactions", {
    model,
    input,
    background: true
  });
  if (!result.id) throw new Error("Gemini did not create a story job. Please try again.");
  return { id: result.id, status: result.status || "in_progress" };
}

async function getStoryGeneration(interactionId) {
  if (!isStoryProviderConfigured()) throw new Error("Story AI is not connected.");
  if (!/^v1_[A-Za-z0-9_-]+$/.test(String(interactionId || ""))) {
    throw new Error("Invalid story job. Please generate again.");
  }
  const result = await requestJSON("GET",
    "https://generativelanguage.googleapis.com/v1beta/interactions/" + encodeURIComponent(interactionId));
  if (result.status === "failed") {
    throw new Error(result.error?.message || "Gemini could not complete this story. Please try again.");
  }
  if (result.status !== "completed") {
    return { status: result.status || "in_progress" };
  }
  const output = (result.steps || [])
    .filter(step => step.type === "model_output")
    .flatMap(step => step.content || [])
    .filter(part => part.type === "text")
    .map(part => part.text || "")
    .join("\n");
  const story = extractJson(output);
  if (!story.title || !story.narration || !Array.isArray(story.scenes) || !story.scenes.length) {
    throw new Error("Gemini returned an incomplete story. Please try again.");
  }
  const duration = Number(story.durationSec);
  if (!Number.isFinite(duration) || duration < 30 || duration > 120) {
    throw new Error("Gemini returned an invalid video duration. Please try again.");
  }
  return { status: "completed", story };
}

module.exports = { startStoryGeneration, getStoryGeneration, isStoryProviderConfigured };
