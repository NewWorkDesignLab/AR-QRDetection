/**
 * Navigation Service für Landing Page → Scanner → AR Scene
 * URL-Parameter Handling für direkte AR-Starts
 */

export const NavigationService = {
  /**
   * Prüfe URL-Parameter und navigiere entsprechend
   * ?station=abc → Direkt zum Scanner mit Station
   * Keine Parameter → Landing Page
   */
  initializeRouting() {
    const params = new URLSearchParams(window.location.search);
    const stationId = params.get('station');

    // Wenn wir auf index.html sind und keine station, dann Landing Page zeigen
    if (window.location.pathname.includes('index.html') || window.location.pathname === '/') {
      if (!stationId) {
        this.showLandingPage();
      } else {
        this.goToScanner(stationId);
      }
    }

    // Wenn wir auf app.html sind, direkt zur App
    if (window.location.pathname.includes('app.html')) {
      this.showARApp();
    }
  },

  /**
   * Zeige Landing Page
   */
  showLandingPage() {
    // Falls wir nicht auf index.html sind, navigiere dorthin
    if (!window.location.pathname.includes('index.html') && window.location.pathname !== '/') {
      window.location.href = '/';
    }
    document.body.classList.add('landing-page');
  },

  /**
   * Navigiere zum QR Scanner
   */
  goToScanner(stationId = null) {
    let url = '/app.html?scan=true';
    if (stationId) {
      url += `&station=${stationId}`;
    }
    window.location.href = url;
  },

  /**
   * Navigiere zur AR Scene (app.html mit ar=true)
   */
  goToARScene(stationId) {
    window.location.href = `/app.html?ar=true&station=${stationId}`;
  },

  /**
   * Zurück zur Landing Page
   */
  goHome() {
    window.location.href = '/';
  },

  /**
   * Extrahiere Station aus URL
   */
  getStationFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('station');
  },

  /**
   * Prüfe ob wir im Scanner sind
   */
  isScannerMode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('scan') === 'true';
  },

  /**
   * Prüfe ob wir in AR sind
   */
  isARMode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('ar') === 'true';
  }
};
