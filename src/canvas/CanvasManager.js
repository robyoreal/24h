import { FADE_DURATION } from '../config/firebase.config.js';

export class CanvasManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    
    // Viewport state
    this.viewport = {
      x: 0, // Center at 0,0
      y: 0,
      zoom: 1
    };
    
    // Loaded tiles cache
    this.tiles = new Map(); // tileId -> tile data
    
    // Drawing state
    this.isDrawing = false;
    this.currentStroke = null;
    this.localStrokes = []; // Strokes not yet saved to Firebase
    
    this.init();
  }
  
  init() {
    this.resizeCanvas();
    window.addEventListener('resize', () => this.resizeCanvas());
    
    // Center viewport at 0,0
    this.centerViewportAt(0, 0);
  }
  
  resizeCanvas() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight - 60; // Account for toolbar
    this.render();
  }
  
  centerViewportAt(worldX, worldY) {
    this.viewport.x = worldX - (this.canvas.width / 2) / this.viewport.zoom;
    this.viewport.y = worldY - (this.canvas.height / 2) / this.viewport.zoom;
    this.render();
  }
  
  // Convert screen coordinates to world coordinates
  screenToWorld(screenX, screenY) {
    return {
      x: this.viewport.x + screenX / this.viewport.zoom,
      y: this.viewport.y + screenY / this.viewport.zoom
    };
  }
  
  // Convert world coordinates to screen coordinates
  worldToScreen(worldX, worldY) {
    return {
      x: (worldX - this.viewport.x) * this.viewport.zoom,
      y: (worldY - this.viewport.y) * this.viewport.zoom
    };
  }
  
  // Pan viewport
  pan(dx, dy) {
    this.viewport.x -= dx / this.viewport.zoom;
    this.viewport.y -= dy / this.viewport.zoom;
    this.render();
  }
  
  // Zoom viewport
  zoom(delta, centerX, centerY) {
    const worldPos = this.screenToWorld(centerX, centerY);
    
    const zoomFactor = delta > 0 ? 1.1 : 0.9;
    this.viewport.zoom = Math.max(0.1, Math.min(5, this.viewport.zoom * zoomFactor));
    
    // Adjust viewport to keep zoom centered on mouse
    this.viewport.x = worldPos.x - centerX / this.viewport.zoom;
    this.viewport.y = worldPos.y - centerY / this.viewport.zoom;
    
    this.render();
  }
  
  // Add tile data
  addTile(tileId, tileData) {
    this.tiles.set(tileId, tileData);
    this.render();
  }
  
  // Start drawing stroke
  startStroke(worldX, worldY, width, color, country) {
    this.isDrawing = true;
    this.currentStroke = {
      points: [[worldX, worldY, width]],
      color: color,
      timestamp: Date.now(),
      country: country,
      inkUsed: 0
    };
  }
  
  // Continue stroke
  continueStroke(worldX, worldY, width) {
    if (!this.isDrawing || !this.currentStroke) return 0;
    
    const lastPoint = this.currentStroke.points[this.currentStroke.points.length - 1];
    const dx = worldX - lastPoint[0];
    const dy = worldY - lastPoint[1];
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Calculate ink cost
    const avgWidth = (width + lastPoint[2]) / 2;
    const inkCost = distance * avgWidth;
    
    this.currentStroke.points.push([worldX, worldY, width]);
    this.currentStroke.inkUsed += inkCost;
    
    // Render just this new segment for smooth drawing
    this.renderStrokeSegment(lastPoint, [worldX, worldY, width], this.currentStroke.color);
    
    return inkCost;
  }
  
  // End stroke
  endStroke() {
    if (this.currentStroke && this.currentStroke.points.length > 1) {
      this.localStrokes.push(this.currentStroke);
    }
    this.isDrawing = false;
    this.currentStroke = null;
  }
  
  // Add text stroke
  addTextStroke(worldX, worldY, text, fontSize, color, country) {
    // Measure text to calculate ink
    this.ctx.font = `${fontSize}px Arial`;
    const metrics = this.ctx.measureText(text);
    const width = metrics.width;
    const height = fontSize;
    const inkUsed = width * height;
    
    const textStroke = {
      type: 'text',
      text: text,
      position: [worldX, worldY],
      fontSize: fontSize,
      color: color,
      timestamp: Date.now(),
      country: country,
      inkUsed: inkUsed
    };
    
    this.localStrokes.push(textStroke);
    this.render();
    
    return inkUsed;
  }
  
  // Get local strokes (for flushing to Firebase)
  getLocalStrokes() {
    return this.localStrokes;
  }
  
  // Clear local strokes (after successful save)
  clearLocalStrokes() {
    this.localStrokes = [];
  }
  
  // Undo last local stroke
  undoLastStroke() {
    if (this.localStrokes.length > 0) {
      const removed = this.localStrokes.pop();
      this.render();
      return removed;
    }
    return null;
  }
  
  // Render stroke segment (for smooth drawing)
  renderStrokeSegment(point1, point2, color) {
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = (point1[2] + point2[2]) / 2 * this.viewport.zoom;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    const screen1 = this.worldToScreen(point1[0], point1[1]);
    const screen2 = this.worldToScreen(point2[0], point2[1]);
    
    this.ctx.beginPath();
    this.ctx.moveTo(screen1.x, screen1.y);
    this.ctx.lineTo(screen2.x, screen2.y);
    this.ctx.stroke();
  }
  
  // Render entire canvas
  render() {
    // Clear canvas
    this.ctx.fillStyle = '#0a0a0a';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    
    const now = Date.now();
    
    // Render all strokes from loaded tiles
    for (const [tileId, tileData] of this.tiles.entries()) {
      if (!tileData.strokes) continue;
      
      for (const stroke of tileData.strokes) {
        this.renderStroke(stroke, now);
      }
    }
    
    // Render local strokes (not yet saved)
    for (const stroke of this.localStrokes) {
      this.renderStroke(stroke, now);
    }
    
    // Render current stroke being drawn
    if (this.currentStroke) {
      this.renderStroke(this.currentStroke, now);
    }
  }
  
  // Render individual stroke
  renderStroke(stroke, now) {
    // Calculate opacity based on age
    const age = now - stroke.timestamp;
    const opacity = Math.max(0, 1 - (age / FADE_DURATION));
    
    if (opacity <= 0) return; // Don't render fully faded strokes
    
    if (stroke.type === 'text') {
      // Render text
      this.ctx.font = `${stroke.fontSize * this.viewport.zoom}px Arial`;
      this.ctx.fillStyle = stroke.color;
      this.ctx.globalAlpha = opacity;
      
      const screenPos = this.worldToScreen(stroke.position[0], stroke.position[1]);
      this.ctx.fillText(stroke.text, screenPos.x, screenPos.y);
      
      this.ctx.globalAlpha = 1;
    } else {
      // Render drawing stroke
      if (!stroke.points || stroke.points.length < 2) return;
      
      this.ctx.strokeStyle = stroke.color;
      this.ctx.globalAlpha = opacity;
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
      
      this.ctx.beginPath();
      
      for (let i = 0; i < stroke.points.length; i++) {
        const point = stroke.points[i];
        const screenPos = this.worldToScreen(point[0], point[1]);
        const width = point[2] * this.viewport.zoom;
        
        if (i === 0) {
          this.ctx.moveTo(screenPos.x, screenPos.y);
        } else {
          this.ctx.lineWidth = width;
          this.ctx.lineTo(screenPos.x, screenPos.y);
        }
      }
      
      this.ctx.stroke();
      this.ctx.globalAlpha = 1;
    }
  }
  
  // Get current viewport info
  getViewport() {
    return {
      x: this.viewport.x,
      y: this.viewport.y,
      width: this.canvas.width / this.viewport.zoom,
      height: this.canvas.height / this.viewport.zoom,
      zoom: this.viewport.zoom
    };
  }
}
