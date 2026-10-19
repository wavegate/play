'use strict';

const ARENA_W = 960;
const ARENA_H = 600;
const FONT = '"Iowan Old Style", Palatino, Georgia, serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

const UPGRADES = [
  { id: 'keen', name: 'Keen', desc: '+1 damage to every shot.', max: 6, apply: (p) => { p.dmg += 1; } },
  { id: 'haste', name: 'Haste', desc: 'Shoot 20% faster.', max: 5, apply: (p) => { p.fireRate = Math.min(16, p.fireRate * 1.2); } },
  { id: 'fleet', name: 'Fleet', desc: 'Move 12% faster.', max: 4, apply: (p) => { p.speed *= 1.12; } },
  { id: 'heart', name: 'Heart', desc: '+2 max health, and heal 2.', max: 4, apply: (p) => { p.maxHp += 2; p.hp = Math.min(p.maxHp, p.hp + 2); } },
  { id: 'fork', name: 'Fork', desc: 'Fire one more shot.', max: 4, apply: (p) => { p.forks += 1; } },
  { id: 'pierce', name: 'Pierce', desc: 'Shots pass through one more foe.', max: 4, apply: (p) => { p.pierce += 1; } },
  { id: 'orbit', name: 'Orbit', desc: 'An ember circles you and burns what it touches.', max: 4, apply: (p) => { p.orbits += 1; } },
  { id: 'arc', name: 'Arc', desc: 'Shots leap to a nearby foe.', max: 3, apply: (p) => { p.chains += 1; } },
  { id: 'trail', name: 'Trail', desc: 'Dashing leaves fire behind you.', max: 1, apply: (p) => { p.trail = true; } },
  { id: 'burst', name: 'Burst', desc: 'Foes explode when they die.', max: 1, apply: (p) => { p.blast = true; } },
  {
    id: 'leech',
    name: 'Leech',
    desc: (p) => `Heal 1 health every ${[4, 3, 2][p.leech] || 2} kills.`,
    max: 3,
    apply: (p) => { p.leech += 1; },
  },
  {
    id: 'heavy',
    name: 'Heavy',
    desc: 'Shoot slower. Shots hit harder and shove.',
    max: 2,
    apply: (p) => {
      p.heavy += 1;
      p.fireRate = Math.max(2.4, p.fireRate * 0.75);
      p.dmg += 2;
      p.knock += 1;
    },
  },
  { id: 'dash', name: 'Long Dash', desc: 'Dash farther. It recharges faster.', max: 3, apply: (p) => { p.dashSpeed *= 1.16; p.dashCdMax *= 0.86; } },
  { id: 'nova', name: 'Nova', desc: 'Dashing throws a ring of sparks.', max: 1, apply: (p) => { p.nova = true; } },
  {
    id: 'glass',
    name: 'Glass',
    desc: '+4 damage. Your health becomes 1.',
    max: 1,
    apply: (p) => {
      p.dmg += 4;
      p.maxHp = 1;
      p.hp = 1;
      p.r = 11;
      p.glass = true;
    },
  },
];

const HINTS = {
  1: 'Hold click to shoot',
  2: 'Space dashes through a lunge',
  3: 'Step around the pale shots',
  4: 'Leave the circle before it bursts',
};

const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const view = { dpr: 1, s: 1, ox: 0, oy: 0 };
const keys = Object.create(null);
const mouse = { x: 0, y: 0, wx: ARENA_W / 2, wy: ARENA_H / 2, down: false, seen: false };

let mode = 'title';
let anim = 0;
let shake = 0;
let hitstop = 0;
let pain = 0;
let glow = 0;
let bannerText = '';
let bannerT = 0;
let hintText = '';
let hintT = 0;
let vacuumT = 0;
let beat = 0;
let offered = [];
let player = null;
let run = null;
let enemies = [];
let bullets = [];
let enemyBullets = [];
let obstacles = [];
let fires = [];
let drops = [];
let particles = [];
let floats = [];
let ghosts = [];
let blasts = [];

const sfxLock = { hit: 0 };
let actx = null;
let master = null;
let noiseBuf = null;
let drone = null;
let muted = false;

try { muted = localStorage.getItem('cinder-mute') === '1'; } catch (err) { muted = false; }

function ac() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!actx) {
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.5;
    master.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}

