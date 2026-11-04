/**
 * Air Canvas — Hand Gesture Mode with Neon Glow
 * 
 * Gesture logic:
 * ✋ OPEN_PALM: Hold for 1s to toggle mode (IDLE -> DRAW -> ERASE -> IDLE).
 * ☝️ POINTING: Draws or Erases based on active mode. Smooth continuous stroke.
 * ✊ OTHER: Stops the current stroke.
 * Mode persists if hand leaves the frame.
 */

// ===== DOM =====
const video = document.getElementById("video");
const drawCanvas = document.getElementById("draw");
const overlayCanvas = document.getElementById("overlay");
const statusEl = document.getElementById("status");
const colorInput = document.getElementById("color");
const sizeInput = document.getElementById("size");
const clearBtn = document.getElementById("clear");
const saveBtn = document.getElementById("save");
const stage = document.getElementById("stage");
const stageInner = document.getElementById("stageInner");

const drawCtx = drawCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");

// ===== Constants =====
const HOLD_DURATION_MS = 1000;     // 1 second hold on open palm to switch
const SMOOTHING = 0.40;
const RING_RADIUS = 36;
const RING_LINE_WIDTH = 5;
const ERASER_MIN_SIZE = 20;
const ERASER_SIZE_MULT = 4;

// ===== State =====
let appMode = 'IDLE'; // 'IDLE' | 'DRAW' | 'ERASE'
let palmHoldStart = null;
let smoothedPoint = null;

// Stroke tracking
let strokes = [];
let currentStroke = null;
let prevPoint = null;

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

// ===== Rendering Helpers =====
function drawSegment(from, to, stroke) {
  drawCtx.save();
  if (stroke.mode === 'erase') {
    drawCtx.globalCompositeOperation = 'destination-out';
    drawCtx.strokeStyle = 'rgba(0,0,0,1)';
    drawCtx.shadowBlur = 0; // Eraser doesn't glow
  } else {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = stroke.color;
    drawCtx.shadowColor = stroke.color;
    drawCtx.shadowBlur = Math.max(15, stroke.size * 3); // Neon glow effect
  }
  drawCtx.lineWidth = stroke.size;
  drawCtx.lineCap = 'round';
  drawCtx.lineJoin = 'round';
  drawCtx.beginPath();
  drawCtx.moveTo(from.x, from.y);
  drawCtx.lineTo(to.x, to.y);
  drawCtx.stroke();
  drawCtx.restore();
}

function redrawStrokes() {
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  drawCtx.clearRect(0, 0, w, h);

  for (const stroke of strokes) {
    if (!stroke.points || stroke.points.length < 1) continue;
    drawCtx.save();
    if (stroke.mode === 'erase') {
      drawCtx.globalCompositeOperation = 'destination-out';
      drawCtx.strokeStyle = 'rgba(0,0,0,1)';
      drawCtx.shadowBlur = 0;
    } else {
      drawCtx.globalCompositeOperation = 'source-over';
      drawCtx.strokeStyle = stroke.color;
      drawCtx.shadowColor = stroke.color;
      drawCtx.shadowBlur = Math.max(15, stroke.size * 3); // Neon glow effect
    }
    drawCtx.lineWidth = stroke.size;
    drawCtx.lineCap = 'round';
    drawCtx.lineJoin = 'round';
    drawCtx.beginPath();
    const p0 = stroke.points[0];
    drawCtx.moveTo(p0.x, p0.y);
    for (let i = 1; i < stroke.points.length; i++) {
      drawCtx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }
    if (stroke.points.length === 1) drawCtx.lineTo(p0.x + 0.01, p0.y + 0.01);
    drawCtx.stroke();
    drawCtx.restore();
  }
}

function drawProgressRing(x, y, progress, currentMode) {
  overlayCtx.save();

  overlayCtx.beginPath();
  overlayCtx.arc(x, y, RING_RADIUS, 0, Math.PI * 2);
  overlayCtx.strokeStyle = "rgba(255,255,255,0.18)";
  overlayCtx.lineWidth = RING_LINE_WIDTH;
  overlayCtx.stroke();

  let nextColor = "#00ffff"; 
  if (currentMode === 'DRAW') nextColor = "#ff0055"; // Next is ERASE
  else if (currentMode === 'ERASE') nextColor = "#e5e5e5"; // Next is IDLE

  if (progress > 0) {
    overlayCtx.beginPath();
    overlayCtx.arc(
      x,
      y,
      RING_RADIUS,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * progress
    );
    overlayCtx.strokeStyle = nextColor;
    overlayCtx.lineWidth = RING_LINE_WIDTH;
    overlayCtx.lineCap = "round";
    overlayCtx.shadowColor = nextColor;
    overlayCtx.shadowBlur = 15;
    overlayCtx.stroke();
  }

  overlayCtx.beginPath();
  overlayCtx.arc(x, y, 4, 0, Math.PI * 2);
  overlayCtx.fillStyle = nextColor;
  overlayCtx.shadowColor = nextColor;
  overlayCtx.shadowBlur = 10;
  overlayCtx.fill();

  overlayCtx.restore();
}

function drawCursor(x, y) {
  overlayCtx.save();
  overlayCtx.beginPath();
  overlayCtx.arc(x, y, 6, 0, Math.PI * 2);
  overlayCtx.fillStyle = "rgba(0, 255, 255, 0.7)";
  overlayCtx.shadowColor = "#00ffff";
  overlayCtx.shadowBlur = 15;
  overlayCtx.fill();
  overlayCtx.restore();
}

