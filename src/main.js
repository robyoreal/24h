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
  INK_REFILL_RATE,
  COLOR_PALETTE,
  FONT_OPTIONS
} from './config/firebase.config.js';
import { initAdminPanel } from './admin/admin-panel.js';
import { loadAdminConfig } from './services/admin.service.js';

// Application state
const state = {
  canvasManager: null,
  currentTool: 'brush', // 'brush', 'text', or 'eraser'
  currentColor: null, // Set by initColorPalette()
  currentWidth: DEFAULT_STROKE_WIDTH,
  currentFont: 'sans-serif', // Default font for text tool
  userIpHash: null,
  userCountry: null,
  userInk: null,
  inkInterval: null,
  inactivityTimer: null,
  isPanning: false,
  lastMousePos: { x: 0, y: 0 },
  tileListeners: new Map(), // Track active listeners

  // Inline text input state
  isTypingText: false,        // Whether user is currently typing
  currentText: '',            // Text being typed
  textWorldPos: null,         // World coordinates where text is being typed
  cursorVisible: true,        // Cursor blink state
  cursorBlinkInterval: null,  // Interval for cursor blinking

  // New keys for bottom toolbar
  undoTimer: null,             // timeout ref for auto-hiding undo button
  undoTimestamp: null,         // Date.now() of last local stroke, used for 60s undo window
  arrowKeys: { up: false, down: false, left: false, right: false }, // tracks held keys
  arrowAnimFrame: null,        // requestAnimationFrame ref for smooth pan loop
  dialDragging: false,         // true while user drags the width dial
  dialStartY: 0,               // mouseY/touchY at drag start
  dialStartWidth: 0,           // currentWidth at drag start
  currentStrokeWasFlushed: false // tracks if current stroke was already flushed mid-draw
};

// Make state accessible to CanvasManager
window.appState = state;

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

  // Load admin config and apply settings
  if (isConfigured) {
    const adminConfig = await loadAdminConfig();
    if (adminConfig) {
      applyAdminConfig(adminConfig);
    }
  }

  // Setup event listeners
  setupBottomToolbar();
  setupCanvas();
  setupKeyboard();

  // Initialize admin panel
  initAdminPanel();

  // Listen for config updates from admin panel
  window.addEventListener('admin-config-updated', (e) => {
    applyAdminConfig(e.detail);
  });

  // Initialize UI state
  updateColorBtnSwatch();
  updateToolDependentControls();

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

// Apply admin configuration to app
function applyAdminConfig(config) {
  // Store config globally for access by other functions
  window.appAdminConfig = config;

  if (config.maintenanceMode) {
    // Disable drawing
    document.getElementById('canvas-container').style.pointerEvents = 'none';
    alert('The wall is currently in maintenance mode. Drawing is temporarily disabled.');
  } else {
    document.getElementById('canvas-container').style.pointerEvents = 'auto';
  }

  // Update color palette if changed
  if (config.colorPalette) {
    initColorPalette(config.colorPalette);
  }

  // Update available fonts for text tool
  if (config.fonts) {
    window.appAvailableFonts = config.fonts;
    // Re-initialize font arc menu
    initFontArc(config.fonts);
  }
}

// Initialize/re-initialize color palette
function initColorPalette(palette) {
  const colorArc = document.getElementById('color-arc');
  colorArc.innerHTML = ''; // Clear existing

  palette.forEach((color, index) => {
    const btn = document.createElement('button');
    btn.className = 'arc-btn color-arc-btn';
    btn.dataset.color = color;

    const dot = document.createElement('div');
    dot.className = 'color-dot';
    dot.style.background = color;

    // Last color (white) needs border for visibility
    if (index === palette.length - 1) {
      dot.style.border = '1px solid #999';
    }

    btn.appendChild(dot);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.currentColor = color;
      updateColorBtnSwatch();
      colorArc.classList.add('hidden');
    });

    colorArc.appendChild(btn);
  });

  // Update current color if not in new palette
  if (!palette.includes(state.currentColor)) {
    state.currentColor = palette[0];
    updateColorBtnSwatch();
  }
}

