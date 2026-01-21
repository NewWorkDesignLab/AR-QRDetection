import { HandLandmarker, FilesetResolver } from 'https://esm.sh/@mediapipe/tasks-vision@0.10.7';

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
  // Handfläche
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

    // Pinch-Tap State
    this.pinchStartTs = [0, 0];
    this.pinchStartPos = [null, null];
    this.pinchMoveDist = [0, 0];
    this.lastPinchTapTs = [0, 0];
    this.pinchTapCooldownMs = 400;
    this.pinchConfirmFrames = [0, 0];

    // Anzeigezustand pro Hand
    this.currentGesture = ['-', '-'];
    this.showPokeUntil = [0, 0];

    this.prevWrist = [null, null];
    this.emitLegacyGestures = false;

    // Grab-Sound Verzögerung
    this.grabSoundTimer = [null, null]; // Timer pro Hand
    this.grabSoundDelay = 150; // ms - warte bevor Sound abgespielt wird
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
            const releaseThreshold = 0.065;
            
            const wasPinching = this.pinchState[i] === 'hold';
            const isPinching = pinchDist < pinchThreshold;
            const isReleased = pinchDist > releaseThreshold;
            
            const nowTs = performance.now();
            const center = { x: (tip.x + thumb.x) * 0.5, y: (tip.y + thumb.y) * 0.5 };

            if (!wasPinching && isPinching) {
              // PINCH START
              this.pinchState[i] = 'hold';
              this.pinchStartTs[i] = nowTs;
              this.pinchStartPos[i] = { x: center.x, y: center.y };
              this.pinchMoveDist[i] = 0;
              this.pinchConfirmFrames[i] = 0;
              this._setGesture(i, 'pinch');
              
              // ✅ Trigger Grab OHNE Sound (Silent)
              this.triggerCallbacks('grab', { 
                handIndex: i, 
                handedness, 
                state: 'start', 
                position: tip, 
                thumb, 
                center, 
                landmarks: lm,
                silent: true // ← Flag für AR-Scene
              });
              
              this.grabSoundTimer[i] = setTimeout(() => {
                if (this.pinchState[i] === 'hold') {
                  // Immer noch im Pinch → wahrscheinlich Grab
                  this.triggerCallbacks('grab', { 
                    handIndex: i, 
                    handedness, 
                    state: 'sound', // ← Spezial-Event nur für Sound
                    position: tip, 
                    thumb, 
                    center, 
                    landmarks: lm 
                  });
                }
              }, this.grabSoundDelay);
            
            } else if (wasPinching && !isReleased) {
              // PINCH HOLD
              this.pinchConfirmFrames[i]++;
              
              if (this.pinchStartPos[i]) {
                const dx = center.x - this.pinchStartPos[i].x;
                const dy = center.y - this.pinchStartPos[i].y;
                this.pinchMoveDist[i] = Math.max(this.pinchMoveDist[i], Math.hypot(dx, dy));
              }
              
              this.triggerCallbacks('grab', { 
                handIndex: i, 
                handedness, 
                state: 'move', 
                position: tip, 
                thumb, 
                center, 
                landmarks: lm,
                silent: true
              });
            
            } else if (wasPinching && isReleased) {
              // PINCH END
              const pinchDuration = nowTs - this.pinchStartTs[i];
              const movedDist = this.pinchMoveDist[i];
              const frames = this.pinchConfirmFrames[i];
              const cooldownOk = nowTs - this.lastPinchTapTs[i] > this.pinchTapCooldownMs;
              
              // ✅ Cancel Grab-Sound Timer falls noch aktiv
              if (this.grabSoundTimer[i]) {
                clearTimeout(this.grabSoundTimer[i]);
                this.grabSoundTimer[i] = null;
              }
              
              this.pinchState[i] = 'open';
              this._setGesture(i, '-');
              
              // PINCH-TAP Check
              const durationOk = pinchDuration > 80 && pinchDuration < 400;
              const notMoved = movedDist < 0.035;
              const stableEnough = frames >= 2;
              
              const isPinchTap = durationOk && notMoved && stableEnough && cooldownOk;
              
              // ✅ Trigger Grab-End mit Info ob es ein Tap war
              this.triggerCallbacks('grab', { 
                handIndex: i, 
                handedness, 
                state: 'end', 
                position: tip, 
                thumb, 
                center, 
                landmarks: lm,
                wasTap: isPinchTap, // ← Flag für AR-Scene
                silent: isPinchTap   // ← Kein Release-Sound bei Tap
              });
              
              if (isPinchTap) {
                this.lastPinchTapTs[i] = nowTs;
                console.log('✅ Pinch-Tap!', { hand: i, duration: pinchDuration.toFixed(0) + 'ms' });
                this._setGesture(i, 'tap');
                setTimeout(() => { if (this.currentGesture[i] === 'tap') this._setGesture(i, '-'); }, 300);
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
            const indexExtended = lm[8]?.y < lm[6]?.y;
            const middleFolded = !(lm[12]?.y < lm[10]?.y);
            const ringFolded = !(lm[16]?.y < lm[14]?.y);
            const pinkyFolded = !(lm[20]?.y < lm[18]?.y);
            const othersFolded = middleFolded && ringFolded && pinkyFolded;
            const pinchDist = Math.hypot(thumb.x - tip.x, thumb.y - tip.y);
            const notPinching = pinchDist > 0.08;
            const thumbTucked = lm[4]?.y > lm[3]?.y || pinchDist > 0.1;
            const movingForward = vy < -0.01;
            const speedOk = speed > 0.03 && speed < 0.25;
            const cooldownOk = nowTs - this.lastPokeTs[i] > this.pokeCooldownMs;

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

      const gesture = this.currentGesture[i];
      const colors = { pinch: '#ff9500', tap: '#d81765', poke: '#00ccff' };
      if (tip) {
        ctx.beginPath();
        ctx.arc(tip.x * w, tip.y * h, gesture != '-' ? 18 : 12, 0, Math.PI * 2);
        ctx.strokeStyle = gesture ? colors[gesture] : color;
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