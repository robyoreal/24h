import { CanvasManager } from './canvas/CanvasManager.js';
import {
  initFirebase,
  getTileId,
  getVisibleTileIds,
  loadTile,
  saveStrokes,
  initUserInk,
  calculateCurrentInk,
  updateUserRefillTime,
  cleanupTile,
  subscribeTileUpdates,
  isConfigured
} from './services/firebase.service.js';
import {
  GEOLOCATION_API,
  TILE_SIZE,
  INACTIVITY_TIMEOUT,
  MAX_BUFFER_SIZE,
  DEFAULT_STROKE_WIDTH,
  INK_REFILL_RATE
} from './config/firebase.config.js';

// Application state
const state = {
  canvasManager: null,
  currentTool: 'brush', // 'brush', 'text', or 'eraser'
  currentColor: '#000000',
  currentWidth: DEFAULT_STROKE_WIDTH,
  userIpHash: null,
  userCountry: null,
  userInk: null,
  inkInterval: null,
  inactivityTimer: null,
  isPanning: false,
  lastMousePos: { x: 0, y: 0 },
  tileListeners: new Map(), // Track active listeners

  // New keys for bottom toolbar
  undoTimer: null,             // timeout ref for auto-hiding undo button
  undoTimestamp: null,         // Date.now() of last local stroke, used for 60s undo window
  arrowKeys: { up: false, down: false, left: false, right: false }, // tracks held keys
  arrowAnimFrame: null,        // requestAnimationFrame ref for smooth pan loop
  dialDragging: false,         // true while user drags the width dial
  dialStartY: 0,               // mouseY/touchY at drag start
  dialStartWidth: 0            // currentWidth at drag start
};

// Initialize app
async function init() {
  // Initialize Firebase
  const firebaseReady = initFirebase();

  if (!firebaseReady) {
    document.getElementById('firebase-notice').classList.add('show');
  }

  // Initialize canvas
  const canvas = document.getElementById('main-canvas');
  state.canvasManager = new CanvasManager(canvas);

  // Get user location and IP hash
  await initUser();

  // Setup event listeners
  setupBottomToolbar();
  setupCanvas();
  setupKeyboard();

  // Initialize UI state
  updateColorBtnSwatch();

  // Load initial tiles
  if (isConfigured) {
    await loadVisibleTiles();

    // Start periodic tile cleanup (when user loads tiles)
    setInterval(() => cleanupVisibleTiles(), 60000); // Every minute
  }

  // Start ink refill updater
  startInkUpdater();

  console.log('App initialized');
}

// Initialize user (get IP hash and country)
async function initUser() {
  try {
    const response = await fetch(GEOLOCATION_API);
    const data = await response.json();

    state.userCountry = data.country_code || 'XX';

    // Create simple hash of IP (not secure, just for identification)
    const ip = data.ip || 'anonymous';
    state.userIpHash = await hashString(ip);

    console.log('User initialized:', state.userCountry);

    // Initialize user ink in Firestore
    if (isConfigured) {
      state.userInk = await initUserInk(state.userIpHash, state.userCountry);
      updateInkGauge();
    }
  } catch (error) {
    console.error('Failed to get user location:', error);
    state.userCountry = 'XX';
    state.userIpHash = 'anonymous_' + Math.random().toString(36).substring(7);
  }
}

