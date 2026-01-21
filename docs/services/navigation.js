/**
 * Navigation Service für Landing Page → Scanner → AR Scene
 * URL-Parameter Handling für direkte AR-Starts
 */

export class NavigationService {
  /**
   * Prüfe URL-Parameter und navigiere entsprechend
   * ?station=abc → Direkt zum Scanner mit Station
   * Keine Parameter → Landing Page
   */
  static initializeRouting() {
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
  }

  /**
   * Zeige Landing Page
   */
  static showLandingPage() {
    // Falls wir nicht auf index.html sind, navigiere dorthin
    if (!window.location.pathname.includes('index.html') && window.location.pathname !== '/') {
      window.location.href = '/';
    }
    document.body.classList.add('landing-page');
  }

  /**
   * Navigiere zum QR Scanner
   */
  static goToScanner(stationId = null, basePath = '') {
    let url = basePath + '/app.html?scan=true';
    if (stationId) {
      url += `&station=${stationId}`;
    }
    window.location.href = url;
  }

  /**
   * Navigiere zur AR Scene (app.html mit ar=true)
   */
  static goToARScene(id, basePath = '') {
    window.location.href = basePath + '/app.html?model=' + id;
  }

  /**
   * Zurück zur Landing Page
   */
  static goHome(basePath = '') {
    window.location.href = basePath + '/index.html';
  }

  /**
   * Extrahiere Station aus URL
   */
  static getStationFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('station');
  }

  /**
   * Prüfe ob wir im Scanner sind
   */
  static isScannerMode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('scan') === 'true';
  }

  /**
   * Prüfe ob wir in AR sind
   */
  static isARMode() {
    const params = new URLSearchParams(window.location.search);
    return params.get('ar') === 'true';
  }
};