function noiseBuffer() {
  const a = ac();
  if (!a) return null;
  if (noiseBuf) return noiseBuf;
  const n = Math.floor(a.sampleRate * 0.25);
  noiseBuf = a.createBuffer(1, n, a.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

function beep(opts) {
  if (muted) return;
  const a = ac();
  if (!a || !master) return;
  const t = a.currentTime;
  const dur = opts.dur;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = opts.type || 'sine';
  o.frequency.setValueAtTime(Math.max(40, opts.freq), t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, opts.slide), t + dur);
  g.gain.setValueAtTime(opts.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(opts) {
  if (muted) return;
  const a = ac();
  const buf = noiseBuffer();
  if (!a || !buf || !master) return;
  const src = a.createBufferSource();
  src.buffer = buf;
  const filter = a.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = opts.freq;
  filter.Q.value = 0.7;
  const g = a.createGain();
  const t = a.currentTime;
  g.gain.setValueAtTime(opts.gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + opts.dur + 0.02);
}

function sfx(name) {
  switch (name) {
    case 'shoot':
      beep({ freq: 760 + Math.random() * 90, dur: 0.05, type: 'triangle', gain: 0.03, slide: 280 });
      break;
    case 'hit':
      if (sfxLock.hit > 0) return;
      sfxLock.hit = 0.035;
      noise({ dur: 0.04, gain: 0.045, freq: 900 });
      break;
    case 'hurt':
      beep({ freq: 150, dur: 0.2, type: 'sawtooth', gain: 0.05, slide: 42 });
      break;
    case 'dash':
      beep({ freq: 230, dur: 0.14, type: 'sine', gain: 0.045, slide: 740 });
      break;
    case 'heal':
      beep({ freq: 640, dur: 0.09, type: 'sine', gain: 0.04, slide: 960 });
      break;
    case 'pick':
      beep({ freq: 523, dur: 0.12, type: 'triangle', gain: 0.04 });
      beep({ freq: 659, dur: 0.16, type: 'triangle', gain: 0.035 });
      beep({ freq: 784, dur: 0.2, type: 'sine', gain: 0.03 });
      break;
    case 'death':
      beep({ freq: 190, dur: 0.48, type: 'sawtooth', gain: 0.055, slide: 38 });
      break;
    case 'windup':
      beep({ freq: 180, dur: 0.1, type: 'square', gain: 0.022, slide: 120 });
      break;
    case 'spit':
      noise({ dur: 0.06, gain: 0.028, freq: 480 });
      break;
    case 'clear':
      beep({ freq: 440, dur: 0.12, type: 'sine', gain: 0.04, slide: 680 });
      break;
    case 'boom':
      noise({ dur: 0.14, gain: 0.05, freq: 180 });
      break;
    case 'heart':
      beep({ freq: 74, dur: 0.12, type: 'sine', gain: 0.055, slide: 46 });
      break;
    default:
      break;
  }
}

function startDrone() {
  if (muted || drone) return;
  const a = ac();
  if (!a || !master) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'sine';
  o.frequency.value = 55;
  g.gain.value = 0.015;
  o.connect(g);
  g.connect(master);
  o.start();
  const o2 = a.createOscillator();
  const g2 = a.createGain();
  o2.type = 'triangle';
  o2.frequency.value = 82.5;
  g2.gain.value = 0.008;
  o2.connect(g2);
  g2.connect(master);
  o2.start();
  drone = { o, o2 };
}

function stopDrone() {
  if (!drone) return;
  try { drone.o.stop(); drone.o2.stop(); } catch (err) { /* already stopped */ }
  drone = null;
}

function loadBest() {
  try {
    const raw = localStorage.getItem('cinder-best');
    if (!raw) return { room: 0, kills: 0 };
    const parsed = JSON.parse(raw);
    return { room: parsed.room | 0, kills: parsed.kills | 0 };
  } catch (err) {
    return { room: 0, kills: 0 };
  }
}

function saveBest(best) {
  try { localStorage.setItem('cinder-best', JSON.stringify(best)); } catch (err) { /* private mode */ }
}

function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function upgradeText(u) {
  return typeof u.desc === 'function' ? u.desc(player) : u.desc;
}

function stacks(id) {
  let n = 0;
  if (!run) return 0;
  for (const x of run.build) if (x === id) n++;
  return n;
}

function buildLabel() {
  if (!run || !run.build.length) return '';
  const map = new Map();
  for (const id of run.build) map.set(id, (map.get(id) || 0) + 1);
  const parts = [];
  for (const [id, n] of map) {
    const u = UPGRADES.find((x) => x.id === id);
    parts.push(n > 1 ? `${u.name} ×${n}` : u.name);
  }
  return parts.join('  ·  ');
}

function formatTime(t) {
  const s = Math.max(0, Math.floor(t));
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function freshPlayer() {
  return {
    x: ARENA_W / 2,
    y: ARENA_H / 2,
    r: 13,
    hp: 6,
    maxHp: 6,
    speed: 250,
    dmg: 1,
    fireRate: 6.5,
    fireCd: 0.12,
    dashCd: 0,
    dashCdMax: 0.78,
    dashT: 0,
    dashDur: 0.14,
    dashSpeed: 1150,
    iframes: 0,
    flash: 0,
    forks: 0,
    pierce: 0,
    orbits: 0,
    chains: 0,
    trail: false,
    blast: false,
    leech: 0,
    leechKills: 0,
    heavy: 0,
    knock: 0,
    nova: false,
    glass: false,
    vx: 0,
    vy: 0,
    ghostAcc: 0,
  };
}

function banner(text, time) {
  bannerText = text;
  bannerT = time || 1.5;
}

function hint(text, time) {
  hintText = text;
  hintT = time || 3.2;
}

function burst(x, y, color, n, speed) {
  for (let i = 0; i < n; i++) {
    if (particles.length > 320) particles.shift();
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.25 + Math.random());
    particles.push({
      x, y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: 0.28 + Math.random() * 0.28,
      max: 0.5,
      color,
      r: 1.4 + Math.random() * 2.2,
    });
  }
}

function floatText(x, y, text, color) {
  if (floats.length > 22) floats.shift();
  floats.push({ x, y, text, color, life: 0.5, max: 0.5, vy: -38 });
}

function heal(n, sound) {
  const before = player.hp;
  player.hp = Math.min(player.maxHp, player.hp + n);
  const got = player.hp - before;
  if (got > 0) {
    floatText(player.x, player.y - 20, `+${got}`, '#b6f2c4');
    if (sound) sfx('heal');
  }
}

function hurt(amount, source) {
  if (mode !== 'play' || player.iframes > 0) return false;
  player.hp -= amount;
  run.lastHit = source;
  player.iframes = 1.05;
  player.flash = 0.12;
  pain = 1;
  if (!reduceMotion) shake = Math.min(16, shake + 8);
  hitstop = 0.055;
  sfx('hurt');
  if (player.hp <= 0) {
    player.hp = 0;
    die();
  }
  return true;
}

function touchSource(kind) {
  switch (kind) {
    case 'grunt': return 'An ash grub caught you.';
    case 'dasher': return 'A dasher ran you through.';
    case 'spitter': return 'A spitter got too close.';
    case 'brute': return 'A brute crushed you.';
    default: return 'The Ash Warden snuffed you out.';
  }
}

function die() {
  mode = 'dead';
  stopDrone();
  sfx('death');
  burst(player.x, player.y, '#ff9d3c', 28, 220);
  const prev = loadBest();
  const record = run.room > prev.room;
  const better = record || (run.room === prev.room && run.kills > prev.kills);
  if (better) saveBest({ room: run.room, kills: run.kills });
  const eyebrow = prev.room > 0 && record ? "farther than you've been" : 'the flame went out';
  const bestNote = record ? '' : `<p class="meta">Best · room ${prev.room}</p>`;
  showOverlay(`<div class="sheet">
    <p class="eyebrow">${esc(eyebrow)}</p>
    <h1 class="${record ? 'hot' : ''}">Room ${String(run.room).padStart(2, '0')}</h1>
    <p class="tag">${esc(run.lastHit || 'The dark got in.')}</p>
    <p class="meta">${run.kills} killed · ${formatTime(run.time)}</p>
    <p class="tag buildline">${esc(buildLabel() || 'No sparks taken')}</p>
    ${bestNote}
    <button type="button" class="go" id="again">Again</button>
  </div>`, true);
  document.getElementById('again').addEventListener('click', start);
}

function showOverlay(html, dim) {
  overlay.className = dim ? 'on dim' : 'on';
  overlay.innerHTML = html;
}

function hideOverlay() {
  overlay.className = '';
  overlay.innerHTML = '';
}

function showTitle() {
  mode = 'title';
  const best = loadBest();
  const line = best.room ? `Best · room ${best.room} · ${best.kills} killed` : 'No run yet';
  showOverlay(`<div class="sheet title">
    <p class="eyebrow">one more room</p>
    <h1>Cinder</h1>
    <p class="tag">You are a small flame in a dark room.</p>
    <button type="button" class="go" id="begin">Begin</button>
    <p class="hint">WASD move<br>mouse aim · hold click to shoot · space to dash</p>
    <p class="meta">${esc(line)} · M toggles sound</p>
  </div>`, false);
  document.getElementById('begin').addEventListener('click', start);
}

function showPause() {
  showOverlay(`<div class="sheet">
    <p class="eyebrow">held</p>
    <h2>Paused</h2>
    <p class="tag">${esc(buildLabel() || 'No sparks yet')}</p>
    <p class="hint">Esc to return · M toggles sound</p>
  </div>`, true);
}

function showCards() {
  const cards = offered.map((u, i) => {
    const owned = stacks(u.id);
    return `<button type="button" class="card" data-i="${i}">
      <span class="key">${i + 1}</span>
      <span class="name">${esc(u.name)}</span>
      <span class="desc">${esc(upgradeText(u))}</span>
      ${owned ? `<span class="meta">owned ${owned}</span>` : ''}
    </button>`;
  }).join('');
  showOverlay(`<div class="sheet">
    <p class="eyebrow">the room is clear</p>
    <h2>Take one</h2>
    <div class="row">${cards}</div>
  </div>`, true);
  overlay.querySelectorAll('.card').forEach((btn) => {
    btn.addEventListener('click', () => pick(Number(btn.dataset.i)));
  });
}

function available() {
  return UPGRADES.filter((u) => {
    if (u.id === 'glass' && (run.room < 3 || player.glass)) return false;
    return stacks(u.id) < u.max;
  });
}

function offer() {
  const bag = available();
  offered = [];
  while (offered.length < 3 && bag.length) {
    const i = Math.floor(Math.random() * bag.length);
    offered.push(bag.splice(i, 1)[0]);
  }
  if (!offered.length) {
    heal(2, false);
    beginRoom(run.room + 1);
    return;
  }
  mode = 'cards';
  showCards();
}

function pick(index) {
  if (mode !== 'cards') return;
  const u = offered[index];
  if (!u) return;
  u.apply(player);
  run.build.push(u.id);
  offered = [];
  sfx('pick');
  hideOverlay();
  beginRoom(run.room + 1);
}

function togglePause() {
  if (mode === 'play') {
    mode = 'pause';
    showPause();
  } else if (mode === 'pause') {
    mode = 'play';
    hideOverlay();
  }
}

function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('cinder-mute', muted ? '1' : '0'); } catch (err) { /* ignore */ }
  if (muted) stopDrone();
  else if (mode === 'play' || mode === 'vacuum' || mode === 'cards' || mode === 'pause') startDrone();
  if (muted) hint('Sound off', 1.2);
  else hint('Sound on', 1.2);
}

function start() {
  if (mode !== 'title' && mode !== 'dead') return;
  ac();
  stopDrone();
  player = freshPlayer();
  run = {
    room: 0,
    kills: 0,
    time: 0,
    build: [],
    lastHit: '',
    toldBest: false,
  };
  bullets = [];
  enemyBullets = [];
  fires = [];
  drops = [];
  blasts = [];
  floats = [];
  ghosts = [];
  keys[' '] = false;
  mouse.down = false;
  hideOverlay();
  startDrone();
  beginRoom(1);
}

function compose(n) {
  if (n === 1) return ['grunt', 'grunt', 'grunt'];
  if (n === 2) return ['grunt', 'grunt', 'grunt', 'dasher'];
  if (n === 3) return ['grunt', 'grunt', 'dasher', 'spitter'];
  if (n === 4) return ['grunt', 'grunt', 'spitter', 'brute'];
  if (n % 5 === 0) return ['boss', 'grunt', 'grunt'];
  const costs = { brute: 6, spitter: 4, dasher: 3, grunt: 2 };
  const pool = ['grunt', 'grunt', 'grunt'];
  if (n >= 3) pool.push('dasher', 'spitter');
  if (n >= 4) pool.push('brute', 'dasher');
  if (n >= 6) pool.push('spitter', 'brute');
  if (n >= 8) pool.push('dasher', 'spitter');
  let budget = 6 + n * 2;
  const out = [];
  let guard = 0;
  while (budget >= 2 && out.length < 8 && guard++ < 60) {
    const kind = pool[Math.floor(Math.random() * pool.length)];
    if (costs[kind] > budget) continue;
    if (kind === 'brute' && out.filter((k) => k === 'brute').length >= 2) continue;
    if (kind === 'spitter' && out.filter((k) => k === 'spitter').length >= 3) continue;
    out.push(kind);
    budget -= costs[kind];
  }
  return out.length ? out : ['grunt', 'grunt', 'grunt', 'grunt'];
}

function spawnPoint(r, near) {
  for (let i = 0; i < 40; i++) {
    let x;
    let y;
    if (near) {
      const a = Math.random() * Math.PI * 2;
      const d = 270 + Math.random() * 40;
      x = ARENA_W / 2 + Math.cos(a) * d;
      y = ARENA_H / 2 + Math.sin(a) * d;
    } else {
      const edge = Math.floor(Math.random() * 4);
      if (edge === 0) { x = r + 36; y = 40 + Math.random() * (ARENA_H - 80); }
      else if (edge === 1) { x = ARENA_W - r - 36; y = 40 + Math.random() * (ARENA_H - 80); }
      else if (edge === 2) { y = r + 36; x = 40 + Math.random() * (ARENA_W - 80); }
      else { y = ARENA_H - r - 36; x = 40 + Math.random() * (ARENA_W - 80); }
    }
    x = Math.max(r + 6, Math.min(ARENA_W - r - 6, x));
    y = Math.max(r + 6, Math.min(ARENA_H - r - 6, y));
    const crowded = obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 14)
      || enemies.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 20);
    if (!crowded) return { x, y };
  }
  return { x: r + 10, y: ARENA_H / 2 };
}

