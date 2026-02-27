/* filepath: /Users/philip/Documents/NWDL/QR Detection/AR-QRDetection/web-ar-project/src/app.js */
import { ARScene } from './components/ar-scene.js';
import { getProjectByQRCode, getProjectActiveContent, getContentById, getModelFileUrl, getMediaTypeFromContentType } from './services/supabase.js';
import { NavigationService } from './services/navigation.js';
import { audioGenerator } from './services/audio-generator.js';

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
    
    // Prüfe ob QR-Code aus URL-Parameter vorhanden
    const qrCodeFromUrl = getQRCodeFromURL();
    if (qrCodeFromUrl) {
      console.log('[App] QR code from URL detected:', qrCodeFromUrl);
      hideScanner();
      hideQRFrame();
      setTimeout(() => {
        loadContentFromQRCode(qrCodeFromUrl);
      }, 500);
    } else {
      // Auto-start QR Scanner wenn keine ID in URL
      console.log('[App] Auto-starting QR scanner...');
      setTimeout(() => {
        startQRScanning();
      }, 500);
    }
  }
});

/**
 * ===== GET QR CODE FROM URL PARAMETER =====
 * Parst die ID aus ?id=xxxxx
 */
function getQRCodeFromURL() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  
  if (id) {
    console.log('[URL] QR Code parameter found:', id);
    return id;
  }
  
  return null;
}

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
      loadContentFromQRCode('demo');
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
    
    // NEU: Pause/Resume Events HIER registrieren (nach arScene-Init)
    document.addEventListener('visibilitychange', () => {
      if (!arScene) return;
      if (document.hidden) {
        console.log('[Perf] Page hidden → pause');
        arScene.pauseProcessing();
      } else {
        console.log('[Perf] Page visible → resume');
        arScene.resumeProcessing();
      }
    });

    // iOS: pagehide / pageshow
    window.addEventListener('pagehide', () => {
      if (arScene) {
        console.log('[Perf] Page hiding (iOS) → pause');
        arScene.pauseProcessing();
      }
    });
    
    window.addEventListener('pageshow', () => {
      if (arScene) {
        console.log('[Perf] Page showing (iOS) → resume');
        arScene.resumeProcessing();
      }
    });
    
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
          // Stille ignoration für jetzt
        }
      }, 700);
    });

    // Polling: Prüfe alle 2 Sekunden ob Marker sichtbar ist
    const startMarkerCheck = () => {
      if (checkTimer) return;
      
      checkTimer = setInterval(() => {
        const arSceneEl = document.getElementById('ar-scene');
        const scannerVisible = document.getElementById('qr-scanner')?.style.display !== 'none';
        
        if (arSceneEl && arSceneEl.style.opacity === '1' && !scannerVisible && !markerVisible) {
          showMarkerHint('Marker nicht erkannt. Bitte näher herantreten und Marker im Sichtfeld halten.');
        }
      }, 2000);
    };

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
 * Extrahiert die ID und leitet weiter
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

  // Extrahiere die QR-Code ID
  let qrCodeId = decodedText;
  if (decodedText.includes('=')) {
    qrCodeId = decodedText.split('=')[1];
  }
  console.log('[QR] Extracted ID:', qrCodeId);

  const url = new URL(window.location);
  url.searchParams.set('id', qrCodeId);
  window.history.replaceState({}, document.title, url.toString());

  hideScanner();
  hideQRFrame();
  
  await loadContentFromQRCode(qrCodeId);
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

  const url = new URL(window.location);
  url.searchParams.delete('id');
  window.history.replaceState({}, document.title, url.toString());
  
  window.location.reload();
}

/**
 * ===== LOAD CONTENT FROM QR CODE =====
 * QR Code → Project → Active Content
 */
async function loadContentFromQRCode(qrCodeId) {
  console.log(`[QR] Loading content for QR code: ${qrCodeId}`);

  showLoading('Lade AR-Szene…');
  hideMarkerHint();

  try {
    await showARScene(qrCodeId);
  } catch (err) {
    console.error('[QR] Error loading content:', err);
    alert('Fehler beim Laden: ' + err.message);
  } finally {
    hideLoading();
  }
}

/**
 * ===== SHOW AR SCENE WITH MODEL LOADING =====
 */