// Simple hash function
async function hashString(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Setup bottom toolbar event listeners
function setupBottomToolbar() {
  // --- Tool button & arc ---
  const toolBtn = document.getElementById('tool-btn');
  const toolArc = document.getElementById('tool-arc');

  toolBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toolArc.classList.toggle('hidden');
    // Close color arc if open
    document.getElementById('color-arc').classList.add('hidden');
  });

  toolArc.querySelectorAll('.arc-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.currentTool = btn.dataset.tool;
      updateToolIcon();
      updateColorBtnSwatch();
      toolArc.classList.add('hidden');
    });
  });

  // --- Color button & arc ---
  const colorBtn = document.getElementById('color-btn');
  const colorArc = document.getElementById('color-arc');

  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Do nothing if eraser is active
    if (state.currentTool === 'eraser') return;
    colorArc.classList.toggle('hidden');
    // Close tool arc if open
    toolArc.classList.add('hidden');
  });

  colorArc.querySelectorAll('.color-arc-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.currentColor = btn.dataset.color;
      updateColorBtnSwatch();
      colorArc.classList.add('hidden');
    });
  });

  // --- Width Dial (drag interaction) ---
  const dial = document.getElementById('width-dial');

  dial.addEventListener('mousedown', (e) => {
    e.preventDefault();
    state.dialDragging = true;
    state.dialStartY = e.clientY;
    state.dialStartWidth = state.currentWidth;
    document.addEventListener('mousemove', onDialDrag);
    document.addEventListener('mouseup', onDialDragEnd);
  });

  dial.addEventListener('touchstart', (e) => {
    e.preventDefault();
    state.dialDragging = true;
    state.dialStartY = e.touches[0].clientY;
    state.dialStartWidth = state.currentWidth;
    document.addEventListener('touchmove', onDialDrag, { passive: false });
    document.addEventListener('touchend', onDialDragEnd);
  }, { passive: false });

  // --- Undo button ---
  document.getElementById('undo-btn').addEventListener('click', () => {
    const removed = state.canvasManager.undoLastStroke();
    if (removed) {
      state.userInk.inkRemaining += removed.inkUsed;
      updateInkGauge();
      hideUndoButton();
    }
  });

  // --- Close arcs when clicking canvas ---
  document.getElementById('canvas-container').addEventListener('mousedown', () => {
    toolArc.classList.add('hidden');
    colorArc.classList.add('hidden');
  });

  // --- Text modal ---
  document.getElementById('text-submit').addEventListener('click', submitText);
  document.getElementById('text-cancel').addEventListener('click', closeTextModal);
  document.getElementById('text-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitText();
  });
}

// Dial drag helpers
function onDialDrag(e) {
  if (!state.dialDragging) return;
  e.preventDefault();
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  // Drag UP = wider, drag DOWN = narrower
  const delta = state.dialStartY - clientY;
  const newWidth = Math.min(50, Math.max(5, state.dialStartWidth + Math.round(delta * 0.4)));
  state.currentWidth = newWidth;
  document.getElementById('width-dial-label').textContent = newWidth;
}

function onDialDragEnd(e) {
  state.dialDragging = false;
  document.removeEventListener('mousemove', onDialDrag);
  document.removeEventListener('mouseup', onDialDragEnd);
  document.removeEventListener('touchmove', onDialDrag);
  document.removeEventListener('touchend', onDialDragEnd);
}

// UI update helpers
function updateToolIcon() {
  // Hide all tool icons, show the one matching state.currentTool
  document.querySelectorAll('.tool-icon').forEach(icon => icon.classList.remove('active'));
  document.getElementById('tool-icon-' + state.currentTool).classList.add('active');
}

function updateColorBtnSwatch() {
  const swatch = document.getElementById('color-btn-swatch');
  if (state.currentTool === 'eraser') {
    swatch.classList.add('eraser-mode');
    swatch.style.background = '';
  } else {
    swatch.classList.remove('eraser-mode');
    swatch.style.background = state.currentColor;
  }
}

function updateInkGauge() {
  if (!state.userInk) return;
  const currentInk = calculateCurrentInk(state.userInk, INK_REFILL_RATE);
  const pct = Math.max(0, Math.min(1, currentInk / 250000));

  // Update arc: circumference = 2 * PI * r = 2 * PI * 18 ≈ 113.097
  const circumference = 113.097;
  const arc = document.getElementById('ink-gauge-arc');
  arc.style.strokeDasharray = circumference;
  arc.style.strokeDashoffset = circumference * (1 - pct);

  document.getElementById('ink-gauge-label').textContent = Math.round(pct * 100) + '%';
}

// Undo visibility (60-second window)
function showUndoButton() {
  const wrap = document.getElementById('undo-btn-wrap');
  wrap.classList.remove('hidden');
  state.undoTimestamp = Date.now();

  // Reset the 60s auto-hide timer
  clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(() => {
    hideUndoButton();
  }, 60000);
}

function hideUndoButton() {
  document.getElementById('undo-btn-wrap').classList.add('hidden');
  clearTimeout(state.undoTimer);
  state.undoTimer = null;
  state.undoTimestamp = null;
}