function makeEnemy(kind) {
  const mult = 1 + Math.max(0, run.room - 1) * 0.12;
  const stats = {
    grunt: { r: 14, hp: 3, speed: 118, color: '#9aa4b2', touch: 1 },
    dasher: { r: 13, hp: 3, speed: 96, color: '#ff6a3d', touch: 1 },
    spitter: { r: 14, hp: 3, speed: 78, color: '#8fb573', touch: 1 },
    brute: { r: 26, hp: 9, speed: 58, color: '#8a74b8', touch: 1 },
    boss: { r: 36, hp: 70 + run.room * 7, speed: 64, color: '#e6d3b1', touch: 2 },
  }[kind];
  const p = spawnPoint(stats.r, run.room === 1);
  const hp = kind === 'boss' ? stats.hp : Math.max(1, Math.round(stats.hp * mult));
  return {
    kind,
    r: stats.r,
    hp,
    maxHp: hp,
    speed: stats.speed * (1 + Math.max(0, run.room - 1) * 0.03) * (run.room === 1 ? 0.85 : 1),
    color: stats.color,
    touch: stats.touch,
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    cd: 0.45 + Math.random() * 0.55,
    state: 'chase',
    timer: 0,
    lx: 1,
    ly: 0,
    sx: p.x,
    sy: p.y,
    ringR: 0,
    ringMax: kind === 'boss' ? 250 : 160,
    flash: 0,
    spawnT: 0.18,
    touchCd: 0,
    orbitCd: 0,
    phase: Math.random() * Math.PI * 2,
    dead: false,
    step: 0,
    minions: false,
    aim: 0,
    windupDur: run.room <= 2 ? 0.72 : 0.5,
  };
}

function spawnObstacles(n) {
  obstacles = [];
  if (n < 2) return;
  const count = Math.min(6, 1 + Math.floor(n / 2));
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < 18; t++) {
      const r = 22 + Math.random() * 16;
      const x = 90 + Math.random() * (ARENA_W - 180);
      const y = 80 + Math.random() * (ARENA_H - 160);
      if (Math.hypot(x - ARENA_W / 2, y - ARENA_H / 2) < 120) continue;
      if (obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r + 36)) continue;
      obstacles.push({ x, y, r });
      break;
    }
  }
}

function beginRoom(n) {
  run.room = n;
  bullets = [];
  enemyBullets = [];
  fires = [];
  drops = [];
  blasts = [];
  enemies = [];
  spawnObstacles(n);
  for (const kind of compose(n)) enemies.push(makeEnemy(kind));
  player.x = ARENA_W / 2;
  player.y = ARENA_H / 2;
  player.vx = 0;
  player.vy = 0;
  player.dashT = 0;
  player.iframes = n === 1 ? 1.2 : 0.5;
  if (n === 1) player.dashCd = 0.3;
  mode = 'play';
  if (HINTS[n]) hint(HINTS[n], 3.6);
  const best = loadBest();
  if (best.room > 0 && n > best.room && !run.toldBest) {
    run.toldBest = true;
    if (!HINTS[n]) hint('Past your best', 2);
  }
  if (n % 5 === 0) banner('The Ash Warden', 2);
}

