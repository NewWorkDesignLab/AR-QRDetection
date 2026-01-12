/* filepath: /Users/philip/Documents/NWDL/QR Detection/AR QRDetection/web-ar-project/src/app.js */
import { ARScene } from './components/ar-scene.js';
import { getModelById, getModelFileUrl } from './services/supabase.js';

class App {
  constructor() {
    this.arScene = new ARScene();
    this.scanner = null;
    this._bindUI();
  }

  _bindUI() {
    const startBtn = document.getElementById('start-scan');
    const skipBtn = document.getElementById('skip-qr');
    startBtn?.addEventListener('click', () => this.startQRScanner());
    skipBtn?.addEventListener('click', () => this.startAR(null));
  }

  async startQRScanner() {
    const el = document.getElementById('qr-reader');
    if (!el) return;

    // Hinweis: Nur auf http://localhost oder HTTPS
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
    if (!isSecure) {
      alert('Bitte über http://localhost oder HTTPS öffnen – Kamera sonst blockiert.');
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
    } catch (e) {
      console.error('QR Fehler', e);
      if (String(e?.name).includes('NotAllowedError')) {
        alert('Kamera-Zugriff verweigert. Erlaube die Kamera in den Website-Einstellungen deines Browsers.');
      }
      this.startAR(null);
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
    // Scanner Overlay ausblenden
    const overlay = document.getElementById('qr-scanner');
    if (overlay) overlay.style.display = 'none';

    // Szene einblenden
    const sceneEl = document.getElementById('ar-scene');
    if (sceneEl) sceneEl.style.opacity = '1';

    // Falls Scanner noch läuft → stoppen
    if (this.scanner) {
      try { await this.scanner.stop(); } catch {}
      this.scanner = null;
    }

    // AR initialisieren (AR.js fragt Kamera an)
    await this.arScene.init();

    // Modell aus Supabase laden
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
  }
}

document.addEventListener('DOMContentLoaded', () => new App());