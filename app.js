/**
 * Air Canvas — Dimensional Portal & 2-Hand Web (Polygon Clip)
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
const gestureBtn = document.getElementById("gestureBtn");
const manualModeBtn = document.getElementById("manualModeBtn");
const stage = document.getElementById("stage");
const stageInner = document.getElementById("stageInner");

const drawCtx = drawCanvas.getContext("2d");
const overlayCtx = overlayCanvas.getContext("2d");

// Offscreen canvas for portal filter
const filterCanvas = document.createElement('canvas');
const filterCtx = filterCanvas.getContext('2d');

// ===== Constants =====
const HOLD_DURATION_MS = 1000;
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
let isGestureActive = true;

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
  
  filterCanvas.width = w;
  filterCanvas.height = h;

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

// ===== Dimensional Portal & Web Logic =====
function drawDimensionalPortal(results, w, h) {
  const numHands = results.multiHandLandmarks.length;
  if (numHands === 0) return;

  // Render filtered camera (Inverted + Hue Shifted for dimension look)
  filterCtx.clearRect(0, 0, w, h);
  filterCtx.filter = 'invert(1) hue-rotate(180deg) contrast(1.5)'; 
  filterCtx.drawImage(video, 0, 0, w, h);
  filterCtx.filter = 'none';

  const getPt = (lm, idx) => ({ x: (1 - lm[idx].x) * w, y: lm[idx].y * h });
  
  overlayCtx.save();
  overlayCtx.beginPath();
  
  // Build Polygon Shape based on hand fingertips (NOT a box)
  if (numHands === 2) {
    let left = results.multiHandLandmarks[0], right = results.multiHandLandmarks[1];
    if (left[9].x > right[9].x) { left = right; right = results.multiHandLandmarks[0]; }
    
    const l_wrist = getPt(left, 0);
    const l_pinky = getPt(left, 20);
    const l_ring = getPt(left, 16);
    const l_mid = getPt(left, 12);
    const l_idx = getPt(left, 8);
    const l_thumb = getPt(left, 4);
    
    const r_thumb = getPt(right, 4);
    const r_idx = getPt(right, 8);
    const r_mid = getPt(right, 12);
    const r_ring = getPt(right, 16);
    const r_pinky = getPt(right, 20);
    const r_wrist = getPt(right, 0);
    
    // Path bridging both hands
    overlayCtx.moveTo(l_wrist.x, l_wrist.y);
    overlayCtx.lineTo(l_pinky.x, l_pinky.y);
    overlayCtx.lineTo(l_ring.x, l_ring.y);
    overlayCtx.lineTo(l_mid.x, l_mid.y);
    overlayCtx.lineTo(l_idx.x, l_idx.y);
    overlayCtx.lineTo(l_thumb.x, l_thumb.y);
    overlayCtx.lineTo(r_thumb.x, r_thumb.y);
    overlayCtx.lineTo(r_idx.x, r_idx.y);
    overlayCtx.lineTo(r_mid.x, r_mid.y);
    overlayCtx.lineTo(r_ring.x, r_ring.y);
    overlayCtx.lineTo(r_pinky.x, r_pinky.y);
    overlayCtx.lineTo(r_wrist.x, r_wrist.y);
    overlayCtx.closePath();
  } else {
    const lm = results.multiHandLandmarks[0];
    const wrist = getPt(lm, 0);
    const thumb = getPt(lm, 4);
    const index = getPt(lm, 8);
    const middle = getPt(lm, 12);
    const ring = getPt(lm, 16);
    const pinky = getPt(lm, 20);
    
    overlayCtx.moveTo(wrist.x, wrist.y);
    overlayCtx.lineTo(pinky.x, pinky.y);
    overlayCtx.lineTo(ring.x, ring.y);
    overlayCtx.lineTo(middle.x, middle.y);
    overlayCtx.lineTo(index.x, index.y);
    overlayCtx.lineTo(thumb.x, thumb.y);
    overlayCtx.closePath();
  }
  
  // Clip and draw filtered dimension
  overlayCtx.save();
  overlayCtx.clip();
  overlayCtx.drawImage(filterCanvas, 0, 0);
  
  // Add tech grid inside the portal
  overlayCtx.strokeStyle = 'rgba(0, 255, 255, 0.2)';
  overlayCtx.lineWidth = 1;
  overlayCtx.beginPath();
  for (let i = 0; i < w; i += 40) { overlayCtx.moveTo(i, 0); overlayCtx.lineTo(i, h); }
  for (let i = 0; i < h; i += 40) { overlayCtx.moveTo(0, i); overlayCtx.lineTo(w, i); }
  overlayCtx.stroke();
  
  overlayCtx.restore(); // remove clip for the border and web

  // Glowing Border
  overlayCtx.strokeStyle = '#00ffff';
  overlayCtx.shadowColor = '#00ffff';
  overlayCtx.shadowBlur = 20;
  overlayCtx.lineWidth = 4;
  overlayCtx.stroke();

  // The Web (Jaring)
  overlayCtx.strokeStyle = '#ff0055';
  overlayCtx.shadowColor = '#ff0055';
  overlayCtx.shadowBlur = 10;
  overlayCtx.lineWidth = 1.5;

  if (numHands === 2) {
    let left = results.multiHandLandmarks[0], right = results.multiHandLandmarks[1];
    if (left[9].x > right[9].x) { left = right; right = results.multiHandLandmarks[0]; }
    
    const l_f = [4, 8, 12, 16, 20].map(i => getPt(left, i));
    const r_f = [4, 8, 12, 16, 20].map(i => getPt(right, i));
    
    // Cross web lines
    for (let i = 0; i < 5; i++) {
      overlayCtx.beginPath();
      overlayCtx.moveTo(l_f[i].x, l_f[i].y);
      overlayCtx.lineTo(r_f[i].x, r_f[i].y);
      overlayCtx.stroke();
    }
    
    // Diagonals
    for (let i = 0; i < 4; i++) {
      overlayCtx.beginPath();
      overlayCtx.moveTo(l_f[i].x, l_f[i].y);
      overlayCtx.lineTo(r_f[i+1].x, r_f[i+1].y);
      overlayCtx.stroke();
      
      overlayCtx.beginPath();
      overlayCtx.moveTo(r_f[i].x, r_f[i].y);
      overlayCtx.lineTo(l_f[i+1].x, l_f[i+1].y);
      overlayCtx.stroke();
    }
    
    // Concentric rings
    for (let step = 1; step <= 4; step++) {
      const ratio = step / 5;
      overlayCtx.beginPath();
      for (let i = 0; i < 5; i++) {
        const px = l_f[i].x + (r_f[i].x - l_f[i].x) * ratio;
        const py = l_f[i].y + (r_f[i].y - l_f[i].y) * ratio;
        if (i === 0) overlayCtx.moveTo(px, py);
        else overlayCtx.lineTo(px, py);
      }
      overlayCtx.stroke();
    }
  } else {
    const lm = results.multiHandLandmarks[0];
    const center = getPt(lm, 9);
    const f = [4, 8, 12, 16, 20].map(i => getPt(lm, i));
    
    // Radial lines
    f.forEach(pt => {
      overlayCtx.beginPath();
      overlayCtx.moveTo(center.x, center.y);
      overlayCtx.lineTo(pt.x, pt.y);
      overlayCtx.stroke();
    });
    
    // Rings
    for (let step = 1; step <= 4; step++) {
      const ratio = step / 4;
      overlayCtx.beginPath();
      f.forEach((pt, i) => {
        const px = center.x + (pt.x - center.x) * ratio;
        const py = center.y + (pt.y - center.y) * ratio;
        if (i === 0) overlayCtx.moveTo(px, py);
        else overlayCtx.lineTo(px, py);
      });
      overlayCtx.closePath();
      overlayCtx.stroke();
    }
  }

  overlayCtx.restore();
}

// ===== MediaPipe =====
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
  maxNumHands: 2,
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

  overlayCtx.clearRect(0, 0, w, h);

  if (!results.multiHandLandmarks || results.multiHandLandmarks.length === 0) {
    endActiveStroke();
    palmHoldStart = null;
    smoothedPoint = null;
    statusEl.textContent = `Mode: ${appMode} | No hand`;
    return;
  }

  // --- DRAW DIMENSIONAL PORTAL ---
  if (isPortalActive) {
    drawDimensionalPortal(results, w, h);
    statusEl.textContent = "🚪 PORTAL ACTIVE (Tarik 2 Tangan)";
    return; // Skip drawing mode logic to prevent chaos
  }

  // --- SINGLE HAND LOGIC (DRAW/ERASE) ---
  let primaryHand = results.multiHandLandmarks[0];
  if (results.multiHandLandmarks.length === 2) {
     if (getGesture(results.multiHandLandmarks[1]) === 'POINTING') {
         primaryHand = results.multiHandLandmarks[1];
     }
  }

  const lm = primaryHand;
  const gesture = getGesture(lm);

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

  if (gesture === 'OPEN_PALM' && isGestureActive) {
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
      manualModeBtn.textContent = `Mode: ${appMode}`;
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
  portalBtn.textContent = isPortalActive ? "Portal: ON" : "Portal: OFF";
  portalBtn.style.background = isPortalActive ? "#ff0055" : "#1a1a1a";
  portalBtn.style.borderColor = isPortalActive ? "#ff0055" : "#333";
  portalBtn.style.color = isPortalActive ? "#fff" : "#e5e5e5";
  
  if (isPortalActive) endActiveStroke();
});

gestureBtn.addEventListener("click", () => {
  isGestureActive = !isGestureActive;
  gestureBtn.textContent = isGestureActive ? "✋ Mode: ON" : "✋ Mode: OFF";
  gestureBtn.style.background = isGestureActive ? "#1a1a1a" : "#ff5050";
});

manualModeBtn.addEventListener("click", () => {
  if (appMode === 'IDLE') appMode = 'DRAW';
  else if (appMode === 'DRAW') appMode = 'ERASE';
  else appMode = 'IDLE';
  manualModeBtn.textContent = `Mode: ${appMode}`;
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
  link.download = `portal-canvas-${Date.now()}.png`;
  link.href = drawCanvas.toDataURL("image/png");
  link.click();
  statusEl.textContent = "Image saved!";
});
