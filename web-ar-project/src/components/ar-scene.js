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
      { active:false, target:null, offset:new THREE.Vector3(), plane:new THREE.Plane() },
      { active:false, target:null, offset:new THREE.Vector3(), plane:new THREE.Plane() }
    ];

    this._fallbackVideo = null;
    // Neu
    this._lostDebounceTimer = null;
    this._migratedToVirtual = false;
  }

  async init() {
    await this.setupARScene();
  }

  async setupARScene() {
    await this._waitForARCamera(4000);

    await this._ensureARVideoReady();

    const video = document.querySelector('#arjs-video') || this._fallbackVideo;
    if (video) {
      try {
        await this.handTracker.init(video);
        this.handTracker.on('cursor', (d) => this.onCursor(d));
        this.handTracker.on('poke',   (d) => this.onPoke(d));
        this.handTracker.on('grab',   (d) => this.onGrab(d));
      } catch (e) {
        console.warn('HandTracking Fehler:', e);
      }
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

  createVirtualMarker() {
    const scene = document.querySelector('a-scene');
    let vm = document.getElementById('virtual-marker');
    if (!vm) {
      vm = document.createElement('a-entity');
      vm.id = 'virtual-marker';
      vm.setAttribute('visible', 'true'); // immer sichtbar
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

    // Echten Marker nie rendern (nur Pose-Quelle)
    this.realMarker.object3D.visible = false;
    this.virtualMarker.object3D.visible = true;

    this.realMarker.addEventListener('markerFound', () => {
      // Debounce "lost" abbrechen
      if (this._lostDebounceTimer) {
        clearTimeout(this._lostDebounceTimer);
        this._lostDebounceTimer = null;
      }

      this.markerVisible = true;
      this.markerLostTime = null;
      if (stateEl) { stateEl.textContent = 'Marker: sichtbar (Tracking)'; stateEl.style.color = '#0f0'; }

      // Collider auf realer Struktur sicherstellen (falls noch nicht migriert)
      this.realMarker.querySelectorAll('.interactable').forEach(el => this._ensureInteractionCollider(el));

      // Welttransform vom echten Marker lesen und auf virtuellen setzen
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

      // Modelle ein einziges Mal auf den virtuellen Marker verschieben (nicht klonen)
      if (!this._migratedToVirtual) {
        this.moveEntitiesToVirtualMarker(this.realMarker);
        this._migratedToVirtual = true;
      }

      if (this.useDeviceMotion) this.motionTracker.calibrate();
    });

    this.realMarker.addEventListener('markerLost', () => {
      // Debounce: nur wirklich "lost" nach kurzer Zeit
      if (this._lostDebounceTimer) clearTimeout(this._lostDebounceTimer);
      this._lostDebounceTimer = setTimeout(() => {
        this._lostDebounceTimer = null;

        this.markerVisible = false;
        this.markerLostTime = Date.now();
        if (stateEl) { stateEl.textContent = 'Marker: verloren (IMU)'; stateEl.style.color = '#ff0'; }

        const wm = this.realMarker.object3D;
        const vm = this.virtualMarker.object3D;

        // Welt-Pose des letzten echten Markers
        const markerWorldPos = new THREE.Vector3();
        const markerWorldQuat = new THREE.Quaternion();
        const markerWorldScale = new THREE.Vector3();
        wm.getWorldPosition(markerWorldPos);
        wm.getWorldQuaternion(markerWorldQuat);
        wm.getWorldScale(markerWorldScale);

        // Virtueller Marker einfrieren
        vm.position.copy(markerWorldPos);
        vm.quaternion.copy(markerWorldQuat);
        vm.scale.copy(markerWorldScale);

        // Kamera-Pose zum Verlustzeitpunkt sichern
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

        // Sichtbarkeit: wir bleiben immer auf virtuellem Marker
        this.virtualMarker.object3D.visible = true;
        this.realMarker.object3D.visible = false;
      }, 300);
    });
  }

  // Cursor je Hand
  onCursor({ handIndex, position }) {
    const i = handIndex ?? 0;
    // Video-Normalized → Viewport → NDC (berücksichtigt Letterboxing)
    const v = this._videoToNDC(position);
    this.cursorNDC[i].set(v.x, v.y);
    this._updateHover(i);
    if (this.grab[i].active) this._dragUpdate(i);
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

    const pinchCenter = center || (thumb && position ? { x: (position.x + thumb.x) * 0.5, y: (position.y + thumb.y) * 0.5 } : position);
    const centerNDC = this._videoToNDC(pinchCenter);
    this.cursorNDC[i].copy(centerNDC);

    if (state === 'start') {
      // Robuster Treffer: Center + Jitter (Radius ~14px)
      const hit = this._raycastAtNDCWithJitter(centerNDC, 14);
      if (!hit) return;

      this.grab[i].active = true;
      this.grab[i].target = hit.el;

      const anchor = this._findAnchorNode(hit.el);
      const anchorUp = new THREE.Vector3(0,1,0).applyQuaternion(
        anchor.object3D.getWorldQuaternion(new THREE.Quaternion())
      ).normalize();
      this.grab[i].plane.setFromNormalAndCoplanarPoint(anchorUp, hit.point.clone());

      const worldPos = hit.el.object3D.getWorldPosition(new THREE.Vector3());
      this.grab[i].offset.copy(hit.point).sub(worldPos);

      this._ensureOriginalColor(hit.el);
      hit.el.setAttribute('color', '#ff9500');
    } else if (state === 'move') {
      if (this.grab[i].active) this._dragUpdate(i);
    } else if (state === 'end') {
      if (this.grab[i].active && this.grab[i].target) this._restoreOriginalColor(this.grab[i].target);
      this.grab[i] = { active:false, target:null, offset:new THREE.Vector3(), plane:new THREE.Plane() };
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

  // Raycast direkt an einer gegebenen NDC-Position (für Pinch-Center)
  _raycastAtNDC(ndc) {
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl?.camera) return null;
    this.raycaster.setFromCamera(ndc, sceneEl.camera);
    return this._intersectFirstInteractable();
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

  _dragUpdate(i) {
    const sceneEl = document.querySelector('a-scene');
    if (!sceneEl?.camera) return;
    const g = this.grab[i];
    if (!g.active || !g.target) return;

    this.raycaster.setFromCamera(this.cursorNDC[i], sceneEl.camera);
    const p = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(g.plane, p)) return;

    const targetWorld = p.clone().sub(g.offset);
    const parent = g.target.object3D.parent;
    if (!parent) return;
    const parentInv = new THREE.Matrix4().copy(parent.matrixWorld).invert();
    targetWorld.applyMatrix4(parentInv);

    const cur = g.target.object3D.position.clone();
    cur.lerp(targetWorld, 0.45);
    g.target.object3D.position.copy(cur);
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
      if (!this.markerVisible && this.virtualMarker?.object3D.visible) {
        const vm = this.virtualMarker.object3D;

        // Kamera aktuelle Weltpose lesen (liefert auf Mobile zumindest Orientation; Position oft 0, aber falls AR.js/A-Frame etwas liefert, nutzen wir es)
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
          // IMU Rotations-Delta auf Kamerarotation anwenden
          const qNow  = this.motionTracker.getQuaternion().clone().normalize();
          const qLoss = this.deviceQuaternionAtLoss.clone().normalize();
          const qDelta = qNow.multiply(qLoss.invert()).normalize();
          const qOpp = qDelta.clone().invert(); // Geräteraum → Kameraraum Korrektur
          camQuatNow = camQuatNow.clone().multiply(qOpp).normalize();
        }

        // Neue Kamera-Matrix aus aktueller Position + korrigierter Rotation
        const C1 = new THREE.Matrix4().compose(
          camPosNow,
          camQuatNow,
          new THREE.Vector3(1,1,1)
        );

        // Marker = C1 * (C0^-1 * M0)
        const M1 = new THREE.Matrix4().copy(C1).multiply(this.T_camToMarkerAtLoss);
        const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
        M1.decompose(pos, quat, scl);

        vm.position.copy(pos);
        vm.quaternion.copy(quat);
        vm.scale.copy(this.markerScaleAtLoss);
      }

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

  loadModelFromQr(urlOrNull) {
    // Immer auf den virtuellen Anker arbeiten
    const anchor = this.virtualMarker || this.realMarker;
    if (!anchor) return;
    anchor.querySelectorAll('.model-root').forEach(n => n.remove());

    if (!urlOrNull) {
      const box = document.createElement('a-box');
      box.classList.add('interactable', 'model-root');
      box.setAttribute('color', '#FF9500');
      box.setAttribute('position', '0 0.5 0');
      box.setAttribute('scale', '0.5 0.5 0.5');
      anchor.appendChild(box);
      this._ensureInteractionCollider(box);
      return;
    }
    const model = document.createElement('a-entity');
    model.classList.add('interactable', 'model-root');
    model.setAttribute('gltf-model', urlOrNull);
    model.setAttribute('position', '0 0 0');
    model.setAttribute('rotation', '0 0 0');
    model.setAttribute('scale', '1 1 1');
    anchor.appendChild(model);
    this._ensureInteractionCollider(model);
  }
}