// Setup canvas event listeners
function setupCanvas() {
  const container = document.getElementById('canvas-container');

  // Mouse events
  container.addEventListener('mousedown', handleMouseDown);
  container.addEventListener('mousemove', handleMouseMove);
  container.addEventListener('mouseup', handleMouseUp);
  container.addEventListener('mouseleave', handleMouseUp);

  // Wheel for zoom
  container.addEventListener('wheel', handleWheel, { passive: false });

  // Touch events for mobile
  container.addEventListener('touchstart', handleTouchStart, { passive: false });
  container.addEventListener('touchmove', handleTouchMove, { passive: false });
  container.addEventListener('touchend', handleTouchEnd);
}

// Mouse down handler
function handleMouseDown(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  if (e.button === 1 || e.ctrlKey || e.metaKey) {
    // Middle mouse or Ctrl+click = pan
    state.isPanning = true;
    state.lastMousePos = { x: e.clientX, y: e.clientY };
  } else if (state.currentTool === 'brush' || state.currentTool === 'eraser') {
    // Start drawing
    const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
    const drawColor = state.currentTool === 'eraser' ? '#FFFFFF' : state.currentColor;
    state.canvasManager.startStroke(
      worldPos.x,
      worldPos.y,
      state.currentWidth,
      drawColor,
      state.userCountry
    );
  } else if (state.currentTool === 'text') {
    // Show text input modal
    const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
    state.textWorldPos = worldPos;
    showTextModal();
  }
}

// Mouse move handler
function handleMouseMove(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  if (state.isPanning) {
    const dx = e.clientX - state.lastMousePos.x;
    const dy = e.clientY - state.lastMousePos.y;
    state.canvasManager.pan(dx, dy);
    state.lastMousePos = { x: e.clientX, y: e.clientY };
  } else if (state.canvasManager.isDrawing) {
    const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
    const inkCost = state.canvasManager.continueStroke(worldPos.x, worldPos.y, state.currentWidth);

    // Eraser costs no ink
    if (state.currentTool !== 'eraser' && state.userInk) {
      state.userInk.inkRemaining -= inkCost;
      updateInkGauge();
    }

    // Reset inactivity timer
    resetInactivityTimer();
  }
}

// Mouse up handler
function handleMouseUp(e) {
  if (state.isPanning) {
    state.isPanning = false;
  } else if (state.canvasManager.isDrawing) {
    // Check if stroke has more than one point before showing undo
    const hadValidStroke = state.canvasManager.currentStroke &&
                           state.canvasManager.currentStroke.points.length > 3;
    state.canvasManager.endStroke();
    resetInactivityTimer();
    if (hadValidStroke) {
      showUndoButton();
    }
  }
}

// Wheel handler (zoom)
function handleWheel(e) {
  e.preventDefault();
  const rect = e.currentTarget.getBoundingClientRect();
  const centerX = e.clientX - rect.left;
  const centerY = e.clientY - rect.top;

  state.canvasManager.zoom(e.deltaY, centerX, centerY);
}

// Touch handlers (with pinch zoom + two-finger pan support)
let lastTouches = [];        // array of touch objects from previous frame
let touchMode = null;        // 'draw' | 'gesture' | 'text'

function handleTouchStart(e) {
  e.preventDefault();
  lastTouches = Array.from(e.touches);

  if (e.touches.length === 1) {
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = touch.clientX - rect.left;
    const screenY = touch.clientY - rect.top;

    if (state.currentTool === 'brush' || state.currentTool === 'eraser') {
      touchMode = 'draw';
      const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
      const drawColor = state.currentTool === 'eraser' ? '#FFFFFF' : state.currentColor;
      state.canvasManager.startStroke(worldPos.x, worldPos.y, state.currentWidth, drawColor, state.userCountry);
    } else if (state.currentTool === 'text') {
      touchMode = 'text';
      const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
      state.textWorldPos = worldPos;
      showTextModal();
    }
  } else if (e.touches.length === 2) {
    // Cancel any in-progress draw stroke if a second finger appears
    if (state.canvasManager.isDrawing) {
      state.canvasManager.isDrawing = false;
      state.canvasManager.currentStroke = null;
    }
    touchMode = 'gesture';
  }
}

function handleTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 1 && touchMode === 'draw') {
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = touch.clientX - rect.left;
    const screenY = touch.clientY - rect.top;

    if (state.canvasManager.isDrawing) {
      const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
      const inkCost = state.canvasManager.continueStroke(worldPos.x, worldPos.y, state.currentWidth);

      // Eraser costs no ink
      if (state.currentTool !== 'eraser' && state.userInk) {
        state.userInk.inkRemaining -= inkCost;
        updateInkGauge();
      }
    }
  } else if (e.touches.length === 2 && touchMode === 'gesture') {
    const t0 = e.touches[0];
    const t1 = e.touches[1];
    const l0 = lastTouches[0];
    const l1 = lastTouches[1];
    if (!l0 || !l1) { lastTouches = Array.from(e.touches); return; }

    const rect = e.currentTarget.getBoundingClientRect();

    // Calculate midpoints
    const prevMidX = (l0.clientX + l1.clientX) / 2;
    const prevMidY = (l0.clientY + l1.clientY) / 2;
    const currMidX = (t0.clientX + t1.clientX) / 2;
    const currMidY = (t0.clientY + t1.clientY) / 2;

    // Calculate distances for zoom
    const prevDist = Math.hypot(l1.clientX - l0.clientX, l1.clientY - l0.clientY);
    const currDist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);

    // Simultaneous zoom + pan (standard mobile behavior)
    // 1. First, apply pan by moving the midpoint
    const panDx = currMidX - prevMidX;
    const panDy = currMidY - prevMidY;

    // 2. Then apply zoom centered on the current midpoint
    const ratio = prevDist > 0 ? currDist / prevDist : 1;

    // Get world position at midpoint before transformations
    const screenMidX = currMidX - rect.left;
    const screenMidY = currMidY - rect.top;

    // Apply pan
    state.canvasManager.viewport.x -= panDx / state.canvasManager.viewport.zoom;
    state.canvasManager.viewport.y -= panDy / state.canvasManager.viewport.zoom;

    // Apply zoom centered on midpoint
    if (Math.abs(ratio - 1) > 0.001) {
      const worldPos = state.canvasManager.screenToWorld(screenMidX, screenMidY);
      state.canvasManager.viewport.zoom = Math.max(0.1, Math.min(5, state.canvasManager.viewport.zoom * ratio));
      state.canvasManager.viewport.x = worldPos.x - screenMidX / state.canvasManager.viewport.zoom;
      state.canvasManager.viewport.y = worldPos.y - screenMidY / state.canvasManager.viewport.zoom;
    }

    state.canvasManager.render();
  }

  lastTouches = Array.from(e.touches);
}

function handleTouchEnd(e) {
  if (touchMode === 'draw' && state.canvasManager.isDrawing) {
    state.canvasManager.endStroke();
    resetInactivityTimer();
    showUndoButton();
  }
  touchMode = null;
  lastTouches = [];
}

// Helper removed - no longer needed since we always do both

// Show text input modal
function showTextModal() {
  const modal = document.getElementById('text-input-modal');
  const input = document.getElementById('text-input');
  modal.classList.remove('hidden');
  input.value = '';
  input.focus();
}

// Close text modal
function closeTextModal() {
  document.getElementById('text-input-modal').classList.add('hidden');
}

// Submit text
function submitText() {
  const input = document.getElementById('text-input');
  const text = input.value.trim();

  if (!text || !state.textWorldPos) {
    closeTextModal();
    return;
  }

  const fontSize = 24; // Fixed for now
  const inkCost = state.canvasManager.addTextStroke(
    state.textWorldPos.x,
    state.textWorldPos.y,
    text,
    fontSize,
    state.currentColor,
    state.userCountry
  );

  // Deduct ink
  if (state.userInk) {
    state.userInk.inkRemaining -= inkCost;
    updateInkGauge();
  }

  resetInactivityTimer();
  closeTextModal();
  showUndoButton();
}

// Start ink updater (refill over time)
function startInkUpdater() {
  state.inkInterval = setInterval(() => {
    updateInkGauge();
  }, 1000); // Update every second
}

// Keyboard arrow-key pan (smooth, Excel-style)
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Ignore if user is typing in a text input
    if (e.target.tagName === 'INPUT') return;

    let moved = false;
    if (e.key === 'ArrowUp')    { state.arrowKeys.up = true;    moved = true; }
    if (e.key === 'ArrowDown')  { state.arrowKeys.down = true;  moved = true; }
    if (e.key === 'ArrowLeft')  { state.arrowKeys.left = true;  moved = true; }
    if (e.key === 'ArrowRight') { state.arrowKeys.right = true; moved = true; }

    if (moved) {
      e.preventDefault();
      if (!state.arrowAnimFrame) startArrowPanLoop();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowUp')    state.arrowKeys.up = false;
    if (e.key === 'ArrowDown')  state.arrowKeys.down = false;
    if (e.key === 'ArrowLeft')  state.arrowKeys.left = false;
    if (e.key === 'ArrowRight') state.arrowKeys.right = false;

    // If no arrow keys held, stop the loop
    if (!state.arrowKeys.up && !state.arrowKeys.down && !state.arrowKeys.left && !state.arrowKeys.right) {
      cancelAnimationFrame(state.arrowAnimFrame);
      state.arrowAnimFrame = null;
    }
  });
}

