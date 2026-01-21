import * as THREE from 'https://esm.sh/three@0.160.0';

class OneEuroFilter {
    constructor({ fMin = 0.8, beta = 0.4, dCutoff = 1.0 } = {}) {
        this.fMin = fMin;
        this.beta = beta;
        this.dCutoff = dCutoff;

        this._xHat = null;
        this._dxHat = 0;
        this._lastX = null;
        this._lastT = null;
    }
    _alpha(dt, cutoff) {
        const tau = 1 / (2 * Math.PI * cutoff);
        return 1 / (1 + tau / dt);
    }
    filter(value, t) {
        if (this._lastT == null) {
            this._xHat = value;
            this._lastX = value;
            this._lastT = t;
            return value;
        }
        const dt = (t - this._lastT) / 1000;
        this._lastT = t;
        if (dt <= 0) return this._xHat;

        // rohe Ableitung
        const dx = (value - this._lastX) / dt;
        this._lastX = value;

        // gefilterte Ableitung
        const aD = this._alpha(dt, this.dCutoff);
        this._dxHat = aD * dx + (1 - aD) * this._dxHat;

        // dynamische Grenzfrequenz
        const cutoff = this.fMin + this.beta * Math.abs(this._dxHat);

        // Wert glätten
        const aX = this._alpha(dt, cutoff);
        this._xHat = aX * value + (1 - aX) * this._xHat;

        return this._xHat;
    }
}

export class DeviceMotionTracker {
    constructor() {
        this.orientation = new THREE.Quaternion(); // Welt-Quaternion (inkl. Screen-Orientation & Kalibrierung)
        this.velocity = new THREE.Vector3();       // Welt-Geschwindigkeit
        this.position = new THREE.Vector3();       // Welt-Position (Delta seit Kalibrierung)

        this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
        this.calibrationQuat = new THREE.Quaternion();
        this.screenOrientation = 0;

        this.lastTs = performance.now();

        // 1-Euro-Filter für Welt-Beschleunigung (x,y,z)
        this._accFilter = [
            new OneEuroFilter({ fMin: 0.9, beta: 0.35, dCutoff: 1.0 }),
            new OneEuroFilter({ fMin: 0.9, beta: 0.35, dCutoff: 1.0 }),
            new OneEuroFilter({ fMin: 0.9, beta: 0.35, dCutoff: 1.0 })
        ];

        this._velDamping = 0.92;
        this._velThreshold = 0.004;
        this._maxVel = 6.0;
    }

    async init() {
        this._bindOrientationChange();
        this.startTracking();
        return true;
    }

    _bindOrientationChange() {
        const read = () => {
            const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
            this.screenOrientation = THREE.MathUtils.degToRad(so || 0);
        };
        window.addEventListener('orientationchange', read, { passive: true });
        read();
    }

    startTracking() {
        window.addEventListener('deviceorientation', (e) => this.handleOrientation(e), { passive: true });
        window.addEventListener('devicemotion', (e) => this.handleMotion(e), { passive: true });
    }

    // alpha(z), beta(x), gamma(y) + Screen-Orientation -> Welt-Quaternion
    handleOrientation(event) {
        if (event.alpha == null) return;
        const alpha = THREE.MathUtils.degToRad(event.alpha || 0);  // Z
        const beta  = THREE.MathUtils.degToRad(event.beta  || 0);  // X
        const gamma = THREE.MathUtils.degToRad(event.gamma || 0);  // Y

        this._euler.set(beta, alpha, -gamma, 'YXZ');
        const qDevice = new THREE.Quaternion().setFromEuler(this._euler);
        const qScreen = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1), -this.screenOrientation);
        const qCalInv = this.calibrationQuat.clone().invert();

        this.orientation.copy(qDevice).multiply(qScreen).multiply(qCalInv).normalize();
    }

    handleMotion(event) {
        const now = performance.now();
        let dt = (now - this.lastTs) / 1000;
        this.lastTs = now;
        if (dt <= 0 || dt > 0.12) return;
        if (!event.accelerationIncludingGravity) return;

        // Device-Koords inkl. Grav
        const aDev = new THREE.Vector3(
            event.accelerationIncludingGravity.x || 0,
            event.accelerationIncludingGravity.y || 0,
            event.accelerationIncludingGravity.z || 0
        );

        // Gravitation raus
        const gWorld = new THREE.Vector3(0, -9.81, 0);
        const gDev = gWorld.clone().applyQuaternion(this.orientation.clone().invert());
        aDev.sub(gDev);

        // Weltbeschleunigung
        const aWorldRaw = aDev.applyQuaternion(this.orientation);

        // 1-Euro filtern je Achse
        const ax = this._accFilter[0].filter(aWorldRaw.x, now);
        const ay = this._accFilter[1].filter(aWorldRaw.y, now);
        const az = this._accFilter[2].filter(aWorldRaw.z, now);

        // Geschwindigkeit integrieren
        this.velocity.x += ax * dt;
        this.velocity.y += ay * dt;
        this.velocity.z += az * dt;

        this.velocity.multiplyScalar(this._velDamping);
        this.velocity.clampLength(0, this._maxVel);
        if (Math.abs(this.velocity.x) < this._velThreshold) this.velocity.x = 0;
        if (Math.abs(this.velocity.y) < this._velThreshold) this.velocity.y = 0;
        if (Math.abs(this.velocity.z) < this._velThreshold) this.velocity.z = 0;

        // Position integrieren
        this.position.addScaledVector(this.velocity, dt);
    }

    calibrate() {
        this.calibrationQuat.copy(this.orientation);
        this.position.set(0,0,0);
        this.velocity.set(0,0,0);
        // Filter zurücksetzen
        this._accFilter.forEach(f => {
            f._xHat = null;
            f._dxHat = 0;
            f._lastX = null;
            f._lastT = null;
        });
    }

    getPosition() { return this.position.clone(); }       // Welt-Delta
    getQuaternion() { return this.orientation.clone(); }   // Welt-Orientierung

    getDebugInfo() {
        return {
            pos: { x: this.position.x, y: this.position.y, z: this.position.z },
            vel: { x: this.velocity.x, y: this.velocity.y, z: this.velocity.z }
        };
    }
}