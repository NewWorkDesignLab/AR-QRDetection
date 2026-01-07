/* eslint-disable no-undef */
// A-Frame bringt THREE global mit; in Modulen explizit referenzieren:
const THREE = (globalThis && globalThis.THREE) ? globalThis.THREE : null;
if (!THREE) {
  console.error('THREE nicht gefunden. A-Frame muss vor diesem Modul geladen werden.');
}

import { DeviceMotionTracker } from './device-motion-tracker.js';
import { HandTracker } from './hand-tracking.js';

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
    this._uprightPending = false;

    this._lastMarkerVisible = false;

    this._uprightRetryCount = 0;
    this._maxUprightRetries = 5;

    this._modelYaw = 0; // user-controlled yaw (from grab)
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

      this._uprightPending = true;
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

        this._uprightPending = true;
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

  onPoke({ handIndex }) {
    const hit = this._raycast(handIndex ?? 0);
    if (!hit) return;
    const el = hit.el;
    const current = el.getAttribute('color') || '#4CC3D9';
    el.setAttribute('color', current.toLowerCase() === '#4cc3d9' ? '#ff9500' : '#4cc3d9');
  }

  onGrab({ handIndex, state, position, thumb, center }) {
    const i = handIndex ?? 0;
    const pinchCenter = center ||
      (thumb && position ? {
        x: (position.x + thumb.x) * 0.5,
        y: (position.y + thumb.y) * 0.5
      } : position);

    // fail-safe defaults
    const pc = pinchCenter || { x: 0.5, y: 0.5 };

    const centerNDC = this._videoToNDC(pc);
    this.cursorNDC[i].copy(centerNDC);

    if (state === 'start') this._rotateStart(i, pc);
    else if (state === 'move') this._rotateUpdate(i, pc);
    else if (state === 'end') this._rotateEnd(i);
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

  // Robust upright helper: takes a world quaternion and reorients it so that its up aligns with `up`
  _makeUpright(worldQuat, up) {
    const upN = up.clone().normalize();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(worldQuat);
    // project forward onto plane orthogonal to up
    const fwdProj = fwd.clone().sub(upN.clone().multiplyScalar(fwd.dot(upN)));
    if (fwdProj.lengthSq() < 1e-6) fwdProj.set(1, 0, 0); // fallback if parallel
    fwdProj.normalize();
    const right = new THREE.Vector3().crossVectors(upN, fwdProj).normalize();
    const fwdOrtho = new THREE.Vector3().crossVectors(right, upN).normalize();
    const m = new THREE.Matrix4().makeBasis(right, upN, fwdOrtho);
    return new THREE.Quaternion().setFromRotationMatrix(m).normalize();
  }

  _applyUprightTo(el) {
    if (!el?.object3D) return false;

    // World up: IMU gravity or fallback world Y
    const up = this.motionTracker
      ? new THREE.Vector3(0, -1, 0)
          .applyQuaternion(this.motionTracker.getQuaternion())
          .negate()
          .normalize()
      : new THREE.Vector3(0, 1, 0);

    const parent = el.object3D.parent;
    if (!parent) return false;

    parent.updateMatrixWorld(true);
    const parentInv = parent.matrixWorld.clone().invert();

    const worldQ = el.object3D.getWorldQuaternion(new THREE.Quaternion());
    const uprightQ = this._makeUpright(worldQ, up);
    const localQ = uprightQ.clone().premultiply(new THREE.Quaternion().setFromRotationMatrix(parentInv));
    el.object3D.quaternion.copy(localQ).normalize();

    // Validate: check if object's local up aligns with world up
    return this._validateUpright(el, up);
  }

  _validateUpright(el, worldUp) {
    if (!el?.object3D) return false;

    // Get object's current up vector in world space
    const localUp = new THREE.Vector3(0, 1, 0);
    const objWorldQuat = el.object3D.getWorldQuaternion(new THREE.Quaternion());
    const objUp = localUp.applyQuaternion(objWorldQuat).normalize();

    // Dot product: 1 = perfect alignment, 0 = perpendicular, -1 = opposite
    const dot = objUp.dot(worldUp.clone().normalize());

    // Threshold: cos(15°) ≈ 0.966
    const isUpright = dot > 0.9;

    if (!isUpright) {
      console.warn(`⚠️ Upright validation failed: dot=${dot.toFixed(3)}`);
    }
    return isUpright;
  }

  _tryApplyUpright(el) {
    if (!el) return;

    const success = this._applyUprightTo(el);
    if (success) {
      this._uprightRetryCount = 0;
      console.log('✅ Upright applied successfully');
    } else if (this._uprightRetryCount < this._maxUprightRetries) {
      this._uprightRetryCount++;
      console.log(`🔄 Upright retry ${this._uprightRetryCount}/${this._maxUprightRetries}`);
      // Retry after short delay (matrices may not be updated yet)
      setTimeout(() => this._tryApplyUpright(el), 50);
    } else {
      console.warn('❌ Upright failed after max retries');
      this._uprightRetryCount = 0;
    }
  }

  _rotateStart(i, pinchCenterNorm) {
    const target = this.currentModel;
    if (!target) return;

    this.grab[i].active = true;
    this.grab[i].target = target;
    this.grab[i].startCenter = { x: pinchCenterNorm.x ?? 0.5, y: pinchCenterNorm.y ?? 0.5 };
    this.grab[i].initialYaw = this._modelYaw;

    this._ensureOriginalColor(target);
    target.setAttribute('color', '#ff9500');
  }

  _rotateUpdate(i, pinchCenterNorm) {
    const g = this.grab[i];
    if (!g.active || !g.target || !g.startCenter) return;

    const dx = (pinchCenterNorm?.x ?? 0.5) - g.startCenter.x;
    const angleDelta = dx * Math.PI * 2 * 0.8;

    this._modelYaw = g.initialYaw + angleDelta;
    // Rotation wird in _loop angewendet
  }

  _rotateEnd(i) {
    if (this.grab[i].active && this.grab[i].target) {
      this._restoreOriginalColor(this.grab[i].target);
    }
    this.grab[i] = { active:false, target:null, startCenter:null, initialYaw:0 };
  }

  _snapUpwards(obj3D, upVec) {
    const up = upVec.clone().normalize();
    // aktuelle Vorwärtsrichtung bestimmen
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(obj3D.quaternion).normalize();
    // falls parallel, Fallback
    if (Math.abs(fwd.dot(up)) > 0.98) fwd.set(1, 0, 0);

    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const fwdOrtho = new THREE.Vector3().crossVectors(right, up).normalize();

    const m = new THREE.Matrix4().makeBasis(right, up, fwdOrtho);
    obj3D.quaternion.setFromRotationMatrix(m).normalize();
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
    const tick = () => {
      const wasVisible = this._lastMarkerVisible;
      const isVisible = this.markerVisible;

      if (isVisible && this.realMarker && this.virtualMarker) {
        const rm = this.realMarker.object3D;
        const vm = this.virtualMarker.object3D;
        rm.updateMatrixWorld(true);

        // Position und Scale vom Marker
        vm.position.copy(rm.getWorldPosition(new THREE.Vector3()));
        vm.scale.copy(rm.getWorldScale(new THREE.Vector3()));
        // Rotation: Identity (Modell-Rotation wird separat gesetzt)
        vm.quaternion.identity();

        // Modell aufrecht + user yaw anwenden
        if (this.currentModel) {
          this._applyUprightWithYaw(this.currentModel, this._modelYaw);
        }

      } else if (!isVisible && this.virtualMarker?.object3D.visible) {
        // IMU-Tracking: Position aus IMU, Rotation aufrecht + yaw
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
        vm.quaternion.identity(); // Rotation separat
        vm.scale.copy(this.markerScaleAtLoss);

        // Modell aufrecht + user yaw
        if (this.currentModel) {
          this._applyUprightWithYaw(this.currentModel, this._modelYaw);
        }
      }

      this._lastMarkerVisible = isVisible;
      requestAnimationFrame(tick);
    };
    tick();
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

  loadModelFromQr(urlOrNull) {
    const anchor = this.virtualMarker || this.realMarker;
    if (!anchor) return;

    anchor.querySelectorAll('.model-root').forEach(n => n.remove());

    const setActive = (el) => {
      this.currentModel = el;
      this._ensureInteractionCollider(el);
      this._modelYaw = 0; // reset yaw for new model
      el.object3D.visible = this.markerVisible;
    };

    if (!urlOrNull) {
      const box = document.createElement('a-box');
      box.classList.add('interactable', 'model-root');
      box.setAttribute('color', '#FF9500');
      box.setAttribute('position', '0 0.5 0');
      box.setAttribute('scale', '0.5 0.5 0.5');
      anchor.appendChild(box);
      setActive(box);
      return;
    }

    const model = document.createElement('a-entity');
    model.classList.add('interactable', 'model-root');
    model.setAttribute('gltf-model', urlOrNull);
    model.setAttribute('position', '0 0 0');
    model.setAttribute('rotation', '0 0 0');
    model.setAttribute('scale', '1 1 1');
    anchor.appendChild(model);
    model.addEventListener('model-loaded', () => {
      // Wait for scene graph to settle
      requestAnimationFrame(() => {
        this._tryApplyUpright(model);
      });
    }, { once: true });
    setActive(model);
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

  _applyUprightWithYaw(el, yaw) {
    if (!el?.object3D) return;

    // World up: immer (0,1,0)
    const up = new THREE.Vector3(0, 1, 0);

    // Quaternion: nur Yaw um Up-Achse
    const qYaw = new THREE.Quaternion().setFromAxisAngle(up, yaw);
    el.object3D.quaternion.copy(qYaw).normalize();
  }
}