async function showARScene(qrCodeId) {
  console.log(`[AR] Showing scene for QR code: ${qrCodeId}`);

  if (!arScene) {
    console.error('[AR] ARScene not initialized');
    alert('AR-Szene konnte nicht initialisiert werden');
    return;
  }

  try {
    console.log('[AR] Initializing scene...');
    await arScene.init();
    console.log('[AR] Scene initialized');

    console.log('[AR] Loading model for QR code:', qrCodeId);
    await loadAndShowModel(qrCodeId);

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
 * QR Code → Project (via qr_code field) → Active Content + CTA
 */
async function loadAndShowModel(qrCodeId) {
  console.log(`[Model] Loading model for QR code: ${qrCodeId}`);

  try {
    // Demo-Mode
    if (qrCodeId === 'demo') {
      console.log('[Model] Loading demo cube');
      arScene.loadModelFromQr(null);
      arScene.setModelInfo({
        title: 'Demo-Würfel',
        description: 'Dies ist ein Demo-Modell. Scanne einen QR-Code mit einer gültigen ID, um Content zu laden.',
        meta: { 'Tipp': 'Nutze einen gültigen QR-Code' },
        ctaLabel: 'Demo CTA',
        ctaValue: 'https://example.com'
      });
      return;
    }

    console.log('[Model] Fetching project by QR code:', qrCodeId);
    
    // Hole Project via QR-Code
    const project = await getProjectByQRCode(qrCodeId);
    
    if (!project) {
      console.warn('[Model] Project not found for QR code:', qrCodeId);
      arScene.loadModelFromQr(null);
      arScene.setModelInfo({
        title: 'Projekt nicht gefunden',
        description: `Das Projekt mit QR-Code "${qrCodeId}" wurde nicht gefunden oder ist noch nicht freigegeben.`,
        meta: { 'QR-Code': qrCodeId },
        ctaLabel: null,
        ctaValue: null
      });
      return;
    }

    console.log('[Model] Project found:', project.title);

    // Hole aktives Content-Item
    const content = await getProjectActiveContent(project.id);

    if (!content) {
      console.warn('[Model] No active content for project:', project.id);
      arScene.loadModelFromQr(null);
      arScene.setModelInfo({
        title: project.title,
        description: project.description || 'Kein aktiver Content verfügbar.',
        meta: { 'Projekt-ID': project.id },
        ctaLabel: null,
        ctaValue: null
      });
      return;
    }

    console.log('[Model] Content loaded:', content.name);
    console.log('[Model] Content type:', content.type);
    
    const fileUrl = getModelFileUrl(content.file_url);
    console.log('[Model] File URL:', fileUrl);

    const mediaType = getMediaTypeFromContentType(content.type);
    const initialScale = content.scale || 1.0;

    // Lade je nach Content-Typ
    if (mediaType === 'image') {
      console.log('[Model] Loading as image');
      arScene.loadMediaFromUrl(fileUrl, 'image', initialScale);
    } else if (mediaType === 'video') {
      console.log('[Model] Loading as video');
      arScene.loadMediaFromUrl(fileUrl, 'video', initialScale);
    } else if (mediaType === 'model') {
      console.log('[Model] Loading as 3D model');
      arScene.loadModelFromQr(fileUrl, initialScale);
    } else if (mediaType === 'audio') {
      console.warn('[Model] Audio content nicht unterstützt in AR');
      arScene.loadModelFromQr(null);
      arScene.setModelInfo({
        title: content.name || 'Audio-Datei',
        description: content.description || 'Audio wird nicht in AR angezeigt',
        meta: {},
        ctaLabel: null,
        ctaValue: null
      });
      return;
    }

    // NEU: Hole CTA aus Project (falls vorhanden)
    let ctaLabel = null;
    let ctaValue = null;
    
    if (project.call_to_action) {
      console.log('[Model] CTA found:', project.call_to_action);
      ctaLabel = project.call_to_action.label || null;
      ctaValue = project.call_to_action.value || null;
    }

    console.log('[Model] CTA:', { label: ctaLabel, value: ctaValue });

    // Model-Info anzeigen
    arScene.setModelInfo({
      title: content.name || project.title,
      description: content.description || project.description || 'Keine Beschreibung verfügbar.',
      meta: {
        'Projekt': project.title,
        'Content-ID': content.id,
        'Typ': content.type,
        ...(content.meta && typeof content.meta === 'object' ? content.meta : {})
      },
      ctaLabel: ctaLabel,
      ctaValue: ctaValue,
      cta: ctaValue
    });

  } catch (err) {
    console.error('[Model] Error loading model:', err);
    arScene.loadModelFromQr(null);
    arScene.setModelInfo({
      title: 'Fehler beim Laden',
      description: 'Es gab einen Fehler beim Laden des Modells: ' + err.message,
      meta: { 'QR-Code': qrCodeId },
      ctaLabel: null,
      ctaValue: null
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
  const markerText = document.getElementById('marker-state')?.textContent.toLowerCase();

  if (scannerVisible || !markerStatusVisible || markerText?.includes('imu')) return;

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

/**
 * ===== EXPORTS FOR EXTERNAL USE =====
 */
export {
  basePath,
  showARScene,
  hideARScene,
  goBackToScanner,
  loadContentFromQRCode
};
