# 24 Hours Wall

A collaborative, infinite canvas where everything fades to white over 24 hours. Draw, write, erase — but nothing lasts forever.

---

## How It Works

### Canvas & Viewport

The canvas is infinite and white. It is divided into **2000×2000 px tiles** stored in Firestore. Only tiles currently in the viewport are loaded; as the user pans into new areas, new tiles are fetched on demand. Loaded tiles subscribe to real-time Firestore updates so changes from other users appear automatically. A spinning indicator in the top-right corner appears whenever tiles are being fetched or strokes are being saved.

Navigation:
- **Mouse drag / touch drag** — pan
- **Scroll wheel / pinch** — zoom in/out

---

### Tools

Three tools are available via an arc menu that fans out from the tool button:

| Tool | Description |
|---|---|
| **Brush** | Freehand drawing. Ink is consumed proportional to `distance × brush width`. |
| **Text** | Click to place a text cursor; type and press Enter to commit. Font and size are controlled by the width dial and font picker. |
| **Eraser** | Paints opaque white (#FFFFFF). Costs no ink. White strokes obey special fading rules (see below). |

A **lock arc** controls movement/drawing mode:

| Lock | Description |
|---|---|
| **Unlock** | Normal mode — one finger/pointer pans, two fingers pinch-zoom. |
| **Brush lock** | All touch points draw simultaneously (multi-finger drawing). Panning is blocked. |
| **Movement lock** | Drawing is blocked; only panning and zooming work. |

---

### Ink System

Each user is identified by a **SHA-256 hash of their IP address**. The user's country is detected via the geolocation API and stored alongside strokes.

- **Max ink**: 250,000 units
- **Cost**: `distance_px × average_brush_width` per stroke segment; text costs `text_width × font_size`
- **Refill rate**: 10,000 units per hour (~2.78/sec), calculated client-side from the `lastRefill` timestamp
- **Eraser**: free — costs no ink
- **Out of ink**: drawing is blocked until ink refills; eraser still works

Ink state is stored in `userInk/{ipHash}` in Firestore and updated on every successful flush.

---

### Stroke Storage & Flushing

Completed strokes are held in a **local buffer** (`localStrokes`) until flushed. Flushing is triggered after **2 seconds of inactivity** (no new drawing or typing). If the user is still drawing when the timer fires, the in-progress stroke is cloned and saved independently so drawing is not interrupted.

The flush writes strokes to Firestore using a **batched write** grouped by tile ID. If the write fails, it retries up to **4 times** with exponential backoff (2 s, 4 s, 8 s, 16 s).

Stroke data format (flat array for drawing strokes):
```
points: [x1, y1, w1, x2, y2, w2, ...]   // world-space coordinates + width per point
color: "#rrggbb"
timestamp: <Unix ms>
country: "ID"
inkUsed: <number>
```

Text stroke format:
```
type: "text"
text: "hello"
position: [worldX, worldY]
fontSize: <px>
fontFamily: "sans-serif"
color: "#rrggbb"
timestamp: <Unix ms>
country: "ID"
inkUsed: <number>
```

---

### Fading — White Overlay System

All strokes fade **linearly to white over 24 hours**. Strokes always render at **100% opacity**; fading is achieved by painting semi-transparent white rectangles on top of the canvas.

#### How buckets work

Strokes are grouped into **30-minute time buckets** (max 48 buckets across 24 h). The canvas is rendered oldest-bucket-first:

1. Draw all strokes in the oldest bucket at full opacity.
2. Paint a white rectangle over the entire canvas at a computed opacity.
3. Draw the next bucket's strokes on top (full opacity).
4. Paint another white rectangle.
5. Repeat through to the newest bucket.

The newest bucket's strokes are drawn last and have the least white on them; the oldest have the most.

#### Corrected overlay formula

Naively using `age / 24h` as the overlay opacity causes **compounding** — each overlay stacks on all previous ones, making strokes fade much faster than intended. To counteract this, each bucket's overlay opacity is adjusted so the *cumulative* effect of all subsequent overlays lands at exactly the right whiteness:

```
W_k  = age_k / FADE_DURATION        // desired final whiteness for bucket k
p_k  = 1 - (1 - W_k) / (1 - W_{k+1})   // adjusted overlay opacity
p_N  = W_N                           // newest bucket: no subsequent overlays
```

With this formula, a stroke drawn 6 h ago ends up at 25% white (75% visible), 12 h ago at 50% white, 23 h ago at 96% white — a perfectly linear ramp regardless of how many buckets exist.

For a full 48-bucket canvas the overlay series follows a harmonic pattern (1/2, 1/3, 1/4 … 1/48, 0%), but the formula adapts automatically to any number of buckets at any ages.

#### White (eraser) strokes

Strokes painted in #FFFFFF act as erasers. They are **excluded from bucket fading** — they always render at 100% opacity — and **disappear instantly** the moment they cross the 24-hour mark (rather than fading gradually).

#### Stroke cleanup

A background cleanup task (`cleanupTile`) periodically deletes strokes older than 24 h from Firestore, keeping tile documents small.

---

### Admin Panel

Accessed via the gear button (⚙️, bottom-right). Password-protected (SHA-256 hash stored in config).

**Config tab options:**

| Setting | Description |
|---|---|
| Ink limit | Maximum ink per user |
| Refill rate | Ink units restored per hour |
| Unlimited ink | Toggle to remove ink cost for all users |
| Allow eraser | Toggle eraser tool availability |
| Color palette | Editable swatches (up to 8 colors); white is always last |
| Available fonts | Add/remove/reorder fonts for the text tool |
| Button icons | Paste SVG code to replace any toolbar icon (brush, text, eraser, locks, undo, admin, upload indicator) |
| Upload indicator icon | SVG displayed in the spinning top-right loader |
| Splash screen | Custom title and description shown to first-time visitors (Indonesian + English) |

Icon fields accept either a full `<svg>` element or just inner elements like `<path d="..."/>`. The upload indicator spins the entire container div — any SVG pasted there will rotate.

---

## Data Structure

### `wallTiles/{tileId}`

```js
{
  bounds: { minX, minY, maxX, maxY },   // world-space tile boundary
  strokes: [ /* stroke objects */ ],
  lastUpdated: <Unix ms>
}
```

Tile ID format: `"tx_{tileX}_ty_{tileY}"` where `tileX = Math.floor(worldX / 2000)`.

### `userInk/{sha256(ip)}`

```js
{
  inkRemaining: 249750,
  lastRefill: <Unix ms>,
  country: "ID",
  createdAt: <Unix ms>
}
```

### `adminSettings/config`

```js
{
  maxInk: 250000,
  inkRefillRate: 10000,
  unlimitedInk: false,
  allowEraser: true,
  colorPalette: ["#000000", ...],
  fonts: [{ name: "Sans", family: "sans-serif" }, ...],
  buttonIcons: {
    toolBrush, toolText, toolEraser,
    lockUnlock, lockBrush, lockMovement,
    undo, admin, uploadIndicator        // SVG strings
  },
  splashContent: {
    titleId, descId, titleEn, descEn
  }
}
```

---

## Configuration (`src/config/firebase.config.js`)

| Constant | Default | Description |
|---|---|---|
| `TILE_SIZE` | 2000 | Tile width/height in world-space pixels |
| `MAX_INK` | 250,000 | Starting ink per user |
| `INK_REFILL_RATE` | 10000/3600 | Ink units per second |
| `FADE_DURATION` | 86,400,000 ms | Time for full fade (24 h) |
| `MIN_STROKE_WIDTH` | 5 | Minimum brush size |
| `MAX_STROKE_WIDTH` | 50 | Maximum brush size |
| `DEFAULT_STROKE_WIDTH` | 10 | Initial brush size |
| `INACTIVITY_TIMEOUT` | 2000 ms | Delay before flushing after drawing stops |
| `MAX_BUFFER_SIZE` | 50 | Stroke count that triggers a force-flush |

---

## Setup

See **SETUP.md** for step-by-step Firebase configuration and deployment instructions.
