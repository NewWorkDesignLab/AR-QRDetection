/* eslint-disable no-undef */
// A-Frame bringt THREE global mit; in Modulen explizit referenzieren:
const THREE = (globalThis && globalThis.THREE) ? globalThis.THREE : null;
if (!THREE) {
  console.error('THREE nicht gefunden. A-Frame muss vor diesem Modul geladen werden.');
}

import { DeviceMotionTracker } from './device-motion-tracker.js';
import { HandTracker } from './hand-tracking.js';
import { AudioGenerator } from '../services/audio-generator.js';

export class ARScene {
  constructor() {
    // Tracking / Marker
    this.motionTracker = new DeviceMotionTracker();
    this.handTracker = new HandTracker();
    this.realMarker = null;
    this.virtualMarker = null;
    this.markerVisible = false;
    this.markerLostTime = null;
    this.interactableEntities = [];
    this.useDeviceMotion = false;
    this.currentModel = null;

    // Verlust-Puffer
    this.cameraPositionAtLoss = new THREE.Vector3();
    this.cameraQuaternionAtLoss = new THREE.Quaternion();
    this.deviceQuaternionAtLoss = new THREE.Quaternion();
    this.T_camToMarkerAtLoss = new THREE.Matrix4();
    this.markerScaleAtLoss = new THREE.Vector3(1,1,1);

    // Interaktion (bis zu 2 Hände)
    this.raycaster = new THREE.Raycaster();
    this.cursorNDC = [new THREE.Vector2(), new THREE.Vector2()];
    this.hoverEl = [null, null];
    this.originalColor = new Map();
      this.grab = [
      { active:false, target:null, startCenter:null, upAtStart:null, baseWorldQuat:null, parentWorldInv:null },
      { active:false, target:null, startCenter:null, upAtStart:null, baseWorldQuat:null, parentWorldInv:null }
    ];

    this._fallbackVideo = null;
    this._videoEl = null;
    this._lostDebounceTimer = null;
    this._migratedToVirtual = false;

    this._lastMarkerVisible = false;

    // Rotation State (Yaw + Pitch)
    this._modelYaw = 0;   // Links/Rechts (Y-Achse)
    this._modelPitch = 0; // Oben/Unten (X-Achse)
    this._pitchLimit = Infinity;
    this._rotationSensitivity = 0.9;

    // NEU: Smoothing für Rotation
    this._targetYaw = 0;
    this._targetPitch = 0;
    this._smoothingFactor = 0.3; // 0.1 = sehr smooth, 0.3 = schneller, 1 = sofort

    // Scale State
    this._modelScale = 1.0;
    this._targetScale = 1.0;
    this._minScale = 0.2;   // Minimum 20%
    this._maxScale = 15.0;   // Maximum 1500%
    this._scaleSmoothing = 0.15;

    this._infoPanelOpen = false;
    this._currentModelInfo = {
      title: 'Unbekanntes Modell',
      description: 'Keine Beschreibung verfügbar.',
      meta: {},
      ctaLabel: null,
      ctaValue: null
    };

    // Touch-State
    this._touchState = {
      active: false,
      startX: 0,
      startY: 0,
      startYaw: 0,
      startPitch: 0,
      lastTap: 0,
      singleTapTimer: null  // NEU: Timer für verzögerten Single-Tap
    };
    this._pinchState = {
      active: false,
      startDist: 0,
      startScale: 1.0
    };

    // FPS Limiter
    this._targetFPS = 30;
    this._frameInterval = 1000 / this._targetFPS; // ~33.33ms
    this._lastFrameTime = 0;

    // Audio
    this.audio = new AudioGenerator();
  }

  async init() {
    await this.setupARScene();
  }

  async setupARScene() {
    await this._waitForARCamera(4000);

    await this._ensureARVideoReady();

    // iOS: ggf. vor dem Start Motion-Permission anfragen (best effort)
    await this._ensureMotionPermission();

    const video = document.querySelector('#arjs-video') || this._fallbackVideo || this._videoEl;
    if (video) {
      try {
        await this.handTracker.init(video);
        this.handTracker.on('cursor', (d) => this.onCursor(d));
        this.handTracker.on('poke',   (d) => this.onPoke(d));
        this.handTracker.on('grab',   (d) => this.onGrab(d));
        // Pinch-Tap → Info-Panel öffnen/schließen
        this.handTracker.on('pinch-tap', (d) => this.onPinchTap(d));
      } catch (e) {
        console.warn('HandTracking Fehler:', e);
      }
    } else {
      console.warn('Kein Video-Element gefunden – Handtracking deaktiviert.');
    }

    this.useDeviceMotion = await this.motionTracker.init();
    this.createVirtualMarker();
    this.setupMarkerPersistence();
    this._loop(); // Wichtig: bleibt erhalten für virtuellen Marker

    // Info-Panel Close-Button
    document.getElementById('info-close')?.addEventListener('click', () => {
      this._closeInfoPanel();
    });

    // Touch-Events initialisieren
    this._initTouchControls();
  }

