/* filepath: /Users/philip/Documents/NWDL/QR Detection/AR QRDetection/web-ar-project/src/app.js */
import { ARScene } from './components/ar-scene.js';
import { getModelById, getModelFileUrl } from './services/supabase.js';
import { StateMachine, UIState } from './state-machine.js';
import { NavigationService } from './services/navigation.js';

// ===== GLOBAL STATE =====
let qrScanner = null;
let isScanning = false;
let arScene = null;  // ← NEU: globale AR Scene Instanz

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
    initARSceneManager(); // ← NEU
  }
});

/**
 * ===== LANDING PAGE BUTTON HANDLERS =====
 */
function initLandingPageButtons() {
  console.log('[Landing] Initializing buttons...');

  const startScanningBtn = document.getElementById('start-scanning-btn');
  const demoBtn = document.getElementById('demo-btn');

  if (startScanningBtn) {
    startScanningBtn.addEventListener('click', () => {
      console.log('[Landing] "Jetzt scannen" clicked');
      NavigationService.goToScanner();
    });
  }

  if (demoBtn) {
    demoBtn.addEventListener('click', () => {
      console.log('[Landing] "Demo ohne QR" clicked');
      NavigationService.goToARScene('demo');
    });
  }
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
      goBackToScanner();
    });
  }

  const backHomeBtn = document.getElementById('back-home-btn');
  if (backHomeBtn) {
    backHomeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[AR] "Startseite" clicked');
      NavigationService.goHome();
    });
  }

  // ===== PERMISSION MODAL BUTTONS =====
  const permitContinueBtn = document.getElementById('permit-continue');
  if (permitContinueBtn) {
    permitContinueBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[Permission] Continuing...');
      startQRScanning(); // ← FIX: Direkt zum Scannen gehen
      hidePermissionModal();
    });
  }

  const permitCancelBtn = document.getElementById('permit-cancel');
  if (permitCancelBtn) {
    permitCancelBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[Permission] Cancelled');
      hidePermissionModal();
      NavigationService.goHome();
    });
  }

  // ===== INFO PANEL CLOSE BUTTON =====
  const infoCloseBtn = document.getElementById('info-close');
  if (infoCloseBtn) {
    infoCloseBtn.addEventListener('click', (e) => {
      e.preventDefault();
      console.log('[Info] Panel closed');
      hideInfoPanel();
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

    // Hide onboarding, show scanner UI
    hideOnboarding();
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

  // Parse station ID from QR code
  // Unterstützt: "id=123", "station=abc", "123", "abc"
  let stationId = decodedText;
  if (decodedText.includes('=')) {
    stationId = decodedText.split('=')[1];
  }

  console.log('[QR] Extracted ID:', stationId);

  // Hide scanner, show AR
  hideScanner();
  await showARScene(stationId);
}

/**
 * ===== ON QR SCAN ERROR =====
 */
function onQRScanError(error) {
  // Silently ignore (normal while scanning)
}

/**
 * ===== DEMO MODE (ohne QR) =====
 */
async function enterDemoMode() {
  console.log('[Demo] Entering demo mode...');
  hideScanner();
  await showARScene('demo');
}

/**
 * ===== GO BACK TO SCANNER =====
 */
async function goBackToScanner() {
  console.log('[Nav] Going back to scanner...');

  // Einfach die Seite neu laden - das setzt alles zurück
  // und bringt uns zurück zum Onboarding-Screen
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
    // 1. Initialisiere AR Szene (Kamera, Hand Tracking, etc.)
    console.log('[AR] Initializing scene...');
    await arScene.init();
    console.log('[AR] Scene initialized');

    // 2. Lade Modell basierend auf ID
    console.log('[AR] Loading model for ID:', stationId);
    await loadAndShowModel(stationId);

    // 3. Zeige AR
    const arSceneEl = document.getElementById('ar-scene');
    if (arSceneEl) {
      arSceneEl.style.opacity = '1';
      arSceneEl.style.pointerEvents = 'auto';
    }

    // 4. Zeige Navigation Bar
    showARNavBar();

    const hint = document.getElementById('grab-hint');
    if (hint) hint.style.display = 'block';

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
      // Demo-Würfel
      console.log('[Model] Loading demo cube');
      arScene.loadModelFromQr(null);
      arScene.setModelInfo({
        title: 'Demo-Würfel',
        description: 'Dies ist ein Demo-Modell. Scanne einen QR-Code mit einer gültigen Modell-ID, um ein 3D-Modell zu laden.',
        meta: { 'Tipp': 'Nutze die ID "items_test" zum Testen' }
      });
      return;
    }

    // Versuche Modell aus Datenbank zu laden
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

function showOnboarding() {
  console.log('[UI] Showing onboarding...');
  const onboarding = document.getElementById('onboarding');
  if (onboarding) {
    onboarding.style.display = 'block';
    onboarding.style.opacity = '1';
  }
}

function hideOnboarding() {
  console.log('[UI] Hiding onboarding...');
  const onboarding = document.getElementById('onboarding');
  if (onboarding) {
    onboarding.style.display = 'none';
    onboarding.style.opacity = '0';
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
  showARScene,
  hideARScene,
  showInfoPanel,
  hideInfoPanel,
  goBackToScanner
};