// ===== MediaPipe =====
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
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
    try { await hands.send({ image: video }); } catch (e) {}
  },
  width: 1280,
  height: 720,
});

camera.start().catch((err) => {
  statusEl.textContent = "Camera error: " + (err?.message || err);
});

// ===== Gesture Detection =====
function getGesture(lm) {
  const wrist = lm[0];
  const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);
  const isExtended = (tip, pip) => dist(lm[tip], wrist) > dist(lm[pip], wrist) * 1.1;

  const indexUp = isExtended(8, 6);
  const middleUp = isExtended(12, 10);
  const ringUp = isExtended(16, 14);
  const pinkyUp = isExtended(20, 18);

  if (indexUp && middleUp && ringUp && pinkyUp) return 'OPEN_PALM';
  if (indexUp && !middleUp && !ringUp) return 'POINTING'; 
  
  return 'OTHER';
}

function endActiveStroke() {
  if (currentStroke && currentStroke.points.length > 0) {
    strokes.push(currentStroke);
  }
  currentStroke = null;
  prevPoint = null;
}

// ===== Main Handler =====
function onHandResults(results) {
  if (video.videoWidth) syncStageInner();
  const now = performance.now();
  const w = drawCanvas.width / (window.devicePixelRatio || 1);
  const h = drawCanvas.height / (window.devicePixelRatio || 1);
  if (!w || !h) return;

  // Clear overlay for this frame
  overlayCtx.clearRect(0, 0, w, h);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    endActiveStroke();
    palmHoldStart = null;
    smoothedPoint = null;
    // Mode is intentionally NOT reset here. It persists.
    statusEl.textContent = `Mode: ${appMode} (Saved) | No hand`;
    return;
  }

  const lm = results.multiHandLandmarks[0];
  const gesture = getGesture(lm);

  // Landmark 9 = palm center, 8 = index tip
  const palmX = (1 - lm[9].x) * w;
  const palmY = lm[9].y * h;
  const indexX = (1 - lm[8].x) * w;
  const indexY = lm[8].y * h;

  if (smoothedPoint === null) {
    smoothedPoint = { x: indexX, y: indexY };
  } else {
    smoothedPoint.x = smoothedPoint.x * (1 - SMOOTHING) + indexX * SMOOTHING;
    smoothedPoint.y = smoothedPoint.y * (1 - SMOOTHING) + indexY * SMOOTHING;
  }

  if (gesture === 'OPEN_PALM') {
    endActiveStroke(); // stop drawing while holding to switch
    
    if (palmHoldStart === null) palmHoldStart = now;
    const elapsed = now - palmHoldStart;
    const progress = Math.min(1, elapsed / HOLD_DURATION_MS);
    
    drawProgressRing(palmX, palmY, progress, appMode);
    const remain = Math.max(0, (HOLD_DURATION_MS - elapsed) / 1000);
    statusEl.textContent = `Switching in ${remain.toFixed(1)}s… (${appMode})`;
    
    if (progress >= 1) {
      if (appMode === 'IDLE') appMode = 'DRAW';
      else if (appMode === 'DRAW') appMode = 'ERASE';
      else appMode = 'IDLE';
      
      palmHoldStart = null; // reset so user must release to hold again
    }
  } else {
    palmHoldStart = null; // cancel hold if gesture changes
    
    if (gesture === 'POINTING') {
      if (appMode === 'DRAW') {
        if (prevPoint) {
          drawSegment(prevPoint, smoothedPoint, currentStroke);
        }
        if (!currentStroke) {
          currentStroke = { mode: 'draw', color: colorInput.value, size: +sizeInput.value, points: [] };
        }
        currentStroke.points.push({ x: smoothedPoint.x, y: smoothedPoint.y });
        prevPoint = { x: smoothedPoint.x, y: smoothedPoint.y };
        statusEl.textContent = `✏️ DRAW MODE (Neon)`;
      } else if (appMode === 'ERASE') {
        if (prevPoint) {
          drawSegment(prevPoint, smoothedPoint, currentStroke);
        }
        if (!currentStroke) {
          currentStroke = { mode: 'erase', size: Math.max(ERASER_MIN_SIZE, +sizeInput.value * ERASER_SIZE_MULT), points: [] };
        }
        currentStroke.points.push({ x: smoothedPoint.x, y: smoothedPoint.y });
        prevPoint = { x: smoothedPoint.x, y: smoothedPoint.y };
        statusEl.textContent = `🩹 ERASE MODE`;
      } else {
        endActiveStroke();
        drawCursor(smoothedPoint.x, smoothedPoint.y);
        statusEl.textContent = `IDLE (Show ✋ to change mode)`;
      }
    } else {
      // OTHER gesture (e.g. fist)
      endActiveStroke();
      statusEl.textContent = `Mode: ${appMode}`;
    }
  }
}

// ===== UI =====
clearBtn.addEventListener("click", () => {
  strokes = [];
  endActiveStroke();
  redrawStrokes();
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  statusEl.textContent = "Cleared";
});

saveBtn.addEventListener("click", () => {
  // Save transparent PNG
  const link = document.createElement("a");
  link.download = `neon-air-canvas-${Date.now()}.png`;
  link.href = drawCanvas.toDataURL("image/png");
  link.click();
  statusEl.textContent = "Image saved!";
});
