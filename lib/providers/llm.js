const https = require("https");

function postJSON(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers }
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 400) return reject(new Error(parsed.error?.message || data));
          resolve(parsed);
        } catch {
          reject(new Error(`Story provider returned non-JSON (${res.statusCode}).`));
        }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

function demoStory(idea) {
  const title = idea ? idea.slice(0, 60) : "The Thing Nobody Expected";
  return {
    title,
    durationSec: 42,
    narration:
      "Everyone thought this strange event was just a coincidence. But there was one detail nobody noticed. The moment it happened, something underneath changed. Watch closely, because that tiny change explains everything. And once you see it, the whole story makes sense.",
    hook: "Everyone thought it was a coincidence... but one tiny detail proved otherwise.",
    kicker: "And that's why the strange part wasn't the event — it was what happened underneath.",
    characters: [
      { id: "char_01", name: "Main Character", description: "expressive stylized 3D human, consistent face, hair and clothing" }
    ],
    environments: [
      { id: "env_01", name: "Primary Environment", description: "cinematic natural environment, no people in environment plate" }
    ],
    props: [],
    scenes: [
      { id: 1, start: 0, end: 7, action: "Immediate visual hook and mystery reveal." },
      { id: 2, start: 7, end: 15, action: "Establish the unusual situation." },
      { id: 3, start: 15, end: 25, action: "Show the hidden mechanism with visual annotations." },
      { id: 4, start: 25, end: 35, action: "Escalate and reveal the surprising truth." },
      { id: 5, start: 35, end: 42, action: "Payoff and curiosity-loop kicker." }
    ],
    beats: [
      { time: 3, effect: "zoom" },
      { time: 19, effect: "zoom" },
      { time: 31, effect: "shake" },
      { time: 39, effect: "zoom" }
    ]
  };
}

async function generateStoryPackage(idea, targetDuration, previousStories = []) {
  if (process.env.DEMO_MODE === "true" || !process.env.OPENAI_API_KEY) {
    return demoStory(idea);
  }

  const system = `You are AHM Studio's autonomous short-form story director.

Create ONE complete 9:16 stylized-realistic 3D cinematic storytelling video.
The visual language is fast, expressive, educational/mystery-driven, with a strong
curiosity loop, rapid visual changes, green reveal annotations, red danger/physics
annotations, zoom-ins, occasional screen shakes, and large readable subtitles.

Do not copy any living creator's exact signature. Use only high-level production
characteristics. Characters do not lip-sync; narration is external.

The final story is normally 30-60 seconds, but may naturally extend to 120 seconds
when genuinely needed. Never add filler and never create Parts/Episodes.

IMPORTANT AUTONOMOUS MODE:
- If an Idea is supplied, use it as inspiration and write the complete final script yourself.
- If no Idea is supplied, invent an original, highly interesting concept yourself.
- Do NOT ask the user to provide a finished script.
- Avoid repeating the title, central mechanism, setting, twist, or opening pattern of recent stories.
- Make the first 1-2 seconds immediately intriguing.
- Build: hook -> problem/mechanism -> escalation -> twist/payoff -> curiosity kicker.
- Keep narration natural and easy to speak.
- Return ONLY valid JSON matching the requested schema.`;

  const schema = {
    title: "string",
    durationSec: "number 30-120",
    hook: "string",
    narration: "string",
    kicker: "string",
    characters: [{ id: "string", name: "string", description: "string" }],
    environments: [{ id: "string", name: "string", description: "string" }],
    props: [{ id: "string", name: "string", description: "string" }],
    scenes: [{ id: "number", start: "number", end: "number", action: "string", shots: ["string"] }],
    beats: [{ time: "number", effect: "zoom|shake|none" }]
  };

  const recent = previousStories.length
    ? JSON.stringify(previousStories)
    : "No previous stories are available.";

  const user = `Idea: ${idea || "(none — invent an original idea yourself)"}
Target duration: ${targetDuration}
Recent stories to avoid repeating: ${recent}
Schema: ${JSON.stringify(schema)}

Write the complete story package.`;

  const response = await postJSON("https://api.openai.com/v1/chat/completions", {
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
  }, {
    model: process.env.OPENAI_MODEL || "gpt-5",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.9,
    response_format: { type: "json_object" }
  });

  const text = response.choices?.[0]?.message?.content;
  if (!text) throw new Error("No story returned by the story provider.");
  return JSON.parse(text);
}

module.exports = { generateStoryPackage };
