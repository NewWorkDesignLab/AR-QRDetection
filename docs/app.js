/* filepath: /Users/philip/Documents/NWDL/QR Detection/AR-QRDetection/web-ar-project/src/app.js */
import { ARScene } from './components/ar-scene.js';
import { getModelById, getModelFileUrl } from './services/supabase.js';
import { StateMachine, UIState } from './state-machine.js';
import { NavigationService } from './services/navigation.js';
import { audioGenerator, AudioGenerator } from './services/audio-generator.js';

// ===== BASE PATH FÜR GITHUB PAGES =====
const basePath = window.location.pathname.includes('/AR-QRDetection/') 
  ? '/AR-QRDetection' 
  : '';

console.log('[App] Base path:', basePath);

// ===== GLOBAL STATE =====
let qrScanner = null;
let isScanning = false;
let arScene = null;

/**
 * ===== MAIN INITIALIZATION =====
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('[App] Initializing...');

  const isLandingPage = document.body.classList.contains('landing-page');
  
  if (isLandingPage) {
    console.log('[Landing] Page detected');
    initLandingPageButtons();
  } else {
    console.log('[App] App page detected');
    initAppPageButtons();
    initQRScanner();
    initARSceneManager();
    
    // Auto-start QR Scanner
    console.log('[App] Auto-starting QR scanner...');
    setTimeout(() => {
      startQRScanning();
    }, 500); // Kleine Verzögerung für Kamera-Init
  }
});

/**
 * ===== LANDING PAGE BUTTON HANDLERS =====
 */
function initLandingPageButtons() {
  console.log('[Landing] Initializing buttons...');

  const startScanningBtn = document.getElementById('start-scanning-btn');
  const startScanningBtn2 = document.getElementById('start-scanning-btn-2');

  const btns = [startScanningBtn, startScanningBtn2];

  btns.forEach((btn) => {
    if (btn) {
      btn.addEventListener('click', () => {
        console.log('[Landing] "Jetzt scannen" clicked');
        audioGenerator.click();
        NavigationService.goToScanner();
      });
    }
  });
}

/**
 * ===== APP PAGE BUTTON HANDLERS =====
 */
function initAppPageButtons() {
  console.log('[App] Initializing button handlers...');

  // ===== SCANNER BUTTONS =====
  const startScanBtn = document.getElementById('start-scan');
  if (startScanBtn) {
    startScanBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[Scanner] "Scanner starten" clicked');
      audioGenerator.click();
      startQRScanning();
    });
  }

  const skipQrBtn = document.getElementById('skip-qr');
  if (skipQrBtn) {
    skipQrBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[Scanner] "Ohne QR starten" clicked');
      enterDemoMode();
    });
  }

  // ===== AR SCENE NAVIGATION BUTTONS =====
  const nextScanBtn = document.getElementById('next-scan-btn');
  if (nextScanBtn) {
    nextScanBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[AR] "Nächsten QR scannen" clicked');
      audioGenerator.click();
      goBackToScanner();
    });
  }

  const backHomeBtn = document.getElementById('back-home-btn');
  if (backHomeBtn) {
    backHomeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[AR] "Startseite" clicked');
      audioGenerator.click();
      NavigationService.goHome();
    });
  }

  // ===== PERMISSION MODAL BUTTONS =====
  const permitContinueBtn = document.getElementById('permit-continue');
  if (permitContinueBtn) {
    permitContinueBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[Permission] Continuing...');
      audioGenerator.click();
      startQRScanning();
      hidePermissionModal();
    });
  }

  const permitCancelBtn = document.getElementById('permit-cancel');
  if (permitCancelBtn) {
    permitCancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[Permission] Cancelled');
      audioGenerator.click();
      hidePermissionModal();
      NavigationService.goHome();
    });
  }
}

/**
 * ===== AR SCENE MANAGER INITIALIZATION =====
 */
