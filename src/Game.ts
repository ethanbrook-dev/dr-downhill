import * as THREE from 'three';
import { clamp } from './core/math';
import { CameraRig, type CamFocus, type CamMode } from './core/CameraRig';
import { Input } from './core/Input';
import { loadBest, saveBest } from './core/storage';
import { Sfx } from './audio/Sfx';
import { Player, PLAYER_RADIUS, START_Z } from './entities/Player';
import { Clown } from './entities/Clown';
import { ClownDirector } from './entities/ClownDirector';
import { Particles, SnowFall, SpeedLines } from './fx/Particles';
import { Hud } from './ui/Hud';
import { Mountains, Sky, World } from './world/World';
import type { Obstacle } from './world/Chunk';
import { featureAt, groundHeight } from './world/terrain';

type State = 'title' | 'playing' | 'paused' | 'dying' | 'over';

const SUN_OFFSET = new THREE.Vector3(45, 60, -12);
const FOG_COLOR = 0xd6ecff;
const SUBSTEP = 1 / 120;

const SNOW = new THREE.Color(0xffffff);
const SNOW_BLUE = new THREE.Color(0xd8e8ff);
const GOLD = new THREE.Color(0xffd23f);
const HEAL = new THREE.Color(0xff4757);
const CYAN = new THREE.Color(0x2ff3c8);
const RAGE = new THREE.Color(0xff2b2b);
const RAGE_HOT = new THREE.Color(0xff9a1a);
const BARK = new THREE.Color(0x7a4a2a);
const LEAF = new THREE.Color(0x1f8a52);
const ROCK = new THREE.Color(0x7d8799);
const CONFETTI = [0xff3da5, 0xffe14a, 0x33d17a, 0x3a7bff, 0xff6a00, 0x9b3dff].map((c) => new THREE.Color(c));

