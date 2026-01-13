/* filepath: /Users/philip/Documents/NWDL/QR Detection/AR QRDetection/web-ar-project/src/app.js */
import { ARScene } from './components/ar-scene.js';
import { getModelById, getModelFileUrl } from './services/supabase.js';
import { StateMachine, UIState } from './state-machine.js';

class App {
  constructor() {
    this.state = new StateMachine((s) => this._applyUIState(s));
    this.arScene = new ARScene();
    this.scanner = null;
    this._bindUI();
  }

  _bindUI() {
    const startBtn = document.getElementById('start-scan');
    const skipBtn = document.getElementById('skip-qr');
    const permitModal = document.getElementById('permission-modal');
    const permitOk = document.getElementById('permit-continue');
    const permitCancel = document.getElementById('permit-cancel');

    startBtn?.addEventListener('click', () => {
      permitModal?.classList.remove('hidden');
    });
    permitOk?.addEventListener('click', () => {
      permitModal?.classList.add('hidden');
      this.startQRScanner();
    });
    permitCancel?.addEventListener('click', () => {
      permitModal?.classList.add('hidden');
    });
    skipBtn?.addEventListener('click', () => this.startAR(null));
  }

  _applyUIState(state, payload) {
    const qrOverlay = document.getElementById('qr-scanner');
    const onboarding = document.getElementById('onboarding');
    const sceneEl   = document.getElementById('ar-scene');
    if (qrOverlay) {
      const showQR = [UIState.QR_SCAN, UIState.ONBOARDING, UIState.QR_DENIED, UIState.QR_ERROR].includes(state);
      qrOverlay.style.display = showQR ? 'flex' : 'none';
      if (state === UIState.ONBOARDING) onboarding?.classList.remove('hidden');
      else onboarding?.classList.add('hidden');

      if (state === UIState.QR_DENIED) this._setQRMessage('Kamera-Zugriff verweigert. Bitte Berechtigungen erlauben und erneut versuchen.');
      if (state === UIState.QR_ERROR)  this._setQRMessage('Scanner-Fehler. Bitte erneut versuchen oder Demo starten.');
      if (state === UIState.QR_SCAN)   this._setQRMessage('Scanne einen QR-Code, um zu starten');
      if (state === UIState.ONBOARDING) this._setQRMessage('Starte den Scanner oder nutze die Demo.');
    }
    if (sceneEl) sceneEl.style.opacity = (state === UIState.AR_ACTIVE || state === UIState.AR_LOADING) ? '1' : '0';
  }

  _setQRMessage(text) {
    const p = document.querySelector('#qr-scanner p');
    if (p) p.textContent = text;
  }

  async startQRScanner() {
    this.state.set(UIState.QR_SCAN);
    const el = document.getElementById('qr-reader');
    if (!el) return;
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
    if (!isSecure) {
      alert('Bitte über http://localhost oder HTTPS öffnen – Kamera sonst blockiert.');
      this.state.set(UIState.QR_ERROR);
      return;
    }
    if (!this.scanner) this.scanner = new Html5Qrcode('qr-reader');
    try {
      await this.scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 220, rememberLastUsedCamera: true },
        async (text) => {
          try { await this.scanner.stop(); } catch {}
          const id = this._parseId(text);
          this.startAR(id);
        },
        () => {}
      );
      this._setQRMessage('Halte den Code in den Rahmen');
    } catch (e) {
      console.error('QR Fehler', e);
      if (String(e?.name).includes('NotAllowedError')) {
        alert('Kamera-Zugriff verweigert. Erlaube die Kamera in den Website-Einstellungen deines Browsers.');
        this.state.set(UIState.QR_DENIED, { reason: e?.message });
      } else {
        this.state.set(UIState.QR_ERROR, { error: e?.message });
      }
    }
  }

  _parseId(raw) {
    try {
      const u = new URL(raw);
      return u.searchParams.get('id') || raw;
    } catch {
      return raw;
    }
  }

  async startAR(id) {
    // SOFORT QR-Scanner ausblenden (Overlay auf 'none')
    this.state.set(UIState.AR_LOADING);
    
    // Kleiner Timeout, damit der DOM render cycle durchläuft und das UI sauber updated
    // bevor der schwere AR init Prozess den Main-Thread blockiert
    await new Promise(r => setTimeout(r, 50));

    console.log('Starte AR Modus mit ID:', id);

    if (this.scanner) {
      try { await this.scanner.stop(); } catch (e) { /* ignore stops */ }
      this.scanner = null;
    }

    // Erst jetzt AR laden
    // Hinweis: Hier wird der Browser nach Kamera fragen, da ARScene getUserMedia aufruft
    await this.arScene.init();

    // Hier ggf. Modell laden basierend auf ID
    if (id) {
      console.log('🔍 Suche Modell mit ID:', id);
      const model = await getModelById(id);

      if (model) {
        const modelUrl = getModelFileUrl(model.model_url);
        this.arScene.loadModelFromQr(modelUrl);
        this.arScene.setModelInfo({
          title: model.title,
          description: model.description,
          meta: {
            'ID': model.id,
            'Scale': model.scale,
            ...(typeof model.meta === 'object' ? model.meta : {})
          }
        });
      } else {
        // ID nicht in Datenbank gefunden
        this.arScene.loadModelFromQr(null);
        this.arScene.setModelInfo({
          title: 'Unbekannte ID',
          description: `Die ID "${id}" wurde nicht in der Datenbank gefunden.`,
          meta: { 'Gescannte ID': id }
        });
      }
    } else {
      // Kein QR gescannt → Demo-Würfel
      this.arScene.loadModelFromQr(null);
      this.arScene.setModelInfo({
        title: 'Demo-Würfel',
        description: 'Scanne einen QR-Code mit einer gültigen Modell-ID, um ein 3D-Modell zu laden.',
        meta: { 'Tipp': 'Erstelle QR-Code mit "items_test"' }
      });
    }

    const hint = document.getElementById('grab-hint');
    if (hint) hint.style.display = 'block';

    this.state.set(UIState.AR_ACTIVE);
  }
}

document.addEventListener('DOMContentLoaded', () => new App());