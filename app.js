/**
 * Air Canvas — pinch-hold to draw / keep-holding-still to erase.
 *
 * Gesture state machine:
 *   IDLE
 *     │ pinch
 *     ▼
 *   CHARGING_DRAW   [0..700ms] — blue ring fills
 *     │ ring full
 *     ▼
 *   DRAWING         [700ms..] — stroke records, draw active
 *     │ still pinched & not moved > 25px from origin
 *     ▼
 *   CHARGING_ERASER [700..1500ms] — small red ring fills
 *     │ ring full
 *     ▼
 *   ERASING         [1500ms..] — eraser stroke records
 *
 * Release anywhere → commit current stroke, start grace window.
 * Re-pinch within 1.5s → instant resume in last committed mode.
 * Movement during CHARGING_ERASER cancels the eraser for this pinch.
 */

// ===== DOM =====
const video = document.getElementById("video");
const drawCanvas = document.getElementById("draw");
const overlayCanvas = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const colorInput = document.getElementById("color");
const sizeInput = document.getElementById("size");
const clearBtn = document.getElementById("clear");
const stage = document.getElementById("stage");
const stageInner = document.getElementById("stageInner");

const drawCtx = drawCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");

// ===== Constants =====
const HOLD_DURATION_MS = 700;      // draw charge time
const ERASER_CHARGE_MS = 800;      // additional time to reach eraser (total 1.5s)
const GRACE_PERIOD_MS = 1500;
const PINCH_ON = 0.30;
const PINCH_OFF = 0.45;
const SMOOTHING = 0.35;
const RING_RADIUS = 40;
const ERASER_RING_RADIUS = 24;
const RING_LINE_WIDTH = 4;
const ERASER_CANCEL_DISTANCE = 25; // px movement from pinch origin that cancels eraser charge
const ERASER_MIN_SIZE = 20;
const ERASER_SIZE_MULT = 4;

// ===== State =====
let isPinching = false;
let smoothed = null;

// pinch-state (reset only when pinch ends)
let pinchHoldStart = null;
let drawUnlockTime = null;
let pinchOriginPos = null;
let eraserCancelled = false;

// stroke-state
let drawMode = false;
let eraserMode = false;
let strokeActive = false;
let currentStroke = null;
let prevPoint = null;

// history
let strokes = [];
let lastStrokeEndTime = null;
let lastCommittedMode = "draw";

// layout
let cachedVideoAspect = null;

// ===== Layout sync =====
function syncStageInner() {
  if (!video.videoWidth || !video.videoHeight) return;

  const aspect = video.videoWidth / video.videoHeight;
  if (cachedVideoAspect === aspect && stageInner.style.width) return;
  cachedVideoAspect = aspect;

  const stageRect = stage.getBoundingClientRect();
  const stageAspect = stageRect.width / stageRect.height;

  let w, h;
  if (stageAspect > aspect) {
    h = stageRect.height - 24;
    w = h * aspect;
  } else {
    w = stageRect.width - 24;
    h = w / aspect;
  }

  stageInner.style.width = w + "px";
  stageInner.style.height = h + "px";

  resizeCanvases(w, h);
}

function resizeCanvases(w, h) {
  const dpr = window.devicePixelRatio || 1;

  drawCanvas.width = w * dpr;
  drawCanvas.height = h * dpr;
  overlayCanvas.width = w * dpr;
  overlayCanvas.height = h * dpr;

  drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  overlayCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  redrawStrokes();
}

window.addEventListener("resize", () => {
  cachedVideoAspect = null;
  syncStageInner();
});

// ===== Stroke rendering =====
function redrawStrokes() {
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  drawCtx.save();
  drawCtx.globalCompositeOperation = "source-over";
  drawCtx.clearRect(0, 0, w, h);
  drawCtx.restore();

  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length < 1) continue;
    applyStrokeStyle(stroke);
    drawCtx.beginPath();
    const p0 = stroke.points[0];
    drawCtx.moveTo(p0.x, p0.y);
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      drawCtx.lineTo(p.x, p.y);
    }
    if (stroke.points.length === 1) {
      drawCtx.lineTo(p0.x + 0.01, p0.y + 0.01);
    }
    drawCtx.stroke();
    drawCtx.restore();
  }
}

function applyStrokeStyle(stroke) {
  drawCtx.save();
  if (stroke.mode === "erase") {
    drawCtx.globalCompositeOperation = "destination-out";
    drawCtx.strokeStyle = "rgba(0,0,0,1)";
  } else {
    drawCtx.globalCompositeOperation = "source-over";
    drawCtx.strokeStyle = stroke.color;
  }
  drawCtx.lineWidth = stroke.size;
  drawCtx.lineCap = "round";
  drawCtx.lineJoin = "round";
}

function drawSegment(from, to, stroke) {
  applyStrokeStyle(stroke);
  drawCtx.beginPath();
  drawCtx.moveTo(from.x, from.y);
  drawCtx.lineTo(to.x, to.y);
  drawCtx.stroke();
  drawCtx.restore();
}

