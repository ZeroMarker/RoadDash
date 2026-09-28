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

const DIAL_CIRCUMFERENCE = 264; // matches the CSS stroke-dasharray
const BAR = (value: number): HTMLElement => {
  const wrap = document.createElement('i');
  wrap.style.width = `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;
  return wrap;
};

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
  private carSelect = $('carSelect');
  private startBest = $('startBest');
  private finalBest = $('finalBest');
  private newBest = $('newBest');
  private muteButton = $<HTMLButtonElement>('muteButton');
  private muteIcon = $('muteIcon');
  private bannerTimer = 0;

  selectedCar = 0;

  constructor() {
    this.buildCarCards();
    this.bindStaticButtons();
  }

  private buildCarCards(): void {
    this.carSelect.innerHTML = '';
    CARS.forEach((car, index) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `car-card${index === 0 ? ' selected' : ''}`;
      card.innerHTML = `
        <div class="car-swatch" style="background:linear-gradient(135deg, #${car.body
          .toString(16)
          .padStart(6, '0')}, #${car.accent.toString(16).padStart(6, '0')})"></div>
        <div class="car-name">${car.name}</div>
        <div class="car-blurb">${car.blurb}</div>
        <div class="car-stats">
          <span class="bar" data-stat="speed"></span>
          <span class="bar mid" data-stat="accel"></span>
          <span class="bar low" data-stat="grip"></span>
        </div>`;
      const bars = card.querySelectorAll<HTMLElement>('.bar');
      bars[0]?.appendChild(BAR((car.topSpeed - 0.85) / 0.35));
      bars[1]?.appendChild(BAR((car.accel - 0.85) / 0.4));
      bars[2]?.appendChild(BAR((car.handling - 0.8) / 0.4));
      card.addEventListener('click', () => this.selectCar(index));
      this.carSelect.appendChild(card);
    });
  }

  selectCar(index: number): void {
    this.selectedCar = Math.max(0, Math.min(CARS.length - 1, index));
    const cards = this.carSelect.querySelectorAll('.car-card');
    cards.forEach((card, i) => card.classList.toggle('selected', i === this.selectedCar));
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
  }

  showGame(stats: RunStats): void {
    this.hud.hidden = true;
    this.startScreen.hidden = true;
    this.pauseScreen.hidden = true;
    this.overScreen.hidden = false;
    const title = $('overTitle');
    title.textContent = stats.reason === 'busted' ? 'BUSTED' : 'WRECKED';
    title.classList.toggle('busted', stats.reason === 'busted');
    $('overReason').textContent = stats.reasonText;
    $('finalScore').textContent = stats.score.toLocaleString();
    $('finalDistance').textContent = Math.floor(stats.distance).toLocaleString();
    $('finalCoins').textContent = stats.coins.toLocaleString();
    this.finalBest.textContent = stats.best.toLocaleString();
    this.newBest.hidden = !stats.isBest;
    this.setHurt(false);
  }

  showPause(paused: boolean): void {
    this.pauseScreen.hidden = !paused;
  }

  /** Hide every overlay — used when a run begins. */
  hideOverlays(): void {
    this.startScreen.hidden = true;
    this.overScreen.hidden = true;
    this.pauseScreen.hidden = true;
  }

  setHudVisible(visible: boolean): void {
    this.hud.hidden = !visible;
  }

  setMuted(muted: boolean): void {
    this.muteButton.classList.toggle('muted', muted);
    this.muteIcon.textContent = muted ? '✕' : '♪';
  }

  // ---------------------------------------------------------------- gauges
  setSpeed(kmh: number, ratio: number, nitro: boolean): void {
    this.speedValue.textContent = Math.round(kmh).toString();
    this.dial.style.strokeDashoffset = `${(1 - Math.max(0, Math.min(1, ratio))) * DIAL_CIRCUMFERENCE}`;
    this.speedo.classList.toggle('nitro', nitro);
  }

  setScore(score: number, distance: number, coins: number, best: number): void {
    this.scoreValue.textContent = Math.floor(score).toLocaleString();
    this.distanceValue.textContent = Math.floor(distance).toLocaleString();
    this.coinValue.textContent = coins.toLocaleString();
    this.bestValue.textContent = best.toLocaleString();
  }

  setNitro(value: number, active: boolean): void {
    this.nitroFill.style.width = `${Math.max(0, Math.min(100, value))}%`;
    this.nitroWrap.classList.toggle('full', value >= 99.5 && !active);
    this.nitroWrap.classList.toggle('active', active);
    this.nitroLabel.textContent = active ? 'BURN' : value >= 99.5 ? 'READY' : 'NITRO';
  }

  setShield(hp: number, max: number): void {
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
  }

  setPolice(active: boolean): void {
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
    this.banner.className = `banner ${kind}`;
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
}
