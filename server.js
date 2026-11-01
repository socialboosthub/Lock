require("dotenv").config();

const express = require("express");
const path = require("path");
const { startStoryGeneration, getStoryGeneration, isStoryProviderConfigured } = require("./lib/providers/llm");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "AHM Studio",
    version: "9.0.0",
    storyProvider: isStoryProviderConfigured() ? "configured" : "not_configured",
    videoProvider: "not_configured"
  });
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
