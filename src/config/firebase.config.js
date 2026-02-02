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
  '#ff70a6', // red
  '#b6e88e', // green
  '#70d6ff', // blue
  '#faf884', // yellow
  '#f6c2f3', // magenta
  '#b7fffa', // cyan
  '#FFFFFF'  // white (always last - needs border)
];

// Buffer settings
export const INACTIVITY_TIMEOUT = 2000; // 2 seconds
export const MAX_BUFFER_SIZE = 50; // Max strokes before force flush