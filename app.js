(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const state = {
    scenes: [],
    voiceUrl: null,
    musicUrl: null,
    voiceFile: null,
    musicFile: null,
    rendering: false,
    cancel: false,
    previewTimer: null,
    currentBlob: null
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

  function splitSentences(text) {
    return text
      .replace(/\s+/g, " ")
      .trim()
      .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
      ?.map(sentence => sentence.trim())
      .filter(Boolean) || [];
  }

  function buildScenes() {
    const script = $("scriptInput").value.trim();

    if (!script) {
      alert("Bro, paste your story or narration first.");
      return;
    }

    const count = Number($("sceneCount").value);
    const sentences = splitSentences(script);

    const chunks = Array.from(
      { length: Math.min(count, Math.max(1, sentences.length)) },
      () => []
    );

    sentences.forEach((sentence, index) => {
      const target = Math.min(
        chunks.length - 1,
        Math.floor(index * chunks.length / sentences.length)
      );

      chunks[target].push(sentence);
    });

    const title = $("titleInput").value.trim() || "Untitled AHM Story";

    state.scenes = chunks.map((lines, index) => {
      const narration = lines.join(" ");

      return {
        id: index + 1,
        caption: narration,
        visualPrompt: visualPrompt(title, narration, index),
        imageFile: null,
        imageUrl: null,
        image: null
      };
    });

    renderSceneCards();
    drawScene(0, 0);

    $("previewTitle").textContent = title;
    $("previewCaption").textContent =
      `${state.scenes.length} scenes ready. Add your images.`;
  }

  function visualPrompt(title, narration, index) {
    const style = $("visualStyle").value;

    return `${style}, vertical 9:16 cinematic film still for the story "${title}". Scene ${index + 1}: ${narration}. Expressive characters, consistent character appearance, dramatic lighting, detailed environment, cinematic depth of field, rich color grading, strong composition, dynamic camera angle. No words, no letters, no subtitles, no watermark.`;
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

          <div class="prompt">
            <strong>IMAGE PROMPT:</strong>
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

    drawSubtitle(subtitle, width, height);

    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.fillRect(
      24,
      height - 22,
      (width - 48) * ((index + progress) / Math.max(1, state.scenes.length)),
      3
    );
  }

  function drawSubtitle(text, width, height) {
    const size = $("subtitleSize").value;
    const font = size === "small" ? 19 : size === "large" ? 29 : 24;

    ctx.font = `800 ${font}px system-ui`;
    ctx.textAlign = "center";

    const words = String(text || "").split(/\s+/);
    const maxWidth = width - 42;
    const lines = [];
    let line = "";

    for (const word of words) {
      const test = line ? line + " " + word : word;

      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = test;
      }
    }

    if (line) lines.push(line);

    const visible = lines.slice(-4);
    const lineHeight = font * 1.22;
    const blockHeight = visible.length * lineHeight + 20;
    const y = height - 76 - blockHeight;

    ctx.fillStyle = "rgba(0,0,0,.62)";
    roundRect(ctx, 15, y, width - 30, blockHeight + 12, 12);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,.22)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#000";
    ctx.textBaseline = "middle";

    visible.forEach((lineText, index) => {
      const lineY = y + 17 + lineHeight * (index + 0.5);
      ctx.strokeText(lineText, width / 2, lineY, maxWidth - 14);
      ctx.fillText(lineText, width / 2, lineY, maxWidth - 14);
    });

    ctx.textBaseline = "alphabetic";
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

  $("renderBtn").addEventListener("click", renderVideo);

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