function startArrowPanLoop() {
  const SPEED_PCT = 0.02; // 2% of screen per frame

  function loop() {
    // Calculate speed based on screen size
    const speedX = window.innerWidth * SPEED_PCT;
    const speedY = window.innerHeight * SPEED_PCT;

    let dx = 0, dy = 0;
    // Reversed: arrow direction = view scroll direction (content moves opposite)
    if (state.arrowKeys.up)    dy =  speedY;
    if (state.arrowKeys.down)  dy = -speedY;
    if (state.arrowKeys.left)  dx =  speedX;
    if (state.arrowKeys.right) dx = -speedX;

    if (dx !== 0 || dy !== 0) {
      state.canvasManager.pan(dx, dy);
      loadVisibleTiles();
    }

    state.arrowAnimFrame = requestAnimationFrame(loop);
  }

  state.arrowAnimFrame = requestAnimationFrame(loop);
}

// Reset inactivity timer
function resetInactivityTimer() {
  clearTimeout(state.inactivityTimer);

  state.inactivityTimer = setTimeout(() => {
    flushStrokes();
  }, INACTIVITY_TIMEOUT);
}

// Flush strokes to Firebase
async function flushStrokes() {
  if (!isConfigured) return;

  const localStrokes = state.canvasManager.getLocalStrokes();
  if (localStrokes.length === 0) return;

  console.log(`Flushing ${localStrokes.length} strokes...`);

  // Group strokes by tile
  const strokesByTile = {};

  for (const stroke of localStrokes) {
    let tileId;

    if (stroke.type === 'text') {
      tileId = getTileId(stroke.position[0], stroke.position[1], TILE_SIZE);
    } else {
      // Use first point of stroke (flat array: [x, y, w, ...])
      tileId = getTileId(stroke.points[0], stroke.points[1], TILE_SIZE);
    }

    if (!strokesByTile[tileId]) {
      strokesByTile[tileId] = [];
    }

    strokesByTile[tileId].push(stroke);
  }

  // Calculate total ink used
  const totalInkUsed = localStrokes.reduce((sum, stroke) => sum + stroke.inkUsed, 0);

  // Save to Firebase
  const success = await saveStrokes(strokesByTile, state.userIpHash, totalInkUsed);

  if (success) {
    state.canvasManager.clearLocalStrokes();
    await updateUserRefillTime(state.userIpHash);
    updateInkGauge();
    console.log('Strokes saved successfully');
  } else {
    console.error('Failed to save strokes');
  }
}

// Load visible tiles
async function loadVisibleTiles() {
  const viewport = state.canvasManager.getViewport();
  const tileIds = getVisibleTileIds(viewport, TILE_SIZE);

  for (const tileId of tileIds) {
    // Skip if already loaded
    if (state.canvasManager.tiles.has(tileId)) continue;

    // Load initial tile data
    const tileData = await loadTile(tileId);
    if (tileData) {
      state.canvasManager.addTile(tileId, tileData);
    }

    // Subscribe to real-time updates for this tile
    if (!state.tileListeners.has(tileId)) {
      const unsubscribe = subscribeTileUpdates(tileId, (updatedTileId, updatedData) => {
        // Update canvas when tile data changes
        state.canvasManager.addTile(updatedTileId, updatedData);
        console.log(`Tile ${updatedTileId} updated in real-time`);
      });

      if (unsubscribe) {
        state.tileListeners.set(tileId, unsubscribe);
      }
    }
  }
}

// Cleanup visible tiles
async function cleanupVisibleTiles() {
  const viewport = state.canvasManager.getViewport();
  const tileIds = getVisibleTileIds(viewport, TILE_SIZE);

  for (const tileId of tileIds) {
    await cleanupTile(tileId);
  }
}

// Save on page unload
window.addEventListener('beforeunload', () => {
  flushStrokes();
});

// Start the app
init();