async function initARSceneManager() {
  console.log('[ARScene] Initializing manager...');
  
  try {
    arScene = new ARScene();
    console.log('[ARScene] Manager ready (not initialized yet)');
  } catch (err) {
    console.error('[ARScene] Init error:', err);
  }

  // Marker-Events für Hinweis
  const marker = document.getElementById('hiroMarker');
  if (marker) {
    let markerVisible = false;
    let lostTimer = null;
    let checkTimer = null;

    marker.addEventListener('markerFound', () => {
      console.log('[Marker] Found');
      markerVisible = true;
      hideMarkerHint();
      
      // Stoppe Polling wenn Marker gefunden
      if (checkTimer) {
        clearInterval(checkTimer);
        checkTimer = null;
      }
    });

    marker.addEventListener('markerLost', () => {
      console.log('[Marker] Lost');
      markerVisible = false;
      clearTimeout(lostTimer);
      lostTimer = setTimeout(() => {
        if (!markerVisible) {
          showMarkerHint('Marker nicht erkannt. Bitte näher herantreten und Marker im Sichtfeld halten.');
        }
      }, 700);
    });

    // Polling: Prüfe alle 2 Sekunden ob Marker sichtbar ist
    // Startet nur wenn AR-Szene aktiv und noch kein Marker gefunden wurde
    const startMarkerCheck = () => {
      if (checkTimer) return; // bereits am laufen
      
      checkTimer = setInterval(() => {
        const arSceneEl = document.getElementById('ar-scene');
        const scannerVisible = document.getElementById('qr-scanner').style.display !== 'none';
        
        // Nur zeigen wenn AR-Szene sichtbar, Scanner weg und Marker noch nicht gefunden
        if (arSceneEl && arSceneEl.style.opacity === '1' && !scannerVisible && !markerVisible) {
          showMarkerHint('Marker nicht erkannt. Bitte näher herantreten und Marker im Sichtfeld halten.');
        }
      }, 2000);
    };

    // Starte Polling wenn AR-Szene geladen wird
    window.addEventListener('ar-scene-loaded', startMarkerCheck);
  }
}

/**
 * ===== QR SCANNER INITIALIZATION =====
 */
function initQRScanner() {
  console.log('[QRScanner] Initializing...');

  const qrReader = document.getElementById('qr-reader');
  if (!qrReader) {
    console.error('[QRScanner] #qr-reader not found');
    return;
  }

  qrScanner = new Html5Qrcode('qr-reader');
  console.log('[QRScanner] Ready');
}

/**
 * ===== START QR SCANNING =====
 */
async function startQRScanning() {
  if (isScanning) {
    console.log('[QRScanner] Already scanning');
    return;
  }

  if (!qrScanner) {
    console.error('[QRScanner] Scanner not initialized');
    initQRScanner();
  }

  try {
    console.log('[QRScanner] Starting scan...');
    isScanning = true;

    await qrScanner.start(
      { facingMode: 'environment' },
      {
        fps: 10,
        qrbox: { width: 250, height: 250 }
      },
      onQRCodeScanned,
      onQRScanError
    );

    showQRFrame();
  } catch (err) {
    console.error('[QRScanner] Error:', err);
    isScanning = false;

    if (err.name === 'NotAllowedError') {
      showPermissionModal();
    } else if (err.name === 'NotFoundError') {
      alert('Keine Kamera gefunden');
    } else {
      alert('Fehler beim Starten des Scanners: ' + err.message);
    }
  }
}

/**
 * ===== ON QR CODE SCANNED =====
 */
async function onQRCodeScanned(decodedText) {
  console.log('[QR] Code scanned:', decodedText);

  // Stop scanning
  try {
    await qrScanner.stop();
    isScanning = false;
  } catch (err) {
    console.error('[QRScanner] Error stopping:', err);
  }

  // Lade-Overlay sofort nach Scan zeigen
  showLoading('Lade AR-Szene…');
  hideMarkerHint();

  // ID ermitteln
  let stationId = decodedText;
  if (decodedText.includes('=')) {
    stationId = decodedText.split('=')[1];
  }
  console.log('[QR] Extracted ID:', stationId);

  hideScanner();
  await showARScene(stationId);
  hideLoading();
}