const OUCH = ['OUCH!', 'BONK!', 'YIKES!', 'MY SPINE!', 'OOF!', 'NURSE!'];

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly rig: CameraRig;
  private readonly sun: THREE.DirectionalLight;
  private readonly world: World;
  private readonly sky: Sky;
  private readonly mountains = new Mountains();
  private readonly player = new Player();
  private readonly director: ClownDirector;
  private readonly titleClown = new Clown('chaser', 0);
  private readonly particles = new Particles(3500);
  private readonly snow = new SnowFall();
  private readonly speedLines = new SpeedLines();
  private readonly input = new Input();
  private readonly sfx = new Sfx();
  private readonly hud: Hud;

  private state: State = 'title';
  private last = performance.now();
  private time = 0;
  private elapsed = 0;
  private distance = 0;
  private bonus = 0;
  private coins = 0;
  private best = loadBest();
  private dyingTime = 0;
  /** Obstacle hits this run; three enrages the main clown. */
  private crashes = 0;
  private catcher: Clown | null = null;
  private honkTimer = 0;
  private nextMilestone = 500;
  private sprayAcc = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(container: HTMLElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    this.rig = new CameraRig(window.innerWidth / window.innerHeight);
    this.scene.add(this.rig.camera);
    this.scene.background = new THREE.Color(FOG_COLOR);
    this.scene.fog = new THREE.Fog(FOG_COLOR, 70, 400);

    this.scene.add(new THREE.HemisphereLight(0xe4f2ff, 0x8aa8d0, 1.7));
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -48;
    sc.right = 48;
    sc.top = 48;
    sc.bottom = -48;
    sc.near = 1;
    sc.far = 220;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    this.sky = new Sky(SUN_OFFSET);
    this.scene.add(this.sky.mesh, this.mountains.group);
    this.world = new World(this.scene);
    this.director = new ClownDirector(this.scene);
    this.scene.add(this.player.model.root, this.titleClown.model.root, this.particles.points, this.snow.points);
    this.rig.camera.add(this.speedLines.lines);

    this.hud = new Hud(uiRoot, this.input, {
      start: () => this.startRun(),
      resume: () => this.setPaused(false),
      restart: () => this.startRun(),
      menu: () => this.toMenu(),
      pause: () => this.setPaused(true),
      mute: () => this.sfx.toggleMute(),
    });
    this.input.on('pause', () => {
      if (this.state === 'playing') this.setPaused(true);
      else if (this.state === 'paused') this.setPaused(false);
    });
    this.input.on('mute', () => this.hud.setMuted(this.sfx.toggleMute()));
    window.addEventListener('keydown', (e) => {
      if ((e.code === 'Enter' || e.code === 'Space') && (this.state === 'title' || (this.state === 'over' && this.dyingTime > 3.2))) {
        this.startRun();
      }
    });
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.setPaused(true);
    });

    this.hud.setBest(this.best);
    this.resize();
    this.toMenu();
  }

  run(): void {
    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.update(dt);
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  // -------------------------------------------------------------------------
  // State transitions
  // -------------------------------------------------------------------------

  private resetRun(): void {
    this.world.reset();
    this.player.reset();
    this.elapsed = this.distance = this.bonus = this.coins = this.dyingTime = this.crashes = 0;
    this.director.reset(this.player, this.cruise);
    this.director.calm();
    this.particles.clear();
    this.honkTimer = 0;
    this.nextMilestone = 500;
    this.catcher = null;
    this.input.clearJump();
  }

  private toMenu(): void {
    this.resetRun();
    this.state = 'title';
    const p = this.player.pos;
    this.titleClown.spawn(p.x + 1.1, p.z + 2.6, -0.3, 0);
    this.rig.snap(this.focus());
    this.hud.showScreen('title');
    this.hud.setBest(this.best);
    this.sfx.setMusic(false);
  }

  private startRun(): void {
    this.sfx.unlock();
    this.sfx.click();
    const fromTitle = this.state === 'title';
    this.resetRun();
    this.titleClown.despawn();
    if (!fromTitle) this.rig.snap(this.focus());
    this.state = 'playing';
    this.hud.showScreen(null);
    this.hud.popup('GO, DOC, GO!', '#ffc928', true);
    this.sfx.setMusic(true);
    this.sfx.tempo = 150;
  }

  private setPaused(paused: boolean): void {
    if (paused && this.state === 'playing') {
      this.state = 'paused';
      this.hud.showScreen('pause');
      this.sfx.setMusic(false);
    } else if (!paused && this.state === 'paused') {
      this.state = 'playing';
      this.hud.showScreen(null);
      this.sfx.setMusic(true);
      this.input.clearJump();
    }
  }

  /** The main clown physically grabbed the doctor: the only way a run ends. */
  private beginCaught(clown: Clown): void {
    this.state = 'dying';
    this.catcher = clown;
    this.dyingTime = 0;
    this.sfx.setMusic(false);
    this.rig.shake(1);
    clown.grabbing = true;
    this.sfx.honk(1.1);
    this.sfx.laugh();
    this.particles.burst(this.tmp.copy(this.player.pos).setY(this.player.pos.y + 1.5), 160, 14, CONFETTI, 0.45, 1.8, 8);
    this.hud.popup('GOTCHA!', '#ff3da5', true);
  }

  private gameOver(): void {
    this.state = 'over';
    const score = this.score;
    const newBest = score > this.best;
    if (newBest) {
      this.best = Math.floor(score);
      saveBest(this.best);
    }
    this.sfx.gameOver();
    this.hud.showGameOver({
      score,
      distance: this.distance,
      coins: this.coins,
      crashes: this.crashes,
      seconds: this.elapsed,
      best: this.best,
      newBest,
    });
  }

  private get score(): number {
    return Math.floor(this.distance + this.bonus);
  }

  // -------------------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------------------

  /** Downhill cruising speed (m/s) ramps up over the run. */
  private get cruise(): number {
    return 30 + 32 * (1 - Math.exp(-this.elapsed / 110));
  }

  private update(dt: number): void {
    this.time += dt;
    const p = this.player;
    let camMode: CamMode = 'chase';

    switch (this.state) {
      case 'title':
        camMode = 'title';
        this.poseDoctor(dt, 0);
        this.titleClown.phase += dt * 1.5;
        this.titleClown.sync(dt);
        break;
      case 'playing':
        this.simulate(dt);
        camMode = this.input.lookBack ? 'lookback' : 'chase';
        break;
      case 'paused':
        return;
      case 'dying':
      case 'over':
        camMode = 'orbit';
        this.updateDeath(dt);
        break;
    }

    this.world.update(p.pos.z, dt, this.time);
    this.particles.update(dt);
    this.rig.update(dt, camMode, this.focus());
    const cam = this.rig.camera;
    this.snow.update(dt, cam.position);
    const speedN = this.speedN;
    this.speedLines.update(dt, this.state === 'playing' ? clamp((speedN - 0.55) * 2.2, 0, 1) + (p.boost > 0 ? 0.5 : 0) : 0, p.actualSpeed);
    this.sky.update(cam);
    this.mountains.update(cam);
    this.particles.setScale(this.renderer.domElement.height, cam.fov);

    // Keep the shadow frustum centred just ahead of the doctor.
    this.sun.target.position.set(p.pos.x, p.pos.y - 6, p.pos.z - 22);
    this.sun.position.copy(this.sun.target.position).add(SUN_OFFSET);

    this.sfx.update(this.state === 'playing' ? speedN : 0, Math.abs(p.steer) * speedN + p.drift * 0.05, !p.grounded);

    const t = this.director.threat;
    this.hud.update({
      score: this.score,
      distance: this.distance,
      coins: this.coins,
      crashes: Math.min(this.crashes, 3),
      enraged: this.crashes >= 3,
      speedKmh: p.actualSpeed * 3.6,
      boost: p.boost,
      clownDistance: this.state === 'playing' ? t.nearest : Infinity,
      clownSide: t.side,
      clownBehind: t.behind,
    });
  }

  private get speedN(): number {
    return clamp(this.player.actualSpeed / 70, 0, 1);
  }

  private focus(): CamFocus {
    const p = this.player;
    return {
      pos: p.pos,
      heading: p.heading,
      steer: p.steer,
      speedN: this.speedN,
      boost: p.boost > 0,
      airborne: !p.grounded,
    };
  }

  private poseDoctor(dt: number, nearest: number): void {
    const p = this.player;
    const t = this.director.threat;
    const glance = nearest > 0 && nearest < 18 && t.behind && Math.sin(this.time * 1.6) > 0.2;
    p.syncModel();
    p.model.update(dt, {
      steer: p.steer,
      speedN: this.state === 'title' ? 0.05 : this.speedN,
      airborne: !p.grounded,
      tuck: p.tuck,
      tumble: p.tumble,
      lookBack: glance ? (t.side > 0 ? -1 : 1) : this.state === 'title' ? Math.sin(this.time * 0.8) * 0.5 : 0,
      panic: nearest > 0 ? clamp(1 - nearest / 30, 0, 1) : this.state === 'title' ? 0.6 : 0,
      caught: this.state === 'dying' || this.state === 'over',
    });
  }

  private simulate(dt: number): void {
    const p = this.player;
    this.elapsed += dt;
    const cruise = this.cruise;
    this.sfx.tempo = this.crashes >= 3 ? 200 : 150 + clamp(this.elapsed / 150, 0, 1) * 30;

    let jump = this.input.consumeJump();
    const input = { steer: this.input.steer, tuck: this.input.tuck, jump: false };
    const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const wasGrounded = p.grounded;
      input.jump = jump && p.grounded && !p.crashed;
      if (input.jump) jump = false;
      const landing = p.step(h, input, cruise);
      if (input.jump && wasGrounded && !p.grounded) this.sfx.jump();
      if (landing) this.onLanding(landing.airTime, landing.impact);

      this.checkObstacles();
      this.checkPickups();
      if (p.inGap()) this.fellInGap();

      const caught = this.director.step(h, p, this.world, cruise, this.crashes, {
        trip: (c, o) => this.onClownTrip(c, o),
        hazardHit: (c) => this.onHazardHit(c),
      });
      if (caught) {
        this.beginCaught(caught);
        return;
      }
    }

    this.distance = Math.max(this.distance, START_Z - p.pos.z);
    if (this.distance >= this.nextMilestone) {
      this.hud.popup(`${this.nextMilestone} m!`, '#9fe8ff');
      this.nextMilestone += 500;
    }

    const spawned = this.director.updateSpawning(dt, this.elapsed, p, this.world);
    if (spawned === 'crossing') {
      this.sfx.honk(1.35);
      this.hud.popup('CLOWN CROSSING!', '#ff5ad1');
    }

    this.director.sync(dt, p);
    if (this.crashes >= 3) this.emitRage(dt);
    const nearest = this.director.threat.nearest;
    this.honkTimer -= dt;
    if (nearest < 26 && this.honkTimer <= 0) {
      this.sfx.honk(1 + (26 - nearest) / 40);
      this.honkTimer = 0.3 + nearest / 16;
    }
    if (nearest < 10 && Math.random() < dt * 0.6) this.sfx.laugh();

    this.poseDoctor(dt, nearest);
    this.emitSpray(dt);
  }

  private onLanding(airTime: number, impact: number): void {
    const p = this.player;
    if (airTime > 0.25) {
      this.sfx.land(impact);
      this.rig.shake(Math.min(0.45, impact * 0.025));
      this.particles.burst(this.tmp.copy(p.pos).setY(p.pos.y + 0.2), Math.min(60, 10 + impact * 3), 6, [SNOW, SNOW_BLUE], 0.5, 0.8);
    }
    if (airTime > 0.7 && !p.crashed) {
      const pts = Math.round(airTime * 60);
      this.bonus += pts;
      this.hud.popup(`AIR TIME +${pts}`, '#9fe8ff');
    }
  }

  private checkObstacles(): void {
    const p = this.player;
    this.world.forObstaclesNear(p.pos.z, (o) => {
      if (o.struck || o.cooldown > 0) return;
      const dx = Math.max(0, Math.abs(p.pos.x - o.x) - o.halfLen);
      const dz = p.pos.z - o.z;
      if (Math.hypot(dx, dz) > o.r + PLAYER_RADIUS || p.pos.y - o.y > o.h) return;
      const at = this.tmp.set(o.x, o.y + Math.min(o.h, 2), o.z);

      if (o.kind === 'drift') {
        // Soft snow only slows you down; it never counts as a crash.
        o.cooldown = 1;
        p.speed *= 0.72;
        this.particles.burst(at, 50, 9, [SNOW, SNOW_BLUE], 0.6, 1);
        this.sfx.land(10);
        this.hud.popup('POOF!', '#ffffff');
        return;
      }
      if (p.boost > 0) {
        // Adrenaline lets you plough straight through without it counting.
        o.shake = 1;
        o.cooldown = 1.5;
        this.smash(o);
        this.bonus += 20;
        this.hud.popup('SMASH! +20', '#2ff3c8');
        this.rig.shake(0.3);
        this.sfx.crash();
        return;
      }
      // Still recovering from the last crash: pass through, never double-count.
      if (!p.crash(o.x, o.z)) return;
      o.struck = true;
      o.shake = 1;
      if (o.kind === 'snowman') this.smash(o);
      const debris = o.kind === 'tree' ? [SNOW, LEAF, BARK] : o.kind === 'rock' ? [SNOW, ROCK] : [SNOW, BARK];
      this.particles.burst(at, 60, 10, debris, 0.5, 1.1);
      this.registerCrash(OUCH[Math.floor(Math.random() * OUCH.length)]);
    });
  }

  /** The doctor ran into a walking or skiing hazard clown. */
  private onHazardHit(c: Clown): void {
    const p = this.player;
    const vx = p.vx;
    const vz = p.vz;
    const at = this.tmp.copy(c.pos).setY(c.pos.y + 1.2);
    if (p.boost > 0) {
      c.knock(vx, vz);
      this.bonus += 30;
      this.hud.popup('CLOWN BOWLING! +30', '#2ff3c8');
      this.sfx.honk(1.4);
      this.particles.burst(at, 50, 10, CONFETTI, 0.4, 1);
      return;
    }
    if (!p.crash(c.pos.x, c.pos.z)) return;
    c.knock(vx, vz);
    this.sfx.honk(1.4);
    this.particles.burst(at, 60, 10, CONFETTI, 0.4, 1.1);
    this.registerCrash(c.role === 'walker' ? 'BONKED A CLOWN!' : 'CLOWN COLLISION!');
  }

  /**
   * Escalation ladder. Each counted crash slows the doctor and lets the main
   * clown close in; the third enrages it into normal chase speed.
   */
  private registerCrash(exclaim: string): void {
    const p = this.player;
    this.crashes++;
    const n = this.crashes;
    this.rig.shake(0.85);
    this.sfx.crash();
    if (n === 1) {
      p.slowDown(1.5, 0.85);
      this.director.surge(1.5);
      this.hud.popup(`${exclaim} CRASH 1/3`, '#ffc21f', true);
    } else if (n === 2) {
      p.slowDown(2.5, 0.8);
      this.director.surge(2.5);
      this.hud.flash();
      this.sfx.honk(0.8);
      this.hud.popup('THE CLOWN IS CLOSING IN! 2/3', '#ff7a1a', true);
    } else if (n === 3) {
      p.slowDown(2, 0.85);
      this.director.enrage();
      this.hud.flash();
      this.sfx.enrage();
      this.hud.popup('THE CLOWN IS GETTING FASTER!', '#ff2b2b', true);
    } else {
      p.slowDown(2, 0.85);
      this.director.surge(2);
      this.hud.flash();
      this.hud.popup(`${exclaim} THE CLOWN GAINS!`, '#ff2b2b', true);
    }
  }

  /** Red steam puffs off the enraged chaser. */
  private emitRage(dt: number): void {
    const c = this.director.chaser;
    if (!c.active || Math.random() > dt * 30) return;
    const col = Math.random() < 0.5 ? RAGE : RAGE_HOT;
    this.particles.emit(c.pos.x + (Math.random() - 0.5) * 0.6, c.pos.y + 2.6, c.pos.z, (Math.random() - 0.5) * 2, 3 + Math.random() * 2, 1, 0.7, 0.45, col, -2, 1.5);
  }

  private smash(o: Obstacle): void {
    if (o.kind === 'snowman' || o.kind === 'log') {
      o.alive = false;
      o.mesh.visible = false;
    }
    this.particles.burst(this.tmp.set(o.x, o.y + 1.5, o.z), 70, 11, [SNOW, SNOW_BLUE, o.kind === 'snowman' ? SNOW : BARK], 0.55, 1.2);
  }

  private checkPickups(): void {
    const p = this.player;
    this.world.forPickupsNear(p.pos.z, (k) => {
      if (Math.hypot(p.pos.x - k.x, p.pos.z - k.z) > 1.9 || Math.abs(p.pos.y + 1 - k.y) > 2.4) return;
      k.taken = true;
      k.mesh.visible = false;
      const at = this.tmp.set(k.x, k.y, k.z);
      switch (k.kind) {
        case 'coin':
          this.coins++;
          this.bonus += 25;
          this.sfx.coin();
          this.particles.burst(at, 14, 5, [GOLD], 0.3, 0.5, 2);
          break;
        case 'medkit':
          // Patches up one crash. Bringing it back under three calms the clown.
          this.sfx.powerup();
          if (this.crashes > 0) {
            const wasEnraged = this.crashes >= 3;
            this.crashes = Math.min(this.crashes, 3) - 1;
            if (wasEnraged) this.director.calm();
            this.hud.popup(wasEnraged ? 'CLOWN CALMED DOWN!' : 'PATCHED UP! -1 CRASH', '#36e27c', true);
          } else {
            this.bonus += 100;
            this.hud.popup('CLEAN BILL OF HEALTH +100', '#36e27c', true);
          }
          this.particles.burst(at, 40, 6, [HEAL, SNOW], 0.4, 0.8, 1);
          break;
        case 'syringe':
          p.boost = 5;
          p.speed += 12;
          this.sfx.powerup();
          this.hud.popup('ADRENALINE!', '#2ff3c8', true);
          this.particles.burst(at, 40, 6, [CYAN, SNOW], 0.4, 0.8, 1);
          break;
      }
    });
  }

  private fellInGap(): void {
    const p = this.player;
    const f = featureAt(p.pos.z);
    // Counts as a crash unless the doctor is still recovering from one.
    const counted = p.crash(p.pos.x, p.pos.z + 1);
    // Hoist the doctor out on the far side of the crevasse.
    const z = f ? f.gapEnd - 3 : p.pos.z - 4;
    p.pos.z = z;
    p.pos.y = groundHeight(p.pos.x, z) + 0.5;
    p.vz = -4;
    this.particles.burst(this.tmp.copy(p.pos).setY(p.pos.y + 1), 60, 9, [SNOW, SNOW_BLUE], 0.6, 1);
    if (counted) this.registerCrash('CREVASSE!');
    else this.hud.popup('CREVASSE!', '#9fe8ff', true);
  }

  private onClownTrip(c: Clown, o: Obstacle): void {
    o.shake = 1;
    if (o.kind === 'snowman') this.smash(o);
    if (c.distanceTo(this.player) < 60) {
      this.bonus += 50;
      this.hud.popup('CLOWN DOWN! +50', '#ffe14a');
      this.sfx.honk(0.7);
      this.particles.burst(this.tmp.copy(c.pos).setY(c.pos.y + 1.5), 30, 7, CONFETTI, 0.35, 0.9);
    }
  }

  private emitSpray(dt: number): void {
    const p = this.player;
    if (!p.grounded || p.crashed) return;
    const speed = p.actualSpeed;
    const turn = Math.abs(p.steer);
    this.sprayAcc += dt * (speed * 1.0 + turn * speed * 2 + p.drift * 15);
    const dirX = Math.sin(p.heading);
    const dirZ = -Math.cos(p.heading);
    const rightX = Math.cos(p.heading);
    const rightZ = Math.sin(p.heading);
    while (this.sprayAcc > 1) {
      this.sprayAcc -= 1;
      const side = Math.random() < 0.5 ? -0.17 : 0.17;
      const back = 0.3 + Math.random() * 0.6;
      const out = -p.steer * (3 + speed * 0.18);
      this.particles.emit(
        p.pos.x + rightX * side - dirX * back,
        p.pos.y + 0.08,
        p.pos.z + rightZ * side - dirZ * back,
        -dirX * speed * 0.12 + rightX * out + (Math.random() - 0.5) * 2,
        1.5 + Math.random() * (2 + turn * 4),
        -dirZ * speed * 0.12 + rightZ * out + (Math.random() - 0.5) * 2,
        0.5 + Math.random() * 0.4,
        0.12 + Math.random() * 0.22 + turn * 0.1,
        Math.random() < 0.7 ? SNOW : SNOW_BLUE,
        10,
        2.5,
      );
    }
    // Clowns kick up snow too.
    for (const c of this.director.clowns) {
      if (!c.active || Math.random() > dt * 25) continue;
      this.particles.emit(c.pos.x, c.pos.y + 0.1, c.pos.z + 0.4, (Math.random() - 0.5) * 3, 2 + Math.random() * 2, 2, 0.5, 0.35, SNOW, 9, 2);
    }
  }

  private updateDeath(dt: number): void {
    this.dyingTime += dt;
    const p = this.player;
    const c = this.catcher;
    if (c) {
      // The clown hoists the doctor overhead and twirls him around.
      const lift = Math.min(1, this.dyingTime * 1.5) * 1.5;
      p.pos.y = groundHeight(p.pos.x, p.pos.z) + lift + Math.abs(Math.sin(this.dyingTime * 9)) * 0.3;
      if (this.dyingTime > 0.6) p.heading += dt * 5;
      c.pos.set(p.pos.x - Math.sin(p.heading) * 0.9, groundHeight(p.pos.x, p.pos.z), p.pos.z + Math.cos(p.heading) * 0.9);
      c.heading = p.heading;
      c.phase += dt * 10;
      if (Math.random() < dt * 12) this.particles.burst(this.tmp.copy(p.pos).setY(p.pos.y + 2.5), 3, 6, CONFETTI, 0.35, 1.2, 6);
      if (this.state === 'dying' && Math.random() < dt * 1.5) this.sfx.honk(1 + Math.random() * 0.4);
    }
    // Hazard clowns carry on milling about in slow motion.
    for (const h of this.director.clowns) {
      if (h.active && h !== c) h.stepHazard(dt * 0.4, this.cruise);
    }
    if (this.state === 'dying' && this.dyingTime > 2.8) this.gameOver();
    this.director.sync(dt, p);
    this.poseDoctor(dt, 1);
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.rig.camera.aspect = w / h;
    this.rig.camera.updateProjectionMatrix();
  }

  private render(): void {
    this.renderer.render(this.scene, this.rig.camera);
  }
}

