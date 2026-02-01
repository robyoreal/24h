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
  currentTool: 'brush', // 'brush' or 'text'
  currentColor: '#FFFFFF',
  currentWidth: DEFAULT_STROKE_WIDTH,
  userIpHash: null,
  userCountry: null,
  userInk: null,
  inkInterval: null,
  inactivityTimer: null,
  isPanning: false,
  lastMousePos: { x: 0, y: 0 },
  tileListeners: new Map() // Track active listeners
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
  setupToolbar();
  setupCanvas();
  
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
      updateInkDisplay();
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

// Setup toolbar event listeners
function setupToolbar() {
  // Tool buttons
  document.getElementById('brush-tool').addEventListener('click', () => {
    state.currentTool = 'brush';
    updateToolButtons();
  });
  
  document.getElementById('text-tool').addEventListener('click', () => {
    state.currentTool = 'text';
    updateToolButtons();
  });
  
  document.getElementById('undo-btn').addEventListener('click', () => {
    const removed = state.canvasManager.undoLastStroke();
    if (removed) {
      // Refund ink
      state.userInk.inkRemaining += removed.inkUsed;
      updateInkDisplay();
    }
  });
  
  // Stroke width slider
  const widthSlider = document.getElementById('stroke-width');
  widthSlider.addEventListener('input', (e) => {
    state.currentWidth = parseInt(e.target.value);
    document.getElementById('width-display').textContent = state.currentWidth + 'px';
  });
  
  // Color palette
  document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      state.currentColor = swatch.dataset.color;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      swatch.classList.add('active');
    });
  });
  
  // Text modal
  document.getElementById('text-submit').addEventListener('click', submitText);
  document.getElementById('text-cancel').addEventListener('click', closeTextModal);
  document.getElementById('text-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') submitText();
  });
}

// Update tool button states
function updateToolButtons() {
  document.getElementById('brush-tool').classList.toggle('active', state.currentTool === 'brush');
  document.getElementById('text-tool').classList.toggle('active', state.currentTool === 'text');
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
  } else if (state.currentTool === 'brush') {
    // Start drawing
    const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
    state.canvasManager.startStroke(
      worldPos.x, 
      worldPos.y, 
      state.currentWidth, 
      state.currentColor,
      state.userCountry
    );
  } else if (state.currentTool === 'text') {
    // Show text input modal
    const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
    state.textWorldPos = worldPos;
    showTextModal();
  }
  
  updatePositionDisplay(screenX, screenY);
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
    
    // Deduct ink
    if (state.userInk) {
      state.userInk.inkRemaining -= inkCost;
      updateInkDisplay();
    }
    
    // Reset inactivity timer
    resetInactivityTimer();
  }
  
  updatePositionDisplay(screenX, screenY);
}

// Mouse up handler
function handleMouseUp(e) {
  if (state.isPanning) {
    state.isPanning = false;
  } else if (state.canvasManager.isDrawing) {
    state.canvasManager.endStroke();
    resetInactivityTimer();
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

// Touch handlers (basic support)
let lastTouch = null;

function handleTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = touch.clientX - rect.left;
    const screenY = touch.clientY - rect.top;
    
    if (state.currentTool === 'brush') {
      const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
      state.canvasManager.startStroke(
        worldPos.x, 
        worldPos.y, 
        state.currentWidth, 
        state.currentColor,
        state.userCountry
      );
    }
    
    lastTouch = touch;
  }
}

function handleTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 1 && lastTouch) {
    const touch = e.touches[0];
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = touch.clientX - rect.left;
    const screenY = touch.clientY - rect.top;
    
    if (state.canvasManager.isDrawing) {
      const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
      const inkCost = state.canvasManager.continueStroke(worldPos.x, worldPos.y, state.currentWidth);
      
      if (state.userInk) {
        state.userInk.inkRemaining -= inkCost;
        updateInkDisplay();
      }
    }
    
    lastTouch = touch;
  }
}

function handleTouchEnd(e) {
  if (state.canvasManager.isDrawing) {
    state.canvasManager.endStroke();
    resetInactivityTimer();
  }
  lastTouch = null;
}

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
    updateInkDisplay();
  }
  
  resetInactivityTimer();
  closeTextModal();
}

// Update position display
function updatePositionDisplay(screenX, screenY) {
  const worldPos = state.canvasManager.screenToWorld(screenX, screenY);
  document.getElementById('position-display').textContent = 
    `x: ${Math.floor(worldPos.x)}, y: ${Math.floor(worldPos.y)}`;
}

// Update ink display
function updateInkDisplay() {
  if (!state.userInk) return;
  
  const currentInk = calculateCurrentInk(state.userInk, INK_REFILL_RATE);
  const percentage = (currentInk / 250000) * 100;
  
  document.getElementById('ink-fill').style.width = percentage + '%';
  document.getElementById('ink-text').textContent = currentInk.toLocaleString();
}

// Start ink updater (refill over time)
function startInkUpdater() {
  state.inkInterval = setInterval(() => {
    updateInkDisplay();
  }, 1000); // Update every second
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