/**
 * ===== ON QR SCAN ERROR =====
 */
function onQRScanError(error) {
  // Silently ignore (normal while scanning)
}

/**
 * ===== GO BACK TO SCANNER =====
 */
async function goBackToScanner() {
  console.log('[Nav] Going back to scanner...');
  window.location.reload();
}

/**
 * ===== SHOW AR SCENE WITH MODEL LOADING =====
 */
async function showARScene(stationId) {
  console.log(`[AR] Showing scene with ID: ${stationId}`);

  if (!arScene) {
    console.error('[AR] ARScene not initialized');
    alert('AR-Szene konnte nicht initialisiert werden');
    return;
  }

  try {
    console.log('[AR] Initializing scene...');
    await arScene.init();
    console.log('[AR] Scene initialized');

    console.log('[AR] Loading model for ID:', stationId);
    await loadAndShowModel(stationId);

    const arSceneEl = document.getElementById('ar-scene');
    if (arSceneEl) {
      arSceneEl.style.opacity = '1';
      arSceneEl.style.pointerEvents = 'auto';
    }

    showARNavBar();

    const hint = document.getElementById('grab-hint');
    if (hint) hint.style.display = 'block';

    // Event für Marker-Polling triggern
    window.dispatchEvent(new Event('ar-scene-loaded'));

  } catch (err) {
    console.error('[AR] Error showing scene:', err);
    alert('Fehler beim Laden der AR-Szene: ' + err.message);
    hideARScene();
  }
}

/**
 * ===== LOAD AND SHOW MODEL =====
 */
async function loadAndShowModel(stationId) {
  console.log(`[Model] Loading model for station: ${stationId}`);

  try {
    if (stationId === 'demo') {
      console.log('[Model] Loading demo cube');
      arScene.loadModelFromQr(null);
      arScene.setModelInfo({
        title: 'Demo-Würfel',
        description: 'Dies ist ein Demo-Modell. Scanne einen QR-Code mit einer gültigen Modell-ID, um ein 3D-Modell zu laden.',
        meta: { 'Tipp': 'Nutze die ID "items_test" zum Testen' }
      });
      return;
    }

    console.log('[Model] Fetching from database:', stationId);
    const model = await getModelById(stationId);

    if (model) {
      console.log('[Model] Found model:', model.title);
      const modelUrl = getModelFileUrl(model.model_url);
      console.log('[Model] Model URL:', modelUrl);
      
      const initialScale = parseFloat(model.scale) || 1.0;
      console.log('[Model] Initial scale from DB:', initialScale);
      
      arScene.loadModelFromQr(modelUrl, initialScale);
      
      arScene.setModelInfo({
        title: model.title || 'Unbekanntes Modell',
        description: model.description || 'Keine Beschreibung verfügbar.',
        meta: {
          'ID': model.id,
          'Scale': model.scale,
          ...(typeof model.meta === 'object' ? model.meta : {})
        }
      });
    } else {
      console.warn('[Model] Model not found for ID:', stationId);
      arScene.loadModelFromQr(null);
      arScene.setModelInfo({
        title: 'Modell nicht gefunden',
        description: `Die ID "${stationId}" wurde nicht in der Datenbank gefunden.`,
        meta: { 'Gescannte ID': stationId }
      });
    }
  } catch (err) {
    console.error('[Model] Error loading model:', err);
    arScene.loadModelFromQr(null);
    arScene.setModelInfo({
      title: 'Fehler beim Laden',
      description: 'Es gab einen Fehler beim Laden des Modells: ' + err.message,
      meta: { 'Station ID': stationId }
    });
  }
}

/**
 * ===== UI STATE FUNCTIONS =====
 */
function showLoading(text = 'Lade…') {
  const el = document.getElementById('loading-overlay');
  if (el) {
    const t = el.querySelector('.loading-text');
    if (t) t.textContent = text;
    el.classList.remove('hidden');
  }
}

function hideLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.classList.add('hidden');
}

