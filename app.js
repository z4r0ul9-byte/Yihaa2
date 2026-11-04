/**
 * Air Canvas — Dimensional Portal & 2-Hand Web
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
let isGestureActive = true; // Toggle for ✋ mode switching

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
  
  // Render camera feed with a filter (e.g., Invert + Hue shift for dimension look)
  filterCtx.clearRect(0, 0, w, h);
  filterCtx.filter = 'invert(1) hue-rotate(180deg) contrast(1.5)';
  filterCtx.drawImage(video, 0, 0, w, h);
  filterCtx.filter = 'none';

  overlayCtx.save();
  
  // Create clipping path based on hands
  overlayCtx.beginPath();
  
  if (numHands === 2) {
    // Bounding box between both hands for the portal window
    let minX = w, minY = h, maxX = 0, maxY = 0;
    results.multiHandLandmarks.forEach(lm => {
      lm.forEach(p => {
        const px = (1 - p.x) * w;
        const py = p.y * h;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      });
    });
    
    // Draw a jagged/tech rectangle
    overlayCtx.rect(minX, minY, maxX - minX, maxY - minY);
  } else if (numHands === 1) {
    // Bounding box around 1 hand
    const lm = results.multiHandLandmarks[0];
    let minX = w, minY = h, maxX = 0, maxY = 0;
    lm.forEach(p => {
      const px = (1 - p.x) * w;
      const py = p.y * h;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    });
    overlayCtx.rect(minX, minY, maxX - minX, maxY - minY);
  }
  
  if (numHands > 0) {
    overlayCtx.clip(); // Apply portal window
    
    // Draw the filtered dimension
    overlayCtx.drawImage(filterCanvas, 0, 0);
    
    // Add a glowing tech border around the clip
    overlayCtx.restore(); // Restore to draw border
    overlayCtx.save();
    
    overlayCtx.strokeStyle = '#00ffff';
    overlayCtx.shadowColor = '#00ffff';
    overlayCtx.shadowBlur = 20;
    overlayCtx.lineWidth = 3;
    overlayCtx.stroke(); // Strokes the path we just defined

    // --- Draw the Web (Jaring) ---
    overlayCtx.strokeStyle = 'rgba(255, 0, 85, 0.6)';
    overlayCtx.shadowColor = '#ff0055';
    overlayCtx.shadowBlur = 10;
    overlayCtx.lineWidth = 1.5;

    const getPt = (handIdx, lmIdx) => {
      const p = results.multiHandLandmarks[handIdx][lmIdx];
      return { x: (1 - p.x) * w, y: p.y * h };
    };

    const fingers = [4, 8, 12, 16, 20];

    if (numHands === 2) {
      // Connect fingertips of hand 1 to hand 2
      fingers.forEach(f => {
        const p1 = getPt(0, f);
        const p2 = getPt(1, f);
        
        overlayCtx.beginPath();
        overlayCtx.moveTo(p1.x, p1.y);
        overlayCtx.lineTo(p2.x, p2.y);
        overlayCtx.stroke();
        
        // Add some zig-zag/web lines
        const midX = (p1.x + p2.x) / 2 + (Math.random() * 20 - 10);
        const midY = (p1.y + p2.y) / 2 + (Math.random() * 20 - 10);
        overlayCtx.beginPath();
        overlayCtx.moveTo(p1.x, p1.y);
        overlayCtx.lineTo(midX, midY);
        overlayCtx.lineTo(p2.x, p2.y);
        overlayCtx.stroke();
      });
    } else {
      // 1 hand web (from palm center)
      const center = getPt(0, 9);
      fingers.forEach(f => {
        const pt = getPt(0, f);
        overlayCtx.beginPath();
        overlayCtx.moveTo(center.x, center.y);
        overlayCtx.lineTo(pt.x, pt.y);
        overlayCtx.stroke();
      });
    }
  }
  
  overlayCtx.restore();
}

// ===== MediaPipe =====
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
});

hands.setOptions({
  maxNumHands: 2, // Support 2 hands for pulling the web
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
    statusEl.textContent = `Mode: ${appMode} | No hand`;
    return;
  }

  // --- DRAW DIMENSIONAL PORTAL ---
  if (isPortalActive) {
    drawDimensionalPortal(results, w, h);
    statusEl.textContent = "🚪 PORTAL ACTIVE (Tarikan 2 Tangan)";
    return; // Skip drawing/gesture logic when portal is active to prevent chaos
  }

  // --- SINGLE HAND LOGIC (DRAW/ERASE) ---
  let primaryHand = results.multiHandLandmarks[0];
  if (results.multiHandLandmarks.length === 2) {
     // Prioritize pointing hand for drawing
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
  
  // Auto pause drawing mode when portal is active
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
