require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { startStoryGeneration, getStoryGeneration, startExplainerGeneration, getExplainerGeneration, isStoryProviderConfigured } = require("./lib/providers/llm");
const { startVideoJob, getVideoJob, isVideoProviderConfigured } = require("./lib/providers/video");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2mb" }));

app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "AHM Studio",
    version: "9.0.0",
    storyProvider: isStoryProviderConfigured() ? "configured" : "not_configured",
    videoProvider: isVideoProviderConfigured() ? "configured" : "not_configured",
    voiceProvider: isStoryProviderConfigured() ? "gemini_tts_available" : "not_configured",
    musicProvider: process.env.LYRIA_ENABLED === "true" ? "enabled" : "optional_not_enabled"
  });
});

app.post("/api/explainer/plan", async (req, res) => {
  try {
    const topic = typeof req.body?.topic === "string" ? req.body.topic.trim() : "";
    const targetDuration = typeof req.body?.targetDuration === "string"
      ? req.body.targetDuration.slice(0, 40) : "natural";
    if (!topic) return res.status(400).json({ error: "Enter a topic or question for AHM to explain." });
    if (topic.length > 6000) {
      return res.status(400).json({ error: "Please keep your topic under 6,000 characters." });
    }
    const characterReferences = Array.isArray(req.body?.characterReferences)
      ? req.body.characterReferences.slice(0, 8).filter(item =>
          item && typeof item.name === "string" && typeof item.description === "string"
        ).map(item => ({
          name: item.name.trim().slice(0, 80),
          description: item.description.trim().slice(0, 1600)
        })).filter(item => item.name && item.description)
      : [];
    const result = await startExplainerGeneration(topic, targetDuration, characterReferences);
    return res.status(200).json({
      ok: true,
      status: "completed",
      story: result.story,
      video: { status: "not_started", message: "The explainer plan is ready. Genuine AI video generation is not connected yet." }
    });
  } catch (error) {
    const status = error.code === "STORY_PROVIDER_NOT_CONFIGURED" ? 503 : 502;
    console.error("AHM explainer job start failed:", error.message);
    return res.status(status).json({ error: error.message || "Could not start explainer planning." });
  }
});

app.post("/api/explainer/video", async (req, res) => {
  try {
    const story = req.body?.story;
    if (!story || !Array.isArray(story.scenes) || !story.scenes.length) {
      return res.status(400).json({ ok: false, error: "Generate a complete AI Director plan before creating the video." });
    }
    if (!story.narration || !story.title) {
      return res.status(400).json({ ok: false, error: "The AI Director plan is missing its title or narration." });
    }
    const allowedVoices = new Set(["Charon", "Kore", "Puck", "Aoede", "Fenrir", "Zephyr", "Leda", "Orus"]);
    const voice = typeof req.body?.voice === "string" ? req.body.voice : "Charon";
    if (!allowedVoices.has(voice)) {
      return res.status(400).json({ ok: false, error: "Choose a supported AHM narrator voice." });
    }
    const musicEnabled = req.body?.musicEnabled === true;
    if (musicEnabled && process.env.LYRIA_ENABLED !== "true") {
      return res.status(503).json({
        ok: false,
        error: "Original background music is selected, but Lyria is not enabled for this deployment. It is a paid music service and must be explicitly configured first."
      });
    }
    const productionStory = {
      ...story,
      productionSettings: { voice, musicEnabled }
    };
    const jobId = crypto.randomUUID();
    const job = await startVideoJob({ jobId, story: productionStory });
    return res.status(202).json({ ok: true, jobId: job.id, status: job.status });
  } catch (error) {
    const status = error.code === "VIDEO_PROVIDER_NOT_CONFIGURED" ? 503 : 502;
    console.error("AHM video job start failed:", error.message);
    return res.status(status).json({ ok: false, error: error.message || "Could not start cinematic video generation." });
  }
});

app.get("/api/explainer/video/:jobId", async (req, res) => {
  try {
    const jobId = String(req.params.jobId || "");
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(jobId)) {
      return res.status(400).json({ ok: false, error: "Invalid video job ID." });
    }
    const result = await getVideoJob(jobId);
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("AHM video job status failed:", error.message);
    return res.status(502).json({ ok: false, error: error.message || "Could not check video generation status." });
  }
});

app.get("/api/explainer/plan/:jobId", async (req, res) => {
  try {
    const result = await getExplainerGeneration(req.params.jobId);
    if (result.status !== "completed") return res.json({ ok: true, status: result.status });
    return res.json({
      ok: true,
      status: "completed",
      story: result.story,
      video: { status: "not_started", message: "The explainer plan is ready. Genuine AI video generation is not connected yet." }
    });
  } catch (error) {
    console.error("AHM explainer job check failed:", error.message);
    return res.status(502).json({ error: error.message || "Could not check explainer generation." });
  }
});

app.post("/api/story/plan", async (req, res) => {
  try {
    const idea = typeof req.body?.idea === "string" ? req.body.idea.trim() : "";
    const targetDuration = typeof req.body?.targetDuration === "string"
      ? req.body.targetDuration.slice(0, 40) : "natural";
    if (idea.length > 6000) {
      return res.status(400).json({ error: "Please keep your story idea under 6,000 characters." });
    }
    const job = await startStoryGeneration(idea, targetDuration);
    return res.status(202).json({ ok: true, jobId: job.id, status: job.status });
  } catch (error) {
    const status = error.code === "STORY_PROVIDER_NOT_CONFIGURED" ? 503 : 502;
    console.error("AHM story job start failed:", error.message);
    return res.status(status).json({ error: error.message || "Could not start story planning." });
  }
});

app.get("/api/story/plan/:jobId", async (req, res) => {
  try {
    const result = await getStoryGeneration(req.params.jobId);
    if (result.status !== "completed") return res.json({ ok: true, status: result.status });
    return res.json({
      ok: true,
      status: "completed",
      story: result.story,
      video: { status: "not_started", message: "Story planning is ready. Video generation is not connected yet." }
    });
  } catch (error) {
    console.error("AHM story job check failed:", error.message);
    return res.status(502).json({ error: error.message || "Could not check story generation." });
  }
});

app.use("/api", (_req, res) => {
  res.status(404).json({ error: "API route not found." });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () => console.log(`AHM Studio running on port ${port}`));
}

module.exports = app;
