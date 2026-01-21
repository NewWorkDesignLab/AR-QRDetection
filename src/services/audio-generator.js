/**
 * Generiert einfache Feedback-Sounds mit Web Audio API
 * Keine externen Dateien nötig
 * Angepasst: Wärmere, weniger nervige Töne
 */
export class AudioGenerator {
  constructor() {
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.masterVolume = 0.2; // ↓ Leiser (war: 0.3)
  }

  /**
   * Spiele einen Synth-Sound mit Envelope
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
    
    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(finalVolume, this.audioContext.currentTime + 0.01);
    
    gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration);

    oscillator.start(this.audioContext.currentTime);
    oscillator.stop(this.audioContext.currentTime + duration);
  }

  /**
   * UI Click Sound - Subtil und warm
   */
  click() {
    this.playTone(400, 0.04, 'sine', 0.5);
  }

  /**
   * Grab Start Sound - Dumpfer, angenehmer Ton
   */
  grab() {
    this.playTone(250, 0.15, 'sine', 0.4);
  }

  /**
   * Release Sound - Sanfter Übergang
   */
  release() {
    this.playTone(350, 0.1, 'sine', 0.35);
  }

  /**
   * Pinch Sound - Subtiler Pop
   */
  pinch() {
    this.playTone(450, 0.05, 'sine', 0.5);
  }

  /**
   * Poke Sound - Leichter Tap
   */
  poke() {
    this.playTone(420, 0.04, 'sine', 0.45);
  }

  /**
   * Success Sound - Angenehmer zwei-Ton Chime
   */
  success() {
    this.playTone(440, 0.12, 'sine', 0.5);
    setTimeout(() => this.playTone(550, 0.18, 'sine', 0.5), 60);
  }

  /**
   * Error Sound - Warnung ohne zu schreien
   */
  error() {
    this.playTone(180, 0.25, 'sine', 0.4);
  }

  /**
   * Info Panel Open - Sanfte Glocke
   */
  infoOpen() {
    this.playTone(440, 0.18, 'sine', 0.45);
    setTimeout(() => this.playTone(550, 0.25, 'sine', 0.4), 80);
  }

  /**
   * Info Panel Close - Kurzer, sanfter Klick
   */
  infoClose() {
    this.playTone(380, 0.04, 'sine', 0.4);
  }
}

// Singleton Export
export const audioGenerator = new AudioGenerator();