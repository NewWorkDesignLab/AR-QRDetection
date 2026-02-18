// Erwartet: window.jsQR (z.B. <script src="https://unpkg.com/jsqr/dist/jsQR.js"></script>)
// Optional: window.cv (OpenCV.js, z.B. <script async src="https://docs.opencv.org/4.x/opencv.js"></script>)
// THREE kommt über A-Frame global (window.THREE)

export class QRPoseTracker {
  constructor({ tagSizeMeters = 0.08, fovDeg = 60 } = {}) {
    this.tagSize = tagSizeMeters;
    this.fovDeg = fovDeg;

    this.video = null;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.K = null;
    this.hasCV = false; // IMMER false – OpenCV nicht nutzen
    
    // NEU: Adaptive Canvas-Größe je nach QR-Nähe
    this._canvasWidth = 480;  // Start kleinere Größe für schnellere Detection
    this._canvasHeight = 360;
    
    this._lastValidResult = null;
    this._smoothingFactor = 0.6; // Etwas weniger Smoothing für schneller Reaktion
    this._frameSkipCounter = 0;
    this._targetFrameSkip = 0; // 0 = jeden Frame, 1 = jeden 2. Frame
  }

  async init(videoEl, { fovDeg } = {}) {
    this.video = videoEl;
    if (fovDeg) this.fovDeg = fovDeg;

    const w = videoEl.videoWidth || videoEl.width || videoEl.clientWidth || 640;
    const h = videoEl.videoHeight || videoEl.height || videoEl.clientHeight || 480;
    
    // NEU: Kleinere Canvas für schnellere Verarbeitung
    // Aber nicht zu klein, sonst verlieren wir QR-Details
    this._canvasWidth = Math.min(480, Math.max(320, w * 0.75));
    this._canvasHeight = Math.floor(this._canvasWidth * (h / w));
    
    this.canvas.width = this._canvasWidth;
    this.canvas.height = this._canvasHeight;

    const f = 0.5 * this._canvasWidth / Math.tan((this.fovDeg * Math.PI/180) / 2);
    const cx = this._canvasWidth / 2;
    const cy = this._canvasHeight / 2;
    this.K = { fx: f, fy: f, cx, cy };

    console.log(`[QR] Canvas: ${this._canvasWidth}x${this._canvasHeight}, FOV: ${this.fovDeg}°`);
    return true;
  }

  // NEU: QR-Größe erkennen & Canvas anpassen
  _estimateQRSize(corners) {
    if (!corners || corners.length !== 4) return null;
    
    // Diagonale berechnen
    const dx = corners[2].x - corners[0].x;
    const dy = corners[2].y - corners[0].y;
    const diagonalPx = Math.hypot(dx, dy);
    
    return diagonalPx;
  }

  // NEU: Frame-Skip adaptiv basierend auf QR-Größe
  _updateFrameSkip(qrSizePx) {
    // Wenn QR sehr klein (< 50px) oder sehr groß (> 400px): Mehr Frames skippen für Processing
    // Normal: Jeden Frame verarbeiten
    
    if (qrSizePx < 50) {
      this._targetFrameSkip = 1; // Jeden 2. Frame
      console.warn(`[QR] QR zu klein (${qrSizePx}px) → Frame-Skip aktiviert`);
    } else if (qrSizePx > 400) {
      this._targetFrameSkip = 2; // Jeden 3. Frame
      console.warn(`[QR] QR zu groß (${qrSizePx}px) → Mehr Frame-Skip`);
    } else {
      this._targetFrameSkip = 0; // Jeden Frame
    }
  }

  _validateCorners(corners) {
    if (!corners || corners.length !== 4) return null;

    const area = this._computeQuadArea(corners);
    const minArea = 100;  // REDUCED von 200
    const maxArea = Math.min(this._canvasWidth, this._canvasHeight) ** 2 * 0.9; // INCREASED
    
    if (area < minArea || area > maxArea) {
      console.warn(`[QR] Ungültige Fläche: ${area}px²`);
      return null;
    }

    const bbox = this._getBoundingBox(corners);
    const ratio = Math.max(bbox.w, bbox.h) / Math.min(bbox.w, bbox.h);
    if (ratio > 3.0) { // RELAXED von 2.5
      console.warn(`[QR] Ungültiges Aspect Ratio: ${ratio}`);
      return null;
    }

    return corners;
  }