// Initialize/re-initialize font arc menu
function initFontArc(fonts) {
  const fontArc = document.getElementById('font-arc');
  fontArc.innerHTML = ''; // Clear existing

  fonts.forEach((font) => {
    const btn = document.createElement('button');
    btn.className = 'arc-btn font-arc-btn';
    btn.dataset.font = font.family;
    btn.textContent = font.name;
    btn.style.fontFamily = font.family;
    btn.style.fontSize = '12px';
    btn.style.fontWeight = '600';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.currentFont = font.family;
      updateFontBtnLabel();
      fontArc.classList.add('hidden');
    });

    fontArc.appendChild(btn);
  });

  // Update current font if not in new list
  const fontFamilies = fonts.map(f => f.family);
  if (!fontFamilies.includes(state.currentFont)) {
    state.currentFont = fonts[0]?.family || 'sans-serif';
    updateFontBtnLabel();
  }
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
      // Finish any in-progress text before switching tools
      if (state.isTypingText) {
        finishTypingText();
      }
      state.currentTool = btn.dataset.tool;
      updateToolIcon();
      updateToolDependentControls();
      toolArc.classList.add('hidden');
    });
  });

  // --- Color button & arc ---
  const colorBtn = document.getElementById('color-btn');
  const colorArc = document.getElementById('color-arc');

  // Generate color arc buttons (use admin config palette if available, otherwise default)
  const colorPalette = window.appAdminConfig?.colorPalette || COLOR_PALETTE;
  initColorPalette(colorPalette);

  // Set initial color (first in palette)
  state.currentColor = colorPalette[0];

  colorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    // Do nothing if eraser is active
    if (state.currentTool === 'eraser') return;
    colorArc.classList.toggle('hidden');
    // Close other arcs if open
    toolArc.classList.add('hidden');
    document.getElementById('font-arc').classList.add('hidden');
  });

  // --- Font button & arc (text mode only) ---
  const fontBtn = document.getElementById('font-btn');
  const fontArc = document.getElementById('font-arc');

  // Generate font arc buttons (use admin config fonts if available, otherwise default)
  const fonts = window.appAvailableFonts || FONT_OPTIONS.map(f => ({ name: f.name, family: f.value, category: 'sans-serif' }));
  initFontArc(fonts);

  // Set initial font
  state.currentFont = fonts[0]?.family || 'sans-serif';

  fontBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fontArc.classList.toggle('hidden');
    // Close other arcs if open
    toolArc.classList.add('hidden');
    colorArc.classList.add('hidden');
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
    fontArc.classList.add('hidden');
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
  swatch.classList.remove('eraser-mode');
  swatch.style.background = state.currentColor;
}

// Update visibility of tool-dependent controls (font button, color button)
function updateToolDependentControls() {
  const colorBtnWrap = document.getElementById('color-btn-wrap');
  const fontBtnWrap = document.getElementById('font-btn-wrap');

  // Hide color button in eraser mode
  if (state.currentTool === 'eraser') {
    colorBtnWrap.classList.add('hidden');
  } else {
    colorBtnWrap.classList.remove('hidden');
    updateColorBtnSwatch();
  }

  // Show font button only in text mode
  if (state.currentTool === 'text') {
    fontBtnWrap.classList.remove('hidden');
  } else {
    fontBtnWrap.classList.add('hidden');
  }
}

