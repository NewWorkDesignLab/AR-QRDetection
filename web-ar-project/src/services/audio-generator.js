/**
 * Generiert einfache Feedback-Sounds mit Web Audio API
 * Keine externen Dateien nötig
 */
export class AudioGenerator {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.masterVolume = 0.3; // Global volume
  }

  /**
   * Spiele einen Synth-Sound
   * @param {number} frequency - Frequenz in Hz
   * @param {number} duration - Dauer in Sekunden
   * @param {string} type - Waveform: 'sine', 'square', 'sawtooth', 'triangle'
   * @param {number} volume - Lautstärke 0-1
   */
  playTone(frequency = 440, duration = 0.1, type = 'sine', volume = 1.0) {
    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = type;

    const finalVolume = this.masterVolume * volume;
    gainNode.gain.setValueAtTime(finalVolume, this.audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  /**
   * UI Click Sound
   */
  click() {
    this.playTone(600, 0.05, 'square', 0.6);
  }

  /**
   * Grab Start Sound (tiefer Ton)
   */
  grab() {
    this.playTone(300, 0.12, 'sine', 0.6);
  }

  /**
   * Release Sound (höherer Ton)
   */
  release() {
    this.playTone(500, 0.08, 'sine', 0.5);
  }

  /**
   * Pinch Sound (kurzer Pop)
   */
  pinch() {
    this.playTone(600, 0.06, 'triangle', 0.7);
  }

  /**
   * Poke Sound (schneller Blip)
   */
  poke() {
    this.playTone(600, 0.05, 'square', 0.6);
  }

  /**
   * Success Sound (zweistufiger Chime)
   */
  success() {
    this.playTone(600, 0.1, 'sine', 0.7);
    setTimeout(() => this.playTone(800, 0.15, 'sine', 0.7), 50);
  }

  /**
   * Error Sound (tiefer Buzz)
   */
  error() {
    this.playTone(200, 0.2, 'sawtooth', 0.5);
  }

  /**
   * Info Panel Open (sanfter Glocken-Sound)
   */
  infoOpen() {
    this.playTone(800, 0.15, 'sine', 0.5);
    setTimeout(() => this.playTone(1000, 0.2, 'sine', 0.4), 60);
  }

  /**
   * Info Panel Close (kurzer Klick)
   */
  infoClose() {
    this.playTone(600, 0.05, 'triangle', 0.4);
  }
}

// Singleton Export
export const audioGenerator = new AudioGenerator();