# 24 Hours Wall 🎨

A collaborative, infinite canvas where messages and drawings fade away over 24 hours. To keep something visible, you must continuously rewrite it - just like chalk on a wall.

## ✨ Features

- **Infinite Canvas**: Pan and zoom across an endless drawing space
- **Real-time Fading**: All content gradually fades to nothing over 24 hours
- **Drawing & Text**: Use brush tools or add text messages
- **Ink System**: Limited "ink" per user (based on IP), refills over time
- **Anonymous**: No sign-up required, pure creative expression
- **Global Collaboration**: See what others are drawing in real-time

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ installed
- A Firebase account (free tier works perfectly)

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd ephemeral-wall
npm install
```

### 2. Configure Firebase

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project (or use existing)
3. Add a web app to your project
4. Copy the configuration

5. Open `src/config/firebase.config.js` and replace with your config:

```javascript
export const firebaseConfig = {
  apiKey: "your-actual-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "your-sender-id",
  appId: "your-app-id"
};
```

### 3. Set Up Firestore

1. In Firebase Console, go to **Build** > **Firestore Database**
2. Click **Create Database**
3. Choose **Start in test mode** (we'll add rules next)
4. Select a region close to your users

5. Go to **Rules** tab and paste the contents from `firestore.rules`:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /wallTiles/{tileId} {
      allow read: if true;
      allow create, update: if request.auth == null && request.resource.data.strokes.size() < 100;
      allow delete: if false;
    }
    
    match /userInk/{ipHash} {
      allow read: if true;
      allow create: if request.auth == null && 
                      request.resource.data.inkRemaining == 250000;
      allow update: if request.auth == null && 
                      request.resource.data.inkRemaining >= 0 &&
                      request.resource.data.inkRemaining <= 250000;
      allow delete: if false;
    }
  }
}
```

6. Click **Publish**

### 4. Run the App

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## 🎮 How to Use

### Drawing
- Click and drag to draw
- Use the width slider to change brush size (5-50px)
- Click color swatches to change colors
- Press **Undo** to remove your last stroke

### Text
- Click the **T** button to switch to text mode
- Click anywhere on canvas to add text
- Type your message and press Enter or click Add

### Navigation
- **Click & Drag**: Pan around the canvas
- **Scroll Wheel**: Zoom in/out
- **Ctrl/Cmd + Click**: Alternative pan mode

### Ink System
- Each user gets 250,000 "ink pixels" (enough for ~500×500px image)
- Ink is consumed when drawing (distance × brush width)
- Text consumes ink based on character size (width × height)
- Ink refills at 10,000 units/hour automatically

## 📊 Data Structure

### Firestore Collections

**wallTiles**: Stores drawing data in 2000×2000px chunks
```javascript
{
  bounds: { minX, minY, maxX, maxY },
  strokes: [
    {
      points: [[x, y, width], ...],  // For drawings
      color: "#FFFFFF",
      timestamp: 1738310400000,
      country: "ID",
      inkUsed: 250
    }
  ],
  lastUpdated: timestamp
}
```

**userInk**: Tracks each user's ink supply
```javascript
{
  inkRemaining: 249750,
  lastRefill: timestamp,
  country: "ID",
  createdAt: timestamp
}
```

## 🔧 Configuration

All configurable values are in `src/config/firebase.config.js`:

- `TILE_SIZE`: Size of each canvas chunk (default: 2000px)
- `MAX_INK`: Maximum ink per user (default: 250,000)
- `INK_REFILL_RATE`: Ink refill per second (default: ~2.78/sec = 10k/hour)
- `FADE_DURATION`: How long before full fade (default: 24 hours)
- `MIN_STROKE_WIDTH`: Minimum brush size (default: 5px)
- `MAX_STROKE_WIDTH`: Maximum brush size (default: 50px)

## 🎯 Firebase Free Tier Limits

The app is designed to work within Firebase's free tier:

**Firestore**:
- Storage: 1GB (plenty for millions of strokes)
- Reads: 50K/day (9 per user × ~5,000 users)
- Writes: 20K/day (batched, ~10 per user × 2,000 users)

**Estimated capacity**:
- ~1,000-2,000 active users/day
- Millions of strokes stored
- Automatic cleanup of 24hr+ old strokes

## 🚀 Deployment

### Using Firebase Hosting (Recommended)

```bash
# Build the project
npm run build

# Install Firebase tools
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize hosting
firebase init hosting

# Select your project
# Choose 'dist' as public directory
# Configure as single-page app: Yes

# Deploy
firebase deploy
```

Your app will be live at `https://your-project.firebaseapp.com`

### Using Other Hosts (Vercel, Netlify, etc.)

1. Build: `npm run build`
2. Upload the `dist` folder to your hosting provider
3. Configure as a static site

## 🔒 Security Notes

**Current Implementation**:
- IP-based user identification (hashed with SHA-256)
- Anonymous access (no authentication)
- Basic rate limiting via Firestore rules

**For Production**:
- Consider implementing proper rate limiting
- Add CAPTCHA for abuse prevention
- Use Cloud Functions for server-side validation
- Consider requiring authentication for persistent users

## 🐛 Troubleshooting

**"Firebase not configured" warning**:
- Check that you've updated `src/config/firebase.config.js` with your actual Firebase config

**Strokes not saving**:
- Check browser console for errors
- Verify Firestore rules are published
- Ensure your Firebase project has Firestore enabled

**Slow performance**:
- Try reducing `TILE_SIZE` in config
- Clear browser cache
- Check if too many tiles are loaded (pan away and back)

**Ink not refilling**:
- Ink refills happen automatically every second
- Check that `lastRefill` timestamp is being updated in Firestore

## 📝 License

MIT License - feel free to use and modify!

## 🤝 Contributing

Contributions welcome! Some ideas:

- [ ] Mobile app version
- [ ] Export canvas as image
- [ ] Admin moderation tools
- [ ] Different fade speeds per color
- [ ] Collaborative sessions/rooms
- [ ] Undo/redo history
- [ ] Eraser tool
- [ ] Layer support

## 💡 Technical Notes

**Why tiles?**
Breaking the infinite canvas into tiles prevents loading all strokes at once, keeping reads/writes manageable within Firebase free tier.

**Why client-side opacity calculation?**
Storing opacity in Firestore would require constant updates. Calculating it based on timestamp is free and works perfectly.

**Why 10-second flush delay?**
Batching writes reduces Firestore usage dramatically. A single writing session might use 100 writes unbatched, but only 1-2 writes when batched.

## 📧 Support

Questions? Issues? Open a GitHub issue or reach out!

---

Built with ❤️ using Firebase, Vite, and vanilla JavaScript