  _computeQuadArea(corners) {
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const c1 = corners[i];
      const c2 = corners[(i + 1) % 4];
      area += c1.x * c2.y - c2.x * c1.y;
    }
    return Math.abs(area) / 2;
  }

  _getBoundingBox(corners) {
    const xs = corners.map(c => c.x);
    const ys = corners.map(c => c.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
  }

  _smoothCorners(corners) {
    if (!this._lastValidResult) {
      return corners;
    }

    const lastCorners = this._lastValidResult.corners;
    const smoothed = corners.map((c, i) => ({
      x: c.x * (1 - this._smoothingFactor) + lastCorners[i].x * this._smoothingFactor,
      y: c.y * (1 - this._smoothingFactor) + lastCorners[i].y * this._smoothingFactor
    }));

    return smoothed;
  }

  // NEU: Intelligentere Fallback-Strategie
  _detectQRCode(img) {
    if (!window.jsQR) return null;

    let res = null;
    
    // Versuche 1: Normal (schnell)
    res = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    
    // Versuche 2: Mit Inversion nur wenn nötig
    if (!res) {
      res = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' });
    }

    // Versuche 3: Kontrast-Enhancement nur wenn beide fehlgeschlagen
    if (!res) {
      const imgCopy = new ImageData(
        new Uint8ClampedArray(img.data),
        img.width,
        img.height
      );
      this._enhanceContrast(imgCopy);
      res = window.jsQR(imgCopy.data, imgCopy.width, imgCopy.height, { inversionAttempts: 'dontInvert' });
    }

    return res;
  }

  _enhanceContrast(imageData) {
    const data = imageData.data;
    const gamma = 1.15;
    const contrastFactor = 1.25;
    const offset = 128 * (1 - contrastFactor) / 2;

    for (let i = 0; i < data.length; i += 4) {
      const r = Math.pow(data[i] / 255, 1 / gamma) * 255;
      const g = Math.pow(data[i + 1] / 255, 1 / gamma) * 255;
      const b = Math.pow(data[i + 2] / 255, 1 / gamma) * 255;

      data[i] = Math.min(255, Math.max(0, r * contrastFactor + offset));
      data[i + 1] = Math.min(255, Math.max(0, g * contrastFactor + offset));
      data[i + 2] = Math.min(255, Math.max(0, b * contrastFactor + offset));
    }
  }

  detectAndEstimate() {
    if (!this.video || this.video.readyState !== this.video.HAVE_ENOUGH_DATA) {
      return { ok: false };
    }

    // NEU: Frame-Skip Logik
    this._frameSkipCounter++;
    if (this._frameSkipCounter < this._targetFrameSkip + 1) {
      // Fallback zum letzten Result wenn wir einen Frame überspringen
      if (this._lastValidResult) {
        const age = Date.now() - (this._lastValidResult.timestamp || 0);
        if (age < 100) {
          return this._lastValidResult;
        }
      }
      return { ok: false };
    }
    this._frameSkipCounter = 0;

    // Frame mit HIGH_PERFORMANCE Context zeichnen
    this.ctx.drawImage(this.video, 0, 0, this._canvasWidth, this._canvasHeight);
    const img = this.ctx.getImageData(0, 0, this._canvasWidth, this._canvasHeight);

    const res = this._detectQRCode(img);
    if (!res) {
      return { ok: false };
    }

    // Ecken extrahieren
    const p = res.location;
    let corners = [
      { x: p.topLeftCorner.x,     y: p.topLeftCorner.y },
      { x: p.topRightCorner.x,    y: p.topRightCorner.y },
      { x: p.bottomRightCorner.x, y: p.bottomRightCorner.y },
      { x: p.bottomLeftCorner.x,  y: p.bottomLeftCorner.y },
    ];

    if (!this._validateCorners(corners)) {
      return { ok: false };
    }

    corners = this._smoothCorners(corners);

    // OHNE OpenCV: nur ID + Ecken zurückgeben
    const result = { ok: true, id: res.data, corners, timestamp: Date.now() };
    this._lastValidResult = result;
    
    return result;
  }
}