function pushOut(e) {
  for (const o of obstacles) {
    let dx = e.x - o.x;
    let dy = e.y - o.y;
    let d = Math.hypot(dx, dy);
    const min = e.r + o.r;
    if (d < min) {
      if (d === 0) { dx = 1; dy = 0; d = 1; }
      const p = (min - d) / d;
      e.x += dx * p;
      e.y += dy * p;
    }
  }
  e.x = Math.max(e.r, Math.min(ARENA_W - e.r, e.x));
  e.y = Math.max(e.r, Math.min(ARENA_H - e.r, e.y));
}

function tryMove(e, dt, touch) {
  const dist = Math.hypot(e.vx, e.vy) * dt;
  const steps = Math.max(1, Math.ceil(dist / 8));
  const sdt = dt / steps;
  for (let i = 0; i < steps; i++) {
    e.x += e.vx * sdt;
    e.y += e.vy * sdt;
    pushOut(e);
    if (touch) checkTouch(e);
    if (mode !== 'play') return;
  }
}

function seek(e, tx, ty, speed) {
  const dx = tx - e.x;
  const dy = ty - e.y;
  const d = Math.hypot(dx, dy) || 1;
  const wobble = Math.sin(anim * 2.4 + e.phase) * 0.5;
  const px = -dy / d;
  const py = dx / d;
  const mx = dx / d + px * wobble;
  const my = dy / d + py * wobble;
  const md = Math.hypot(mx, my) || 1;
  e.vx = (mx / md) * speed;
  e.vy = (my / md) * speed;
}

function shootAimed(e, speed, spread, source) {
  const a = Math.atan2(player.y - e.y, player.x - e.x) + (Math.random() - 0.5) * spread;
  enemyBullets.push({
    x: e.x + Math.cos(a) * (e.r + 4),
    y: e.y + Math.sin(a) * (e.r + 4),
    vx: Math.cos(a) * speed,
    vy: Math.sin(a) * speed,
    r: 7,
    life: 3.4,
    source,
  });
}

function radialBurst(e, count, speed) {
  for (let i = 0; i < count; i++) {
    const a = e.aim + (i / count) * Math.PI * 2;
    enemyBullets.push({
      x: e.x + Math.cos(a) * (e.r + 2),
      y: e.y + Math.sin(a) * (e.r + 2),
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: 6,
      life: 3,
      source: "The warden's sparks caught you.",
    });
  }
  sfx('spit');
}

function checkTouch(e) {
  if (e.dead || e.spawnT > 0 || e.touchCd > 0 || mode !== 'play') return;
  const dist = Math.hypot(e.x - player.x, e.y - player.y);
  if (dist >= e.r + player.r) return;
  if (!hurt(e.touch, touchSource(e.kind))) return;
  e.touchCd = 0.75;
  if (mode !== 'play') return;
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const d = dist || 1;
  const push = (e.r + player.r - dist) + 18;
  player.x += (dx / d) * push;
  player.y += (dy / d) * push;
  pushOut(player);
}

function ringHits(cx, cy, radius, source) {
  const d = Math.hypot(player.x - cx, player.y - cy);
  if (Math.abs(d - radius) < 16 + player.r * 0.25) hurt(1, source);
}

function updateDasher(e, dt) {
  if (e.state === 'chase') {
    seek(e, player.x, player.y, e.speed);
    const d = Math.hypot(player.x - e.x, player.y - e.y);
    e.cd -= dt;
    if (d < 320 && d > 64 && e.cd <= 0 && e.spawnT <= 0) {
      e.state = 'windup';
      e.timer = e.windupDur;
      const len = d || 1;
      e.lx = (player.x - e.x) / len;
      e.ly = (player.y - e.y) / len;
      e.vx = 0;
      e.vy = 0;
      sfx('windup');
    }
  } else if (e.state === 'windup') {
    e.vx = 0;
    e.vy = 0;
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = 'lunge';
      e.timer = 0.2;
      e.vx = e.lx * 720;
      e.vy = e.ly * 720;
    }
  } else if (e.state === 'lunge') {
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = 'recover';
      e.timer = 0.38;
      e.vx = 0;
      e.vy = 0;
    }
  } else {
    e.vx = 0;
    e.vy = 0;
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = 'chase';
      e.cd = 0.85;
    }
  }
  tryMove(e, dt, true);
}

function updateSpitter(e, dt) {
  const dx = player.x - e.x;
  const dy = player.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  let sx = dx / d;
  let sy = dy / d;
  if (d < 150) { sx = -sx; sy = -sy; }
  else if (d < 310) { const px = -sy; sy = sx; sx = px; }
  e.vx = sx * e.speed;
  e.vy = sy * e.speed;
  e.cd -= dt;
  if (e.cd <= 0 && e.spawnT <= 0 && d < 560) {
    shootAimed(e, 155, 0.06, "A spitter's shot landed.");
    e.cd = Math.max(0.85, 1.65 - run.room * 0.04);
    sfx('spit');
  }
  tryMove(e, dt, true);
}

function updateBrute(e, dt) {
  if (e.state === 'chase') {
    seek(e, player.x, player.y, e.speed);
    e.cd -= dt;
    if (e.cd <= 0 && e.spawnT <= 0) {
      e.state = 'slamWindup';
      e.timer = 0.62;
      e.sx = e.x;
      e.sy = e.y;
      e.vx = 0;
      e.vy = 0;
      sfx('windup');
    }
  } else if (e.state === 'slamWindup') {
    e.vx = 0;
    e.vy = 0;
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = 'slam';
      e.timer = 0.48;
      e.ringR = 8;
    }
  } else if (e.state === 'slam') {
    e.vx = 0;
    e.vy = 0;
    e.timer -= dt;
    e.ringR = e.ringMax * (1 - Math.max(0, e.timer) / 0.48);
    ringHits(e.sx, e.sy, e.ringR, "A brute's ring caught you.");
    if (e.timer <= 0) {
      e.state = 'chase';
      e.cd = 1.35;
    }
  }
  tryMove(e, dt, true);
}

function updateBoss(e, dt) {
  const phase = e.hp < e.maxHp / 2 ? 2 : 1;
  if (!e.minions && phase === 2) {
    e.minions = true;
    enemies.push(makeEnemy('grunt'));
    enemies.push(makeEnemy('grunt'));
    banner('It splits', 1.2);
  }
  if (e.state === 'chase') {
    seek(e, player.x, player.y, e.speed * (phase === 2 ? 1.28 : 1));
    e.cd -= dt;
    if (e.cd <= 0 && e.spawnT <= 0) {
      e.step = (e.step + 1) % 2;
      e.vx = 0;
      e.vy = 0;
      if (e.step === 0) {
        e.state = 'slamWindup';
        e.timer = phase === 2 ? 0.48 : 0.66;
        e.sx = e.x;
        e.sy = e.y;
      } else {
        e.state = 'burstWindup';
        e.timer = 0.42;
        e.aim = Math.atan2(player.y - e.y, player.x - e.x);
      }
      sfx('windup');
    }
  } else if (e.state === 'slamWindup') {
    e.vx = 0;
    e.vy = 0;
    e.sx = e.x;
    e.sy = e.y;
    e.timer -= dt;
    if (e.timer <= 0) {
      e.state = 'slam';
      e.timer = 0.5;
    }
  } else if (e.state === 'slam') {
    e.vx = 0;
    e.vy = 0;
    e.timer -= dt;
    e.ringR = (phase === 2 ? 280 : 240) * (1 - Math.max(0, e.timer) / 0.5);
    ringHits(e.sx, e.sy, e.ringR, "The warden's ring caught you.");
    if (e.timer <= 0) {
      e.state = 'chase';
      e.cd = phase === 2 ? 0.7 : 1.05;
    }
  } else if (e.state === 'burstWindup') {
    e.vx = 0;
    e.vy = 0;
    e.timer -= dt;
    if (e.timer <= 0) {
      radialBurst(e, phase === 2 ? 16 : 12, phase === 2 ? 185 : 145);
      e.state = 'chase';
      e.cd = phase === 2 ? 0.75 : 1.1;
    }
  }
  tryMove(e, dt, true);
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (e.dead) continue;
    e.flash = Math.max(0, e.flash - dt);
    e.spawnT = Math.max(0, e.spawnT - dt);
    e.touchCd = Math.max(0, e.touchCd - dt);
    e.orbitCd = Math.max(0, e.orbitCd - dt);
    if (e.kind === 'dasher') updateDasher(e, dt);
    else if (e.kind === 'spitter') updateSpitter(e, dt);
    else if (e.kind === 'brute') updateBrute(e, dt);
    else if (e.kind === 'boss') updateBoss(e, dt);
    else {
      seek(e, player.x, player.y, e.speed);
      tryMove(e, dt, true);
    }
    if (mode !== 'play') return;
  }
}

