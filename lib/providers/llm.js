const https = require("https");

function requestJSON(method, url, body, timeoutMs = 12000) {
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
    req.setTimeout(timeoutMs, () => req.destroy(new Error("Gemini connection timed out after " + Math.round(timeoutMs / 1000) + " seconds. Please try again.")));
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function splitSubtitlePhrases(text) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
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

function quoteBalance(text) {
  const value = String(text || "");
  const opens = (value.match(/[“]/g) || []).length;
  const closes = (value.match(/[”]/g) || []).length;
  const straight = (value.match(/"/g) || []).length;
  return opens - closes + (straight % 2);
}

function repairSceneFragments(input) {
  const scenes = [];
  for (const raw of (Array.isArray(input) ? input : [])) {
    const narration = String(raw.narration || raw.action || "").trim();
    if (!narration || /^[”"'’.,!?…\\s]+$/.test(narration)) {
      const previous = scenes[scenes.length - 1];
      // Attach a closing quote only when it completes an actually open quotation.
      // Ignore orphan punctuation so it cannot corrupt an otherwise complete scene.
      if (previous && narration && quoteBalance(previous.narration) !== 0) {
        previous.narration += narration;
      }
      continue;
    }
    const previous = scenes[scenes.length - 1];
    if (previous && quoteBalance(previous.narration) !== 0) {
      previous.narration = (previous.narration + " " + narration).replace(/\s+/g, " ").trim();
      previous.action = [previous.action, raw.action].filter(Boolean).join(" ");
      previous.dialogue = [...(previous.dialogue || []), ...(raw.dialogue || [])];
      continue;
    }
    scenes.push({ ...raw, narration });
  }
  return scenes.filter(scene => String(scene.narration || "").trim());
}

function normalizeStoryPackage(story) {
  const durationSec = Math.max(30, Math.min(120, Math.round(Number(story.durationSec) || 60)));
  const scenes = repairSceneFragments(story.scenes).slice(0, 14);
  if (!scenes.length) throw new Error("Gemini returned no usable scenes.");

  const weights = scenes.map(scene => Math.max(1,
    String(scene.narration || scene.action || "").trim().split(/\s+/).filter(Boolean).length));
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
Subtitles must be short, readable phrases timed to the spoken narration; do not cram full paragraphs into one scene. NEVER split a spoken quotation across scenes. Keep opening and closing quotation marks attached to the complete dialogue sentence, including tags such as 'she cried' or 'he whispered'. Never create a scene containing only punctuation or a closing quotation mark. Every scene narration must be a complete, non-empty spoken thought; preserve every word and punctuation from the story.
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


const EXPLAINER_SYSTEM = `You are AHM Studio's autonomous educational explainer director.
Your job is to turn a topic, question, fact, situation, what-if, or supplied script into a concise, visually explanatory short-form video plan. This is NOT automatically a fictional story. Never invent characters or fictional events unless the topic genuinely calls for a dramatized example and it is clearly labelled as illustrative.

CORE GOAL:
Explain the subject accurately and clearly. Build a curiosity gap, deliver a strong first 1-2 second hook, reveal the mechanism or answer through a logical sequence, and end with a memorable accurate takeaway. No filler, generic introductions, or sensational claims unsupported by evidence.

ADAPTIVE VISUAL DIRECTION:
Infer the best visual language from the topic. Use detailed stylized-realistic 3D environments, objects, anatomy, cross-sections, particles, maps, machines, animals, landscapes, scientific simulations, historical reconstructions, diagrams, or expressive people only when they help explain. Do not force characters into every video. Visuals must demonstrate the narration, not merely decorate it.
Plan intentional cinematic camera movement and motivated transitions: macro-to-wide reveals, fly-throughs, tracking, push-ins, match cuts, object transitions, rotations, whip pans, cutaways, speed ramps and impact cuts where appropriate. Every transition must connect ideas or preserve visual continuity. Avoid random effects and repeated generic shots.
Use detailed materials, realistic lighting, shadows, reflections, depth, atmosphere and clear composition. Keep recurring subjects visually consistent. Never ask the video model to render text; exact labels, arrows, captions and subtitles are composited later.

ACCURACY:
Distinguish established facts from hypotheses, disputed interpretations and illustrative scenarios. Do not invent statistics, studies, quotations, sources or precise claims. For medical, health, scientific, historical and current topics, flag claims that require up-to-date verification. If uncertain, say so in the explanation rather than pretending certainty. Avoid individualized medical advice.
The narration must be natural, engaging, speakable and understandable to a general audience. Explain cause and effect in plain language. Use no more than the information needed for a strong short.

OUTPUT:
Choose a natural duration, usually 30-60 seconds, never over 120 seconds. Use 5-14 scenes. Timings start at 0, are chronological, have no gaps or overlaps and cover the full duration. Each scene has a specific visible action/demonstration that directly matches its narration, camera/shot, transition, sound design and a detailed standalone visual prompt. Keep subtitles short and readable; preserve all narration words.
Return only valid JSON:
{
 "title":"accurate concise title",
 "topic":"interpreted subject",
 "category":"inferred subject category",
 "visualApproach":"chosen 3D visual language and why it explains this topic",
 "durationSec":45,
 "hook":"opening visual and spoken hook",
 "summary":"one-sentence explanation",
 "narration":"complete narration",
 "conclusion":"accurate takeaway",
 "accuracyNotes":["uncertainties or claims requiring current verification"],
 "sourcesToVerify":[{"claim":"claim","suggestedSource":"reliable source type or institution"}],
 "characters":[{"id":"char_1","name":"name","description":"only if a person/character is genuinely useful"}],
 "environments":[{"id":"env_1","name":"name","description":"visual details"}],
 "props":[{"id":"prop_1","name":"name","description":"visual details"}],
 "scenes":[
  {"id":1,"start":0,"end":5,"narration":"exact narration segment","action":"what viewers see that explains the line","emotion":"mood if relevant","shot":"shot size and composition","camera":"angle, lens feel and motivated camera movement","transition":"purposeful connection to next scene","sound":"ambience, score and specific sound effects","visualPrompt":"standalone detailed stylized-realistic 3D video prompt with subject, accurate action, environment, materials, lighting, composition, camera and motion; no text or watermark","characters":[],"environment":"env_1 or empty","props":[]}
 ],
 "visualContinuity":["specific consistency rules"],
 "beats":[{"time":2,"effect":"effect","purpose":"why it helps explain"}]
}
Before returning JSON, check that every scene visually explains its narration, the sequence is logically coherent, facts are appropriately qualified, scene timings cover the full duration, and there are no invented sources or unsupported statistics. `;

async function startExplainerGeneration(topic, targetDuration = "natural") {
  if (!isStoryProviderConfigured()) {
    const error = new Error("AHM's AI Director is not connected. Add the Gemini API key in the server environment.");
    error.code = "STORY_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const input = [
    EXPLAINER_SYSTEM,
    "",
    "USER TOPIC OR QUESTION:",
    String(topic || "").trim(),
    "",
    "DURATION PREFERENCE: " + (targetDuration || "natural, usually 30-60 seconds, maximum 120 seconds"),
    "Create an explanatory video plan, not a fictional story unless the user's topic explicitly requests fiction.",
    "Return only the JSON object. Do not wrap it in markdown."
  ].join("\n");

  // Use the standard generateContent endpoint for explainers. The previous
  // background Interactions path repeatedly failed inside Google's service
  // with INTERNAL errors even though job creation succeeded.
  const result = await requestJSON(
    "POST",
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
    {
      contents: [{ role: "user", parts: [{ text: input }] }],
      generationConfig: { responseMimeType: "application/json" }
    },
    55000
  );

  const candidate = result.candidates?.[0];
  const output = (candidate?.content?.parts || [])
    .filter(part => typeof part.text === "string")
    .map(part => part.text)
    .join("\n");
  if (!output) {
    const reason = result.promptFeedback?.blockReason || candidate?.finishReason || "No text candidate returned";
    throw new Error("Gemini did not return an explainer (" + reason + ").");
  }

  const explainer = normalizeStoryPackage(extractJson(output));
  if (!explainer.title || !explainer.narration || !Array.isArray(explainer.scenes) || !explainer.scenes.length) {
    throw new Error("AHM's AI Director returned an incomplete explainer plan.");
  }
  return { status: "completed", story: explainer };
}

async function getExplainerGeneration(interactionId) {
  if (!isStoryProviderConfigured()) throw new Error("AHM's AI Director is not connected.");
  if (!/^v1_[A-Za-z0-9_-]+$/.test(String(interactionId || ""))) {
    throw new Error("Invalid AHM job. Please generate again.");
  }
  const result = await requestJSON("GET",
    "https://generativelanguage.googleapis.com/v1beta/interactions/" + encodeURIComponent(interactionId));
  if (result.status === "failed") {
    const providerErrors = Array.isArray(result.errors) ? result.errors : [];
    const errorDetails = providerErrors.map(item => {
      if (typeof item === "string") return item;
      const code = item?.code ? String(item.code) : "";
      const message = item?.message || item?.detail || "";
      return [code, message].filter(Boolean).join(": ");
    }).filter(Boolean);
    const providerError = result.error || result.last_error || result.failure || null;
    const fallbackDetail = typeof providerError === "string"
      ? providerError
      : providerError?.message || providerError?.detail || providerError?.code || "";
    const diagnostic = (errorDetails.join("; ") || fallbackDetail ||
      "Gemini marked the job failed (response fields: " + Object.keys(result).join(", ") + ").").slice(0, 1000);
    console.error("AHM Gemini explainer provider failure:", diagnostic);
    throw new Error("Gemini could not finish the explainer: " + diagnostic);
  }
  if (result.status !== "completed") return { status: result.status || "in_progress" };
  const output = (result.steps || [])
    .filter(step => step.type === "model_output")
    .flatMap(step => step.content || [])
    .filter(part => part.type === "text")
    .map(part => part.text || "")
    .join("\\n");
  const explainer = normalizeStoryPackage(extractJson(output));
  if (!explainer.title || !explainer.narration || !Array.isArray(explainer.scenes) || !explainer.scenes.length) {
    throw new Error("AHM's AI Director returned an incomplete explainer plan.");
  }
  return { status: "completed", story: explainer };
}

module.exports = { startStoryGeneration, getStoryGeneration, startExplainerGeneration, getExplainerGeneration, isStoryProviderConfigured, normalizeStoryPackage, splitSubtitlePhrases };