function showMarkerHint(text) {
  const el = document.getElementById('marker-hint');
  const markerStatus = document.getElementById('marker-status');
  const scanner = document.getElementById('qr-scanner');

  const markerStatusVisible = markerStatus && markerStatus.style.display !== 'none';
  const scannerVisible = scanner && scanner.style.display !== 'none';
  const markerText = document.getElementById('marker-state').textContent.toLowerCase();

  // nicht zeigen, wenn QR-Overlay aktiv, kein Marker-Status sichtbar oder IMU-Modus aktiv
  if (scannerVisible || !markerStatusVisible || markerText.includes('imu')) return;

  if (el) {
    el.textContent = text || 'Marker nicht erkannt. Bitte näher herantreten.';
    el.classList.add('visible');
  }
}

function hideMarkerHint() {
  const el = document.getElementById('marker-hint');
  if (el) el.classList.remove('visible');
}

function showScanner() {
  console.log('[UI] Showing scanner...');
  const qrScannerDiv = document.getElementById('qr-scanner');
  if (qrScannerDiv) {
    qrScannerDiv.style.display = 'block';
    qrScannerDiv.style.opacity = '1';
    qrScannerDiv.style.zIndex = '1000';
  }
  hideARNavBar();
}

function hideScanner() {
  console.log('[UI] Hiding scanner...');
  const qrScannerDiv = document.getElementById('qr-scanner');
  if (qrScannerDiv) {
    qrScannerDiv.style.display = 'none';
    qrScannerDiv.style.opacity = '0';
  }
}

function showQRFrame() {
  console.log('[UI] Showing QR frame...');
  const frame = document.querySelector('.qr-frame');
  if (frame) {
    frame.style.display = 'block';
  }
}

function hideQRFrame() {
  console.log('[UI] Hiding QR frame...');
  const frame = document.querySelector('.qr-frame');
  if (frame) {
    frame.style.display = 'none';
  }
}

function hideARScene() {
  console.log('[UI] Hiding AR scene...');
  const arSceneEl = document.getElementById('ar-scene');
  if (arSceneEl) {
    arSceneEl.style.opacity = '0';
    arSceneEl.style.pointerEvents = 'none';
  }
  hideARNavBar();

  const hint = document.getElementById('grab-hint');
  if (hint) hint.style.display = 'none';
}

function showARNavBar() {
  console.log('[UI] Showing AR nav bar...');
  const navBar = document.getElementById('ar-nav-bar');
  if (navBar) {
    navBar.classList.remove('hidden');
  }
}

function hideARNavBar() {
  console.log('[UI] Hiding AR nav bar...');
  const navBar = document.getElementById('ar-nav-bar');
  if (navBar) {
    navBar.classList.add('hidden');
  }
}

function showPermissionModal() {
  console.log('[UI] Showing permission modal...');
  const modal = document.getElementById('permission-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
  }
}

function hidePermissionModal() {
  console.log('[UI] Hiding permission modal...');
  const modal = document.getElementById('permission-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.style.display = 'none';
  }
}

function showInfoPanel(title, description, metadata) {
  console.log('[UI] Showing info panel...');
  const panel = document.getElementById('info-panel');
  if (panel) {
    document.getElementById('info-title').textContent = title || 'Info';
    document.getElementById('info-description').textContent = description || 'Keine Beschreibung verfügbar';

    const metaDiv = document.getElementById('info-meta');
    if (metaDiv && metadata) {
      metaDiv.innerHTML = metadata;
    }

    panel.classList.remove('hidden');
    panel.style.display = 'flex';
  }
}

function hideInfoPanel() {
  console.log('[UI] Hiding info panel...');
  const panel = document.getElementById('info-panel');
  if (panel) {
    panel.classList.add('hidden');
    panel.style.display = 'none';
  }
}

/**
 * ===== EXPORTS FOR EXTERNAL USE =====
 */
export {
  basePath,
  showARScene,
  hideARScene,
  showInfoPanel,
  hideInfoPanel,
  goBackToScanner
};