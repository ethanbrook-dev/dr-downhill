import type { Input } from '../core/Input';

export type Screen = 'title' | 'pause' | 'gameover' | null;

export interface HudState {
  score: number;
  distance: number;
  coins: number;
  crashes: number;
  enraged: boolean;
  speedKmh: number;
  boost: number;
  clownDistance: number;
  clownSide: number;
  clownBehind: boolean;
}

export interface GameOverInfo {
  score: number;
  distance: number;
  coins: number;
  crashes: number;
  seconds: number;
  best: number;
  newBest: boolean;
}

export interface HudHandlers {
  start: () => void;
  resume: () => void;
  restart: () => void;
  menu: () => void;
  pause: () => void;
  mute: () => boolean;
}

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

export class Hud {
  private readonly root: HTMLElement;
  private readonly hud: HTMLElement;
  private readonly els: Record<string, HTMLElement> = {};
  private readonly last: Record<string, string> = {};
  private readonly screens: Record<Exclude<Screen, null>, HTMLElement>;

  constructor(root: HTMLElement, input: Input, handlers: HudHandlers) {
    this.root = root;
    root.innerHTML = /* html */ `
      <div class="fx danger" id="danger"></div>
      <div class="fx boostfx" id="boostfx"></div>
      <div class="fx flash" id="flash"></div>
      <div class="hud hidden" id="hud">
        <div class="panel score-box">
          <div class="label">SCORE</div>
          <div class="big" id="score">0</div>
          <div class="sub"><span id="dist">0</span> m · <span class="coin-ico">✚</span> <span id="coins">0</span></div>
        </div>
        <div class="panel crash-box" id="crashBox">
          <div class="label" id="crashLabel">CRASHES: 0 / 3</div>
          <div class="pips"><span class="pip"></span><span class="pip"></span><span class="pip"></span></div>
          <div class="boost-tag hidden" id="boost">ADRENALINE!</div>
        </div>
        <div class="clown-meter hidden" id="meter">
          <div class="clown-ico">🤡</div>
          <div class="meter-body">
            <div class="meter-label" id="meterLabel">CLOWN 0 m</div>
            <div class="bar"><div class="fill" id="meterFill"></div></div>
          </div>
        </div>
        <div class="arrow hidden" id="arrow">▲</div>
        <div class="speed panel"><span id="speed">0</span><small>km/h</small></div>
        <div class="buttons">
          <button class="icon-btn" id="muteBtn" title="Mute (M)">🔊</button>
          <button class="icon-btn" id="pauseBtn" title="Pause (Esc)">❚❚</button>
        </div>
        <div class="popups" id="popups"></div>
        <div class="touch" id="touch">
          <div class="tbtn" data-a="left">◀</div>
          <div class="tbtn" data-a="right">▶</div>
          <div class="tright">
            <div class="tbtn small" data-a="back">👀</div>
            <div class="tbtn small" data-a="tuck">▼</div>
            <div class="tbtn jump" data-a="jump">JUMP</div>
          </div>
        </div>
      </div>

      <div class="screen title-screen" id="title">
        <div class="logo">
          <div class="logo-dr">DR.</div>
          <div class="logo-main"><span>D</span><span>O</span><span>W</span><span>N</span><span>H</span><span>I</span><span>L</span><span>L</span></div>
          <div class="tagline">The clowns are coming. Ski for your life!</div>
        </div>
        <button class="btn primary" id="startBtn">START</button>
        <div class="best">BEST: <span id="bestTitle">0</span></div>
        <div class="help">
          <div><kbd>←</kbd><kbd>→</kbd> / <kbd>A</kbd><kbd>D</kbd> steer</div>
          <div><kbd>Space</kbd> jump · <kbd>↓</kbd> tuck for speed</div>
          <div><kbd>C</kbd> look back · <kbd>Esc</kbd> pause · <kbd>M</kbd> mute</div>
        </div>
      </div>

      <div class="screen pause-screen hidden" id="pause">
        <h2>PAUSED</h2>
        <button class="btn primary" id="resumeBtn">RESUME</button>
        <button class="btn" id="restartBtn2">RESTART</button>
        <button class="btn" id="menuBtn2">MENU</button>
      </div>

      <div class="screen over-screen hidden" id="gameover">
        <h2 id="overTitle">CAUGHT!</h2>
        <div class="over-sub" id="overSub"></div>
        <div class="stats">
          <div><span>SCORE</span><b id="overScore">0</b></div>
          <div><span>DISTANCE</span><b id="overDist">0 m</b></div>
          <div><span>COINS</span><b id="overCoins">0</b></div>
          <div><span>CRASHES</span><b id="overCrashes">0</b></div>
          <div><span>SURVIVED</span><b id="overTime">0s</b></div>
          <div><span>BEST</span><b id="overBest">0</b></div>
        </div>
        <div class="newbest hidden" id="newBest">NEW BEST!</div>
        <button class="btn primary" id="restartBtn">SKI AGAIN</button>
        <button class="btn" id="menuBtn">MENU</button>
      </div>
    `;
    this.hud = $(root, '#hud');
    this.screens = { title: $(root, '#title'), pause: $(root, '#pause'), gameover: $(root, '#gameover') };
    for (const id of [
      'score', 'dist', 'coins', 'crashBox', 'crashLabel', 'flash', 'boost', 'meter', 'meterLabel', 'meterFill', 'arrow', 'speed',
      'popups', 'danger', 'boostfx', 'muteBtn', 'bestTitle', 'touch',
    ]) {
      this.els[id] = $(root, `#${id}`);
    }

    const click = (id: string, fn: () => void): void => {
      $(root, `#${id}`).addEventListener('click', (e) => {
        e.stopPropagation();
        fn();
      });
    };
    click('startBtn', handlers.start);
    click('resumeBtn', handlers.resume);
    click('restartBtn', handlers.restart);
    click('restartBtn2', handlers.restart);
    click('menuBtn', handlers.menu);
    click('menuBtn2', handlers.menu);
    click('pauseBtn', handlers.pause);
    click('muteBtn', () => this.setMuted(handlers.mute()));

    root.querySelectorAll<HTMLElement>('.tbtn').forEach((el) => {
      input.bindTouch(el, el.dataset.a as 'left' | 'right' | 'tuck' | 'back' | 'jump');
    });
    const coarse = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    this.els.touch.classList.toggle('hidden', !coarse);
  }