// ===== Overlay =====
function clearOverlay() {
  const w = overlayCanvas.width / (window.devicePixelRatio || 1);
  const h = overlayCanvas.height / (window.devicePixelRatio || 1);
  overlayCtx.clearRect(0, 0, w, h);
}

function drawProgressRing(x, y, progress) {
  overlayCtx.save();

  overlayCtx.beginPath();
  overlayCtx.arc(x, y, RING_RADIUS, 0, Math.PI * 2);
  overlayCtx.strokeStyle = "rgba(255,255,255,0.18)";
  overlayCtx.lineWidth = RING_LINE_WIDTH;
  overlayCtx.stroke();

  if (progress > 0) {
    overlayCtx.beginPath();
    overlayCtx.arc(
      x,
      y,
      RING_RADIUS,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * progress
    );
    overlayCtx.strokeStyle = "#4d6bfe";
    overlayCtx.lineWidth = RING_LINE_WIDTH;
    overlayCtx.lineCap = "round";
    overlayCtx.stroke();
  }

  overlayCtx.beginPath();
  overlayCtx.arc(x, y, 3, 0, Math.PI * 2);
  overlayCtx.fillStyle = "#4d6bfe";
  overlayCtx.fill();

  overlayCtx.restore();
}

function drawEraserRing(x, y, progress) {
  overlayCtx.save();

  overlayCtx.beginPath();
  overlayCtx.arc(x, y, ERASER_RING_RADIUS, 0, Math.PI * 2);
  overlayCtx.strokeStyle = "rgba(255,80,80,0.20)";
  overlayCtx.lineWidth = 3;
  overlayCtx.stroke();

  if (progress > 0) {
    overlayCtx.beginPath();
    overlayCtx.arc(
      x,
      y,
      ERASER_RING_RADIUS,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * progress
    );
    overlayCtx.strokeStyle = "#ff5050";
    overlayCtx.lineWidth = 3;
    overlayCtx.lineCap = "round";
    overlayCtx.stroke();
  }

  overlayCtx.beginPath();
  overlayCtx.arc(x, y, 2.5, 0, Math.PI * 2);
  overlayCtx.fillStyle = "#ff5050";
  overlayCtx.fill();

  overlayCtx.restore();
}

// ===== MediaPipe =====
const hands = new Hands({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
});

hands.onResults(onHandResults);

const camera = new Camera(video, {
  onFrame: async () => {
    try {
      await hands.send({ image: video });
    } catch (e) {
      /* ignore */
    }
  },
  width: 1280,
  height: 720,
});

camera
  .start()
  .then(() => {
    statusEl.textContent = "Ready — show your hand";
  })
  .catch((err) => {
    statusEl.textContent = "Camera error: " + (err?.message || err);
  });

