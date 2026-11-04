/**
 * Air Canvas — pinch-hold to draw.
 *
 * Hand tracking via MediaPipe Hands. Drawing on one canvas,
 * progress ring on a second overlay canvas.
 *
 * Gesture:
 *   - Pinch ratio (thumb-index / palm-size) < 0.30 → "pressing"
 *   - Pinch ratio > 0.45 → "released"
 *   - (between = hysteresis: keep previous state)
 *
 * Flow:
 *   - Pinch & hold for 700ms → ring fills → draw mode on
 *   - Release → stroke ends, grace window starts (1.5s)
 *   - Re-pinch within grace → instant draw mode
 *   - Re-pinch after grace → must hold 700ms again
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
const HOLD_DURATION_MS = 700;
const GRACE_PERIOD_MS = 1500;
const PINCH_ON = 0.30;
const PINCH_OFF = 0.45;
const SMOOTHING = 0.35;
const RING_RADIUS = 40;
const RING_LINE_WIDTH = 4;

// ===== State =====
let pinchHoldStart = null;
let lastStrokeEndTime = null;
let isPinching = false;
let drawMode = false;
let strokeActive = false;
let prevPoint = null;
let smoothed = null;
let strokes = [];
let currentStroke = null;
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

// ===== Stroke storage / rendering =====
function redrawStrokes() {
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  drawCtx.clearRect(0, 0, w, h);

  for (const stroke of strokes) {
    if (stroke.points.length < 1) continue;
    drawCtx.strokeStyle = stroke.color;
    drawCtx.lineWidth = stroke.size;
    drawCtx.lineCap = "round";
    drawCtx.lineJoin = "round";
    drawCtx.beginPath();
    const p0 = stroke.points[0];
    drawCtx.moveTo(p0.x, p0.y);
    for (let i = 1; i < stroke.points.length; i++) {
      const p = stroke.points[i];
      drawCtx.lineTo(p.x, p.y);
    }
    if (stroke.points.length === 1) {
      // dot
      drawCtx.lineTo(p0.x + 0.01, p0.y + 0.01);
    }
    drawCtx.stroke();
  }
}

function drawSegment(from, to, color, size) {
  drawCtx.strokeStyle = color;
  drawCtx.lineWidth = size;
  drawCtx.lineCap = "round";
  drawCtx.lineJoin = "round";
  drawCtx.beginPath();
  drawCtx.moveTo(from.x, from.y);
  drawCtx.lineTo(to.x, to.y);
  drawCtx.stroke();
}

// ===== Overlay =====
function clearOverlay() {
  const w = overlayCanvas.width / (window.devicePixelRatio || 1);
  const h = overlayCanvas.height / (window.devicePixelRatio || 1);
  overlayCtx.clearRect(0, 0, w, h);
}

function drawProgressRing(x, y, progress) {
  overlayCtx.save();

  // faint outer ring
  overlayCtx.beginPath();
  overlayCtx.arc(x, y, RING_RADIUS, 0, Math.PI * 2);
  overlayCtx.strokeStyle = "rgba(255,255,255,0.18)";
  overlayCtx.lineWidth = RING_LINE_WIDTH;
  overlayCtx.stroke();

  // progress arc
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

  // center dot
  overlayCtx.beginPath();
  overlayCtx.arc(x, y, 3, 0, Math.PI * 2);
  overlayCtx.fillStyle = "#4d6bfe";
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
      // ignore transient errors
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
  // keep layout in sync with video aspect
  if (video.videoWidth) {
    syncStageInner();
  }

  const now = performance.now();
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  if (!w || !h) return;

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    if (strokeActive) endStroke(now);
    pinchHoldStart = null;
    isPinching = false;
    smoothed = null;
    clearOverlay();
    statusEl.textContent = "No hand detected";
    return;
  }

  const lm = results.multiHandLandmarks[0];
  const thumb = lm[4];
  const index = lm[8];
  const wrist = lm[0];
  const middleMcp = lm[9];

  const pinchDist = Math.hypot(thumb.x - index.x, thumb.y - index.y);
  const palmSize = Math.hypot(wrist.x - middleMcp.x, wrist.y - middleMcp.y) || 0.0001;
  const pinchRatio = pinchDist / palmSize;

  // hysteresis
  if (!isPinching && pinchRatio < PINCH_ON) isPinching = true;
  else if (isPinching && pinchRatio > PINCH_OFF) isPinching = false;

  // screen coords (mirrored)
  const rawX = (1 - (thumb.x + index.x) / 2) * w;
  const rawY = ((thumb.y + index.y) / 2) * h;

  // smoothing
  if (smoothed === null) {
    smoothed = { x: rawX, y: rawY };
  } else {
    smoothed.x = smoothed.x * (1 - SMOOTHING) + rawX * SMOOTHING;
    smoothed.y = smoothed.y * (1 - SMOOTHING) + rawY * SMOOTHING;
  }

  if (isPinching) {
    if (drawMode) {
      // actively drawing
      if (prevPoint) {
        drawSegment(prevPoint, smoothed, colorInput.value, +sizeInput.value);
      }
      if (currentStroke) currentStroke.points.push({ x: smoothed.x, y: smoothed.y });
      prevPoint = { x: smoothed.x, y: smoothed.y };
      strokeActive = true;
      statusEl.textContent = "✏️ Drawing";
    } else {
      const sinceLast =
        lastStrokeEndTime === null ? Infinity : now - lastStrokeEndTime;

      if (sinceLast < GRACE_PERIOD_MS) {
        // instant redraw from grace
        drawMode = true;
        prevPoint = { x: smoothed.x, y: smoothed.y };
        strokeActive = true;
        currentStroke = {
          color: colorInput.value,
          size: +sizeInput.value,
          points: [{ x: smoothed.x, y: smoothed.y }],
        };
        clearOverlay();
        statusEl.textContent = "✏️ Drawing (grace)";
      } else {
        // start / continue ring
        if (pinchHoldStart === null) pinchHoldStart = now;
        const elapsed = now - pinchHoldStart;
        const progress = Math.min(1, elapsed / HOLD_DURATION_MS);

        clearOverlay();
        drawProgressRing(overlayCtx, smoothed.x, smoothed.y, progress);
        statusEl.textContent = `Hold… ${Math.round(progress * 100)}%`;

        if (progress >= 1) {
          drawMode = true;
          prevPoint = { x: smoothed.x, y: smoothed.y };
          strokeActive = true;
          currentStroke = {
            color: colorInput.value,
            size: +sizeInput.value,
            points: [{ x: smoothed.x, y: smoothed.y }],
          };
          clearOverlay();
        }
      }
    }
  } else {
    if (strokeActive) endStroke(now);
    pinchHoldStart = null;
    clearOverlay();
    statusEl.textContent = "Pinch & hold to start";
  }
}

function endStroke(now) {
  if (currentStroke && currentStroke.points.length > 0) {
    strokes.push(currentStroke);
  }
  currentStroke = null;
  drawMode = false;
  strokeActive = false;
  prevPoint = null;
  lastStrokeEndTime = now;
}

// ===== UI =====
clearBtn.addEventListener("click", () => {
  strokes = [];
  currentStroke = null;
  drawMode = false;
  strokeActive = false;
  prevPoint = null;
  pinchHoldStart = null;
  lastStrokeEndTime = null;
  isPinching = false;
  smoothed = null;
  redrawStrokes();
  clearOverlay();
  statusEl.textContent = "Cleared";
});
