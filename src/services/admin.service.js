import { getFirestore, doc, getDoc, setDoc, updateDoc, collection, getDocs, deleteDoc } from 'firebase/firestore';
import { ADMIN_PASSWORD_HASH, DEFAULT_COLOR_PALETTE, DEFAULT_FONTS } from '../config/firebase.config.js';

// Get Firestore instance (initialized in firebase.service.js)
function getDb() {
  return getFirestore();
}

// Verify admin password
export async function verifyAdminPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hash === ADMIN_PASSWORD_HASH;
}

// Load admin config from Firestore
export async function loadAdminConfig() {
  try {
    const db = getDb();
    const configDoc = await getDoc(doc(db, 'adminSettings', 'config'));
    if (configDoc.exists()) {
      return configDoc.data();
    } else {
      // Create default config if doesn't exist
      const defaultConfig = {
        maintenanceMode: false,
        unlimitedInk: false,
        maxInkPerUser: 250000,
        inkRefillRate: 2.78,
        fadeDuration: 86400000,
        inactivityTimeout: 10000,
        strokeWidthMin: 5,
        strokeWidthMax: 50,
        allowText: true,
        allowEraser: true,
        colorPalette: [...DEFAULT_COLOR_PALETTE],
        fonts: [...DEFAULT_FONTS],
        lastUpdated: Date.now()
      };
      await setDoc(doc(db, 'adminSettings', 'config'), defaultConfig);
      return defaultConfig;
    }
  } catch (error) {
    console.error('Failed to load admin config:', error);
    return null;
  }
}

// Save admin config to Firestore
export async function saveAdminConfig(config) {
  try {
    const db = getDb();
    config.lastUpdated = Date.now();
    await setDoc(doc(db, 'adminSettings', 'config'), config);
    return true;
  } catch (error) {
    console.error('Failed to save admin config:', error);
    return false;
  }
}

// Get system stats
export async function getSystemStats() {
  try {
    const db = getDb();
    const stats = {
      totalUsers: 0,
      activeTiles: 0,
      totalStrokes: 0
    };

    // Count users
    const usersSnapshot = await getDocs(collection(db, 'userInk'));
    stats.totalUsers = usersSnapshot.size;

    // Count tiles and strokes
    const tilesSnapshot = await getDocs(collection(db, 'wallTiles'));
    stats.activeTiles = tilesSnapshot.size;

    tilesSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.strokes) {
        stats.totalStrokes += data.strokes.length;
      }
    });

    return stats;
  } catch (error) {
    console.error('Failed to get system stats:', error);
    return null;
  }
}

// Search users
export async function searchUsers(searchTerm) {
  try {
    const db = getDb();
    const usersSnapshot = await getDocs(collection(db, 'userInk'));
    const results = [];

    usersSnapshot.forEach(docSnapshot => {
      const data = docSnapshot.data();
      const id = docSnapshot.id;

      // Search by IP hash prefix or country code
      if (id.startsWith(searchTerm) || (data.country && data.country.toUpperCase() === searchTerm.toUpperCase())) {
        results.push({
          id,
          ...data
        });
      }
    });

    return results;
  } catch (error) {
    console.error('Failed to search users:', error);
    return [];
  }
}

// Cleanup old strokes (24h+)
export async function cleanupOldStrokes() {
  try {
    const db = getDb();
    const now = Date.now();
    const fadeDuration = 86400000; // 24h
    let cleaned = 0;

    const tilesSnapshot = await getDocs(collection(db, 'wallTiles'));

    for (const tileDoc of tilesSnapshot.docs) {
      const data = tileDoc.data();
      if (!data.strokes) continue;

      const validStrokes = data.strokes.filter(stroke => {
        const age = now - stroke.timestamp;
        return age < fadeDuration;
      });

      if (validStrokes.length < data.strokes.length) {
        cleaned += (data.strokes.length - validStrokes.length);

        if (validStrokes.length === 0) {
          // Delete empty tile
          await deleteDoc(doc(db, 'wallTiles', tileDoc.id));
        } else {
          // Update with remaining strokes
          await updateDoc(doc(db, 'wallTiles', tileDoc.id), {
            strokes: validStrokes,
            lastUpdated: now
          });
        }
      }
    }

    return cleaned;
  } catch (error) {
    console.error('Failed to cleanup old strokes:', error);
    return 0;
  }
}

// Reset all user ink
export async function resetAllUserInk(maxInk) {
  try {
    const db = getDb();
    const usersSnapshot = await getDocs(collection(db, 'userInk'));
    const promises = [];

    usersSnapshot.forEach(docSnapshot => {
      promises.push(
        updateDoc(docSnapshot.ref, {
          inkRemaining: maxInk,
          lastRefill: Date.now()
        })
      );
    });

    await Promise.all(promises);
    return usersSnapshot.size;
  } catch (error) {
    console.error('Failed to reset user ink:', error);
    return 0;
  }
}

// Export all data
export async function exportAllData() {
  try {
    const db = getDb();
    const data = {
      users: [],
      tiles: [],
      config: null,
      exportedAt: Date.now()
    };

    // Export users
    const usersSnapshot = await getDocs(collection(db, 'userInk'));
    usersSnapshot.forEach(docSnapshot => {
      data.users.push({ id: docSnapshot.id, ...docSnapshot.data() });
    });

    // Export tiles
    const tilesSnapshot = await getDocs(collection(db, 'wallTiles'));
    tilesSnapshot.forEach(docSnapshot => {
      data.tiles.push({ id: docSnapshot.id, ...docSnapshot.data() });
    });

    // Export config
    data.config = await loadAdminConfig();

    return data;
  } catch (error) {
    console.error('Failed to export data:', error);
    return null;
  }
}