// Update font button label
function updateFontBtnLabel() {
  const label = document.getElementById('font-btn-label');
  // Use admin fonts if available, otherwise fall back to default FONT_OPTIONS
  const fonts = window.appAvailableFonts || FONT_OPTIONS.map(f => ({ name: f.name, family: f.value }));
  const fontOption = fonts.find(f => f.family === state.currentFont);
  label.textContent = fontOption ? fontOption.name : 'Font';
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
    // If typing text, finish it first
    if (state.isTypingText) {
      finishTypingText();
    }
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
    // Inline text input - click to start/move typing position
    const worldPos = state.canvasManager.screenToWorld(screenX, screenY);

    // If already typing, submit current text first
    if (state.isTypingText && state.currentText.length > 0) {
      finishTypingText();
    }

    // Start typing at new position
    startTypingText(worldPos);
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
      // If typing text, finish it first
      if (state.isTypingText) {
        finishTypingText();
      }
      touchMode = 'draw';
      const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
      const drawColor = state.currentTool === 'eraser' ? '#FFFFFF' : state.currentColor;
      state.canvasManager.startStroke(worldPos.x, worldPos.y, state.currentWidth, drawColor, state.userCountry);
    } else if (state.currentTool === 'text') {
      touchMode = 'text';
      const worldPos = state.canvasManager.screenToWorld(screenX, screenY);

      // If already typing, submit current text first
      if (state.isTypingText && state.currentText.length > 0) {
        finishTypingText();
      }

      // Start typing at new position
      startTypingText(worldPos);
    }
  } else if (e.touches.length === 2) {
    // Cancel any in-progress draw stroke if a second finger appears
    if (state.canvasManager.isDrawing) {
      state.canvasManager.isDrawing = false;
      state.canvasManager.currentStroke = null;
    }
    // If typing, finish text
    if (state.isTypingText) {
      finishTypingText();
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

// ===== Inline Text Input =====

// Start typing text at position
function startTypingText(worldPos) {
  state.isTypingText = true;
  state.currentText = '';
  state.textWorldPos = worldPos;
  state.cursorVisible = true;

  // Start cursor blink
  if (state.cursorBlinkInterval) {
    clearInterval(state.cursorBlinkInterval);
  }
  state.cursorBlinkInterval = setInterval(() => {
    state.cursorVisible = !state.cursorVisible;
    state.canvasManager.render();
  }, 530);

  state.canvasManager.render();
}

// Handle keyboard input for inline text
function handleTextKeydown(e) {
  if (!state.isTypingText) return false;

  // Enter = finish typing
  if (e.key === 'Enter') {
    e.preventDefault();
    finishTypingText();
    return true;
  }

  // Escape = cancel typing
  if (e.key === 'Escape') {
    e.preventDefault();
    cancelTypingText();
    return true;
  }

  // Backspace = delete last character
  if (e.key === 'Backspace') {
    e.preventDefault();
    state.currentText = state.currentText.slice(0, -1);
    state.canvasManager.render();
    return true;
  }

  // Ignore control keys, function keys, etc.
  if (e.key.length > 1 && !e.key.startsWith('Arrow')) {
    return true; // Consume but don't add to text
  }

  // Arrow keys - ignore for text input
  if (e.key.startsWith('Arrow')) {
    return true;
  }

  // Add typed character (printable characters only)
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    // Limit text length
    if (state.currentText.length < 100) {
      state.currentText += e.key;
      state.canvasManager.render();
    }
    return true;
  }

  return false;
}

// Finish typing and add text stroke
function finishTypingText() {
  if (!state.isTypingText) return;

  const text = state.currentText.trim();

  if (text && state.textWorldPos) {
    const fontSize = state.currentWidth * 2;
    const inkCost = state.canvasManager.addTextStroke(
      state.textWorldPos.x,
      state.textWorldPos.y,
      text,
      fontSize,
      state.currentColor,
      state.userCountry,
      state.currentFont
    );

    // Deduct ink
    if (state.userInk) {
      state.userInk.inkRemaining -= inkCost;
      updateInkGauge();
    }

    resetInactivityTimer();
    showUndoButton();
  }

  // Clear typing state
  stopTypingText();
}

// Cancel typing without saving
function cancelTypingText() {
  stopTypingText();
}

// Stop typing (cleanup)
function stopTypingText() {
  state.isTypingText = false;
  state.currentText = '';
  state.textWorldPos = null;

  if (state.cursorBlinkInterval) {
    clearInterval(state.cursorBlinkInterval);
    state.cursorBlinkInterval = null;
  }

  state.canvasManager.render();
}

// Start ink updater (refill over time)
function startInkUpdater() {
  state.inkInterval = setInterval(() => {
    updateInkGauge();
  }, 1000); // Update every second
}

// Keyboard handler
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    // Ignore if user is typing in a DOM input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

    // Handle inline text input first
    if (state.isTypingText) {
      if (handleTextKeydown(e)) {
        return; // Event was handled by text input
      }
    }

    // Arrow key pan (only when not typing)
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

  // SPECIAL CASE: If currently drawing, flush in-progress stroke but keep drawing active
  if (state.canvasManager.isDrawing && state.canvasManager.currentStroke) {
    console.log('Flushing in-progress stroke (user still drawing)...');

    // Clone the current stroke and save it
    const strokeToSave = {
      points: [...state.canvasManager.currentStroke.points],
      color: state.canvasManager.currentStroke.color,
      timestamp: state.canvasManager.currentStroke.timestamp,
      country: state.canvasManager.currentStroke.country,
      inkUsed: state.canvasManager.currentStroke.inkUsed
    };

    // Group by tile
    const strokesByTile = {};
    const tileId = getTileId(strokeToSave.points[0], strokeToSave.points[1], TILE_SIZE);
    strokesByTile[tileId] = [strokeToSave];

    // Save to Firebase
    const success = await saveStrokes(strokesByTile, state.userIpHash, strokeToSave.inkUsed);

    if (success) {
      // Mark that this stroke was already saved to Firebase
      state.currentStrokeWasFlushed = true;
      console.log('In-progress stroke saved. User continues drawing...');
    }

    // Reset timer for next auto-flush cycle
    resetInactivityTimer();
    return;
  }

  // NORMAL CASE: Flush completed local strokes
  if (localStrokes.length === 0) return;

  console.log(`Flushing ${localStrokes.length} completed stroke(s)...`);

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
