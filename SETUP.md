# 🚀 QUICK SETUP GUIDE

Follow these steps to get your 24 Hours Wall running in ~10 minutes:

## Step 1: Install Dependencies
```bash
npm install
```

## Step 2: Set Up Firebase

### 2.1 Create Firebase Project
1. Go to https://console.firebase.google.com/
2. Click "Add Project"
3. Enter project name (e.g., "ephemeral-wall")
4. Disable Google Analytics (optional)
5. Click "Create Project"

### 2.2 Add Web App
1. In your Firebase project, click the web icon `</>`
2. Register app (nickname: "24 Hours Wall")
3. **Copy the firebaseConfig object**

### 2.3 Update Configuration
Open `src/config/firebase.config.js` and replace the config:

```javascript
export const firebaseConfig = {
  apiKey: "AIza...",              // ← Your actual values
  authDomain: "your-app.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-app.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456:web:abc123"
};
```

### 2.4 Enable Firestore
1. In Firebase Console, click "Build" → "Firestore Database"
2. Click "Create Database"
3. Choose "Start in **production mode**" (we'll add custom rules)
4. Select a location (choose closest to your users)
5. Click "Enable"

### 2.5 Set Security Rules
1. Click the "Rules" tab in Firestore
2. **Copy the entire contents** from `firestore.rules` file in your project
3. Paste into the rules editor
4. Click "Publish"

## Step 3: Run the App
```bash
npm run dev
```

Open http://localhost:5173 in your browser

## Step 4: Test It!

1. You should see a black canvas
2. No warning about "Firebase not configured"
3. Draw something - you should see white strokes
4. Wait 10 seconds - your drawing should save (check browser console for "Strokes saved successfully")
5. Refresh the page - your drawing should still be there (but slightly faded if you wait)

## 🎉 You're Done!

The app is now running locally. To deploy:

```bash
npm run build
firebase deploy
```

---

## ❓ Troubleshooting

**Warning: "Firebase not configured"**
→ You haven't updated `src/config/firebase.config.js` yet

**Error: "permission-denied"**
→ Your Firestore rules aren't set up correctly. Re-check Step 2.5

**Drawings disappear immediately on refresh**
→ Check browser console for errors. Firestore might not be saving.

**Ink meter shows 0**
→ Wait a few seconds for geolocation API to initialize

Need help? Check the full README.md or open an issue!