function damageEnemy(e, amount, nx, ny, knock) {
  if (!e || e.dead || e.spawnT > 0) return;
  e.hp -= amount;
  e.flash = 0.08;
  if (amount !== 1) floatText(e.x, e.y - e.r - 4, String(amount), '#f4eadc');
  if (nx) {
    e.x += nx * knock * 0.055;
    e.y += ny * knock * 0.055;
  }
  burst(e.x, e.y, '#fff6e4', 4, 80);
  sfx('hit');
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  if (e.dead) return;
  e.dead = true;
  e.hp = 0;
  run.kills += 1;
  burst(e.x, e.y, e.color, e.kind === 'boss' ? 26 : 12, e.kind === 'boss' ? 240 : 150);
  if (!reduceMotion) shake = Math.min(12, shake + (e.kind === 'boss' ? 10 : 2));
  if (e.kind === 'boss' || e.kind === 'brute') hitstop = Math.max(hitstop, 0.04);
  if (player.leech > 0) {
    player.leechKills += 1;
    const need = [4, 3, 2][player.leech - 1] || 2;
    if (player.leechKills >= need) {
      player.leechKills = 0;
      heal(1, true);
    }
  }
  const num = e.kind === 'boss' ? 4 : (Math.random() < 0.46 ? 1 : 0);
  for (let i = 0; i < num; i++) {
    drops.push({
      x: e.x + (Math.random() - 0.5) * 18,
      y: e.y + (Math.random() - 0.5) * 18,
      r: 7,
      life: 8,
    });
  }
  if (player.blast) blasts.push({ x: e.x, y: e.y, r: 62, dmg: 1 + Math.floor(player.dmg / 2) });
  if (e.kind === 'boss') banner('The warden breaks', 1.5);
}

function onBulletHit(b, e) {
  if (b.hit.has(e) || e.dead) return;
  b.hit.add(e);
  const len = Math.hypot(b.vx, b.vy) || 1;
  damageEnemy(e, b.dmg, b.vx / len, b.vy / len, b.knock);
  if (b.life <= 0) return;
  if (b.chains > 0) {
    let best = null;
    let bestD = 220;
    for (const o of enemies) {
      if (o.dead || b.hit.has(o)) continue;
      const d = Math.hypot(o.x - b.x, o.y - b.y);
      if (d < bestD) { best = o; bestD = d; }
    }
    if (best) {
      const a = Math.atan2(best.y - b.y, best.x - b.x);
      const spd = Math.hypot(b.vx, b.vy) || 500;
      b.vx = Math.cos(a) * spd;
      b.vy = Math.sin(a) * spd;
      b.chains -= 1;
      b.life = Math.max(b.life, 0.22);
      return;
    }
  }
  if (b.pierce > 0) {
    b.pierce -= 1;
    return;
  }
  b.life = 0;
}

function hitsObstacle(x, y, r) {
  return obstacles.some((o) => Math.hypot(o.x - x, o.y - y) < o.r + r);
}

function updateBullets(dt) {
  for (const b of bullets) {
    const dist = Math.hypot(b.vx, b.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / 12));
    const sdt = dt / steps;
    for (let s = 0; s < steps && b.life > 0; s++) {
      b.x += b.vx * sdt;
      b.y += b.vy * sdt;
      b.life -= sdt;
      if (b.x < -30 || b.y < -30 || b.x > ARENA_W + 30 || b.y > ARENA_H + 30 || hitsObstacle(b.x, b.y, b.r)) {
        b.life = 0;
        break;
      }
      for (const e of enemies) {
        if (b.life <= 0) break;
        if (e.dead || e.spawnT > 0 || b.hit.has(e)) continue;
        if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + b.r) onBulletHit(b, e);
      }
    }
  }
}

function updateEnemyBullets(dt) {
  for (const b of enemyBullets) {
    const dist = Math.hypot(b.vx, b.vy) * dt;
    const steps = Math.max(1, Math.ceil(dist / 10));
    const sdt = dt / steps;
    for (let s = 0; s < steps && b.life > 0; s++) {
      b.x += b.vx * sdt;
      b.y += b.vy * sdt;
      b.life -= sdt;
      if (b.x < -20 || b.y < -20 || b.x > ARENA_W + 20 || b.y > ARENA_H + 20 || hitsObstacle(b.x, b.y, b.r)) {
        b.life = 0;
        break;
      }
      if (mode === 'play' && player.iframes <= 0 && Math.hypot(player.x - b.x, player.y - b.y) < player.r + b.r) {
        hurt(1, b.source);
        b.life = 0;
      }
    }
  }
}

function spreadAngle(n, i) {
  if (n <= 1) return 0;
  const width = Math.min(0.72, 0.16 * (n - 1));
  return -width / 2 + (width * i) / (n - 1);
}

function shoot() {
  if (player.fireCd > 0 || mode !== 'play') return;
  player.fireCd = 1 / player.fireRate;
  const ang = Math.atan2(mouse.wy - player.y, mouse.wx - player.x);
  const n = 1 + player.forks;
  const speed = player.heavy ? 520 : 660;
  for (let i = 0; i < n; i++) {
    const a = ang + spreadAngle(n, i) + (Math.random() - 0.5) * 0.04;
    bullets.push({
      x: player.x + Math.cos(a) * (player.r + 6),
      y: player.y + Math.sin(a) * (player.r + 6),
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: player.heavy ? 7 : 3.5,
      dmg: player.dmg,
      pierce: player.pierce,
      chains: player.chains,
      knock: 80 + player.knock * 70 + (player.heavy ? 40 : 0),
      life: player.heavy ? 0.72 : 0.58,
      hit: new Set(),
    });
  }
  player.x -= Math.cos(ang) * 1.4;
  player.y -= Math.sin(ang) * 1.4;
  burst(player.x + Math.cos(ang) * 16, player.y + Math.sin(ang) * 16, '#ffd7a1', 3, 40);
  sfx('shoot');
}

function nova() {
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    bullets.push({
      x: player.x,
      y: player.y,
      vx: Math.cos(a) * 430,
      vy: Math.sin(a) * 430,
      r: 3.2,
      dmg: Math.max(1, player.dmg - 1),
      pierce: 0,
      chains: 0,
      knock: 50,
      life: 0.32,
      hit: new Set(),
    });
  }
}

