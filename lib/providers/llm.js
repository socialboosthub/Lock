const https = require("https");

function requestJSON(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = { "x-goog-api-key": process.env.GEMINI_API_KEY, "Api-Revision": "2026-05-20" };
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

function splitSubtitlePhrases(text) {
  const words = String(text || "").trim().split(/\\s+/).filter(Boolean);
  const phrases = [];
  let current = [];
  for (const word of words) {
    current.push(word);
    const sentenceEnd = /[.!?…][”"'’)]?$/.test(word);
    if (current.length >= 5 || (sentenceEnd && current.length >= 2)) {
      phrases.push(current.join(" "));
      current = [];
    }
  }
  if (current.length) phrases.push(current.join(" "));
  return phrases;
}

function normalizeStoryPackage(story) {
  const durationSec = Math.max(30, Math.min(120, Math.round(Number(story.durationSec) || 60)));
  const scenes = (story.scenes || []).slice(0, 14);
  if (!scenes.length) throw new Error("Gemini returned no usable scenes.");

  const weights = scenes.map(scene => Math.max(1,
    String(scene.narration || scene.action || "").trim().split(/\\s+/).filter(Boolean).length));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  let cursor = 0;
  const normalized = scenes.map((scene, index) => {
    const start = cursor;
    const end = index === scenes.length - 1
      ? durationSec
      : Math.max(start + 1, Math.round(start + durationSec * weights[index] / totalWeight));
    cursor = end;
    const narration = String(scene.narration || "").trim();
    const subtitlePhrases = splitSubtitlePhrases(narration);
    return {
      ...scene,
      id: index + 1,
      start,
      end,
      durationSec: end - start,
      narration,
      subtitlePhrases
    };
  });

  return { ...story, durationSec, scenes: normalized };
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

const STORY_SYSTEM = `You are AHM Studio's world-class autonomous short-form film director, screenwriter and continuity supervisor.
Create a production-ready vertical 9:16 stylized 3D cinematic short with a clear emotional story.
Priorities: a visually arresting first 1-2 seconds; immediate story clarity; escalating stakes; emotionally specific choices;
a surprising but earned payoff; and a memorable final image.
STORY LOGIC: establish the protagonist's goal, obstacle and stakes early. Every scene must change the situation or deepen emotion.
Plant every major character, relationship, clue, object and mystery before its payoff. Make the final reveal explicit and understandable,
not merely pretty or symbolic. Never invent a dead relative, lost child, secret identity or important keepsake at the end without setup.
TITLE CHECK: the title must accurately describe the actual story's central setting, object or mystery. Do not keep an unrelated placeholder title. Return titleFit with matchesStory (boolean) and reason (short explanation). If the supplied title conflicts with the story, explicitly flag it instead of silently pretending it matches.
CHARACTER CONTINUITY: define permanent identity only (age, face, skin/fur, eyes, hair, build, height, signature clothing and unique marks). Do NOT put temporary states such as an empty necklace, held object, wet clothing or injury into the permanent character description. Track temporary states separately per scene. Repeat permanent identity exactly in each relevant visualPrompt; show state changes only after an explicit action.
WORLD & PROP CONTINUITY: lock locations, time/weather, lighting and important props. Track each prop's owner, position and state scene by scene. Never show a prop before it is introduced, after it is removed, or in two places at once. For every change, show the action that causes it. Audit every scene for contradictions in character, costume, props, weather, lighting and geography.
CINEMATOGRAPHY: every scene needs a motivated shot size, angle, lens feel, camera movement, composition and subject action.
Vary close-ups, mediums, wides, POVs and moving shots; avoid repeating generic wide shots. Specify facial expression and body language.
SOUND & DIALOGUE: give each scene purposeful ambience, score, foley or impact. If a character speaks, include the exact short spoken line in dialogue with the speaker's character ID; never describe speech without supplying the words. Keep narration and character dialogue distinct.
SHORT-FORM RHYTHM: hook in the first 2 seconds, visual change or new information every few seconds, clean transitions, no filler.
Narration must be concise, speakable and fit the natural duration. Choose 30-120 seconds based on story complexity; no padding.
Use 5-14 scenes. Scene timings must start at 0, be chronological, cover the full duration exactly, with no gaps or overlaps.
Subtitles must be short, readable phrases timed to the spoken narration; do not cram full paragraphs into one scene.
Return only valid JSON with this structure:
{
 "title":"string","titleFit":{"matchesStory":true,"reason":"short title/story fit explanation"},"durationSec":48,"hook":"first-second visual hook","kicker":"memorable final line",
 "narration":"complete voice-over",
 "characters":[{"id":"char_1","name":"string","role":"story role","description":"locked detailed visual identity, personality and voice"}],
 "environments":[{"id":"env_1","name":"string","description":"locked location, lighting, palette and atmosphere"}],
 "props":[{"id":"prop_1","name":"string","description":"locked appearance and story meaning"}],
 "scenes":[{"id":1,"start":0,"end":6,"narration":"exact spoken lines","action":"specific visible action and emotional beat",
 "emotion":"specific facial expression and body language","dialogue":[{"character":"char_1","line":"optional spoken line"}],
 "shot":"shot size and composition","camera":"angle, lens feel and motivated camera movement",
 "characters":["char_1"],"environment":"env_1","props":["prop_1"],
 "camera":"shot size, angle, lens feel and camera movement","transition":"how this shot connects to the next",
 "sound":"specific ambience, music cue or sound effect",
 "visualPrompt":"standalone detailed video prompt; restate exact locked character and prop descriptions for every visible subject; include action, environment, lighting, composition, camera and motion"}],
 "beats":[{"time":2,"effect":"fast push-in","purpose":"reveal the hook"}],
 "continuityNotes":["specific setup/payoff or prop-state note"],
 "storyArc":{"goal":"protagonist goal","stakes":"what can be lost","turningPoint":"choice or reversal","payoff":"how the planted clue resolves"}
}
The story must be logically coherent. Make the final reveal understandable from details planted in earlier scenes.
Every visualPrompt must be independently usable by an image/video model and must not contain text, captions, logos or watermarks. Before returning JSON, verify permanent character descriptions contain no changing temporary states; every prop is introduced before use; every state change is shown; dialogue has exact words and a speaker; scene timings cover the full duration exactly; and the final reveal is planted and paid off.
Avoid vague phrases like "cinematic scene"; specify subject, action, place, light, camera and motion.`;

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
  const story = normalizeStoryPackage(extractJson(output));
  if (!story.title || !story.narration || !Array.isArray(story.scenes) || !story.scenes.length) {
    throw new Error("Gemini returned an incomplete story. Please try again.");
  }
  const duration = Number(story.durationSec);
  if (!Number.isFinite(duration) || duration < 30 || duration > 120) {
    throw new Error("Gemini returned an invalid video duration. Please try again.");
  }
  return { status: "completed", story };
}

module.exports = { startStoryGeneration, getStoryGeneration, isStoryProviderConfigured, normalizeStoryPackage, splitSubtitlePhrases };
