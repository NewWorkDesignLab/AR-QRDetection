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
    this.K = null; // Kamera-Matrix
    this.hasCV = typeof window.cv !== 'undefined';
  }

  async init(videoEl, { fovDeg } = {}) {
    this.video = videoEl;
    if (fovDeg) this.fovDeg = fovDeg;

    // Canvas Dimensionen setzen
    const w = videoEl.videoWidth || videoEl.width || videoEl.clientWidth || 640;
    const h = videoEl.videoHeight || videoEl.height || videoEl.clientHeight || 480;
    this.canvas.width = Math.min(640, w);   // runterskalieren für Speed
    this.canvas.height = Math.floor(this.canvas.width * (h / w));

    // Kameramatrix aus FOV schätzen
    const f = 0.5 * this.canvas.width / Math.tan((this.fovDeg * Math.PI/180) / 2);
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    this.K = { fx: f, fy: f, cx, cy };

    return true;
  }

  // liefert { ok, id, pos(THREE.Vector3), quat(THREE.Quaternion), corners }
  detectAndEstimate() {
    if (!this.video) return { ok: false };

    // Frame ziehen
    this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
    const img = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);

    // QR erkennen
    if (!window.jsQR) return { ok: false };
    const res = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    if (!res) return { ok: false };

    const p = res.location;
    const corners = [
      { x: p.topLeftCorner.x,     y: p.topLeftCorner.y },
      { x: p.topRightCorner.x,    y: p.topRightCorner.y },
      { x: p.bottomRightCorner.x, y: p.bottomRightCorner.y },
      { x: p.bottomLeftCorner.x,  y: p.bottomLeftCorner.y },
    ];

    if (!this.hasCV) {
      // Ohne PnP: nur ID zurückgeben; Pose-Fusion übernimmt IMU/Marker
      return { ok: true, id: res.data, corners };
    }

    // solvePnP mit OpenCV.js
    const size = this.tagSize / 2;
    // 3D-Objektpunkte (im Tag-Frame, z=0, Uhrzeigersinn)
    const objPts = cv.matFromArray(4, 1, cv.CV_32FC3, [
      -size,  size, 0,
       size,  size, 0,
       size, -size, 0,
      -size, -size, 0
    ]);
    const imgPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y,
      corners[1].x, corners[1].y,
      corners[2].x, corners[2].y,
      corners[3].x, corners[3].y
    ]);
    const camMat = cv.matFromArray(3, 3, cv.CV_64F, [
      this.K.fx, 0,         this.K.cx,
      0,         this.K.fy, this.K.cy,
      0,         0,         1
    ]);
    const distCoeffs = cv.Mat.zeros(1, 5, cv.CV_64F); // keine Verzerrungen (angenommen)

    const rvec = new cv.Mat(), tvec = new cv.Mat();
    // IPPE_SQUARE ist ideal für planar square; fallback auf ITERATIVE wenn nicht verfügbar
    const flag = cv.SOLVEPNP_IPPE_SQUARE ?? cv.SOLVEPNP_ITERATIVE;
    const ok = cv.solvePnP(objPts, imgPts, camMat, distCoeffs, rvec, tvec, false, flag);

    objPts.delete(); imgPts.delete(); camMat.delete(); distCoeffs.delete();

    if (!ok) { rvec.delete(); tvec.delete(); return { ok: false }; }

    // rvec -> R
    const Rcv = new cv.Mat();
    cv.Rodrigues(rvec, Rcv);
    rvec.delete();

    // In Three-Koordinaten konvertieren:
    // OpenCV: x=rechts, y=unten, z=vorwärts(+)
    // Three (Kamera schaut -Z): x=rechts, y=oben, z=nach vorn ist NEGATIV
    // Transform A = diag(1,-1,-1)
    const A = new THREE.Matrix4().makeScale(1, -1, -1);

    // R
    const Relems = Rcv.data64F ?? Rcv.data32F;
    const Rm = new THREE.Matrix3().set(
      Relems[0], Relems[1], Relems[2],
      Relems[3], Relems[4], Relems[5],
      Relems[6], Relems[7], Relems[8]
    );
    Rcv.delete();

    let M = new THREE.Matrix4();
    M.makeBasis(
      new THREE.Vector3(Rm.elements[0], Rm.elements[3], Rm.elements[6]),
      new THREE.Vector3(Rm.elements[1], Rm.elements[4], Rm.elements[7]),
      new THREE.Vector3(Rm.elements[2], Rm.elements[5], Rm.elements[8])
    );

    // t
    const t = new THREE.Vector3(
      tvec.data64F ? tvec.data64F[0] : tvec.data32F[0],
      tvec.data64F ? tvec.data64F[1] : tvec.data32F[1],
      tvec.data64F ? tvec.data64F[2] : tvec.data32F[2]
    );
    tvec.delete();

    // Anwenden der A-Transformation: R' = A*R*A, t' = A*t
    const A3 = new THREE.Matrix3().set(1,0,0, 0,-1,0, 0,0,-1);
    Rm.premultiply(A3).multiply(A3); // A*R*A
    const t3 = t.clone().applyMatrix3(A3);

    // Matrix4 aus R' + t'
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

    return { ok: true, id: res.data, pos, quat, corners };
  }
}