function tryDash() {
  if (mode !== 'play' || !player || player.dashCd > 0 || player.dashT > 0) return;
  let x = 0;
  let y = 0;
  if (keys.d || keys.arrowright) x += 1;
  if (keys.a || keys.arrowleft) x -= 1;
  if (keys.s || keys.arrowdown) y += 1;
  if (keys.w || keys.arrowup) y -= 1;
  let len = Math.hypot(x, y);
  if (len < 0.1) {
    x = mouse.wx - player.x;
    y = mouse.wy - player.y;
    len = Math.hypot(x, y);
  }
  if (len < 0.1) { x = 1; y = 0; len = 1; }
  player.vx = (x / len) * player.dashSpeed;
  player.vy = (y / len) * player.dashSpeed;
  player.dashT = player.dashDur;
  player.dashCd = player.dashCdMax;
  player.iframes = Math.max(player.iframes, player.dashDur + 0.04);
  sfx('dash');
  if (player.nova) nova();
}

function updatePlayer(dt) {
  player.fireCd = Math.max(0, player.fireCd - dt);
  player.dashCd = Math.max(0, player.dashCd - dt);
  player.iframes = Math.max(0, player.iframes - dt);
  player.flash = Math.max(0, player.flash - dt);
  refreshMouse();
  if (player.dashT > 0) {
    player.dashT -= dt;
    tryMove(player, dt);
    player.ghostAcc += dt;
    if (player.ghostAcc > 0.025) {
      player.ghostAcc = 0;
      ghosts.push({ x: player.x, y: player.y, r: player.r, life: 0.16, max: 0.16 });
    }
    if (player.trail && fires.length < 48) {
      fires.push({ x: player.x, y: player.y, r: 20, life: 0.55, tick: 0 });
    }
    if (Math.random() < 0.65) {
      burst(player.x, player.y, '#ff9d3c', 1, 30);
    }
  } else {
    let x = 0;
    let y = 0;
    if (keys.d || keys.arrowright) x += 1;
    if (keys.a || keys.arrowleft) x -= 1;
    if (keys.s || keys.arrowdown) y += 1;
    if (keys.w || keys.arrowup) y -= 1;
    const len = Math.hypot(x, y);
    if (len) {
      player.vx = (x / len) * player.speed;
      player.vy = (y / len) * player.speed;
      tryMove(player, dt);
    } else {
      player.vx = 0;
      player.vy = 0;
    }
  }
  if (keys[' ']) tryDash();
  if (mouse.down) shoot();
}

function updateFires(dt) {
  for (const f of fires) {
    f.life -= dt;
    f.tick -= dt;
    if (f.tick > 0) continue;
    f.tick = 0.14;
    for (const e of enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - f.x, e.y - f.y) < e.r + f.r * 0.7) damageEnemy(e, 1, 0, 0, 0);
    }
  }
}

function updateOrbits(dt) {
  const n = player.orbits;
  if (!n) return;
  const dmg = 1 + Math.floor(player.dmg / 3);
  for (let i = 0; i < n; i++) {
    const ang = anim * 2.3 + (i * Math.PI * 2) / n;
    const x = player.x + Math.cos(ang) * 40;
    const y = player.y + Math.sin(ang) * 40;
    for (const e of enemies) {
      if (e.dead || e.spawnT > 0 || e.orbitCd > 0) continue;
      if (Math.hypot(e.x - x, e.y - y) < e.r + 8) {
        e.orbitCd = 0.32;
        damageEnemy(e, dmg, (e.x - x) || 1, e.y - y, 40);
      }
    }
  }
}

function updateDrops(dt, pull) {
  for (const d of drops) {
    d.life -= dt;
    if (pull) {
      const k = 1 - Math.exp(-10 * dt);
      d.x += (player.x - d.x) * k;
      d.y += (player.y - d.y) * k;
    }
    if (Math.hypot(d.x - player.x, d.y - player.y) < player.r + d.r + 8) {
      d.life = 0;
      heal(1, true);
    }
  }
  drops = drops.filter((d) => d.life > 0);
}

function separate() {
  const list = enemies.filter((e) => !e.dead);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = Math.hypot(dx, dy);
      const min = a.r + b.r + 1;
      if (d === 0) { dx = 1; dy = 0; d = 1; }
      if (d < min) {
        const p = (min - d) / 2 / d;
        a.x -= dx * p;
        a.y -= dy * p;
        b.x += dx * p;
        b.y += dy * p;
      }
    }
  }
  for (const e of list) pushOut(e);
  pushOut(player);
}

function resolveBlasts() {
  let guard = 0;
  while (blasts.length && guard++ < 24) {
    const b = blasts.shift();
    burst(b.x, b.y, '#ff9d3c', 16, 190);
    sfx('boom');
    if (!reduceMotion) shake = Math.min(10, shake + 3);
    for (const e of enemies) {
      if (e.dead) continue;
      if (Math.hypot(e.x - b.x, e.y - b.y) < b.r + e.r) damageEnemy(e, b.dmg, 0, 0, 0);
    }
  }
  blasts.length = 0;
}

function cleanup() {
  enemies = enemies.filter((e) => !e.dead);
  bullets = bullets.filter((b) => b.life > 0);
  enemyBullets = enemyBullets.filter((b) => b.life > 0);
  fires = fires.filter((f) => f.life > 0);
}

function checkClear() {
  if (mode !== 'play') return;
  if (enemies.length) return;
  mode = 'vacuum';
  vacuumT = 0.62;
  glow = 0.16;
  heal(1, false);
  sfx('clear');
}

function updateHeartbeat(dt) {
  if (!player || player.hp <= 0 || player.maxHp <= 0) return;
  if (player.hp / player.maxHp > 0.34) {
    beat = 0;
    return;
  }
  beat -= dt;
  if (beat <= 0) {
    beat = player.hp === 1 ? 0.62 : 0.85;
    sfx('heart');
  }
}

function update(dt) {
  if (mode === 'play') {
    run.time += dt;
    updatePlayer(dt);
    if (mode !== 'play') return;
    updateEnemies(dt);
    if (mode !== 'play') return;
    updateBullets(dt);
    updateEnemyBullets(dt);
    updateFires(dt);
    updateOrbits(dt);
    updateDrops(dt, false);
    separate();
    resolveBlasts();
    cleanup();
    checkClear();
    updateHeartbeat(dt);
  } else if (mode === 'vacuum') {
    updatePlayer(dt);
    updateDrops(dt, true);
    updateBullets(dt);
    vacuumT -= dt;
    if (vacuumT <= 0) {
      for (const d of drops) heal(1, true);
      drops = [];
      bullets = [];
      offer();
    }
  }
}

function stepList(list, dt, drag) {
  for (const p of list) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (drag) p.vx *= Math.exp(-drag * dt), p.vy *= Math.exp(-drag * dt);
    p.life -= dt;
  }
}

function updateAmbient(dt) {
  stepList(particles, dt, 1.6);
  for (const f of floats) {
    f.y += f.vy * dt;
    f.life -= dt;
  }
  for (const g of ghosts) g.life -= dt;
  particles = particles.filter((p) => p.life > 0);
  floats = floats.filter((f) => f.life > 0);
  ghosts = ghosts.filter((g) => g.life > 0);
  if (hintT > 0) hintT -= dt;
  if (bannerT > 0) bannerT -= dt;
  glow = Math.max(0, glow - dt * 0.35);
  pain = Math.max(0, pain - dt * 1.6);
}

