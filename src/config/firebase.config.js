// Firebase Configuration
// 
// TO SET UP:
// 1. Go to https://console.firebase.google.com/
// 2. Create a new project (or use existing)
// 3. Add a web app to your project
// 4. Copy the config object below
// 5. Enable Firestore Database (in Build > Firestore Database)
// 6. Set Firestore rules to allow read/write (see firestore.rules file)

export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
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

// Colors
export const COLOR_PALETTE = [
  '#FFFFFF', // white
  '#FF5733', // red
  '#33FF57', // green
  '#3357FF', // blue
  '#FFFF33', // yellow
  '#FF33FF', // magenta
  '#33FFFF', // cyan
  '#000000'  // black
];

// Buffer settings
export const INACTIVITY_TIMEOUT = 10000; // 10 seconds
export const MAX_BUFFER_SIZE = 50; // Max strokes before force flush
