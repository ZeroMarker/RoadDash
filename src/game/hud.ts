import { CARS, type CarSpec } from './config';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing element #${id}`);
  return el as T;
};

export interface RunStats {
  score: number;
  distance: number;
  coins: number;
  best: number;
  isBest: boolean;
  reason: 'wrecked' | 'busted';
  reasonText: string;
  biome: string;
}

/** Matches the `--fs-*` ladder in styles.css only in name, not in shape. */
const DIAL_CIRCUMFERENCE = 264; // matches the CSS stroke-dasharray
const BANNER_KINDS = ['near', 'boost', 'danger'] as const;

/**
 * The three bars under a car card. Each is a ratio of the car's stat against
 * the width of the spread between the slowest and fastest car, so a card
 * reads as a shape rather than a table.
 */
const STAT_BARS = [
  { stat: 'speed', label: 'Top speed', get: (c: CarSpec) => c.topSpeed, lo: 0.85, span: 0.35 },
  { stat: 'accel', label: 'Acceleration', get: (c: CarSpec) => c.accel, lo: 0.85, span: 0.4 },
  { stat: 'grip', label: 'Handling', get: (c: CarSpec) => c.handling, lo: 0.8, span: 0.4 },
] as const;

/** Bar fill as a clamped 0..1 ratio of its stat's spread. */
const statRatio = (value: number, lo: number, span: number): number =>
  Math.max(0, Math.min(1, (value - lo) / span));

const BAR = (value: number): HTMLElement => {
  const wrap = document.createElement('i');
  wrap.style.width = `${Math.round(value * 100)}%`;
  return wrap;
};

const pct = (value: number): string => `${Math.round(value * 100)}%`;

const hex = (color: number): string => `#${color.toString(16).padStart(6, '0')}`;

export class Hud {
  private hud = $('hud');
  private app = $('app');
  private speedo = document.querySelector('.speedo') as HTMLElement;
  private dial = $('dialFill') as unknown as SVGCircleElement;
  private speedValue = $('speedValue');
  private scoreValue = $('scoreValue');
  private distanceValue = $('distanceValue');
  private coinValue = $('coinValue');
  private bestValue = $('bestValue');
  private nitroFill = $('nitroFill');
  private nitroTrack = document.querySelector('.nitro-track') as HTMLElement;
  private nitroWrap = document.querySelector('.nitro') as HTMLElement;
  private nitroLabel = $('nitroLabel');
  private shieldRow = $('shieldRow');
  private banner = $('banner');
  private bannerTitle = $('bannerTitle');
  private bannerSub = $('bannerSub');
  private policeWarning = $('policeWarning');
  private startScreen = $('startScreen');
  private overScreen = $('overScreen');
  private pauseScreen = $('pauseScreen');
  private overTitle = $('overTitle');
  private overReason = $('overReason');
  private overWhere = $('overWhere');
  private carSelect = $('carSelect');
  private startBest = $('startBest');
  private finalBest = $('finalBest');
  private newBest = $('newBest');
  private muteButton = $<HTMLButtonElement>('muteButton');
  private muteIcon = $('muteIcon');
  private bannerTimer = 0;
  private activeDialog: HTMLElement | null = null;
  private returnFocus: HTMLElement | null = null;

  /**
   * Everything below is written every frame from `update()`. Caching the last
   * rendered value keeps the HUD off the critical path: a textContent write
   * invalidates layout for the whole overlay, and most of these numbers only
   * change a few times a second at most.
   */
  private lastKmh = -1;
  private lastDialOffset = -1;
  private lastSpeedNitro: boolean | null = null;
  private lastScore = -1;
  private lastDistance = -1;
  private lastCoins = -1;
  private lastBest = -1;
  private lastNitroWidth = '';
  private lastNitroState = '';
  private lastNitroSpoken = '';
  private lastShield = '';
  private lastPolice: boolean | null = null;

  selectedCar = 0;

  constructor() {
    this.buildCarCards();
    this.bindStaticButtons();
    this.app.addEventListener('keydown', this.onDialogKeyDown);
  }