  _waitForARCamera(timeoutMs=4000) {
    return new Promise(async resolve => {
      const scene = document.getElementById('ar-scene');
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };

      const timer = setTimeout(async () => {
        if (!document.querySelector('#arjs-video')) {
          console.warn('AR.js Video nicht gefunden – Fallback getUserMedia');
          await this._initFallbackVideo();
        }
        finish();
      }, timeoutMs);

      scene?.addEventListener('camera-init', () => {
        clearTimeout(timer);
        finish();
      });
      scene?.addEventListener('camera-error', async () => {
        clearTimeout(timer);
        await this._initFallbackVideo();
        finish();
      });
    });
  }

  async _initFallbackVideo() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const v = document.createElement('video');
      v.id = 'fallback-video';
      v.autoplay = true; v.muted = true; v.playsInline = true;
      v.srcObject = stream;
      v.style.position = 'fixed';
      v.style.top = '0'; v.style.left = '0';
      v.style.width = '1px'; v.style.height = '1px';
      document.body.appendChild(v);
      this._fallbackVideo = v;
      await v.play().catch(()=>{});
    } catch (e) {
      console.error('Fallback Kamera fehlgeschlagen', e);
    }
  }

  async _ensureARVideoReady() {
    // Wartet robust auf #arjs-video bzw. Fallback, bis Metadaten da sind
    const findVideo = () => document.querySelector('#arjs-video') || this._fallbackVideo;
    let v = findVideo();

    if (!v) {
      // Beobachte DOM, bis das Video erscheint
      v = await new Promise(resolve => {
        const obs = new MutationObserver(() => {
          const cand = findVideo();
          if (cand) { obs.disconnect(); resolve(cand); }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        // Sicherheitsnetz: nach 2s aufgeben, wenn Fallback existiert
        setTimeout(() => { if (this._fallbackVideo) { obs.disconnect(); resolve(this._fallbackVideo); } }, 2000);
      });
    }

    if (!v) return null;

    // iOS-Attribute
    v.playsInline = true;
    v.muted = true;

    if (v.readyState >= 2) {
      this._videoEl = v;
      return v;
    }
    await new Promise(res => {
      const onReady = () => { v.removeEventListener('loadedmetadata', onReady); v.removeEventListener('loadeddata', onReady); res(); };
      v.addEventListener('loadedmetadata', onReady, { once: true });
      v.addEventListener('loadeddata', onReady, { once: true });
    });
    this._videoEl = v;
    return v;
  }

  async _ensureMotionPermission() {
    try {
      // iOS 13+
      const DM = globalThis.DeviceMotionEvent;
      const DO = globalThis.DeviceOrientationEvent;
      if (DM && typeof DM.requestPermission === 'function') {
        try {
          const r = await DM.requestPermission();
          if (r !== 'granted') console.warn('DeviceMotion Permission nicht erteilt.');
        } catch (e) { console.warn('DeviceMotion Permission Fehler:', e); }
      }
      if (DO && typeof DO.requestPermission === 'function') {
        try {
          const r = await DO.requestPermission();
          if (r !== 'granted') console.warn('DeviceOrientation Permission nicht erteilt.');
        } catch (e) { console.warn('DeviceOrientation Permission Fehler:', e); }
      }
    } catch {}
  }

  createVirtualMarker() {
    const scene = document.querySelector('a-scene');
    let vm = document.getElementById('virtual-marker');
    if (!vm) {
      vm = document.createElement('a-entity');
      vm.id = 'virtual-marker';
      vm.setAttribute('visible', 'true'); // immer sichtbar
      vm.setAttribute('position', '0 0 0');
      vm.setAttribute('rotation', '0 0 0');
      vm.setAttribute('scale', '1 1 1');
      scene.appendChild(vm);
    }
    this.virtualMarker = vm;
  }

  setupMarkerPersistence() {
    this.realMarker = document.getElementById('hiroMarker');
    const statusBox = document.getElementById('marker-status');
    const stateEl = document.getElementById('marker-state');
    if (!this.realMarker) return;
    if (statusBox) statusBox.style.display = 'block';

    // Echten Marker nicht rendern (Pose-Quelle)
    this.realMarker.object3D.visible = false;
    this.virtualMarker.object3D.visible = true;

    this.realMarker.addEventListener('markerFound', () => {
      if (this._lostDebounceTimer) {
        clearTimeout(this._lostDebounceTimer);
        this._lostDebounceTimer = null;
      }

      this.markerVisible = true;
      this.markerLostTime = null;
      if (stateEl) { stateEl.textContent = 'Marker: sichtbar (Tracking)'; stateEl.style.color = '#0f0'; }

      // Collider sicherstellen
      this.realMarker.querySelectorAll('.interactable').forEach(el => this._ensureInteractionCollider(el));

      // Welttransform übernehmen
      const wm = this.realMarker.object3D;
      const vm = this.virtualMarker.object3D;

      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl  = new THREE.Vector3();
      wm.getWorldPosition(pos);
      wm.getWorldQuaternion(quat);
      wm.getWorldScale(scl);

      vm.position.copy(pos);
      vm.quaternion.copy(quat);
      vm.scale.copy(scl);

      // Modelle auf den virtuellen Marker verschieben
      if (!this._migratedToVirtual) {
        this.moveEntitiesToVirtualMarker(this.realMarker);
        this._migratedToVirtual = true;
      }
      this._setModelsVisible(true);
      if (this.useDeviceMotion) this.motionTracker.calibrate();
    });

    this.realMarker.addEventListener('markerLost', () => {
      if (this._lostDebounceTimer) clearTimeout(this._lostDebounceTimer);
      this._lostDebounceTimer = setTimeout(() => {
        this._lostDebounceTimer = null;

        this.markerVisible = false;
        this.markerLostTime = Date.now();
        if (stateEl) { stateEl.textContent = 'Marker: verloren (IMU)'; stateEl.style.color = '#ff0'; }

        const wm = this.realMarker.object3D;
        const vm = this.virtualMarker.object3D;

        // Welt-Pose einfrieren
        const markerWorldPos = new THREE.Vector3();
        const markerWorldQuat = new THREE.Quaternion();
        const markerWorldScale = new THREE.Vector3();
        wm.getWorldPosition(markerWorldPos);
        wm.getWorldQuaternion(markerWorldQuat);
        wm.getWorldScale(markerWorldScale);

        vm.position.copy(markerWorldPos);
        vm.quaternion.copy(markerWorldQuat);
        vm.scale.copy(markerWorldScale);

        // Kamera-Pose sichern
        const cam = document.querySelector('[camera]');
        if (cam) {
          cam.object3D.getWorldPosition(this.cameraPositionAtLoss);
          cam.object3D.getWorldQuaternion(this.cameraQuaternionAtLoss).normalize();
        }

        this.markerScaleAtLoss.copy(markerWorldScale);

        // Relative Transform C0^-1 * M0
        const C0 = new THREE.Matrix4().compose(
          this.cameraPositionAtLoss.clone(),
          this.cameraQuaternionAtLoss.clone(),
          new THREE.Vector3(1,1,1)
        );
        const M0 = new THREE.Matrix4().compose(
          markerWorldPos,
          markerWorldQuat,
          new THREE.Vector3(1,1,1)
        );
        this.T_camToMarkerAtLoss.copy(C0).invert().multiply(M0);

        if (this.useDeviceMotion) {
          this.deviceQuaternionAtLoss.copy(this.motionTracker.getQuaternion()).normalize();
        }

        this.virtualMarker.object3D.visible = true;
        this.realMarker.object3D.visible = false;
      }, 300);
    });
  }

  // Cursor je Hand
  onCursor({ handIndex, position }) {
    const i = handIndex ?? 0;
    const v = this._videoToNDC(position);
    this.cursorNDC[i].set(v.x, v.y);
    this._updateHover(i);
  }

  onPoke({ handIndex, position }) {
    //Poke Interaction logic here
  }

  onGrab({ handIndex, state, position, thumb, center, silent, wasTap }) {
    const i = handIndex ?? 0;
    const pinchCenter = center ||
      (thumb && position ? {
        x: (position.x + thumb.x) * 0.5,
        y: (position.y + thumb.y) * 0.5
      } : position);

    const pc = pinchCenter || { x: 0.5, y: 0.5 };
    const centerNDC = this._videoToNDC(pc);
    this.cursorNDC[i].copy(centerNDC);

    if (state === 'start') {
      this._rotateStart(i, pc);
      
    } else if (state === 'sound') {
      this.audio.grab();
      
    } else if (state === 'move') {
      this._rotateUpdate(i, pc);
      
    } else if (state === 'end') {
      this._rotateEnd(i);
      
      if (!silent && !wasTap) {
        this.audio.release();
      }
    }
  }

  onPinchTap({ handIndex, position }) {
    console.log('📱 Pinch-Tap erkannt → Toggle Info-Panel');
    
    if (this._infoPanelOpen) {
      this._closeInfoPanel();
    } else if (this.currentModel) {
      this._openInfoPanel();
    }
  }

  _updateHover(i) {
    const hit = this._raycast(i);
    const prev = this.hoverEl[i];

    if (hit?.el !== prev) {
      if (prev && !this._isGrabbed(prev)) this._restoreOriginalColor(prev);
      if (hit?.el && !this._isGrabbed(hit.el)) {
        this._ensureOriginalColor(hit.el);
        hit.el.setAttribute('color', '#00ccff');
      }
      this.hoverEl[i] = hit?.el || null;
    }
  }

  _raycast(i=0) {
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl?.camera) return null;
    this.raycaster.setFromCamera(this.cursorNDC[i], sceneEl.camera);
    return this._intersectFirstInteractable();
  }

  _raycastAtNDC(ndc) {
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl?.camera) return null;
    this.raycaster.setFromCamera(ndc, sceneEl.camera);
    return this._intersectFirstInteractable();
  }

  _raycastAtNDCWithJitter(ndc, radiusPx=12) {
    const hitCenter = this._raycastAtNDC(ndc);
    if (hitCenter) return hitCenter;

    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const dx = (radiusPx * 2) / w;
    const dy = (radiusPx * 2) / h;

    const samples = [
      [ 0,  0],
      [ dx, 0], [-dx, 0], [0, dy], [0, -dy],
      [ dx, dy], [ dx, -dy], [ -dx, dy], [ -dx, -dy]
    ];
    for (const [ox, oy] of samples) {
      const p = new THREE.Vector2(ndc.x + ox, ndc.y + oy);
      const hit = this._raycastAtNDC(p);
      if (hit) return hit;
    }
    return null;
  }

  _intersectFirstInteractable() {
    const sceneEl = document.querySelector('a-scene');
    const meshes = [];
    sceneEl.object3D.traverse(o => { if (o.isMesh) meshes.push(o); });
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (!hits.length) return null;

    for (const h of hits) {
      let o = h.object;
      while (o && !o.el) o = o.parent;
      let el = o?.el;
      if (el?.classList?.contains('hit-collider')) el = el.parentElement;
      if (el && el.classList?.contains('interactable')) {
        return { el, point: h.point, object: h.object };
      }
    }
    return null;
  }

  _rotateStart(i, pinchCenterNorm) {
    const target = this.currentModel;
    if (!target) return;

    this.grab[i].active = true;
    this.grab[i].target = target;
    this.grab[i].startCenter = { 
      x: pinchCenterNorm.x ?? 0.5, 
      y: pinchCenterNorm.y ?? 0.5 
    };
    this.grab[i].initialYaw = this._modelYaw;
    this.grab[i].initialPitch = this._modelPitch;

    this._ensureOriginalColor(target);
    target.setAttribute('color', '#ff9500');
  }

  _rotateUpdate(i, pinchCenterNorm) {
    const g = this.grab[i];
    if (!g.active || !g.target || !g.startCenter) return;

    const dx = (pinchCenterNorm?.x ?? 0.5) - g.startCenter.x;
    const dy = (pinchCenterNorm?.y ?? 0.5) - g.startCenter.y;

    // Zielwerte setzen (statt direkte Rotation)
    this._targetYaw = g.initialYaw + dx * Math.PI * 2 * this._rotationSensitivity;
    this._targetPitch = g.initialPitch + (dy * Math.PI * 2 * this._rotationSensitivity);
    
    // Pitch begrenzen
    this._targetPitch = Math.max(-this._pitchLimit, Math.min(this._pitchLimit, this._targetPitch));
  }

  _rotateEnd(i) {
    if (this.grab[i].active && this.grab[i].target) {
      this._restoreOriginalColor(this.grab[i].target);
    }
    this.grab[i] = { 
      active: false, 
      target: null, 
      startCenter: null, 
      initialYaw: 0, 
      initialPitch: 0 
    };
  }

  _findAnchorNode(el) {
    let n = el;
    while (n && n.id !== 'hiroMarker' && n.id !== 'virtual-marker' && n !== document.querySelector('a-scene')) {
      n = n.parentElement || n.parentNode?.el || n.parentNode;
    }
    return (n && n.object3D) ? n : document.getElementById('virtual-marker');
  }

  _ensureOriginalColor(el) {
    if (!this.originalColor.has(el)) {
      const c = el.getAttribute('color');
      this.originalColor.set(el, c ?? null);
    }
  }

  _restoreOriginalColor(el) {
    const c = this.originalColor.get(el);
    if (c == null) el.removeAttribute('color');
    else el.setAttribute('color', c);
  }

  _isGrabbed(el) {
    return (this.grab[0].target === el && this.grab[0].active) || (this.grab[1].target === el && this.grab[1].active);
  }

  _loop() {
    const tick = (timestamp) => {
      // FPS Throttling
      const elapsed = timestamp - this._lastFrameTime;
      
      if (elapsed < this._frameInterval) {
        requestAnimationFrame(tick);
        return; // Frame überspringen
      }
      
      // Frame durchführen
      this._lastFrameTime = timestamp - (elapsed % this._frameInterval);
      
      const wasVisible = this._lastMarkerVisible;
      const isVisible = this.markerVisible;

      if (isVisible && this.realMarker && this.virtualMarker) {
        const rm = this.realMarker.object3D;
        const vm = this.virtualMarker.object3D;
        rm.updateMatrixWorld(true);

        vm.position.copy(rm.getWorldPosition(new THREE.Vector3()));
        vm.scale.copy(rm.getWorldScale(new THREE.Vector3()));
        vm.quaternion.identity();

        if (this.currentModel) {
          // Rotation interpolieren
          this._modelYaw += (this._targetYaw - this._modelYaw) * this._smoothingFactor;
          this._modelPitch += (this._targetPitch - this._modelPitch) * this._smoothingFactor;
          this._applyRotation(this.currentModel, this._modelYaw, this._modelPitch);
          
          // Scale interpolieren
          this._modelScale += (this._targetScale - this._modelScale) * this._scaleSmoothing;
          const baseScale = this.currentModel._baseScale || 1;
          const s = baseScale * this._modelScale;
          this.currentModel.object3D.scale.set(s, s, s);
        }

      } else if (!isVisible && this.virtualMarker?.object3D.visible) {
        // IMU-Tracking
        const vm = this.virtualMarker.object3D;
        const sceneEl = document.querySelector('a-scene');
        const camEl = sceneEl?.camera ? sceneEl.camera.el : document.querySelector('[camera]');
        const camObj = camEl?.object3D;

        let camPosNow = this.cameraPositionAtLoss.clone();
        let camQuatNow = this.cameraQuaternionAtLoss.clone();
        if (camObj) {
          camObj.getWorldPosition(camPosNow);
          camObj.getWorldQuaternion(camQuatNow).normalize();
        }
        if (this.useDeviceMotion) {
          const qNow  = this.motionTracker.getQuaternion().clone().normalize();
          const qLoss = this.deviceQuaternionAtLoss.clone().normalize();
          const qDelta = qNow.multiply(qLoss.invert()).normalize();
          const qOpp = qDelta.clone().invert();
          camQuatNow = camQuatNow.clone().multiply(qOpp).normalize();
        }
        const C1 = new THREE.Matrix4().compose(camPosNow, camQuatNow, new THREE.Vector3(1,1,1));
        const M1 = new THREE.Matrix4().copy(C1).multiply(this.T_camToMarkerAtLoss);
        const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
        M1.decompose(pos, quat, scl);

        vm.position.copy(pos);
        vm.quaternion.identity();
        vm.scale.set(1, 1, 1);

        // Smoothed Rotation + Scale anwenden
        if (this.currentModel) {
          this._modelYaw += (this._targetYaw - this._modelYaw) * this._smoothingFactor;
          this._modelPitch += (this._targetPitch - this._modelPitch) * this._smoothingFactor;
          this._applyRotation(this.currentModel, this._modelYaw, this._modelPitch);
          
          this._modelScale += (this._targetScale - this._modelScale) * this._scaleSmoothing;
          const baseScale = this.currentModel._baseScale || 1;
          const s = baseScale * this._modelScale;
          this.currentModel.object3D.scale.set(s, s, s);
        }
      }

      this._lastMarkerVisible = isVisible;
      requestAnimationFrame(tick);
    };
    
    // Starte Loop mit initialem Timestamp
    requestAnimationFrame(tick);
  }

  // Verschiebt Interactables vom echten auf den virtuellen Marker (kein Duplikat)
  moveEntitiesToVirtualMarker(realMarker) {
    const vm = this.virtualMarker;
    const children = realMarker.querySelectorAll('.interactable');
    children.forEach(c => {
      vm.appendChild(c); // move statt clone
      this._ensureInteractionCollider(c);
      this.interactableEntities.push(c);
    });
  }

  _ensureInteractionCollider(el) {
    // No-Op für einfache Primitives; bei GLTF optionalen, transparenten Box-Collider ergänzen
    if (!el || el.classList.contains('has-collider')) return;

    if (el.hasAttribute('geometry')) {
      el.classList.add('has-collider');
      return;
    }

    if (el.hasAttribute('gltf-model')) {
      const addBox = () => {
        try {
          const bbox = new THREE.Box3().setFromObject(el.object3D);
          if (!bbox || !isFinite(bbox.min.x) || !isFinite(bbox.max.x)) return;
          const size = new THREE.Vector3();
          const center = new THREE.Vector3();
          bbox.getSize(size);
          bbox.getCenter(center);

          const collider = document.createElement('a-entity');
          collider.classList.add('hit-collider');
          collider.setAttribute('geometry', `primitive: box; width: ${Math.max(0.01, size.x)}; height: ${Math.max(0.01, size.y)}; depth: ${Math.max(0.01, size.z)}`);
          collider.setAttribute('material', 'color: #ffffff; opacity: 0.001; transparent: true; side: double');
          collider.object3D.position.copy(center);
          el.appendChild(collider);
          el.classList.add('has-collider');
        } catch {}
      };
      if (el.getObject3D('mesh')) {
        addBox();
      } else {
        el.addEventListener('model-loaded', addBox, { once: true });
      }
    }
  }

  _setModelsVisible(flag) {
    (this.virtualMarker || this.realMarker)
      ?.querySelectorAll('.model-root')
      .forEach(el => { el.object3D.visible = flag; });
  }

  loadModelFromQr(urlOrNull, initialScale = 1.0) {
    const anchor = this.virtualMarker || this.realMarker;
    if (!anchor) return;

    // Remove loading label from BOTH markers
    this.realMarker?.querySelectorAll('.loading-label').forEach(n => n.remove());
    this.virtualMarker?.querySelectorAll('.loading-label').forEach(n => n.remove());
    
    // Remove old models
    anchor.querySelectorAll('.model-root').forEach(n => n.remove());

    const setActive = (el, baseScale) => {
      this.currentModel = el;
      this._ensureInteractionCollider(el);
      
      // Reset Rotation
      this._modelYaw = 0;
      this._modelPitch = 0;
      this._targetYaw = 0;
      this._targetPitch = 0;

      this._modelScale = 1.0  // Interaktiver Multiplikator (bleibt 1.0)
      this._targetScale = 1.0;

      el._baseScale = baseScale;

      const s = baseScale * this._modelScale;
      el.object3D.scale.set(s, s, s);
      
      el.object3D.visible = this.markerVisible;
      
      console.log(`[Model] Loaded with base scale: ${baseScale}, applied: ${s}`);
    };

    if (!urlOrNull) {
      // Demo-Würfel
      const box = document.createElement('a-box');
      box.classList.add('interactable', 'model-root');
      box.setAttribute('color', '#FF9500');
      box.setAttribute('position', '0 0.5 0');
      box.setAttribute('scale', '0.5 0.5 0.5');
      anchor.appendChild(box);
      setActive(box, 0.5); // Demo-Würfel hat festen Scale 0.5
      return;
    }

    const model = document.createElement('a-entity');
    model.classList.add('interactable', 'model-root');
    model.setAttribute('gltf-model', urlOrNull);
    model.setAttribute('position', '0 0 0');
    model.setAttribute('rotation', '0 0 0');
    
    // ✅ Initialen Scale aus DB anwenden
    model.setAttribute('scale', `${initialScale} ${initialScale} ${initialScale}`);
    
    anchor.appendChild(model);
    
    model.addEventListener('model-loaded', () => {
      console.log('[Model] GLTF loaded successfully');
    }, { once: true });
    
    setActive(model, initialScale);
  }

  // Mappt Video-Normalized (0..1) auf NDC (-1..1), Y nach oben
  _videoToNDC(p) {
    if (!p) return new THREE.Vector2(0, 0);
    const x = (p.x ?? 0);
    const y = (p.y ?? 0);
    const ndcX = x * 2 - 1;
    const ndcY = -(y * 2 - 1);
    return new THREE.Vector2(ndcX, ndcY);
  }

  _applyRotation(el, yaw, pitch) {
    if (!el?.object3D) return;

    // Trackball-Style: Rotation akkumuliert sich
    // Yaw und Pitch werden um FESTE Welt-Achsen angewendet
    
    const qYaw = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0), // Welt-Y (vertikal)
      yaw
    );
    
    const qPitch = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), // Welt-X (horizontal)
      pitch
    );
    
    // Reihenfolge für intuitive Steuerung:
    // Yaw * Pitch = Erst um Y drehen, dann um die NEUE X-Achse kippen
    // Pitch * Yaw = Erst kippen, dann um WELT-Y drehen (Gimbal-Lock frei)
    
    // Für Bildschirm-paralleles Kippen: Pitch * Yaw
    const combined = new THREE.Quaternion();
    combined.multiplyQuaternions(qPitch, qYaw);
    
    el.object3D.quaternion.copy(combined).normalize();
  }

  _openInfoPanel() {
    const panel = document.getElementById('info-panel');
    const title = document.getElementById('info-title');
    const desc = document.getElementById('info-description');
    const meta = document.getElementById('info-meta');
    const ctaBtn = document.getElementById('info-cta-btn');

    if (!panel) return;

    title.textContent = this._currentModelInfo.title;
    desc.textContent = this._currentModelInfo.description;
    this.audio.infoOpen();

    // Meta-Infos anzeigen
    const metaObj = this._currentModelInfo.meta || {};
    meta.innerHTML = Object.entries(metaObj)
      .map(([k, v]) => `<div><strong>${k}:</strong> ${v}</div>`)
      .join('');

    // CTA Button verwalten
    if (ctaBtn && this._currentModelInfo.ctaLabel && this._currentModelInfo.ctaValue) {
      ctaBtn.textContent = this._currentModelInfo.ctaLabel;
      ctaBtn.classList.remove('hidden');
      ctaBtn.style.display = 'inline-flex';
      ctaBtn.onclick = () => this._handleCtaClick(this._currentModelInfo.ctaValue);
    } else if (ctaBtn) {
      ctaBtn.classList.add('hidden');
    }

    panel.classList.remove('hidden');
    this._infoPanelOpen = true;
  }

  _closeInfoPanel() {
    this.audio.infoClose();
    const panel = document.getElementById('info-panel');
    if (panel) panel.classList.add('hidden');
    this._infoPanelOpen = false;
  }

  setModelInfo(info) {
    this._currentModelInfo = {
      title: info.title || 'Unbekanntes Modell',
      description: info.description || 'Keine Beschreibung verfügbar.',
      meta: info.meta || {},
      ctaLabel: info.ctaLabel || null,
      ctaValue: info.ctaValue || null
    };
  }

  _handleCtaClick(ctaValue) {
    if (!ctaValue) return;

    console.log('[CTA] Clicked with value:', ctaValue);
    this.audio.click();

    // Email
    if (ctaValue.includes('@') || ctaValue.toLowerCase().startsWith('mailto:')) {
      const mailtoUrl = ctaValue.startsWith('mailto:') ? ctaValue : `mailto:${ctaValue}`;
      window.location.href = mailtoUrl;
      return;
    }

    // Telefon
    if (ctaValue.match(/^[\d\s\+\-\(\)]+$/) || ctaValue.toLowerCase().startsWith('tel:')) {
      const telUrl = ctaValue.startsWith('tel:') ? ctaValue : `tel:${ctaValue.replace(/\s/g, '')}`;
      window.location.href = telUrl;
      return;
    }

    // URL
    if (ctaValue.startsWith('http://') || ctaValue.startsWith('https://') || ctaValue.startsWith('www.')) {
      const url = ctaValue.startsWith('www.') ? `https://${ctaValue}` : ctaValue;
      window.open(url, '_blank');
      return;
    }

    // Fallback
    window.open(`https://${ctaValue}`, '_blank');
  }

  _initTouchControls() {
    const canvas = document.querySelector('canvas') || document.body;
    
    let touchStartTime = 0;
    let touchMoved = false;

    // Hilfsfunktion: Distanz zwischen zwei Touches
    const getTouchDistance = (touches) => {
      if (touches.length < 2) return 0;
      const dx = touches[0].clientX - touches[1].clientX;
      const dy = touches[0].clientY - touches[1].clientY;
      return Math.hypot(dx, dy);
    };

    canvas.addEventListener('touchstart', (e) => {
      touchStartTime = performance.now();
      touchMoved = false;

      if (e.touches.length === 1) {
        // Single Touch → Rotation
        const touch = e.touches[0];
        this._touchState.active = true;
        this._touchState.startX = touch.clientX;
        this._touchState.startY = touch.clientY;
        this._touchState.startYaw = this._targetYaw;
        this._touchState.startPitch = this._targetPitch;
        
        if (this.currentModel) {
          this._ensureOriginalColor(this.currentModel);
          this.currentModel.setAttribute('color', '#ff9500');
        }
      } else if (e.touches.length === 2) {
        // Two Finger → Scale (Rotation deaktivieren)
        this._touchState.active = false;
        this._pinchState.active = true;
        this._pinchState.startDist = getTouchDistance(e.touches);
        this._pinchState.startScale = this._targetScale;
        touchMoved = true; // Verhindert Tap-Erkennung
        
        if (this.currentModel) {
          this._ensureOriginalColor(this.currentModel);
          this.currentModel.setAttribute('color', '#00ff88'); // Grün für Scale
        }
      }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this._touchState.active) {
        // Single Touch → Rotation
        const touch = e.touches[0];
        const dx = touch.clientX - this._touchState.startX;
        const dy = touch.clientY - this._touchState.startY;
        
        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
          touchMoved = true;
        }
        
        if (touchMoved && this.currentModel) {
          const sensitivityX = 0.008;
          const sensitivityY = 0.008;
          
          this._targetYaw = this._touchState.startYaw + dx * sensitivityX;
          const newPitch = this._touchState.startPitch + dy * sensitivityY;
          this._targetPitch = Math.max(-this._pitchLimit, Math.min(this._pitchLimit, newPitch));
        }
      } else if (e.touches.length === 2 && this._pinchState.active) {
        // Two Finger → Scale
        const currentDist = getTouchDistance(e.touches);
        if (this._pinchState.startDist > 10) { // Mindestabstand
          const scaleFactor = currentDist / this._pinchState.startDist;

          const baseScale = this.currentModel?._baseScale || 1.0;
          let newScale = baseScale * scaleFactor; 

          newScale = Math.max(this._minScale, Math.min(this._maxScale, newScale));
          
          this._targetScale = newScale / baseScale; 
          
          console.log(`[Scale] Base: ${baseScale}, Factor: ${scaleFactor.toFixed(2)}, Final: ${newScale.toFixed(2)}`);
        }
      }
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
      // Pinch beenden wenn weniger als 2 Finger
      if (e.touches.length < 2 && this._pinchState.active) {
        this._pinchState.active = false;
        if (this.currentModel) {
          this._restoreOriginalColor(this.currentModel);
        }
      }

      // Single Touch Ende
      if (e.touches.length === 0) {
        if (this._touchState.active) {
          this._touchState.active = false;
          
          const touchDuration = performance.now() - touchStartTime;
          const now = performance.now();
          
          if (this.currentModel) {
            this._restoreOriginalColor(this.currentModel);
            this.audio.release();
          }
          
          // Tap Detection (nur wenn nicht bewegt und nicht gepincht)
          if (!touchMoved && touchDuration < 300) {
            const timeSinceLastTap = now - this._touchState.lastTap;
            
            if (this._touchState.singleTapTimer) {
              clearTimeout(this._touchState.singleTapTimer);
              this._touchState.singleTapTimer = null;
            }
            
            if (timeSinceLastTap < 350) {
              // Double Tap → Reset Rotation UND Scale
              this._targetYaw = 0;
              this._targetPitch = 0;
              this._targetScale = 1.0;
              this.audio.success();
              console.log('👆👆 Double Tap → Reset (Rotation + Scale)');
              this._touchState.lastTap = 0;
            } else {
              this._touchState.lastTap = now;
              this._touchState.singleTapTimer = setTimeout(() => {
                this._touchState.singleTapTimer = null;
                console.log('👆 Single Tap → Info-Panel toggle');
                if (this._infoPanelOpen) {
                  this._closeInfoPanel();
                } else if (this.currentModel) {
                  this._openInfoPanel();
                }
              }, 350);
            }
          }
        }
        
        this._pinchState.active = false;
      }
    }, { passive: true });

    canvas.addEventListener('touchcancel', () => {
      if (this.currentModel) {
        this._restoreOriginalColor(this.currentModel);
      }
      this._touchState.active = false;
      this._pinchState.active = false;
    }, { passive: true });

    console.log('📱 Touch-Controls initialisiert (Rotation + Scale)');
  }
}