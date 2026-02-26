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
    this.hasCV = false;
    
    this.cvWorker = null;
    this.cvReady = false;
    this._solvePnPPromise = null;
    
    this._canvasWidth = 480;
    this._canvasHeight = 360;
    
    this._lastValidResult = null;
    this._smoothingFactor = 0.6;
  }

  async init(videoEl, { fovDeg } = {}) {
    this.video = videoEl;
    if (fovDeg) this.fovDev = fovDeg;

    const w = videoEl.videoWidth || videoEl.width || videoEl.clientWidth || 640;
    const h = videoEl.videoHeight || videoEl.height || videoEl.clientHeight || 480;
    
    this._canvasWidth = Math.min(480, Math.max(320, w * 0.75));
    this._canvasHeight = Math.floor(this._canvasWidth * (h / w));
    
    this.canvas.width = this._canvasWidth;
    this.canvas.height = this._canvasHeight;

    const f = 0.5 * this._canvasWidth / Math.tan((this.fovDeg * Math.PI/180) / 2);
    const cx = this._canvasWidth / 2;
    const cy = this._canvasHeight / 2;
    this.K = { fx: f, fy: f, cx, cy };

    // NEU: Initialisiere OpenCV Worker
    try {
      await this._initCVWorker();
    } catch (err) {
      console.warn('[QR] OpenCV Worker init failed, fallback to jsQR-only:', err);
    }

    console.log(`[QR] Canvas: ${this._canvasWidth}x${this._canvasHeight}, FOV: ${this.fovDeg}°`);
    return true;
  }

  async _initCVWorker() {
    return new Promise((resolve, reject) => {
      try {
        this.cvWorker = new Worker('./workers/opencv-worker.js');
        
        this.cvWorker.onmessage = (e) => {
          if (e.data.type === 'ready') {
            this.cvReady = e.data.success;
            if (this.cvReady) {
              console.log('[QR] OpenCV Worker ready');
              resolve();
            } else {
              reject(new Error('CV Worker timeout'));
            }
          } else if (e.data.type === 'solvePnP') {
            if (this._solvePnPPromise) {
              this._solvePnPPromise.resolve(e.data);
              this._solvePnPPromise = null;
            }
          }
        };
        
        this.cvWorker.onerror = (err) => {
          console.error('[QR] Worker error:', err);
          reject(err);
        };
        
        // Starte Worker
        this.cvWorker.postMessage({ type: 'init' });
        
        // Timeout nach 10s
        setTimeout(() => {
          if (!this.cvReady) {
            reject(new Error('CV Worker init timeout'));
          }
        }, 10000);
      } catch (err) {
        reject(err);
      }
    });
  }

  async _solvePnPWithWorker(corners) {
    if (!this.cvWorker || !this.cvReady) return null;
    
    return new Promise((resolve) => {
      this._solvePnPPromise = { resolve };
      
      this.cvWorker.postMessage({
        type: 'solvePnP',
        corners,
        K: this.K,
        tagSize: this.tagSize
      });
      
      // Timeout nach 1s
      setTimeout(() => {
        if (this._solvePnPPromise) {
          resolve(null);
          this._solvePnPPromise = null;
        }
      }, 1000);
    });
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

  // NEU: Schnelle PnP-Estimation OHNE OpenCV (fallback)
  _estimatePnPFast(corners) {
    try {
      const THREE = window.THREE;

      // Kantenlängen in Pixel berechnen (mittlere Kante)
      const d01 = Math.hypot(corners[1].x - corners[0].x, corners[1].y - corners[0].y);
      const d12 = Math.hypot(corners[2].x - corners[1].x, corners[2].y - corners[1].y);
      const d23 = Math.hypot(corners[3].x - corners[2].x, corners[3].y - corners[2].y);
      const d30 = Math.hypot(corners[0].x - corners[3].x, corners[0].y - corners[3].y);
      const edgePx = (d01 + d12 + d23 + d30) / 4;

      if (!edgePx || !this.K) return null;

      // Z-Entfernung: Z = (tagSize * fx) / edgePx
      const z = (this.tagSize * this.K.fx) / edgePx;

      // Centroid
      const cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
      const cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;

      // X/Y in Kamera-Koordinaten
      const x = (cx - this.K.cx) * (z / this.K.fx);
      const y = (cy - this.K.cy) * (z / this.K.fy);

      const pos = new THREE.Vector3(x, -y, -z); // -y / -z für A-Frame Kamera
      const quat = new THREE.Quaternion();

      return { pos, quat, distance: z };
    } catch (err) {
      console.warn('[QR] Fast PnP estimation failed:', err);
      return null;
    }
  }

  detectAndEstimate() {
    if (!this.video || this.video.readyState !== this.video.HAVE_ENOUGH_DATA) {
      return { ok: false };
    }

    this.ctx.drawImage(this.video, 0, 0, this._canvasWidth, this._canvasHeight);
    const img = this.ctx.getImageData(0, 0, this._canvasWidth, this._canvasHeight);

    const res = this._detectQRCode(img);
    if (!res) {
      return { ok: false };
    }

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

    // NEU: Fast PnP Estimation (IMMER)
    let poseData = this._estimatePnPFast(corners);
    
    if (poseData) {
      const result = { ok: true, id: res.data, corners, 
        pos: poseData.pos, 
        quat: poseData.quat,
        distance: poseData.distance,
        timestamp: performance.now() 
      };
      this._lastValidResult = result;
      
      // Asynchron: versuche bessere Pose mit OpenCV Worker
      if (this.cvReady) {
        this._tryComputePoseAsync(corners).catch(console.warn);
      }
      
      return result;
    }

    return { ok: false };
  }

  // NEU: Asynchrone Pose-Berechnung (überschreibt schnelle Estimation)
  async _tryComputePoseAsync(corners) {
    const poseData = await this._solvePnPWithWorker(corners);
    if (!poseData || !poseData.success) return;

    try {
      const THREE = window.THREE;
      const Relems = poseData.R;
      const tvelem = poseData.t;

      const Rm = new THREE.Matrix3().set(
        Relems[0], Relems[1], Relems[2],
        Relems[3], Relems[4], Relems[5],
        Relems[6], Relems[7], Relems[8]
      );

      const A3 = new THREE.Matrix3().set(1,0,0, 0,-1,0, 0,0,-1);
      Rm.premultiply(A3).multiply(A3);
      
      const t3 = new THREE.Vector3(tvelem[0], tvelem[1], tvelem[2]).applyMatrix3(A3);

      let M = new THREE.Matrix4();
      M.makeBasis(
        new THREE.Vector3(Rm.elements[0], Rm.elements[3], Rm.elements[6]),
        new THREE.Vector3(Rm.elements[1], Rm.elements[4], Rm.elements[7]),
        new THREE.Vector3(Rm.elements[2], Rm.elements[5], Rm.elements[8])
      );
      M.setPosition(t3);

      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      M.decompose(pos, quat, scl);

      // Update letztes Result mit besserer Pose
      if (this._lastValidResult) {
        this._lastValidResult.pos = pos;
        this._lastValidResult.quat = quat;
      }
    } catch (err) {
      console.warn('[QR] Pose compute error:', err);
    }
  }
}