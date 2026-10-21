/** Stable identities shared by shortcut recording, storage and runtime. */
export const MOUSE_INPUT_LABELS = Object.freeze({
  MouseMiddle: 'Mouse middle',
  MouseBack: 'Mouse back',
  MouseForward: 'Mouse forward',
  WheelUp: 'Wheel up',
  WheelDown: 'Wheel down',
  WheelLeft: 'Wheel left',
  WheelRight: 'Wheel right',
});

export const HOLD_ACTIONS = ['holdSpeed', 'holdAdvance'];
export const PERIODIC_ADVANCE_ACTIONS = ['holdAdvance', 'toggleAdvance'];

export function isWheelInput(code) {
  return ['WheelUp', 'WheelDown', 'WheelLeft', 'WheelRight'].includes(code);
}

export function getMouseInputCode(event) {
  if (event.type === 'wheel') {
    if (event.ctrlKey || (!event.deltaX && !event.deltaY)) {
      return null;
    }
    if (Math.abs(event.deltaX || 0) > Math.abs(event.deltaY || 0)) {
      return event.deltaX < 0 ? 'WheelLeft' : 'WheelRight';
    }
    return event.deltaY < 0 ? 'WheelUp' : 'WheelDown';
  }
  return { 1: 'MouseMiddle', 3: 'MouseBack', 4: 'MouseForward' }[event.button] || null;
}
