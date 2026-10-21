/** Keyboard + on-screen touch controls, merged into one simple state. */
export class Input {
  private readonly keys = new Set<string>();
  private jumpQueued = false;
  private readonly touch = { left: false, right: false, tuck: false, back: false };
  private readonly listeners: Partial<Record<'pause' | 'mute', () => void>> = {};

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') this.jumpQueued = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.listeners.pause?.();
      if (e.code === 'KeyM') this.listeners.mute?.();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(event: 'pause' | 'mute', fn: () => void): void {
    this.listeners[event] = fn;
  }

  /** Wire a DOM element as a hold-to-activate touch button. */
  bindTouch(el: HTMLElement, action: 'left' | 'right' | 'tuck' | 'back' | 'jump'): void {
    const down = (e: PointerEvent): void => {
      e.preventDefault();
      el.classList.add('active');
      if (action === 'jump') this.jumpQueued = true;
      else this.touch[action] = true;
    };
    const up = (): void => {
      el.classList.remove('active');
      if (action !== 'jump') this.touch[action] = false;
    };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }

  get steer(): number {
    const left = this.keys.has('ArrowLeft') || this.keys.has('KeyA') || this.touch.left;
    const right = this.keys.has('ArrowRight') || this.keys.has('KeyD') || this.touch.right;
    return (right ? 1 : 0) - (left ? 1 : 0);
  }

  get tuck(): boolean {
    return this.keys.has('ArrowDown') || this.keys.has('KeyS') || this.touch.tuck;
  }

  get lookBack(): boolean {
    return this.keys.has('KeyC') || this.keys.has('ShiftLeft') || this.touch.back;
  }

  /** Returns true once per jump press. */
  consumeJump(): boolean {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  clearJump(): void {
    this.jumpQueued = false;
  }
}