  setMuted(muted: boolean): void {
    this.els.muteBtn.textContent = muted ? '🔇' : '🔊';
  }

  showScreen(screen: Screen): void {
    for (const [name, el] of Object.entries(this.screens)) el.classList.toggle('hidden', name !== screen);
    this.hud.classList.toggle('hidden', screen === 'title');
    this.root.classList.toggle('dim', screen === 'pause' || screen === 'gameover');
  }

  setBest(best: number): void {
    this.els.bestTitle.textContent = best.toLocaleString();
  }

  private set(id: string, text: string): void {
    if (this.last[id] === text) return;
    this.last[id] = text;
    this.els[id].textContent = text;
  }

  update(s: HudState): void {
    this.set('score', Math.floor(s.score).toLocaleString());
    this.set('dist', Math.floor(s.distance).toLocaleString());
    this.set('coins', String(s.coins));
    this.set('speed', String(Math.round(s.speedKmh)));
    this.set('crashLabel', s.enraged ? 'CLOWN ENRAGED!' : `CRASHES: ${s.crashes} / 3`);
    this.els.crashBox.querySelectorAll('.pip').forEach((pip, i) => pip.classList.toggle('on', i < s.crashes));
    this.els.crashBox.classList.toggle('enraged', s.enraged);
    this.els.meter.classList.toggle('enraged', s.enraged);
    this.els.boost.classList.toggle('hidden', s.boost <= 0);

    const d = s.clownDistance;
    const showMeter = d < 90;
    this.els.meter.classList.toggle('hidden', !showMeter);
    if (showMeter) {
      const name = s.enraged ? 'ANGRY CLOWN' : 'CLOWN';
      this.set('meterLabel', d < 6 ? 'RIGHT BEHIND YOU!' : `${name} ${Math.round(d)} m`);
      const danger = 1 - Math.min(1, d / 60);
      this.els.meterFill.style.width = `${danger * 100}%`;
      this.els.meter.classList.toggle('pulse', d < 18);
    }
    this.els.danger.style.opacity = String(Math.max(0, 1 - d / 22) * 0.9);
    this.els.boostfx.style.opacity = s.boost > 0 ? '1' : '0';

    const arrow = this.els.arrow;
    const showArrow = d < 40;
    arrow.classList.toggle('hidden', !showArrow);
    if (showArrow) {
      const angle = s.clownBehind ? 180 + s.clownSide * -50 : s.clownSide * 70;
      arrow.style.transform = `translateX(-50%) rotate(${angle}deg)`;
    }
  }

  /** Red full-screen warning flash. */
  flash(): void {
    const el = this.els.flash;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  popup(text: string, color = '#ffffff', big = false): void {
    const el = document.createElement('div');
    el.className = `popup${big ? ' big' : ''}`;
    el.textContent = text;
    el.style.color = color;
    el.style.left = `${45 + Math.random() * 10}%`;
    this.els.popups.appendChild(el);
    window.setTimeout(() => el.remove(), 1300);
  }

  showGameOver(info: GameOverInfo): void {
    $(this.root, '#overTitle').textContent = 'CAUGHT BY THE CLOWN!';
    $(this.root, '#overSub').textContent = 'The doctor will see you now... in the circus.';
    $(this.root, '#overScore').textContent = Math.floor(info.score).toLocaleString();
    $(this.root, '#overDist').textContent = `${Math.floor(info.distance).toLocaleString()} m`;
    $(this.root, '#overCoins').textContent = String(info.coins);
    $(this.root, '#overCrashes').textContent = String(info.crashes);
    $(this.root, '#overTime').textContent = `${Math.floor(info.seconds)}s`;
    $(this.root, '#overBest').textContent = Math.floor(info.best).toLocaleString();
    $(this.root, '#newBest').classList.toggle('hidden', !info.newBest);
    this.showScreen('gameover');
  }
}
