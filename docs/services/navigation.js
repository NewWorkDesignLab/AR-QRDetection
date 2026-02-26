/**
 * Navigation Service für Landing Page → Scanner → AR Scene
 * URL-Parameter Handling für direkte AR-Starts
 */

// ===== BASE PATH FÜR GITHUB PAGES =====
const basePath = window.location.pathname.includes('/AR-QRDetection/') 
  ? '/AR-QRDetection' 
  : '';

export class NavigationService {

  /**
   * Navigiere zum QR Scanner
   */
  static goToScanner(stationId = null) {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    
    let url = `${basePath}/app.html`;
    if (id) {
      url += `?id=${encodeURIComponent(id)}`;
    }
    
    window.location.href = url;
  }

  /**
   * Zurück zur Landing Page
   */
  static goHome() {
    window.location.href = basePath + '/index.html';
  }
}
