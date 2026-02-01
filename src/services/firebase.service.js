import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, getDoc, setDoc, updateDoc, writeBatch, arrayUnion, onSnapshot } from 'firebase/firestore';
import { firebaseConfig } from '../config/firebase.config.js';

let app = null;
let db = null;
let isConfigured = false;

// Initialize Firebase
export function initFirebase() {
  try {
    // Check if config is valid
    if (firebaseConfig.apiKey === 'YOUR_API_KEY') {
      console.warn('Firebase not configured. Please update src/config/firebase.config.js');
      return false;
    }

    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    isConfigured = true;
    console.log('Firebase initialized successfully');
    return true;
  } catch (error) {
    console.error('Firebase initialization error:', error);
    return false;
  }
}

// Get tile ID from coordinates
export function getTileId(x, y, tileSize = 2000) {
  const tileX = Math.floor(x / tileSize);
  const tileY = Math.floor(y / tileSize);
  return `tile_${tileX}_${tileY}`;
}

// Get all tile IDs in viewport
export function getVisibleTileIds(viewport, tileSize = 2000) {
  const { x, y, width, height } = viewport;
  
  const startTileX = Math.floor(x / tileSize);
  const startTileY = Math.floor(y / tileSize);
  const endTileX = Math.floor((x + width) / tileSize);
  const endTileY = Math.floor((y + height) / tileSize);
  
  const tileIds = [];
  for (let tx = startTileX; tx <= endTileX; tx++) {
    for (let ty = startTileY; ty <= endTileY; ty++) {
      tileIds.push(`tile_${tx}_${ty}`);
    }
  }
  
  return tileIds;
}

// Load tile data
export async function loadTile(tileId) {
  if (!isConfigured) return null;
  
  try {
    const tileRef = doc(db, 'wallTiles', tileId);
    const tileSnap = await getDoc(tileRef);
    
    if (tileSnap.exists()) {
      return tileSnap.data();
    } else {
      // Create empty tile
      const emptyTile = {
        bounds: getTileBounds(tileId),
        strokes: [],
        lastUpdated: Date.now()
      };
      await setDoc(tileRef, emptyTile);
      return emptyTile;
    }
  } catch (error) {
    console.error('Error loading tile:', error);
    return null;
  }
}

// Get tile bounds from ID
function getTileBounds(tileId) {
  const match = tileId.match(/tile_(-?\d+)_(-?\d+)/);
  if (!match) return null;
  
  const tileX = parseInt(match[1]);
  const tileY = parseInt(match[2]);
  const tileSize = 2000;
  
  return {
    minX: tileX * tileSize,
    minY: tileY * tileSize,
    maxX: (tileX + 1) * tileSize,
    maxY: (tileY + 1) * tileSize
  };
}

// Save strokes (batched)
export async function saveStrokes(strokesByTile, userIpHash, totalInkUsed) {
  if (!isConfigured) return false;
  
  try {
    const batch = writeBatch(db);
    
    // Update tiles with new strokes
    for (const [tileId, strokes] of Object.entries(strokesByTile)) {
      const tileRef = doc(db, 'wallTiles', tileId);
      
      // First check if tile exists
      const tileSnap = await getDoc(tileRef);
      
      if (tileSnap.exists()) {
        batch.update(tileRef, {
          strokes: arrayUnion(...strokes),
          lastUpdated: Date.now()
        });
      } else {
        // Create new tile with strokes
        batch.set(tileRef, {
          bounds: getTileBounds(tileId),
          strokes: strokes,
          lastUpdated: Date.now()
        });
      }
    }
    
    // Update user ink
    const userRef = doc(db, 'userInk', userIpHash);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      const currentInk = userSnap.data().inkRemaining;
      batch.update(userRef, {
        inkRemaining: currentInk - totalInkUsed,
        lastActivity: Date.now()
      });
    }
    
    await batch.commit();
    return true;
  } catch (error) {
    console.error('Error saving strokes:', error);
    return false;
  }
}

// Initialize or get user ink data
export async function initUserInk(ipHash, country) {
  if (!isConfigured) return null;
  
  try {
    const userRef = doc(db, 'userInk', ipHash);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      return userSnap.data();
    } else {
      // Create new user
      const newUser = {
        inkRemaining: 250000,
        lastRefill: Date.now(),
        country: country,
        createdAt: Date.now()
      };
      await setDoc(userRef, newUser);
      return newUser;
    }
  } catch (error) {
    console.error('Error initializing user ink:', error);
    return null;
  }
}

// Calculate current ink (with refill)
export function calculateCurrentInk(userDoc, refillRate = 10000 / 3600) {
  const timeSinceRefill = (Date.now() - userDoc.lastRefill) / 1000; // seconds
  const refilled = Math.floor(timeSinceRefill * refillRate);
  
  return Math.min(250000, userDoc.inkRemaining + refilled);
}

// Update user's last refill timestamp
export async function updateUserRefillTime(ipHash) {
  if (!isConfigured) return false;
  
  try {
    const userRef = doc(db, 'userInk', ipHash);
    await updateDoc(userRef, {
      lastRefill: Date.now()
    });
    return true;
  } catch (error) {
    console.error('Error updating refill time:', error);
    return false;
  }
}

// Clean up old strokes from a tile
export async function cleanupTile(tileId, maxAge = 24 * 60 * 60 * 1000) {
  if (!isConfigured) return false;
  
  try {
    const tileRef = doc(db, 'wallTiles', tileId);
    const tileSnap = await getDoc(tileRef);
    
    if (!tileSnap.exists()) return false;
    
    const tileData = tileSnap.data();
    const now = Date.now();
    
    // Filter out strokes older than maxAge
    const activeStrokes = tileData.strokes.filter(stroke => {
      return (now - stroke.timestamp) < maxAge;
    });
    
    // Only update if we removed strokes
    if (activeStrokes.length < tileData.strokes.length) {
      await updateDoc(tileRef, {
        strokes: activeStrokes,
        lastUpdated: now
      });
      console.log(`Cleaned ${tileData.strokes.length - activeStrokes.length} old strokes from ${tileId}`);
    }
    
    return true;
  } catch (error) {
    console.error('Error cleaning tile:', error);
    return false;
  }
}

// Subscribe to real-time tile updates
export function subscribeTileUpdates(tileId, callback) {
  if (!isConfigured) return null;
  
  try {
    const tileRef = doc(db, 'wallTiles', tileId);
    
    // Set up real-time listener
    const unsubscribe = onSnapshot(tileRef, (docSnap) => {
      if (docSnap.exists()) {
        callback(tileId, docSnap.data());
      }
    }, (error) => {
      console.error(`Error listening to ${tileId}:`, error);
    });
    
    return unsubscribe; // Return function to unsubscribe later
  } catch (error) {
    console.error('Error setting up tile listener:', error);
    return null;
  }
}

export { db, isConfigured };