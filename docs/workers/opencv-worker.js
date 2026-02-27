// Worker für OpenCV.js
let cvReady = false;

// Warte auf OpenCV
self.onmessage = async (e) => {
  if (e.data.type === 'init') {
    // Lade OpenCV
    importScripts('https://docs.opencv.org/4.x/opencv.js');
    
    // Warte bis cv verfügbar ist
    const checkCV = setInterval(() => {
      if (typeof cv !== 'undefined' && cv.Mat) {
        clearInterval(checkCV);
        cvReady = true;
        self.postMessage({ type: 'ready', success: true });
      }
    }, 100);
    
    setTimeout(() => {
      if (!cvReady) {
        clearInterval(checkCV);
        self.postMessage({ type: 'ready', success: false });
      }
    }, 8000);
  }
  
  // solvePnP Request
  if (e.data.type === 'solvePnP' && cvReady) {
    try {
      const { corners, K, tagSize } = e.data;
      
      const size = tagSize / 2;
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
        K.fx, 0,     K.cx,
        0,    K.fy,  K.cy,
        0,    0,     1
      ]);
      
      const distCoeffs = cv.Mat.zeros(1, 5, cv.CV_64F);
      const rvec = new cv.Mat();
      const tvec = new cv.Mat();
      
      const flag = cv.SOLVEPNP_IPPE_SQUARE ?? cv.SOLVEPNP_ITERATIVE;
      const ok = cv.solvePnP(objPts, imgPts, camMat, distCoeffs, rvec, tvec, false, flag);
      
      if (!ok) {
        objPts.delete();
        imgPts.delete();
        camMat.delete();
        distCoeffs.delete();
        rvec.delete();
        tvec.delete();
        
        self.postMessage({ type: 'solvePnP', success: false });
        return;
      }
      
      // Rodrigues
      const Rcv = new cv.Mat();
      cv.Rodrigues(rvec, Rcv);
      
      const Relems = Rcv.data64F || Rcv.data32F;
      const tvelem = tvec.data64F || tvec.data32F;
      
      const result = {
        type: 'solvePnP',
        success: true,
        R: Array.from(Relems),
        t: [tvelem[0], tvelem[1], tvelem[2]]
      };
      
      objPts.delete();
      imgPts.delete();
      camMat.delete();
      distCoeffs.delete();
      rvec.delete();
      tvec.delete();
      Rcv.delete();
      
      self.postMessage(result);
    } catch (err) {
      self.postMessage({ type: 'solvePnP', success: false, error: err.message });
    }
  }
};