  private openDialog(dialog: HTMLElement, initialFocus: HTMLElement): void {
    if (!this.activeDialog) {
      const focused = document.activeElement;
      this.returnFocus = focused instanceof HTMLElement && focused !== document.body ? focused : null;
    }
    this.activeDialog = dialog;
    for (const child of this.app.children) {
      if (child instanceof HTMLElement) child.inert = child !== dialog;
    }
    initialFocus.focus({ preventScroll: true });
  }

  private closeDialog(restoreFocus = true): void {
    if (!this.activeDialog) return;
    this.activeDialog = null;
    for (const child of this.app.children) {
      if (child instanceof HTMLElement) child.inert = false;
    }
    const previous = this.returnFocus;
    this.returnFocus = null;
    const target = restoreFocus && previous?.isConnected && previous.getClientRects().length > 0
      && !previous.closest('[hidden], [inert]') ? previous : $('scene');
    target.focus({ preventScroll: true });
  }

  private onDialogKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Tab' || !this.activeDialog) return;
    const controls = [...this.activeDialog.querySelectorAll<HTMLElement>(
      'button, a[href], input, select, textarea, [tabindex]',
    )].filter((el) => el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.closest('[inert]'));
    const first = controls[0];
    const last = controls[controls.length - 1];
    const focused = document.activeElement;
    if ((event.shiftKey && focused === first) || (!event.shiftKey && focused === last)
      || !this.activeDialog.contains(focused)) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus({ preventScroll: true });
    }
  };

  // ------------------------------------------------------------------ setup
  private buildCarCards(): void {
    this.carSelect.innerHTML = '';
    CARS.forEach((car, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'car-card';
      card.setAttribute('role', 'radio');

      const swatch = document.createElement('div');
      swatch.className = 'car-swatch';
      swatch.style.background = `linear-gradient(135deg, ${hex(car.body)}, ${hex(car.accent)})`;

      const name = document.createElement('div');
      name.className = 'car-name';
      name.textContent = car.name;

      const blurb = document.createElement('div');
      blurb.className = 'car-blurb';
      blurb.textContent = car.blurb;

      const stats = document.createElement('div');
      stats.className = 'car-stats';
      // Three colour-coded bars are unreadable without a key, so every bar
      // carries its own name — as a tooltip for pointers, as text for AT.
      const summary: string[] = [];
      STAT_BARS.forEach((bar, i) => {
        const value = statRatio(bar.get(car), bar.lo, bar.span);
        const track = document.createElement('span');
        track.className = i === 0 ? 'bar' : `bar ${i === 1 ? 'mid' : 'low'}`;
        track.dataset.stat = bar.stat;
        track.title = `${bar.label} ${pct(value)}`;
        track.appendChild(BAR(value));
        stats.appendChild(track);
        summary.push(`${bar.label.toLowerCase()} ${pct(value)}`);
      });

      const spoken = document.createElement('span');
      spoken.className = 'sr-only';
      spoken.textContent = `${car.name}. ${car.blurb}. ${summary.join(', ')}.`;
      card.setAttribute('aria-label', spoken.textContent);

      card.append(swatch, name, blurb, stats);
      card.addEventListener('click', () => this.selectCar(index));
      this.carSelect.appendChild(card);
    });
    this.selectCar(this.selectedCar);
  }

  selectCar(index: number): void {
    this.selectedCar = Math.max(0, Math.min(CARS.length - 1, index));
    const cards = this.carSelect.querySelectorAll<HTMLButtonElement>('.car-card');
    cards.forEach((card, i) => {
      const on = i === this.selectedCar;
      card.classList.toggle('selected', on);
      card.setAttribute('aria-checked', String(on));
      card.tabIndex = on ? 0 : -1;
    });
  }

  get car(): CarSpec {
    return CARS[this.selectedCar] as CarSpec;
  }

  private bindStaticButtons(): void {
    $('startButton').addEventListener('click', () => this.onStart?.());
    $('retryButton').addEventListener('click', () => this.onStart?.());
    $('resumeButton').addEventListener('click', () => this.onResume?.());
    $('quitButton').addEventListener('click', () => this.onQuit?.());
    this.muteButton.addEventListener('click', () => this.onMute?.());

    // Roving tabindex: the group is one tab stop, and ←/→ move between cars.
    // Without this a keyboard user tabbing the menu lands on a card with
    // focus and can still not tell which one is selected, because focus and
    // selection are only ever the same card after a click.
    this.carSelect.addEventListener('keydown', (e) => {
      const keys: Record<string, number> = {
        ArrowLeft: -1,
        ArrowRight: 1,
        ArrowUp: -1,
        ArrowDown: 1,
      };
      const step = keys[e.key];
      if (step === undefined) return;
      e.preventDefault();
      // The global input layer also maps ←/→ to a lane change and already
      // moves the selection while the menu is up. Stop here so the arrows
      // move the selection once, not twice.
      e.stopPropagation();
      const next = Math.max(0, Math.min(CARS.length - 1, this.selectedCar + step));
      if (next === this.selectedCar) return;
      this.selectCar(next);
      (this.carSelect.children[next] as HTMLElement | undefined)?.focus();
    });

    // Focus entering a group lands on the selected option, not the first.
    this.carSelect.addEventListener('focusin', (e) => {
      const card = (e.target as HTMLElement).closest('.car-card') as HTMLElement | null;
      if (!card) return;
      const index = [...this.carSelect.children].indexOf(card);
      if (index >= 0 && index !== this.selectedCar) this.selectCar(index);
    });
  }

  onStart?: () => void;
  onResume?: () => void;
  onQuit?: () => void;
  onMute?: () => void;

  // ---------------------------------------------------------------- screens
  showStart(best: number): void {
    this.startBest.textContent = best.toLocaleString();
    this.startScreen.hidden = false;
    this.overScreen.hidden = true;
    this.pauseScreen.hidden = true;
    this.hud.hidden = true;
    this.openDialog(this.startScreen, this.carSelect.children[this.selectedCar] as HTMLElement);
  }

  showGame(stats: RunStats): void {
    this.hud.hidden = true;
    this.startScreen.hidden = true;
    this.pauseScreen.hidden = true;
    this.overScreen.hidden = false;
    this.overTitle.textContent = stats.reason === 'busted' ? 'BUSTED' : 'WRECKED';
    this.overTitle.classList.toggle('busted', stats.reason === 'busted');
    this.overReason.textContent = stats.reasonText;
    this.overWhere.textContent = stats.biome ? `ENDED IN ${stats.biome}` : '';
    $('finalScore').textContent = stats.score.toLocaleString();
    $('finalDistance').textContent = Math.floor(stats.distance).toLocaleString();
    $('finalCoins').textContent = stats.coins.toLocaleString();
    this.finalBest.textContent = stats.best.toLocaleString();
    this.newBest.hidden = !stats.isBest;
    this.setHurt(false);
    this.openDialog(this.overScreen, $('retryButton'));
  }

  showPause(paused: boolean): void {
    this.pauseScreen.hidden = !paused;
    if (paused) this.openDialog(this.pauseScreen, $('resumeButton'));
    else if (this.activeDialog === this.pauseScreen) this.closeDialog();
  }

  /** Hide every overlay — used when a run begins. */
  hideOverlays(): void {
    this.startScreen.hidden = true;
    this.overScreen.hidden = true;
    this.pauseScreen.hidden = true;
    this.closeDialog(false);
  }

  setHudVisible(visible: boolean): void {
    this.hud.hidden = !visible;
  }

  setMuted(muted: boolean): void {
    this.muteButton.classList.toggle('muted', muted);
    this.muteButton.setAttribute('aria-pressed', String(muted));
    this.muteButton.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
    this.muteIcon.textContent = muted ? '✕' : '♪';
  }

  // ---------------------------------------------------------------- gauges
  setSpeed(kmh: number, ratio: number, nitro: boolean): void {
    const kmhRounded = Math.round(kmh);
    if (kmhRounded !== this.lastKmh) {
      this.lastKmh = kmhRounded;
      this.speedValue.textContent = kmhRounded.toString();
    }
    // The needle moves continuously; a quarter of a pixel is under the
    // resolution of the display, so there is nothing to redraw below it.
    const offset = Math.round((1 - Math.max(0, Math.min(1, ratio))) * DIAL_CIRCUMFERENCE * 4) / 4;
    if (offset !== this.lastDialOffset) {
      this.lastDialOffset = offset;
      this.dial.style.strokeDashoffset = `${offset}`;
    }
    if (nitro !== this.lastSpeedNitro) {
      this.lastSpeedNitro = nitro;
      this.speedo.classList.toggle('boosting', nitro);
    }
  }

  setScore(score: number, distance: number, coins: number, best: number): void {
    const s = Math.floor(score);
    if (s !== this.lastScore) {
      this.lastScore = s;
      this.scoreValue.textContent = s.toLocaleString();
    }
    const d = Math.floor(distance);
    if (d !== this.lastDistance) {
      this.lastDistance = d;
      this.distanceValue.textContent = d.toLocaleString();
    }
    if (coins !== this.lastCoins) {
      this.lastCoins = coins;
      this.coinValue.textContent = coins.toLocaleString();
    }
    if (best !== this.lastBest) {
      this.lastBest = best;
      this.bestValue.textContent = best.toLocaleString();
    }
  }

  /**
   * Kick the coin counter. Pickups can happen at the edge of vision or behind
   * the car, so the in-world pop is not always enough to confirm the collect —
   * this is the confirmation that is always visible.
   *
   * The animation is restarted by toggling the class off and forcing a reflow;
   * simply re-adding it does nothing once the animation has already run.
   */
  pulseCoins(): void {
    const row = this.coinValue.parentElement;
    if (!row) return;
    row.classList.remove('bump');
    void row.offsetWidth;
    row.classList.add('bump');
  }

  setNitro(value: number, active: boolean): void {
    const clamped = Math.max(0, Math.min(100, value));
    const width = `${Math.round(clamped * 10) / 10}%`;
    if (width !== this.lastNitroWidth) {
      this.lastNitroWidth = width;
      this.nitroFill.style.width = width;
    }
    const full = clamped >= 99.5 && !active;
    const state = full ? 'full' : active ? 'active' : '';
    if (state !== this.lastNitroState) {
      this.lastNitroState = state;
      this.nitroWrap.classList.toggle('full', full);
      this.nitroWrap.classList.toggle('active', active);
      const label = active ? 'BURN' : full ? 'READY' : 'NITRO';
      this.nitroLabel.textContent = label;
    }
    // Round down to quarter-percent steps so a value below the activation
    // threshold cannot be announced as 25%, or a partial bar as 100%.
    const spoken = `${Math.floor(clamped * 4) / 4}%`;
    if (spoken !== this.lastNitroSpoken) {
      this.lastNitroSpoken = spoken;
      this.nitroTrack.setAttribute('aria-label', `Nitro ${spoken}`);
    }
  }

  setShield(hp: number, max: number): void {
    const key = `${hp}/${max}`;
    if (key === this.lastShield) return;
    this.lastShield = key;
    if (this.shieldRow.childElementCount !== max) {
      this.shieldRow.innerHTML = '';
      for (let i = 0; i < max; i++) {
        const pip = document.createElement('span');
        pip.className = 'pip';
        this.shieldRow.appendChild(pip);
      }
    }
    const pips = this.shieldRow.children;
    for (let i = 0; i < max; i++) {
      const pip = pips[i] as HTMLElement;
      const on = i < hp;
      pip.className = `pip${on ? (hp === 1 ? ' low' : '') : ' off'}`;
    }
    this.shieldRow.setAttribute('aria-label', hp > 0 ? `Armour ${hp} of ${max}` : 'Armour gone');
  }

  setPolice(active: boolean): void {
    if (active === this.lastPolice) return;
    this.lastPolice = active;
    this.policeWarning.hidden = !active;
  }

  setHurt(on: boolean): void {
    this.app.classList.toggle('hurt', on);
  }

  setBoost(on: boolean): void {
    this.app.classList.toggle('boost', on);
  }

  // ---------------------------------------------------------------- banners
  showBanner(title: string, sub: string, kind: 'near' | 'boost' | 'danger' | '', hold = 700): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    for (const k of BANNER_KINDS) this.banner.classList.toggle(k, k === kind);
    this.banner.hidden = false;
    // Restart the entry animation.
    this.banner.style.animation = 'none';
    void this.banner.offsetWidth;
    this.banner.style.animation = '';
    this.bannerTimer = hold;
  }

  tick(dt: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.hidden = true;
    }
  }

  dispose(): void {
    this.app.removeEventListener('keydown', this.onDialogKeyDown);
    this.closeDialog(false);
  }
}
