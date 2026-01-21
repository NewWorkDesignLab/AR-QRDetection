export const UIState = {
  ONBOARDING: 'onboarding',
  QR_SCAN: 'qr-scan',
  QR_DENIED: 'qr-denied',
  QR_ERROR: 'qr-error',
  AR_LOADING: 'ar-loading',
  AR_ACTIVE: 'ar-active',
};

export class StateMachine {
  constructor(onChange) {
    this.state = UIState.ONBOARDING;
    this.onChange = onChange;
  }
  set(state, payload = {}) {
    if (state === this.state) return;
    this.state = state;
    this.onChange?.(state, payload);
  }
  is(state) { return this.state === state; }
}