// Firebase Configuration
//
// TO SET UP:
// 1. Copy .env.example to .env
// 2. Fill in your Firebase config values from Firebase Console
// 3. Go to https://console.firebase.google.com/
// 4. Create a new project (or use existing)
// 5. Add a web app to your project
// 6. Copy the config values to your .env file
// 7. Enable Firestore Database (in Build > Firestore Database)
// 8. Set Firestore rules to allow read/write (see firestore.rules file)

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || ''
};

// IP Geolocation API configuration
// Using ipapi.co free tier (1000 requests/day)
// Alternative: you can set up Firebase Cloud Function for better privacy
export const GEOLOCATION_API = 'https://ipapi.co/json/';

// Canvas settings
export const TILE_SIZE = 2000; // pixels
export const MAX_INK = 250000; // 500x500 pixels worth
export const INK_REFILL_RATE = 10000 / 3600; // 10k per hour = ~2.78 per second
export const FADE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

// Stroke settings
export const MIN_STROKE_WIDTH = 5;
export const MAX_STROKE_WIDTH = 50;
export const DEFAULT_STROKE_WIDTH = 10;

// Colors - SINGLE SOURCE OF TRUTH
export const COLOR_PALETTE = [
  '#000000', // black (default)
  '#bf212f', // red
  '#006f3c', // green
  '#264b96', // blue
  '#f9a73e', // yellow
  '#f6c2f3', // magenta
  '#00aeef', // cyan
  '#FFFFFF'  // white (always last - needs border)
];

// Font options for text tool
export const FONT_OPTIONS = [
  { name: 'Sans', value: 'sans-serif' },
  { name: 'Serif', value: 'serif' },
  { name: 'Mono', value: 'monospace' },
  { name: 'Cursive', value: 'cursive' }
];

// Buffer settings
export const INACTIVITY_TIMEOUT = 2000; // 2 seconds
export const MAX_BUFFER_SIZE = 50; // Max strokes before force flush

// ===== Admin Settings =====

// Admin password hash (SHA-256)
// Default: empty string hash - CHANGE THIS IMMEDIATELY
// Generate your hash: run `echo -n "your_password" | shasum -a 256` in terminal
export const ADMIN_PASSWORD_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

// Default color palette (used for reset)
export const DEFAULT_COLOR_PALETTE = [
  '#000000', '#FF5733', '#33FF57', '#3357FF',
  '#FFFF33', '#FF33FF', '#33FFFF', '#FFFFFF'
];

// Default font list (used for reset)
export const DEFAULT_FONTS = [
  { name: 'Arial', family: 'Arial, sans-serif', category: 'sans-serif' },
  { name: 'Times New Roman', family: '"Times New Roman", serif', category: 'serif' },
  { name: 'Courier New', family: '"Courier New", monospace', category: 'monospace' },
  { name: 'Georgia', family: 'Georgia, serif', category: 'serif' },
  { name: 'Verdana', family: 'Verdana, sans-serif', category: 'sans-serif' },
  { name: 'Comic Sans MS', family: '"Comic Sans MS", cursive', category: 'cursive' },
  { name: 'Impact', family: 'Impact, sans-serif', category: 'display' },
  { name: 'Trebuchet MS', family: '"Trebuchet MS", sans-serif', category: 'sans-serif' }
];