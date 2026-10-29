require("dotenv").config();

const express = require("express");
const path = require("path");

const app = express();

app.disable("x-powered-by");

app.use(
  express.static(path.join(__dirname, "public"), {
    maxAge: "1h"
  })
);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    app: "AHM Studio Free Editor",
    version: "8.1.0",
    mode: "browser-only"
  });
});

app.use("/api", (_req, res) => {
  res.status(404).json({
    error: "This free editor does not use paid generation APIs."
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);

  app.listen(port, "0.0.0.0", () => {
    console.log(`AHM Studio running on port ${port}`);
  });
}

module.exports = app;
