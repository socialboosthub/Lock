(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const state = {
    scenes: [],
    storyBible: null,
    voiceUrl: null,
    musicUrl: null,
    voiceFile: null,
    musicFile: null,
    rendering: false,
    cancel: false,
    previewTimer: null,
    currentBlob: null,
    generatedStory: null,
    videoJobId: null
  };

  const canvas = $("previewCanvas");
  const ctx = canvas.getContext("2d");
  const DB_NAME = "ahm-studio-free-v81";
  const STORE = "videos";

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);

      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: "id" });
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(item) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbAll() {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, "readonly")
        .objectStore(STORE)
        .getAll();

      req.onsuccess = () => {
        resolve((req.result || []).sort(
          (a, b) => b.createdAt - a.createdAt
        ));
      };

      req.onerror = () => reject(req.error);
    });
  }

  async function dbDelete(id) {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  const escapeHtml = value =>
    String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[char]));

  const slugify = value =>
    String(value || "ahm-video")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 55) || "ahm-video";

  // Split only at sentence boundaries and keep closing quotation marks attached.
  // A dialogue exclamation followed by "she said" remains part of the same sentence.
  function splitSentences(text) {
    const source = String(text || "").replace(/\s+/g, " ").trim();
    if (!source) return [];
    const sentences = [];
    let start = 0;
    let curlyQuoteOpen = false;
    let straightQuoteOpen = false;
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (char === "“") curlyQuoteOpen = true;
      else if (char === "”") curlyQuoteOpen = false;
      else if (char === '"') straightQuoteOpen = !straightQuoteOpen;
      if (!/[.!?…]/.test(char)) continue;
      if (curlyQuoteOpen || straightQuoteOpen) continue;
      let end = i + 1;
      while (end < source.length && /["'”’»）)\]]/.test(source[end])) end++;
      const rest = source.slice(end);
      const next = rest.match(/^\s+([\p{L}])/u);
      const nextWord = next?.[1] || "";
      if (/[!?]/.test(char) && nextWord && /\p{Ll}/u.test(nextWord)) continue;
      if (end === source.length || /^\s/.test(source[end])) {
        const part = source.slice(start, end).trim();
        if (part) sentences.push(part);
        start = end;
        while (start < source.length && /\s/.test(source[start])) start++;
        i = start - 1;
      }
    }
    const tail = source.slice(start).trim();
    if (tail) sentences.push(tail);
    return sentences.length ? sentences : [source];
  }

  function estimateScenePlan(sentences) {
    const totalWords = sentences.join(" ").match(/\S+/g)?.length || 1;
    const durationSec = Math.max(30, Math.min(120, Math.round(totalWords / 2.35)));
    const weights = sentences.map(line => Math.max(1, line.match(/\S+/g)?.length || 1));
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    let cursor = 0;
    return sentences.map((line, index) => {
      const start = cursor;
      const end = index === sentences.length - 1
        ? durationSec
        : Math.max(start + 1, Math.round(start + durationSec * weights[index] / totalWeight));
      cursor = end;
      return { start, end, durationSec: end - start };
    });
  }

  function buildScenes() {
    const script = $("scriptInput").value.trim();
    if (!script) {
      alert("Bro, paste your story or narration first.");
      return;
    }
    const sentences = splitSentences(script);
    const requested = Math.max(1, Number($("sceneCount").value) || sentences.length);
    const sceneTotal = Math.min(requested, sentences.length);
    const chunks = Array.from({ length: sceneTotal }, () => []);
    sentences.forEach((sentence, index) => {
      const target = Math.min(sceneTotal - 1, Math.floor(index * sceneTotal / sentences.length));
      chunks[target].push(sentence);
    });
    const title = $("titleInput").value.trim() || "Untitled AHM Story";
    const narrations = chunks.map(lines => lines.join(" "));
    const timings = estimateScenePlan(narrations);
    state.scenes = narrations.map((narration, index) => ({
      id: index + 1,
      caption: narration,
      subtitlePhrases: splitSubtitlePhrasesForUI(narration),
      ...timings[index],
      action: narration,
      camera: ["Wide establishing shot","Medium tracking shot","Close-up reaction shot","Over-the-shoulder shot","Low-angle dramatic shot","Emotional close-up"][index % 6],
      visualPrompt: visualPrompt(title, narration, index),
      imageFile: null,
      imageUrl: null,
      image: null
    }));
    renderSceneCards();
    drawScene(0, 0);
    $("previewTitle").textContent = title;
    $("previewCaption").textContent = `${state.scenes.length} scenes ready · ${timings[timings.length - 1].end}s estimated. Add your images.`;
  }

  function splitSubtitlePhrasesForUI(text) {
    const words = String(text || "").trim().match(/\S+/g) || [];
    const phrases = [];
    let line = [];
    words.forEach(word => {
      line.push(word);
      if (line.length >= 5 || (/[.!?…]["'”’)]?$/.test(word) && line.length >= 2)) {
        phrases.push(line.join(" "));
        line = [];
      }
    });
    if (line.length) phrases.push(line.join(" "));
    return phrases;
  }

  function visualPrompt(title, narration, index) {
    const style = $("visualStyle").value || "Stylized 3D cinematic";
    const text = String(narration || "").trim();
    const lower = text.toLowerCase();
    const setting = /lake|water|river|sea|shore/.test(lower) ? "dark moonlit lakeshore, rippling water and mist" :
      /home|door|mother|house|room/.test(lower) ? "warm modest family home, doorway and intimate interior" :
      /forest|tree|woods/.test(lower) ? "dense atmospheric forest with layered trees" :
      /street|road|ran|run/.test(lower) ? "cinematic village street with deep perspective" :
      "story-specific environment grounded in the action, with clear foreground and background";
    const mood = /scream|dragged|monster|danger|fear|shadow/.test(lower) ? "tense, mysterious, high-stakes atmosphere" :
      /hug|mother|love|home|whisper|recognized/.test(lower) ? "warm emotional atmosphere, relief and tenderness" :
      /gold|magic|glow|spark/.test(lower) ? "magical atmosphere with controlled luminous highlights" :
      "expressive dramatic atmosphere";
    const action = text.replace(/["“”]/g, "'").slice(0, 420);
    const shot = ["wide shot showing geography and action","medium shot focused on the main action","tight facial close-up capturing emotion","over-the-shoulder composition revealing the subject","low-angle dynamic composition"][index % 5];
    return `${style}, vertical 9:16 animated feature-film frame for "${title}". VISUAL MOMENT: faithfully depict this exact action: ${action}. SETTING: ${setting}. COMPOSITION: ${shot}, clear subject separation, readable silhouettes, foreground-midground-background depth. PERFORMANCE: expressive face, believable body language, emotionally clear gesture matching the moment. LIGHTING & MOOD: ${mood}, cinematic motivated lighting, rich but coherent color palette, detailed materials, depth of field. CONTINUITY: preserve the same character designs, clothing, proportions and environment across every scene; do not add unmentioned characters or props. No text, letters, subtitles, logos or watermark.`;
  }

  function renderSceneCards() {
    const host = $("scenes");

    if (!state.scenes.length) {
      host.className = "scenesEmpty";
      host.textContent = "Build a scene plan to begin.";
      return;
    }

    host.className = "";

    host.innerHTML = state.scenes.map(scene => `
      <article class="sceneCard">
        <img
          class="sceneThumb"
          id="thumb-${scene.id}"
          alt="Scene ${scene.id} visual"
        >

        <div>
          <h3>SCENE ${String(scene.id).padStart(2, "0")}</h3>

          <label for="caption-${scene.id}">
            Subtitle for this scene
          </label>

          <textarea
            id="caption-${scene.id}"
            data-caption="${scene.id}"
          >${escapeHtml(scene.caption)}</textarea>

          <div class="sceneMeta"><span>⏱ ${Number.isFinite(Number(scene.start)) && Number.isFinite(Number(scene.end)) ? Number(scene.start).toFixed(1) + "–" + Number(scene.end).toFixed(1) + "s · " + (Number(scene.end) - Number(scene.start)).toFixed(1) + "s" : "Timing estimate unavailable"}</span><span>🎥 ${escapeHtml(scene.camera || "Director camera plan")}</span></div>
          ${scene.subtitlePhrases?.length ? '<div class="subtitlePhrases"><strong>SUBTITLE BEATS · ESTIMATED</strong><div>' + scene.subtitlePhrases.map(phrase => '<span>' + escapeHtml(phrase) + '</span>').join('') + '</div></div>' : ''}
          <p class="sceneAction">${escapeHtml(scene.action || "")}</p>
          <div class="prompt">
            <strong>DIRECTOR VISUAL PROMPT:</strong>
            ${escapeHtml(scene.visualPrompt)}
          </div>

          <div class="sceneActions">
            <label for="image-${scene.id}">Upload AI image</label>

            <input
              id="image-${scene.id}"
              data-image="${scene.id}"
              type="file"
              accept="image/*"
            >

            <button
              type="button"
              class="secondary copyPrompt"
              data-copy="${scene.id}"
            >Copy image prompt</button>

            <span class="hint" id="imageStatus-${scene.id}">
              No image yet
            </span>
          </div>
        </div>
      </article>
    `).join("");

    state.scenes.forEach(scene => {
      $("thumb-" + scene.id).src = makeFallbackData(scene.id);
    });

    host.querySelectorAll("[data-caption]").forEach(element => {
      element.addEventListener("input", () => {
        const scene = state.scenes.find(
          item => item.id === Number(element.dataset.caption)
        );

        if (scene) scene.caption = element.value;
        drawScene(0, 0);
      });
    });

    host.querySelectorAll("[data-image]").forEach(element => {
      element.addEventListener("change", async () => {
        const scene = state.scenes.find(
          item => item.id === Number(element.dataset.image)
        );

        const file = element.files?.[0];

        if (!scene || !file) return;

        if (!file.type.startsWith("image/")) {
          alert("Please choose an image file.");
          return;
        }

        if (scene.imageUrl) URL.revokeObjectURL(scene.imageUrl);

        scene.imageFile = file;
        scene.imageUrl = URL.createObjectURL(file);
        scene.image = await loadImage(scene.imageUrl);

        $("thumb-" + scene.id).src = scene.imageUrl;
        $("imageStatus-" + scene.id).textContent = file.name;

        drawScene(scene.id - 1, 0);
      });
    });

    host.querySelectorAll("[data-copy]").forEach(button => {
      button.addEventListener("click", async () => {
        const scene = state.scenes.find(
          item => item.id === Number(button.dataset.copy)
        );

        if (!scene) return;

        try {
          await navigator.clipboard.writeText(scene.visualPrompt);
          button.textContent = "Copied!";
          setTimeout(() => {
            button.textContent = "Copy image prompt";
          }, 1200);
        } catch {
          prompt("Copy this image prompt:", scene.visualPrompt);
        }
      });
    });
  }

  function makeFallbackData(number) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg"
        width="576" height="1024">
        <defs>
          <linearGradient id="g" x2=".9" y2="1">
            <stop stop-color="#132a43"/>
            <stop offset=".48" stop-color="#7c624d"/>
            <stop offset="1" stop-color="#12131b"/>
          </linearGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#g)"/>
        <circle cx="420" cy="240" r="180" fill="#e4bf68" opacity=".5"/>
        <path d="M0 630 Q180 540 320 650 T576 610 V1024 H0Z"
          fill="#111c29"/>
        <circle cx="288" cy="455" r="95" fill="#c98d5b"/>
        <path d="M170 420 Q180 300 290 325 Q410 310 410 430
          L380 390 Q300 430 210 390Z" fill="#241d1b"/>
        <path d="M135 810 Q145 575 288 575 Q430 575 445 810Z"
          fill="#253c51"/>
        <text x="288" y="925" font-size="30" fill="#fff"
          text-anchor="middle" font-family="sans-serif">
          SCENE ${number}
        </text>
      </svg>`;

    return "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(svg);
  }

  function loadImage(src) {
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
  }

  function drawScene(index, progress = 0, subtitleOverride = null) {
    const width = canvas.width;
    const height = canvas.height;
    const scene = state.scenes[index];

    const background = ctx.createLinearGradient(0, 0, width, height);
    background.addColorStop(0, "#10243a");
    background.addColorStop(0.55, "#7b5d4b");
    background.addColorStop(1, "#11131c");

    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    if (!scene) return;

    if (scene.image) {
      const image = scene.image;
      const scale = Math.max(
        width / image.width,
        height / image.height
      ) * (1.02 + progress * 0.12);

      const imageWidth = image.width * scale;
      const imageHeight = image.height * scale;
      const drift = (progress - 0.5) * width * 0.055;

      ctx.drawImage(
        image,
        (width - imageWidth) / 2 + drift,
        (height - imageHeight) / 2,
        imageWidth,
        imageHeight
      );
    } else {
      ctx.fillStyle = "#0c1724";
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = "#b68c5c";
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(width * 0.74, height * 0.28, width * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = "#172638";
      ctx.beginPath();
      ctx.moveTo(0, height * 0.61);
      ctx.lineTo(width * 0.3, height * 0.42);
      ctx.lineTo(width * 0.6, height * 0.65);
      ctx.lineTo(width, height * 0.47);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.fill();

      ctx.fillStyle = "#d9b078";
      ctx.beginPath();
      ctx.arc(width * 0.5, height * 0.42, width * 0.11, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#263b50";
      ctx.fillRect(width * 0.36, height * 0.53, width * 0.28, height * 0.24);

      ctx.font = "bold 18px system-ui";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText("ADD AI IMAGE", width / 2, height * 0.82);
    }

    const shade = ctx.createLinearGradient(0, height * 0.55, 0, height);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,.88)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, height);

    const title = $("titleInput").value.trim();

    ctx.textAlign = "left";
    ctx.font = "700 14px system-ui";
    ctx.fillStyle = "#e4bf68";
    ctx.fillText("AHM STUDIO", 24, 38);

    ctx.fillStyle = "#fff";
    ctx.globalAlpha = 0.9;
    ctx.font = "600 12px system-ui";
    ctx.fillText(title.slice(0, 38), 24, 58);
    ctx.globalAlpha = 1;

    const subtitle = subtitleOverride === null
      ? scene.caption
      : subtitleOverride;

    drawSubtitle(getSubtitlePhrase(subtitle, progress), width, height);

    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.fillRect(
      24,
      height - 22,
      (width - 48) * ((index + progress) / Math.max(1, state.scenes.length)),
      3
    );
  }

  // Break narration into short, readable caption beats like fast-paced short-form videos.
  function getSubtitlePhrase(text, progress = 0) {
    const words = String(text || "").trim().match(/\S+/g) || [];
    if (!words.length) return "";
    const phrases = [];
    let current = [];

    for (const word of words) {
      current.push(word);
      const endsThought = /[.!?…][”"'’)]?$/.test(word);
      if (current.length >= 4 || (endsThought && current.length >= 2)) {
        phrases.push(current.join(" "));
        current = [];
      }
    }
    if (current.length) phrases.push(current.join(" "));
    if (phrases.length <= 1) return phrases[0] || "";

    const totalWords = words.length;
    const target = Math.min(0.999, Math.max(0, Number(progress) || 0)) * totalWords;
    let elapsed = 0;
    for (const phrase of phrases) {
      const count = phrase.match(/\S+/g)?.length || 1;
      if (target < elapsed + count) return phrase;
      elapsed += count;
    }
    return phrases[phrases.length - 1];
  }

  function drawSubtitle(text, width, height) {
    const size = $("subtitleSize").value;
    const font = size === "small" ? 24 : size === "large" ? 38 : 32;
    const maxWidth = width - 58;

    ctx.save();
    ctx.font = `900 ${font}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";

    // Keep each timed phrase compact; wrap only when a phrase is unusually long.
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? line + " " + word : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);

    const lineHeight = font * 1.16;
    const centerY = height * 0.795;
    const firstY = centerY - ((lines.length - 1) * lineHeight) / 2;

    ctx.shadowColor = "rgba(0,0,0,.9)";
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    ctx.lineWidth = Math.max(5, font * 0.17);
    ctx.strokeStyle = "#050505";
    ctx.fillStyle = "#ffffff";

    lines.forEach((captionLine, index) => {
      const y = firstY + index * lineHeight;
      ctx.strokeText(captionLine, width / 2, y, maxWidth);
      ctx.fillText(captionLine, width / 2, y, maxWidth);
    });
    ctx.restore();
  }

  function roundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.arcTo(x + width, y, x + width, y + height, radius);
    context.arcTo(x + width, y + height, x, y + height, radius);
    context.arcTo(x, y + height, x, y, radius);
    context.arcTo(x, y, x + width, y, radius);
    context.closePath();
  }

  function updateProgress(progress, label) {
    $("progressBar").style.width = Math.round(progress * 100) + "%";
    $("progressText").textContent = Math.round(progress * 100) + "%";
    $("renderStatus").textContent = label;
  }

  function previewMotion() {
    if (!state.scenes.length) {
      alert("Build the scene plan first.");
      return;
    }

    if (state.previewTimer) clearInterval(state.previewTimer);

    let tick = 0;
    const total = state.scenes.length * 180;

    $("previewBtn").textContent = "Previewing…";

    state.previewTimer = setInterval(() => {
      tick = (tick + 1) % total;

      const position = tick / 180;
      const index = Math.min(
        state.scenes.length - 1,
        Math.floor(position)
      );

      drawScene(index, position - index);

      if (tick === 0) {
        clearInterval(state.previewTimer);
        state.previewTimer = null;
        $("previewBtn").textContent = "Preview motion";
      }
    }, 33);
  }

  function setAudioFiles() {
    const voice = $("voiceFile").files?.[0] || null;
    const music = $("musicFile").files?.[0] || null;

    state.voiceFile = voice;
    state.musicFile = music;

    if (state.voiceUrl) URL.revokeObjectURL(state.voiceUrl);
    if (state.musicUrl) URL.revokeObjectURL(state.musicUrl);

    state.voiceUrl = voice ? URL.createObjectURL(voice) : null;
    state.musicUrl = music ? URL.createObjectURL(music) : null;

    $("voiceName").textContent = voice ? voice.name : "No narration uploaded";
    $("musicName").textContent = music ? music.name : "No music uploaded";
  }

  $("voiceFile").addEventListener("change", setAudioFiles);
  $("musicFile").addEventListener("change", setAudioFiles);

  $("musicVolume").addEventListener("input", () => {
    $("musicVolumeValue").textContent = $("musicVolume").value + "%";
  });


  function buildContinuityPrompt(scene, story) {
    const cast = (story.characters || [])
      .filter(character => !(scene.characters || []).length || scene.characters.includes(character.id))
      .map(character => character.name + ": " + character.description).join("\n");
    const props = (story.props || [])
      .filter(prop => !(scene.props || []).length || scene.props.includes(prop.id))
      .map(prop => prop.name + ": " + prop.description).join("\n");
    const places = (story.environments || [])
      .filter(place => !scene.environment || place.id === scene.environment)
      .map(place => place.name + ": " + place.description).join("\n");
    return [scene.visualPrompt || scene.action || "", scene.emotion && "EMOTION / PERFORMANCE:\n" + scene.emotion, cast && "LOCKED CHARACTER DESIGNS (do not alter):\n" + cast,
      places && "LOCKED ENVIRONMENT:\n" + places, props && "LOCKED PROPS / CONTINUITY:\n" + props,
      "SHOT: " + (scene.camera || scene.shot || "cinematic motivated camera"), "ACTION: " + (scene.action || ""), scene.transition && "TRANSITION: " + scene.transition, scene.sound && "SOUND DESIGN: " + scene.sound,
      "Vertical 9:16 stylized 3D animation, maintain exact continuity. No text, captions, logos or watermark."]
      .filter(Boolean).join("\n\n");
  }

  function renderDirectorBible(story) {
    const items = [
      ["CAST & CHARACTER LOCK", story.characters || []],
      ["WORLD & LOCATIONS", story.environments || []],
      ["IMPORTANT PROPS & PROP CONTINUITY", story.props || []]
    ];
    let panel = document.getElementById("directorBible");
    if (panel) panel.remove();
    panel = document.createElement("section");
    panel.id = "directorBible";
    panel.className = "directorBible";
    panel.innerHTML = '<div class="bibleHeading"><strong>AHM DIRECTOR BIBLE</strong><span>Continuity locked</span></div>' +
      items.map(([heading, values]) => '<div class="bibleGroup"><h3>' + heading + '</h3>' +
        (values.length ? values.map(item => '<p><b>' + escapeHtml(item.name || "Unnamed") + '</b> ' +
          escapeHtml(item.description || "") +
          (item.voice ? '<br><b>Voice:</b> ' + escapeHtml(item.voice) : "") +
          (item.arc ? '<br><b>Arc:</b> ' + escapeHtml(item.arc) : "") + '</p>').join("") : '<p>None specified</p>') + '</div>').join("") +
      (story.storyArc ? '<div class="bibleGroup"><h3>STORY ENGINE · SETUP → PAYOFF</h3>' +
        ['goal','stakes','turningPoint','payoff'].map(key => story.storyArc[key] ?
          '<p><b>' + ({goal:'Goal',stakes:'Stakes',turningPoint:'Turning point',payoff:'Payoff'}[key]) +
          ':</b> ' + escapeHtml(story.storyArc[key]) + '</p>' : '').join("") + '</div>' : '') +
      (story.continuityNotes?.length ? '<div class="bibleGroup"><h3>CONTINUITY CHECKLIST</h3>' +
        story.continuityNotes.map(note => '<p>• ' + escapeHtml(note) + '</p>').join("") + '</div>' : '');
    const summary = document.getElementById("aiStorySummary");
    if (summary) summary.insertAdjacentElement("afterend", panel);
  }

  async function generateAiStory() {
    const idea = $("scriptInput").value.trim();
    const status = $("aiStoryStatus");
    const button = $("aiStoryBtn");
    if (!idea) {
      alert("Enter a topic, question, idea or script first.");
      return;
    }
    button.disabled = true;
    status.textContent = "Starting AHM Director…";
    try {
      const startResponse = await fetch("/api/explainer/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: idea, targetDuration: "natural, usually 30 to 60 seconds, maximum 120 seconds" })
      });
      const started = await startResponse.json();
      if (!startResponse.ok || !started.ok) {
        throw new Error(started.error || "Could not generate the explainer plan.");
      }

      // Explainer planning now uses a direct model response, not a background
      // interaction that can fail asynchronously after appearing to start.
      const story = started.story;
      if (!story || !Array.isArray(story.scenes) || !story.scenes.length) {
        throw new Error("AHM received an incomplete explainer plan. Please try again.");
      }

      state.generatedStory = story;
      state.videoJobId = null;
      $("renderBtn").disabled = false;
      $("renderBtn").textContent = "Generate complete cinematic video";
      $("titleInput").value = story.title || "AHM Explainer";
      $("scriptInput").value = story.narration || idea;
      state.storyBible = { characters: story.characters || [], environments: story.environments || [], props: story.props || [], beats: story.beats || [], continuityNotes: story.continuityNotes || [], storyArc: story.storyArc || null, titleFit: story.titleFit || null };
      const sceneCount = (story.scenes || []).length;
      const countSelect = $("sceneCount");
      if (sceneCount && !Array.from(countSelect.options).some(option => Number(option.value) === sceneCount)) {
        const option = document.createElement("option");
        option.value = String(sceneCount);
        option.textContent = String(sceneCount);
        countSelect.appendChild(option);
      }
      if (sceneCount) countSelect.value = String(sceneCount);
      state.scenes = (story.scenes || []).map((scene, index) => ({
        id: index + 1,
        caption: scene.narration || scene.action || "",
        subtitlePhrases: scene.subtitlePhrases || [],
        visualPrompt: buildContinuityPrompt(scene, story),
        imageFile: null, imageUrl: null, image: null,
        start: scene.start, end: scene.end, durationSec: scene.durationSec,
        emotion: scene.emotion || "", dialogue: scene.dialogue || [],
        camera: scene.camera || "", action: scene.action || "", transition: scene.transition || "", sound: scene.sound || "", characters: scene.characters || [], environment: scene.environment || "", props: scene.props || []
      }));
      renderSceneCards();
      drawScene(0, 0);
      $("previewTitle").textContent = story.title || "Your AHM explainer";
      $("previewCaption").textContent = `${state.scenes.length} AI-directed scenes · ${story.durationSec}s planned`;
      status.textContent = `Explainer plan ready: ${state.scenes.length} scenes · ${story.durationSec} seconds estimated. Subtitle timing is provisional until narration audio is generated. No video has been created.`;

      const intro = document.createElement("div");
      intro.className = "aiStorySummary";
      intro.innerHTML = `<strong>AI Director · ${escapeHtml(story.title || "Untitled")}</strong><p>${escapeHtml(story.hook || "")}</p><p>${escapeHtml(story.kicker || "")}</p>${story.titleFit?.matchesStory === false ? '<p class="directorWarning"><b>Title check:</b> ' + escapeHtml(story.titleFit.reason || "The title may not match the story. Review it before continuing.") + '</p>' : ''}<p class="directorTimingNote">Scene timings and subtitle beats are estimates for planning only. Once narration is added, final subtitle timing must follow the actual audio.</p>`;
      const existing = document.getElementById("aiStorySummary");
      if (existing) existing.remove();
      intro.id = "aiStorySummary";
      status.insertAdjacentElement("afterend", intro);
      renderDirectorBible(story);
    } catch (error) {
      status.textContent = error.message || "Could not generate the explainer plan.";
    } finally {
      button.disabled = false;
    }
  }

  $("aiStoryBtn").addEventListener("click", generateAiStory);
  $("sceneBtn").addEventListener("click", buildScenes);
  $("previewBtn").addEventListener("click", previewMotion);

  $("sceneCount").addEventListener("change", () => {
    if (state.scenes.length) buildScenes();
  });

  $("visualStyle").addEventListener("change", () => {
    if (state.scenes.length) buildScenes();
  });

  $("cancelBtn").addEventListener("click", () => {
    state.cancel = true;
    $("renderStatus").textContent = "CANCELLING…";
  });

  async function renderVideo() {
    if (state.rendering) return;

    if (!state.scenes.length) {
      alert("Build your scene plan first.");
      return;
    }

    if (!window.MediaRecorder || !canvas.captureStream) {
      alert("Your browser cannot record canvas video. Try an updated Chrome browser.");
      return;
    }

    if (!state.scenes.some(scene => scene.image)) {
      const proceed = confirm(
        "You have not uploaded any AI images. The video will use basic placeholder scenes. Continue?"
      );

      if (!proceed) return;
    }

    state.rendering = true;
    state.cancel = false;

    $("renderBtn").disabled = true;
    $("cancelBtn").disabled = false;
    $("downloadArea").classList.add("hidden");

    updateProgress(0, "PREPARING");

    let audioContext = null;
    let voiceElement = null;
    let musicElement = null;
    let recorder = null;
    let animationFrame = 0;
    let stream = null;

    try {
      const fps = Number($("fpsSelect").value) || 30;
      let audioDuration = 0;

      if (state.voiceUrl) {
        voiceElement = new Audio(state.voiceUrl);
        voiceElement.preload = "auto";
        await waitMetadata(voiceElement);
        audioDuration = voiceElement.duration || 0;
      }

      if (state.musicUrl) {
        musicElement = new Audio(state.musicUrl);
        musicElement.loop = true;
        musicElement.preload = "auto";
        await waitMetadata(musicElement);
      }

      const targetDuration = Math.max(
        audioDuration,
        state.scenes.length * 4,
        12
      );

      if (targetDuration > 120) {
        throw new Error(
          "The video would exceed 2 minutes. Use a shorter narration."
        );
      }

      const sceneDuration = targetDuration / state.scenes.length;

      const AudioContextClass =
        window.AudioContext || window.webkitAudioContext;

      if (!AudioContextClass) {
        throw new Error("Audio mixing is not supported in this browser.");
      }

      audioContext = new AudioContextClass();
      await audioContext.resume();

      const destination = audioContext.createMediaStreamDestination();

      if (voiceElement) {
        const source = audioContext.createMediaElementSource(voiceElement);
        source.connect(destination);
        source.connect(audioContext.destination);
      }

      if (musicElement) {
        const source = audioContext.createMediaElementSource(musicElement);
        const gain = audioContext.createGain();

        gain.gain.value = Number($("musicVolume").value) / 100;

        source.connect(gain);
        gain.connect(destination);
        gain.connect(audioContext.destination);
      }

      stream = canvas.captureStream(fps);

      destination.stream.getAudioTracks().forEach(track => {
        stream.addTrack(track);
      });

      const supportedTypes = [
        "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
        "video/mp4",
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm"
      ];

      const mimeType = supportedTypes.find(type =>
        MediaRecorder.isTypeSupported(type)
      ) || "";

      recorder = new MediaRecorder(
        stream,
        mimeType
          ? { mimeType, videoBitsPerSecond: 2500000 }
          : undefined
      );

      const chunks = [];

      recorder.ondataavailable = event => {
        if (event.data && event.data.size) chunks.push(event.data);
      };

      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = event => {
          reject(event.error || new Error("Video recording failed."));
        };
      });

      recorder.start(1000);

      const started = performance.now();
      const totalMilliseconds = targetDuration * 1000;
      let lastScene = -1;

      if (voiceElement) {
        voiceElement.currentTime = 0;
        await voiceElement.play().catch(() => {});
      }

      if (musicElement) {
        musicElement.currentTime = 0;
        await musicElement.play().catch(() => {});
      }

      const tick = now => {
        const elapsed = now - started;

        if (state.cancel || elapsed >= totalMilliseconds) {
          if (recorder && recorder.state !== "inactive") recorder.stop();
          if (voiceElement) voiceElement.pause();
          if (musicElement) musicElement.pause();
          return;
        }

        const index = Math.min(
          state.scenes.length - 1,
          Math.floor(elapsed / (sceneDuration * 1000))
        );

        const withinScene =
          (elapsed % (sceneDuration * 1000)) /
          (sceneDuration * 1000);

        if (index !== lastScene) {
          lastScene = index;
          $("previewCaption").textContent =
            `Scene ${index + 1} of ${state.scenes.length}`;
        }

        drawScene(index, withinScene);
        updateProgress(elapsed / totalMilliseconds, "RENDERING");

        animationFrame = requestAnimationFrame(tick);
      };

      animationFrame = requestAnimationFrame(tick);

      await stopped;

      cancelAnimationFrame(animationFrame);

      if (state.cancel) {
        updateProgress(0, "CANCELLED");
        return;
      }

      const actualMime = recorder.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunks, { type: actualMime });

      if (!blob.size) {
        throw new Error("The browser produced an empty video.");
      }

      state.currentBlob = blob;

      const extension = actualMime.includes("mp4") ? "mp4" : "webm";
      const title = $("titleInput").value.trim() || "AHM Story";

      const item = {
        id: "v_" + Date.now(),
        title,
        createdAt: Date.now(),
        durationSec: Math.round(targetDuration),
        type: actualMime,
        ext: extension,
        blob,
        size: blob.size,
        sceneCount: state.scenes.length
      };

      await dbPut(item);
      showDownload(item);
      await loadHistory();

      updateProgress(1, "VIDEO READY");

      $("previewCaption").textContent =
        `Rendered ${state.scenes.length} scenes · ${Math.round(targetDuration)} seconds`;

    } catch (error) {
      console.error(error);

      alert(
        "Rendering failed: " + (error.message || error) +
        "\n\nTry fewer scenes, smaller images and shorter narration."
      );

      updateProgress(0, "RENDER FAILED");

    } finally {
      if (animationFrame) cancelAnimationFrame(animationFrame);

      if (audioContext && audioContext.state !== "closed") {
        await audioContext.close().catch(() => {});
      }

      if (stream) stream.getTracks().forEach(track => track.stop());

      state.rendering = false;
      $("renderBtn").disabled = false;
      $("cancelBtn").disabled = true;
    }
  }

  function waitMetadata(element) {
    return new Promise((resolve, reject) => {
      if (element.readyState >= 1) return resolve();

      const timeout = setTimeout(() => {
        reject(new Error("Audio file took too long to load."));
      }, 12000);

      element.onloadedmetadata = () => {
        clearTimeout(timeout);
        resolve();
      };

      element.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Could not read the uploaded audio file."));
      };
    });
  }

  function showDownload(item) {
    const url = URL.createObjectURL(item.blob);
    const area = $("downloadArea");

    area.classList.remove("hidden");

    area.innerHTML = `
      <strong>Your video is ready!</strong>
      <p>
        ${escapeHtml(item.title)} ·
        ${item.durationSec}s ·
        ${(item.size / 1024 / 1024).toFixed(1)} MB ·
        ${item.ext.toUpperCase()}
      </p>

      <a href="${url}" download="${slugify(item.title)}.${item.ext}">
        Download ${item.ext.toUpperCase()}
      </a>

      <p class="smallNote">
        If your browser exports WebM instead of MP4, you can convert the file
        using a video editor that supports WebM.
      </p>
    `;
  }

  async function generateFullVideo() {
    const story = state.generatedStory;
    if (!story || !story.scenes?.length) {
      alert("Create an AI Director plan first.");
      return;
    }
    const button = $("renderBtn");
    const status = $("renderStatus");
    const download = $("downloadArea");
    button.disabled = true;
    $("cancelBtn").disabled = true;
    download.classList.add("hidden");
    state.videoJobId = null;
    updateProgress(0, "STARTING AI VIDEO");

    try {
      const response = await fetch("/api/explainer/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ story })
      });
      const started = await response.json();
      if (!response.ok || !started.ok || !started.jobId) {
        throw new Error(started.error || "AHM could not start the video production job.");
      }

      state.videoJobId = started.jobId;
      status.textContent = "Video production started. Generating cinematic scenes, narration, sound and subtitles…";
      $("previewCaption").textContent = "AHM is rendering your complete video in the production worker.";
      const deadline = Date.now() + 30 * 60 * 1000;

      while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 7000));
        const check = await fetch("/api/explainer/video/" + encodeURIComponent(state.videoJobId));
        const result = await check.json();
        if (!check.ok || !result.ok) {
          throw new Error(result.error || "Could not read the video production status.");
        }
        if (result.status === "completed" && result.video?.finalVideoUrl) {
          const url = new URL(result.video.finalVideoUrl);
          if (url.protocol !== "https:") throw new Error("The video provider returned an unsafe download URL.");
          const player = document.createElement("video");
          player.controls = true;
          player.playsInline = true;
          player.preload = "metadata";
          player.src = url.href;
          player.style.width = "100%";
          player.style.maxWidth = "420px";
          player.style.borderRadius = "16px";
          const link = document.createElement("a");
          link.href = url.href;
          link.target = "_blank";
          link.rel = "noopener";
          link.textContent = "Open / download your finished MP4";
          link.className = "downloadLink";
          const title = document.createElement("strong");
          title.textContent = story.title + " · Finished video";
          download.replaceChildren(title, player, link);
          download.classList.remove("hidden");
          updateProgress(1, "VIDEO READY");
          status.textContent = "Complete MP4 ready · " + (result.video.sceneCount || story.scenes.length) + " generated scenes · narration and subtitles included.";
          $("previewCaption").textContent = "Your finished cinematic explainer is ready to watch and download.";
          return;
        }
        if (result.status === "failed") {
          throw new Error(result.error || "The video production worker failed.");
        }
        const label = String(result.status || "processing").replace(/_/g, " ").toUpperCase();
        status.textContent = "AHM production: " + label + ". Please keep this page open.";
        updateProgress(0.15, label);
      }
      throw new Error("Video production is taking longer than 30 minutes. Your job may still be running; check again later.");
    } catch (error) {
      status.textContent = error.message || "Complete video generation failed.";
      updateProgress(0, "VIDEO GENERATION FAILED");
    } finally {
      button.disabled = false;
      button.textContent = "Generate complete cinematic video";
    }
  }

  $("renderBtn").addEventListener("click", () => {
    if (state.generatedStory) generateFullVideo();
    else renderVideo();
  });

  async function loadHistory() {
    const host = $("historyList");

    try {
      const items = await dbAll();

      if (!items.length) {
        host.className = "historyEmpty";
        host.textContent = "Your rendered videos will appear here.";
        return;
      }

      host.className = "";

      host.innerHTML = items.map(item => `
        <div class="historyItem">
          <div class="meta">
            <strong>${escapeHtml(item.title)}</strong>
            <small>
              ${new Date(item.createdAt).toLocaleString()} ·
              ${item.durationSec}s ·
              ${item.ext.toUpperCase()} ·
              ${(item.size / 1024 / 1024).toFixed(1)} MB
            </small>
          </div>

          <button class="secondary" data-download="${item.id}">
            DOWNLOAD
          </button>

          <button class="secondary" data-delete="${item.id}">
            DELETE
          </button>
        </div>
      `).join("");

      host.querySelectorAll("[data-download]").forEach(button => {
        button.addEventListener("click", async () => {
          const items = await dbAll();
          const item = items.find(
            entry => entry.id === button.dataset.download
          );

          if (!item) return;

          const url = URL.createObjectURL(item.blob);
          const anchor = document.createElement("a");

          anchor.href = url;
          anchor.download = slugify(item.title) + "." + item.ext;
          document.body.appendChild(anchor);
          anchor.click();
          anchor.remove();

          setTimeout(() => URL.revokeObjectURL(url), 3000);
        });
      });

      host.querySelectorAll("[data-delete]").forEach(button => {
        button.addEventListener("click", async () => {
          await dbDelete(button.dataset.delete);
          await loadHistory();
        });
      });

    } catch {
      host.className = "historyEmpty";
      host.textContent =
        "History storage is unavailable. Download your videos after rendering.";
    }
  }

  $("clearHistoryBtn").addEventListener("click", async () => {
    if (!confirm("Delete all videos saved in this browser? This cannot be undone.")) {
      return;
    }

    try {
      const items = await dbAll();

      for (const item of items) {
        await dbDelete(item.id);
      }

      await loadHistory();
    } catch (error) {
      alert("Could not clear history: " + error.message);
    }
  });

  function buildCanvasWelcome() {
    ctx.fillStyle = "#0e1724";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const gradient = ctx.createRadialGradient(
      220, 180, 20,
      180, 240, 460
    );

    gradient.addColorStop(0, "#876b48");
    gradient.addColorStop(0.4, "#27435b");
    gradient.addColorStop(1, "#0e1119");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.font = "900 26px system-ui";
    ctx.fillText("AHM STUDIO", canvas.width / 2, canvas.height * 0.45);

    ctx.font = "600 15px system-ui";
    ctx.fillStyle = "#bfc8d8";
    ctx.fillText(
      "YOUR STORY. YOUR CINEMA.",
      canvas.width / 2,
      canvas.height * 0.5
    );

    ctx.fillStyle = "#e4bf68";
    ctx.fillRect(55, canvas.height * 0.57, canvas.width - 110, 3);
  }

  buildCanvasWelcome();
  loadHistory();
})();