function updateTitle(dt) {
  if (Math.random() < dt * 10) {
    burst(
      ARENA_W / 2 + (Math.random() - 0.5) * 10,
      ARENA_H / 2 + 10,
      Math.random() < 0.5 ? '#ff9d3c' : '#fff6e4',
      1,
      50,
    );
    const p = particles[particles.length - 1];
    if (p) {
      p.vy = -40 - Math.random() * 50;
      p.vx = (Math.random() - 0.5) * 20;
      p.life = 0.9;
    }
  }
}

function resize() {
  view.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(window.innerWidth * view.dpr));
  canvas.height = Math.max(1, Math.round(window.innerHeight * view.dpr));
  const pad = 36;
  view.s = Math.max(0.35, Math.min((window.innerWidth - pad) / ARENA_W, (window.innerHeight - pad) / ARENA_H));
  view.ox = (window.innerWidth - ARENA_W * view.s) / 2;
  view.oy = (window.innerHeight - ARENA_H * view.s) / 2;
}

function screenToWorld(x, y) {
  return { x: (x - view.ox) / view.s, y: (y - view.oy) / view.s };
}

function refreshMouse() {
  const w = screenToWorld(mouse.x, mouse.y);
  mouse.wx = w.x;
  mouse.wy = w.y;
}

function drawArena() {
  ctx.fillStyle = '#14110e';
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.fillStyle = 'rgba(244, 234, 220, 0.035)';
  for (let y = 18; y < ARENA_H; y += 28) {
    for (let x = 18; x < ARENA_W; x += 28) ctx.fillRect(x, y, 1.4, 1.4);
  }
  const px = player ? player.x : ARENA_W / 2;
  const py = player ? player.y : ARENA_H / 2 + 8;
  const pulse = player ? 210 : 180 + Math.sin(anim * 2.2) * 16;
  const light = ctx.createRadialGradient(px, py, 10, px, py, pulse);
  light.addColorStop(0, 'rgba(255, 150, 50, 0.16)');
  light.addColorStop(1, 'rgba(255, 140, 40, 0)');
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  if (glow > 0) {
    ctx.fillStyle = `rgba(255, 157, 60, ${glow})`;
    ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  }
  const shade = ctx.createRadialGradient(ARENA_W / 2, ARENA_H / 2, 80, ARENA_W / 2, ARENA_H / 2, 560);
  shade.addColorStop(0, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.38)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, ARENA_W, ARENA_H);
  ctx.strokeStyle = 'rgba(255, 157, 60, 0.38)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, ARENA_W - 2, ARENA_H - 2);
}

