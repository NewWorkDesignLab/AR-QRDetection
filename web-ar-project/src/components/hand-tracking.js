import { HandLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const HAND_CONNECTIONS = [
  // Daumen
  [0,1],[1,2],[2,3],[3,4],
  // Zeigefinger
  [0,5],[5,6],[6,7],[7,8],
  // Mittelfinger
  [0,9],[9,10],[10,11],[11,12],
  // Ringfinger
  [0,13],[13,14],[14,15],[15,16],
  // Kleiner Finger
  [0,17],[17,18],[18,19],[19,20],
  // Handfläche (optional für bessere Form)
  [5,9],[9,13],[13,17],[5,17]
];

export class HandTracker {
  constructor() {
    this.handLandmarker = null;
    this.gestureCallbacks = { cursor: [], grab: [], poke: [], 'pinch-tap': [] };
    this.overlay = document.getElementById('hand-overlay');
    this.octx = this.overlay?.getContext('2d') || null;

    // Zustände pro Hand
    this.prevIndexTip = [null, null];
    this.pinchState = ['open', 'open'];
    this.lastPokeTs = [0, 0];
    this.pokeCooldownMs = 220;

    // NEU: Pinch-Tap State
    this.pinchStartTs = [0, 0];           // Wann Pinch begann
    this.pinchStartPos = [null, null];    // Wo Pinch begann
    this.pinchMoveDist = [0, 0];          // Wie weit bewegt während Pinch
    this.lastPinchTapTs = [0, 0];         // Cooldown für Pinch-Tap
    this.pinchTapCooldownMs = 400;        // Min. Zeit zwischen Taps
    this.pinchConfirmFrames = [0, 0];     // Frames in Pinch-Zustand (Stabilität)

    // Anzeigezustand pro Hand
    this.currentGesture = ['-', '-'];
    this.showPokeUntil = [0, 0];

    this.prevWrist = [null, null];
    this.emitLegacyGestures = false;
  }

  async init(videoElement) {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm'
    );
    this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
        delegate: 'GPU'
      },
      runningMode: 'VIDEO',
      numHands: 2
    });
    this._resizeOverlay();
    window.addEventListener('resize', () => this._resizeOverlay());
    this.startTracking(videoElement);
  }

  _resizeOverlay() {
    if (!this.overlay) return;
    this.overlay.width = window.innerWidth;
    this.overlay.height = window.innerHeight;
  }

  startTracking(videoElement) {
    let lastVideoTime = -1;
    const detectHands = async () => {
      const t = performance.now();
      if (videoElement.currentTime !== lastVideoTime) {
        lastVideoTime = videoElement.currentTime;
        const results = this.handLandmarker.detectForVideo(videoElement, t);

        // Overlay
        this._drawOverlay(results);

        const hands = results.landmarks || [];
        const info = results.handedness || [];

        hands.forEach((lm, i) => {
          const handedness = info?.[i]?.[0]?.categoryName || (i === 0 ? 'Right' : 'Left');
          const tip = lm[8];
          const thumb = lm[4];

          if (tip) this.triggerCallbacks('cursor', { handIndex: i, handedness, position: tip });

          if (thumb && tip) {
            const pinchDist = Math.hypot(thumb.x - tip.x, thumb.y - tip.y);
            const pinchThreshold = 0.045;
            const releaseThreshold = 0.065; // Hysterese: Loslassen braucht mehr Abstand
            
            const wasPinching = this.pinchState[i] === 'hold';
            const isPinching = pinchDist < pinchThreshold;
            const isReleased = pinchDist > releaseThreshold;
            
            const nowTs = performance.now();
            const center = { x: (tip.x + thumb.x) * 0.5, y: (tip.y + thumb.y) * 0.5 };

            if (!wasPinching && isPinching) {
              // ===== PINCH START =====
              this.pinchState[i] = 'hold';
              this.pinchStartTs[i] = nowTs;
              this.pinchStartPos[i] = { x: center.x, y: center.y };
              this.pinchMoveDist[i] = 0;
              this.pinchConfirmFrames[i] = 0;
              this._setGesture(i, 'pinch');
              this.triggerCallbacks('grab', { handIndex: i, handedness, state: 'start', position: tip, thumb, center, landmarks: lm });
            
            } else if (wasPinching && !isReleased) {
              // ===== PINCH HOLD =====
              this.pinchConfirmFrames[i]++;
              
              // Track Bewegung
              if (this.pinchStartPos[i]) {
                const dx = center.x - this.pinchStartPos[i].x;
                const dy = center.y - this.pinchStartPos[i].y;
                this.pinchMoveDist[i] = Math.max(this.pinchMoveDist[i], Math.hypot(dx, dy));
              }
              
              this.triggerCallbacks('grab', { handIndex: i, handedness, state: 'move', position: tip, thumb, center, landmarks: lm });
            
            } else if (wasPinching && isReleased) {
              // ===== PINCH END =====
              const pinchDuration = nowTs - this.pinchStartTs[i];
              const movedDist = this.pinchMoveDist[i];
              const frames = this.pinchConfirmFrames[i];
              const cooldownOk = nowTs - this.lastPinchTapTs[i] > this.pinchTapCooldownMs;
              
              this.pinchState[i] = 'open';
              this._setGesture(i, '-');
              this.triggerCallbacks('grab', { handIndex: i, handedness, state: 'end', position: tip, thumb, center, landmarks: lm });
              
              // ===== PINCH-TAP Erkennung =====
              // Bedingungen:
              // 1. Kurz gehalten (100-350ms) - nicht zu kurz (Rauschen), nicht zu lang (Drag)
              // 2. Kaum bewegt (< 0.03 = ~3% der Bildbreite)
              // 3. Mindestens 3 Frames stabil im Pinch
              // 4. Cooldown eingehalten
              
              const durationOk = pinchDuration > 100 && pinchDuration < 350;
              const notMoved = movedDist < 0.03;
              const stableEnough = frames >= 3;
              
              console.log(`🔍 Pinch-End Check [Hand ${i}]:`, {
                duration: pinchDuration.toFixed(0) + 'ms',
                moved: movedDist.toFixed(3),
                frames,
                durationOk,
                notMoved,
                stableEnough,
                cooldownOk
              });
              
              if (durationOk && notMoved && stableEnough && cooldownOk) {
                this.lastPinchTapTs[i] = nowTs;
                console.log('✅ Pinch-Tap erkannt!', { hand: i, duration: pinchDuration.toFixed(0) });
                this._setGesture(i, 'tap');
                setTimeout(() => {
                  if (this.currentGesture[i] === 'tap') this._setGesture(i, '-');
                }, 300);
                this.triggerCallbacks('pinch-tap', { handIndex: i, handedness, position: center, landmarks: lm });
              }
            }
          }

          // Poke: Nur wenn Zeigefinger gestreckt + Impuls nach vorne + NICHT im Pinch
          const prev = this.prevIndexTip[i];
          if (tip && prev && thumb) {
            const vx = tip.x - prev.x;
            const vy = tip.y - prev.y;
            const speed = Math.hypot(vx, vy);
            const nowTs = performance.now();
            
            // Bedingungen für Poke:
            // 1. Zeigefinger gestreckt (Spitze höher als Mittelgelenk)
            const indexExtended = lm[8]?.y < lm[6]?.y;
            
            // 2. Andere Finger eingeklappt
            const middleFolded = !(lm[12]?.y < lm[10]?.y);
            const ringFolded = !(lm[16]?.y < lm[14]?.y);
            const pinkyFolded = !(lm[20]?.y < lm[18]?.y);
            const othersFolded = middleFolded && ringFolded && pinkyFolded;
            
            // 3. NICHT im Pinch (Daumen weit genug weg von Zeigefinger)
            const pinchDist = Math.hypot(thumb.x - tip.x, thumb.y - tip.y);
            const notPinching = pinchDist > 0.08; // Größerer Abstand als Pinch-Threshold
            
            // 4. Daumen nicht gestreckt Richtung Zeigefinger (sonst ist es eher "pointing")
            const thumbTucked = lm[4]?.y > lm[3]?.y || pinchDist > 0.1;
            
            // 5. Bewegung muss nach "vorne" sein (y wird kleiner = nach oben im Bild)
            const movingForward = vy < -0.01;
            
            // 6. Geschwindigkeit im richtigen Bereich (nicht zu langsam, nicht zu schnell)
            const speedOk = speed > 0.03 && speed < 0.25;
            
            // 7. Cooldown einhalten
            const cooldownOk = nowTs - this.lastPokeTs[i] > this.pokeCooldownMs;
            
            // 8. Hand muss "stabil" sein (Handgelenk bewegt sich nicht zu viel)
            const wrist = lm[0];
            const prevWrist = this.prevWrist?.[i];
            let wristStable = true;
            if (wrist && prevWrist) {
              const wristSpeed = Math.hypot(wrist.x - prevWrist.x, wrist.y - prevWrist.y);
              wristStable = wristSpeed < 0.05; // Handgelenk relativ ruhig
            }
            this.prevWrist = this.prevWrist || [null, null];
            this.prevWrist[i] = wrist ? { x: wrist.x, y: wrist.y } : null;

            const isPoke = indexExtended && 
                          othersFolded && 
                          notPinching && 
                          thumbTucked &&
                          movingForward &&
                          speedOk && 
                          cooldownOk &&
                          wristStable;

            if (isPoke) {
              this.lastPokeTs[i] = nowTs;
              this._setGesture(i, 'poke');
              this.showPokeUntil[i] = nowTs + 450;
              console.log('👆 Poke erkannt!', { i, speed: speed.toFixed(3), pinchDist: pinchDist.toFixed(3) });
              this.triggerCallbacks('poke', { handIndex: i, handedness, position: tip, landmarks: lm });
            }
            
            // Poke-Anzeige abräumen
            if (this.currentGesture[i] === 'poke' && nowTs > this.showPokeUntil[i] && this.pinchState[i] !== 'hold') {
              this._setGesture(i, '-');
            }
          }
          this.prevIndexTip[i] = tip ? { x: tip.x, y: tip.y } : null;
        });

        // Falls keine Hände → Anzeige zurücksetzen
        if (!hands.length) {
          if (this.currentGesture[0] !== '-') this._setGesture(0, '-');
          if (this.currentGesture[1] !== '-') this._setGesture(1, '-');
        }
      }
      requestAnimationFrame(detectHands);
    };
    detectHands();
  }

  _setGesture(i, name) {
    this.currentGesture[i] = name;
    this._updateGestureStatus();
  }

  _updateGestureStatus() {
    const el = document.getElementById('gesture-status');
    if (!el) return;
    // Links/Rechts Zuordnung: Index 0/1 sind nicht garantiert L/R, daher anzeigen beide mit Label
    const left = 'L: ' + (this.currentGesture[1] || '-');
    const right = 'R: ' + (this.currentGesture[0] || '-');
    el.textContent = `${left} | ${right}`;
  }

  _drawOverlay(results) {
    if (!this.octx) return;
    const ctx = this.octx;
    const w = this.overlay.width, h = this.overlay.height;
    ctx.clearRect(0, 0, w, h);

    const hands = results.landmarks || [];
    const info = results.handedness || [];

    hands.forEach((lm, i) => {
      const type = info?.[i]?.[0]?.categoryName || (i === 0 ? 'Right' : 'Left');
      const color = type === 'Right' ? '#00D1FF' : '#FF5E7A';

      // Bones
      ctx.strokeStyle = color + 'cc';
      ctx.lineWidth = 3;
      HAND_CONNECTIONS.forEach(([a,b]) => {
        const pa = lm[a], pb = lm[b];
        if (!pa || !pb) return;
        ctx.beginPath();
        ctx.moveTo(pa.x * w, pa.y * h);
        ctx.lineTo(pb.x * w, pb.y * h);
        ctx.stroke();
      });

      // Joints
      lm.forEach((p, idx) => {
        const x = p.x * w, y = p.y * h;
        const r = idx % 4 === 0 ? 4.5 : 3;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = color;
        ctx.stroke();
      });

      // Label an Handgelenk inkl. Geste
      const wrist = lm[0];
      if (wrist) {
        const g = this.currentGesture[i] || '-';
        const label = `${type} ${g !== '-' ? `· ${g}` : ''}`;
        const bx = wrist.x*w + 6, by = wrist.y*h - 22;
        ctx.fillStyle = '#000000b0';
        ctx.fillRect(bx, by, ctx.measureText ? Math.max(56, ctx.measureText(label).width + 10) : 80, 16);
        ctx.fillStyle = '#fff';
        ctx.font = '11px system-ui';
        ctx.fillText(label, bx + 6, by + 12);
      }

      // Cursor-Ring am Index
      const tip = lm[8];
      const thumb = lm[4];
      const pinched = tip && thumb ? Math.hypot(thumb.x - tip.x, thumb.y - tip.y) < 0.045 : false;
      if (tip) {
        ctx.beginPath();
        ctx.arc(tip.x * w, tip.y * h, pinched ? 18 : 12, 0, Math.PI * 2);
        ctx.strokeStyle = pinched ? '#ff9500' : color;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tip.x * w, tip.y * h, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
    });
  }

  // Legacy-API (nur falls emitLegacyGestures=true)
  processGestures(landmarks, handedness) {
    landmarks.forEach((hand, index) => {
      const gesture = this.detectGesture(hand);
      const handType = handedness?.[index]?.[0]?.categoryName || 'unknown';
      if (gesture === 'poke') {
        this.triggerCallbacks('poke', { handIndex: index, handedness: handType, position: hand[8], landmarks: hand });
      } else if (gesture === 'grab') {
        this.triggerCallbacks('grab', { handIndex: index, handedness: handType, state: 'start', position: hand[8], landmarks: hand });
      }
    });
  }

  detectGesture(landmarks) {
    const indexExtended = landmarks[8]?.y < landmarks[6]?.y;
    const middleExtended = landmarks[12]?.y < landmarks[10]?.y;
    const ringExtended = landmarks[16]?.y < landmarks[14]?.y;
    const pinkyExtended = landmarks[20]?.y < landmarks[18]?.y;
    if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended) return 'poke';
    if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) return 'grab';
    return null;
  }

  on(gesture, callback) {
    if (this.gestureCallbacks[gesture]) this.gestureCallbacks[gesture].push(callback);
  }
  triggerCallbacks(gesture, data) {
    this.gestureCallbacks[gesture].forEach(cb => cb(data));
  }
}