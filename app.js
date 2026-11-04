/**
 * Air Canvas — Neon Gesture Mode with Dynamic Web Portal
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
const portalBtn = document.getElementById("portalBtn");
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
let isPortalActive = false;

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
    drawCtx.shadowBlur = 0;
  } else {
    drawCtx.globalCompositeOperation = 'source-over';
    drawCtx.strokeStyle = stroke.color;
    drawCtx.shadowColor = stroke.color;
    drawCtx.shadowBlur = Math.max(15, stroke.size * 3);
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
      drawCtx.shadowBlur = Math.max(15, stroke.size * 3);
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
  if (currentMode === 'DRAW') nextColor = "#ff0055"; 
  else if (currentMode === 'ERASE') nextColor = "#e5e5e5"; 

  if (progress > 0) {
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, RING_RADIUS, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
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

// Dynamic Web Portal following the hand
function drawWebPortal(lm, w, h) {
  const cx = (1 - lm[9].x) * w;
  const cy = lm[9].y * h;
  
  // Fingertips: Thumb, Index, Middle, Ring, Pinky
  const fingers = [4, 8, 12, 16, 20].map(idx => ({
    x: (1 - lm[idx].x) * w,
    y: lm[idx].y * h
  }));

  // 3D Depth offset (moving "into" the screen)
  const dx = 25;
  const dy = -25;

  overlayCtx.save();

  // --- Draw Back Web (Darker / smaller) ---
  overlayCtx.strokeStyle = 'rgba(255, 0, 85, 0.3)';
  overlayCtx.shadowColor = '#ff0055';
  overlayCtx.shadowBlur = 10;
  overlayCtx.lineWidth = 1.5;

  // Back rays
  fingers.forEach(f => {
    overlayCtx.beginPath();
    overlayCtx.moveTo(cx + dx, cy + dy);
    overlayCtx.lineTo(f.x + dx, f.y + dy);
    overlayCtx.stroke();
  });

  // Back rings
  for (let r = 1; r <= 4; r++) {
    const ratio = r / 4;
    overlayCtx.beginPath();
    fingers.forEach((f, i) => {
      const fx = cx + dx + (f.x - cx) * ratio;
      const fy = cy + dy + (f.y - cy) * ratio;
      if (i === 0) overlayCtx.moveTo(fx, fy);
      else overlayCtx.lineTo(fx, fy);
    });
    overlayCtx.closePath();
    overlayCtx.stroke();
  }

  // --- Draw Depth Connecting Lines ---
  overlayCtx.strokeStyle = 'rgba(255, 0, 85, 0.5)';
  overlayCtx.lineWidth = 1;
  fingers.forEach(f => {
    overlayCtx.beginPath();
    overlayCtx.moveTo(f.x, f.y);
    overlayCtx.lineTo(f.x + dx, f.y + dy);
    overlayCtx.stroke();
  });

  // --- Draw Front Web (Bright / neon) ---
  overlayCtx.strokeStyle = '#ff0055';
  overlayCtx.shadowBlur = 20;
  overlayCtx.lineWidth = 2.5;

  // Front rays
  fingers.forEach(f => {
    overlayCtx.beginPath();
    overlayCtx.moveTo(cx, cy);
    overlayCtx.lineTo(f.x, f.y);
    overlayCtx.stroke();
  });

  // Front rings
  for (let r = 1; r <= 4; r++) {
    const ratio = r / 4;
    overlayCtx.beginPath();
    fingers.forEach((f, i) => {
      const fx = cx + (f.x - cx) * ratio;
      const fy = cy + (f.y - cy) * ratio;
      if (i === 0) overlayCtx.moveTo(fx, fy);
      else overlayCtx.lineTo(fx, fy);
    });
    overlayCtx.closePath();
    overlayCtx.stroke();
  }

  // --- Center HUD (Floating info) ---
  overlayCtx.shadowBlur = 15;
  overlayCtx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  overlayCtx.beginPath();
  overlayCtx.arc(cx, cy, 28, 0, Math.PI * 2);
  overlayCtx.fill();
  
  overlayCtx.strokeStyle = '#00ffff';
  overlayCtx.lineWidth = 2;
  overlayCtx.stroke();

  overlayCtx.fillStyle = '#00ffff';
  overlayCtx.font = 'bold 11px monospace';
  overlayCtx.textAlign = 'center';
  overlayCtx.shadowColor = '#00ffff';
  overlayCtx.fillText(appMode, cx, cy + 4);

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
    statusEl.textContent = `Mode: ${appMode} (Saved) | No hand`;
    return;
  }

  const lm = results.multiHandLandmarks[0];
  const gesture = getGesture(lm);

  // Draw Portal Web if active
  if (isPortalActive) {
    drawWebPortal(lm, w, h);
  }

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
    endActiveStroke();
    
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
      palmHoldStart = null;
    }
  } else {
    palmHoldStart = null;
    
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
        statusEl.textContent = `✏️ DRAW MODE`;
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
      endActiveStroke();
      statusEl.textContent = `Mode: ${appMode}`;
    }
  }
}

// ===== UI =====
portalBtn.addEventListener("click", () => {
  isPortalActive = !isPortalActive;
  portalBtn.style.background = isPortalActive ? "#ff0055" : "#1a1a1a";
  portalBtn.style.borderColor = isPortalActive ? "#ff0055" : "#333";
  portalBtn.style.color = isPortalActive ? "#fff" : "#e5e5e5";
});

clearBtn.addEventListener("click", () => {
  strokes = [];
  endActiveStroke();
  redrawStrokes();
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  statusEl.textContent = "Cleared";
});

saveBtn.addEventListener("click", () => {
  const link = document.createElement("a");
  link.download = `neon-air-canvas-${Date.now()}.png`;
  link.href = drawCanvas.toDataURL("image/png");
  link.click();
  statusEl.textContent = "Image saved!";
});
