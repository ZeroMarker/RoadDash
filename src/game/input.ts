export type Action = 'left' | 'right' | 'jump' | 'slide' | 'nitro' | 'pause' | 'confirm';

type Handler = (action: Action) => void;

/**
 * Keyboard + touch/swipe input, normalised into a small verb set so the game
 * loop never cares where an action came from.
 */
export class Input {
  private held = new Set<Action>();
  private handlers: Handler[] = [];
  private touchStart: { x: number; y: number; t: number } | null = null;
  private disposed = false;

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('pointerdown', this.onPointerDown);
    target.addEventListener('pointerup', this.onPointerUp);
    target.addEventListener('pointercancel', this.onPointerCancel);
    target.addEventListener('contextmenu', this.onContextMenu);
  }

  on(handler: Handler): void {
    this.handlers.push(handler);
  }

  isHeld(action: Action): boolean {
    return this.held.has(action);
  }

  private emit(action: Action): void {
    for (const h of this.handlers) h(action);
  }

  private onContextMenu = (e: Event) => e.preventDefault();

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.disposed) return;
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.held.add('left');
        this.emit('left');
        e.preventDefault();
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.held.add('right');
        this.emit('right');
        e.preventDefault();
        break;
      case 'ArrowUp':
      case 'KeyW':
        this.held.add('jump');
        this.emit('jump');
        e.preventDefault();
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.held.add('slide');
        this.emit('slide');
        e.preventDefault();
        break;
      case 'Space':
        this.held.add('nitro');
        this.emit('nitro');
        e.preventDefault();
        break;
      case 'Escape':
      case 'KeyP':
        this.emit('pause');
        break;
      case 'Enter':
        this.emit('confirm');
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case 'ArrowLeft':
      case 'KeyA':
        this.held.delete('left');
        break;
      case 'ArrowRight':
      case 'KeyD':
        this.held.delete('right');
        break;
      case 'ArrowUp':
      case 'KeyW':
        this.held.delete('jump');
        break;
      case 'ArrowDown':
      case 'KeyS':
        this.held.delete('slide');
        break;
      case 'Space':
        this.held.delete('nitro');
        break;
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if (this.disposed) return;
    this.target.setPointerCapture?.(e.pointerId);
    this.touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerUp = (e: PointerEvent) => {
    const start = this.touchStart;
    this.touchStart = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 24) {
      // Tap: left half steers left, right half steers right, centre jumps.
      const mid = window.innerWidth / 2;
      if (e.clientX < mid * 0.75) this.emit('left');
      else if (e.clientX > mid * 1.25) this.emit('right');
      else this.emit('jump');
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) {
      this.emit(dx > 0 ? 'right' : 'left');
    } else {
      this.emit(dy < 0 ? 'jump' : 'slide');
    }
  };

  private onPointerCancel = () => {
    this.touchStart = null;
  };

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.target.removeEventListener('pointerdown', this.onPointerDown);
    this.target.removeEventListener('pointerup', this.onPointerUp);
    this.target.removeEventListener('pointercancel', this.onPointerCancel);
    this.target.removeEventListener('contextmenu', this.onContextMenu);
  }
}
