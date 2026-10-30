require("dotenv").config();

const express = require("express");
const path = require("path");
const { generateStoryPackage, isStoryProviderConfigured } = require("./lib/providers/llm");

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
      ? req.body.targetDuration.slice(0, 40)
      : "natural";

    if (idea.length > 6000) {
      return res.status(400).json({ error: "Please keep your story idea under 6,000 characters." });
    }

    const story = await generateStoryPackage(idea, targetDuration);
    return res.json({
      ok: true,
      story,
      video: { status: "not_started", message: "Story planning is ready. A real video-generation provider is not connected yet." }
    });
  } catch (error) {
    const notConfigured = error.code === "STORY_PROVIDER_NOT_CONFIGURED";
    const message = notConfigured
      ? error.message
      : (error.message || "Story planning failed. Please try again.");
    return res.status(notConfigured ? 503 : 502).json({ error: message });
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