function drawRocks() {
  for (const o of obstacles) {
    ctx.fillStyle = '#3a2f26';
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 196, 140, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 244, 220, 0.05)';
    ctx.beginPath();
    ctx.arc(o.x - o.r * 0.28, o.y - o.r * 0.32, o.r * 0.32, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawFires() {
  for (const f of fires) {
    ctx.globalAlpha = Math.max(0, f.life / 0.55) * 0.8;
    ctx.fillStyle = '#ff7a2a';
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r * (0.7 + (1 - f.life / 0.55) * 0.4), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawDrops() {
  for (const d of drops) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(anim * 2);
    ctx.fillStyle = '#ffd27a';
    ctx.fillRect(-4, -4, 8, 8);
    ctx.restore();
  }
}

function drawEnemy(e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.globalAlpha = e.spawnT > 0 ? 0.4 : 1;
  ctx.fillStyle = e.flash > 0 ? '#fffaf2' : e.color;
  if (e.kind === 'dasher') {
    const ang = Math.atan2(e.ly || e.vy, e.lx || e.vx || 1);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(e.r + 4, 0);
    ctx.lineTo(-e.r, e.r * 0.8);
    ctx.lineTo(-e.r * 0.4, 0);
    ctx.lineTo(-e.r, -e.r * 0.8);
    ctx.closePath();
    ctx.fill();
  } else if (e.kind === 'spitter') {
    ctx.beginPath();
    ctx.arc(0, 0, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#14110e';
    ctx.beginPath();
    ctx.arc(0, 0, e.r * 0.45, 0, Math.PI * 2);
    ctx.fill();
  } else if (e.kind === 'brute') {
    ctx.fillRect(-e.r, -e.r, e.r * 2, e.r * 2);
  } else if (e.kind === 'boss') {
    ctx.beginPath();
    ctx.arc(0, 0, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(20, 17, 14, 0.45)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(0, 0, e.r * 0.55, anim, anim + Math.PI * 1.3);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(0, 0, e.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  if (e.kind === 'boss' || e.kind === 'brute') {
    const w = e.r * 2;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(e.x - e.r, e.y - e.r - 12, w, 4);
    ctx.fillStyle = e.kind === 'boss' ? '#ff9d3c' : '#f4eadc';
    ctx.fillRect(e.x - e.r, e.y - e.r - 12, w * Math.max(0, e.hp / e.maxHp), 4);
  }
}

function drawTelegraphs() {
  ctx.save();
  for (const e of enemies) {
    if (e.dead) continue;
    if (e.kind === 'dasher' && e.state === 'windup') {
      const reach = 150;
      ctx.strokeStyle = `rgba(255, 106, 61, ${0.45 + 0.45 * (1 - e.timer / e.windupDur)})`;
      ctx.lineWidth = 3;
      ctx.setLineDash([7, 7]);
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x + e.lx * reach, e.y + e.ly * reach);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if ((e.kind === 'brute' || e.kind === 'boss') && e.state === 'slamWindup') {
      const total = e.kind === 'boss' ? 0.66 : 0.62;
      const p = 1 - Math.max(0, e.timer) / total;
      ctx.strokeStyle = `rgba(255, 90, 54, ${0.25 + p * 0.65})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.sx, e.sy, 18 + p * 36, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 157, 60, 0.25)';
      ctx.beginPath();
      ctx.arc(e.sx, e.sy, e.kind === 'boss' ? 240 : 160, 0, Math.PI * 2);
      ctx.stroke();
    }
    if ((e.kind === 'brute' || e.kind === 'boss') && e.state === 'slam') {
      ctx.strokeStyle = 'rgba(255, 157, 60, 0.92)';
      ctx.lineWidth = e.kind === 'boss' ? 10 : 8;
      ctx.beginPath();
      ctx.arc(e.sx, e.sy, Math.max(4, e.ringR), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (e.kind === 'boss' && e.state === 'burstWindup') {
      ctx.strokeStyle = 'rgba(230, 211, 177, 0.75)';
      ctx.lineWidth = 2;
      const count = e.hp < e.maxHp / 2 ? 16 : 12;
      for (let i = 0; i < count; i++) {
        const a = e.aim + (i / count) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(e.x + Math.cos(a) * e.r, e.y + Math.sin(a) * e.r);
        ctx.lineTo(e.x + Math.cos(a) * (e.r + 22), e.y + Math.sin(a) * (e.r + 22));
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function drawPlayer() {
  if (!player) return;
  for (const g of ghosts) {
    ctx.globalAlpha = Math.max(0, g.life / g.max) * 0.45;
    ctx.fillStyle = '#ff9d3c';
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const glowR = 34 + Math.sin(anim * 5) * 2;
  const g = ctx.createRadialGradient(player.x, player.y, 2, player.x, player.y, glowR);
  g.addColorStop(0, 'rgba(255, 180, 70, 0.95)');
  g.addColorStop(1, 'rgba(255, 120, 20, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(player.x, player.y, glowR, 0, Math.PI * 2);
  ctx.fill();
  const blink = player.iframes > 0 && Math.floor(anim * 28) % 2 === 0;
  ctx.globalAlpha = blink ? 0.35 : 1;
  ctx.fillStyle = player.flash > 0 ? '#fff' : '#fff6e4';
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const pct = 1 - player.dashCd / player.dashCdMax;
  ctx.strokeStyle = pct >= 1 ? '#ff9d3c' : 'rgba(255, 157, 60, 0.45)';
  ctx.lineWidth = pct >= 1 ? 2.5 : 2;
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.r + 7, -Math.PI / 2, -Math.PI / 2 + Math.max(0.001, pct) * Math.PI * 2);
  ctx.stroke();
  const n = player.orbits;
  for (let i = 0; i < n; i++) {
    const ang = anim * 2.3 + (i * Math.PI * 2) / n;
    const x = player.x + Math.cos(ang) * 40;
    const y = player.y + Math.sin(ang) * 40;
    ctx.fillStyle = '#ffb15a';
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawShots() {
  ctx.lineCap = 'round';
  for (const b of enemyBullets) {
    ctx.fillStyle = 'rgba(198, 214, 255, 0.22)';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#d5e2ff';
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const b of bullets) {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    ctx.strokeStyle = b.r > 5 ? '#ff9d3c' : '#fff6e4';
    ctx.lineWidth = b.r * 1.3;
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - (b.vx / sp) * 12, b.y - (b.vy / sp) * 12);
    ctx.stroke();
  }
}

function drawParticles() {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.font = `13px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const f of floats) {
    ctx.globalAlpha = Math.max(0, f.life / f.max);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;
}

function drawFlame(x, y, r) {
  const pulse = r + Math.sin(anim * 3) * 2;
  const g = ctx.createRadialGradient(x, y, 2, x, y, pulse * 3);
  g.addColorStop(0, 'rgba(255, 186, 80, 0.9)');
  g.addColorStop(1, 'rgba(255, 120, 20, 0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, pulse * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff6e4';
  ctx.beginPath();
  ctx.arc(x, y, pulse * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

function drawHud() {
  const dpr = view.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const x = view.ox;
  const y = view.oy;
  const w = ARENA_W * view.s;
  const h = ARENA_H * view.s;
  ctx.textBaseline = 'middle';
  ctx.font = `13px ${MONO}`;
  ctx.fillStyle = '#f4eadc';
  ctx.textAlign = 'left';
  ctx.fillText(`ROOM ${String(run.room).padStart(2, '0')}`, x + 16, y + 22);
  const heartR = 5;
  const gap = 16;
  const total = player.maxHp * gap;
  let hx = x + w - 18 - total;
  for (let i = 0; i < player.maxHp; i++) {
    ctx.beginPath();
    ctx.arc(hx + i * gap, y + 22, heartR, 0, Math.PI * 2);
    ctx.fillStyle = i < player.hp ? '#ff5d3a' : 'rgba(244, 234, 220, 0.18)';
    ctx.fill();
  }
  const label = buildLabel();
  if (label) {
    ctx.fillStyle = '#cbbba6';
    ctx.font = `12px ${MONO}`;
    let shown = label;
    const maxW = w - 32;
    while (shown.length > 4 && ctx.measureText(shown).width > maxW) shown = `${shown.slice(0, -2)}…`;
    ctx.fillText(shown, x + 16, y + h - 18);
  }
  if (hintT > 0 && hintText) {
    ctx.globalAlpha = Math.min(1, hintT);
    ctx.fillStyle = '#f4eadc';
    ctx.font = `14px ${MONO}`;
    ctx.textAlign = 'center';
    ctx.fillText(hintText, x + w / 2, y + h - 42);
    ctx.globalAlpha = 1;
  }
  if (bannerT > 0 && bannerText) {
    ctx.globalAlpha = Math.min(1, bannerT / 0.35);
    ctx.fillStyle = '#f4eadc';
    ctx.font = `500 42px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(bannerText, x + w / 2, y + h * 0.2);
    ctx.globalAlpha = 1;
  }
  if (muted && mode === 'play') {
    ctx.fillStyle = '#cbbba6';
    ctx.font = `11px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.fillText('sound off', x + w - 16, y + h - 18);
  }
}

function drawVignette() {
  const dpr = view.dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  let a = pain * 0.33;
  if (player && (mode === 'play' || mode === 'vacuum') && player.hp > 0 && player.hp / player.maxHp <= 0.34) {
    a += 0.14 + (reduceMotion ? 0 : Math.sin(anim * 7) * 0.04);
  }
  if (a > 0) {
    const r = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
    r.addColorStop(0, 'rgba(255, 40, 16, 0)');
    r.addColorStop(1, `rgba(180, 24, 12, ${Math.min(0.55, a)})`);
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, w, h);
  }
}

function draw() {
  const dpr = view.dpr;
  const sh = reduceMotion ? 0 : shake;
  const shx = (Math.random() - 0.5) * sh;
  const shy = (Math.random() - 0.5) * sh;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#0e0c0a';
  ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * (view.ox + shx), dpr * (view.oy + shy));
  drawArena();
  if (mode === 'title') {
    drawFlame(ARENA_W / 2, ARENA_H * 0.72, 18);
    drawParticles();
  } else {
    drawRocks();
    drawFires();
    drawDrops();
    for (const e of enemies) drawEnemy(e);
    drawTelegraphs();
    drawPlayer();
    drawShots();
    drawParticles();
  }
  if (run && (mode === 'play' || mode === 'vacuum' || mode === 'cards')) drawHud();
  drawVignette();
  document.body.style.cursor = mode === 'play' || mode === 'vacuum' ? 'crosshair' : 'default';
}

function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (!reduceMotion) anim += dt;
  sfxLock.hit = Math.max(0, sfxLock.hit - dt);
  if (!reduceMotion) shake = Math.max(0, shake - dt * 22);
  if (hitstop > 0) hitstop -= dt;
  else if (mode === 'title') updateTitle(dt);
  else if (mode === 'play' || mode === 'vacuum') update(dt);
  if (hitstop <= 0) updateAmbient(dt);
  draw();
  requestAnimationFrame(frame);
}

let last = performance.now();

window.addEventListener('resize', resize);
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ' || k.startsWith('arrow')) e.preventDefault();
  keys[k] = true;
  if (e.repeat) return;
  if (k === 'escape') togglePause();
  if (k === 'm') toggleMute();
  if ((k === 'enter' || k === ' ') && (mode === 'title' || mode === 'dead')) start();
  if (mode === 'cards' && (k === '1' || k === '2' || k === '3')) pick(Number(k) - 1);
});
window.addEventListener('keyup', (e) => {
  keys[e.key.toLowerCase()] = false;
});
window.addEventListener('mousemove', (e) => {
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  mouse.seen = true;
  refreshMouse();
});
window.addEventListener('mousedown', (e) => {
  if (e.button === 2) {
    if (mode === 'play') tryDash();
    return;
  }
  if (e.button !== 0) return;
  mouse.x = e.clientX;
  mouse.y = e.clientY;
  refreshMouse();
  if (mode === 'title' || mode === 'dead') {
    start();
    mouse.down = false;
    return;
  }
  mouse.down = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.down = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('blur', () => {
  mouse.down = false;
  for (const k of Object.keys(keys)) keys[k] = false;
});

resize();
mouse.x = window.innerWidth / 2;
mouse.y = window.innerHeight / 2;
showTitle();
requestAnimationFrame(frame);