// ===== Main handler =====
function onHandResults(results) {
  if (video.videoWidth) syncStageInner();

  const now = performance.now();
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  if (!w || !h) return;

  // ---- no hand: commit any active stroke, reset pinch state ----
  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    if (strokeActive) endStroke(now);
    isPinching = false;
    smoothed = null;
    pinchHoldStart = null;
    drawUnlockTime = null;
    pinchOriginPos = null;
    eraserCancelled = false;
    drawMode = false;
    eraserMode = false;
    clearOverlay();
    statusEl.textContent = "No hand detected";
    return;
  }

  // ---- compute pinch ratio + screen point ----
  const lm = results.multiHandLandmarks[0];
  const thumb = lm[4];
  const index = lm[8];
  const wrist = lm[0];
  const middleMcp = lm[9];

  const pinchDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
  const palmSize =
    Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) || 0.0001;
  const pinchRatio = pinchDist / palmSize;

  if (!isPinching && pinchRatio < PINCH_ON) isPinching = true;
  else if (isPinching && pinchRatio > PINCH_OFF) isPinching = false;

  const rawX = (1 - (thumb.x + index.x) / 2) * w;
  const rawY = ((thumb.y + index.y) / 2) * h;

  if (smoothed === null) smoothed = { x: rawX, y: rawY };
  else {
    smoothed.x = smoothed.x * (1 - SMOOTHING) + rawX * SMOOTHING;
    smoothed.y = smoothed.y * (1 - SMOOTHING) + rawY * SMOOTHING;
  }

  // ---- not pinching: commit + reset pinch state ----
  if (!isPinching) {
    if (strokeActive) endStroke(now);
    pinchHoldStart = null;
    drawUnlockTime = null;
    pinchOriginPos = null;
    eraserCancelled = false;
    drawMode = false;
    eraserMode = false;
    clearOverlay();
    statusEl.textContent = "Pinch & hold to start";
    return;
  }

  // ---- pinching, not yet in draw or eraser mode ----
  if (!drawMode && !eraserMode) {
    // grace: instant resume in last committed mode
    const sinceLast =
      lastStrokeEndTime === null ? Infinity : now - lastStrokeEndTime;
    if (sinceLast < GRACE_PERIOD_MS) {
      if (lastCommittedMode === "erase") {
        eraserMode = true;
        currentStroke = {
          mode: "erase",
          size: eraserSize(),
          points: [{ x: smoothed.x, y: smoothed.y }],
        };
      } else {
        drawMode = true;
        currentStroke = {
          color: colorInput.value,
          size: +sizeInput.value,
          mode: "draw",
          points: [{ x: smoothed.x, y: smoothed.y }],
        };
      }
      prevPoint = { x: smoothed.x, y: smoothed.y };
      strokeActive = true;
      clearOverlay();
      statusEl.textContent =
        lastCommittedMode === "erase" ? "🩹 Eraser" : "✏️ Drawing (grace)";
      return;
    }

    // charge draw ring
    if (pinchHoldStart === null) pinchHoldStart = now;
    const elapsed = now - pinchHoldStart;
    const progress = Math.min(1, elapsed / HOLD_DURATION_MS);

    clearOverlay();
    drawProgressRing(overlayCtx, smoothed.x, smoothed.y, progress);
    statusEl.textContent = `Hold… ${Math.round(progress * 100)}%`;

    if (progress >= 1) {
      // unlock draw, start eraser-charge tracking
      drawMode = true;
      drawUnlockTime = now;
      pinchOriginPos = { x: smoothed.x, y: smoothed.y };
      eraserCancelled = false;
      currentStroke = {
        color: colorInput.value,
        size: +sizeInput.value,
        mode: "draw",
        points: [{ x: smoothed.x, y: smoothed.y }],
      };
      prevPoint = { x: smoothed.x, y: smoothed.y };
      strokeActive = true;
      clearOverlay();
    }
    return;
  }

  // ---- drawing ----
  if (drawMode) {
    if (prevPoint) {
      drawSegment(prevPoint, smoothed, currentStroke);
      currentStroke.points.push({ x: smoothed.x, y: smoothed.y });
    }
    prevPoint = { x: smoothed.x, y: smoothed.y };

    if (eraserCancelled) {
      statusEl.textContent = "✏️ Drawing";
      return;
    }

    const distFromOrigin = Math.hypot(
      smoothed.x - pinchOriginPos.x,
      smoothed.y - pinchOriginPos.y
    );
    if (distFromOrigin > ERASER_CANCEL_DISTANCE) {
      eraserCancelled = true;
      clearOverlay();
      statusEl.textContent = "✏️ Drawing";
      return;
    }

    const eraserElapsed = now - drawUnlockTime;
    const eraserProgress = Math.min(1, eraserElapsed / ERASER_CHARGE_MS);

    clearOverlay();
    drawEraserRing(overlayCtx, smoothed.x, smoothed.y, eraserProgress);
    statusEl.textContent = `✏️ Drawing · hold still for 🩹 ${Math.round(
      eraserProgress * 100
    )}%`;

    if (eraserProgress >= 1) {
      // commit draw stroke, switch to eraser
      endStroke(now);
      eraserMode = true;
      currentStroke = {
        mode: "erase",
        size: eraserSize(),
        points: [{ x: smoothed.x, y: smoothed.y }],
      };
      prevPoint = { x: smoothed.x, y: smoothed.y };
      strokeActive = true;
      clearOverlay();
      statusEl.textContent = "🩹 Eraser";
    }
    return;
  }

  // ---- erasing ----
  if (eraserMode) {
    if (prevPoint) {
      drawSegment(prevPoint, smoothed, currentStroke);
      currentStroke.points.push({ x: smoothed.x, y: smoothed.y });
    }
    prevPoint = { x: smoothed.x, y: smoothed.y };
    statusEl.textContent = "🩹 Eraser";
  }
}

function eraserSize() {
  return Math.max(ERASER_MIN_SIZE, +sizeInput.value * ERASER_SIZE_MULT);
}

function endStroke(now) {
  if (currentStroke && currentStroke.points.length > 0) {
    strokes.push(currentStroke);
    lastCommittedMode = currentStroke.mode || "draw";
  }
  currentStroke = null;
  drawMode = false;
  eraserMode = false;
  strokeActive = false;
  prevPoint = null;
  lastStrokeEndTime = now;
}

// ===== UI =====
clearBtn.addEventListener("click", () => {
  strokes = [];
  currentStroke = null;
  drawMode = false;
  eraserMode = false;
  strokeActive = false;
  prevPoint = null;
  pinchHoldStart = null;
  drawUnlockTime = null;
  pinchOriginPos = null;
  eraserCancelled = false;
  lastStrokeEndTime = null;
  lastCommittedMode = "draw";
  isPinching = false;
  smoothed = null;
  redrawStrokes();
  clearOverlay();
  statusEl.textContent = "Cleared";
});
