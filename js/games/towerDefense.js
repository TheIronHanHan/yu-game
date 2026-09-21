const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 620;
const BALANCE_VERSION = 2;

export const TOWER_TYPES = {
  archer: {
    name: '箭塔',
    cost: 70,
    color: '#62D9B0',
    range: 182,
    damage: 22,
    cooldown: 0.55,
  },
  cannon: {
    name: '炮塔',
    cost: 100,
    color: '#FFB85C',
    range: 152,
    damage: 41,
    cooldown: 1.25,
    splash: 70,
  },
  mage: {
    name: '法师塔',
    cost: 120,
    color: '#A980FF',
    range: 172,
    damage: 33,
    cooldown: 0.82,
    armorPiercing: true,
  },
};

export const TOWER_LEVEL = {
  id: 1,
  name: '晨曦林地',
  description: '守住林间商路，击退 6 波怪物',
  totalWaves: 6,
  path: [
    { x: -45, y: 128 },
    { x: 180, y: 128 },
    { x: 180, y: 315 },
    { x: 425, y: 315 },
    { x: 425, y: 150 },
    { x: 690, y: 150 },
    { x: 690, y: 445 },
    { x: 1045, y: 445 },
  ],
  spots: [
    { x: 100, y: 248 },
    { x: 285, y: 190 },
    { x: 310, y: 430 },
    { x: 520, y: 260 },
    { x: 585, y: 70 },
    { x: 585, y: 420 },
    { x: 805, y: 320 },
    { x: 850, y: 535 },
  ],
};

const ENEMY_TYPES = {
  scout: { name: '小怪', health: 78, speed: 84, armor: 0, reward: 7, damage: 1, color: '#F36F81' },
  runner: { name: '疾行怪', health: 62, speed: 136, armor: 0, reward: 8, damage: 1, color: '#FFD166' },
  guard: { name: '铁甲怪', health: 175, speed: 60, armor: 0.4, reward: 14, damage: 2, color: '#7EA1C4' },
  boss: { name: '森林巨兽', health: 930, speed: 40, armor: 0.3, reward: 60, damage: 5, color: '#B96DDE' },
};

const WAVES = [
  [{ type: 'scout', count: 7, interval: 0.82 }],
  [{ type: 'scout', count: 8, interval: 0.65 }, { type: 'runner', count: 3, interval: 0.7 }],
  [{ type: 'runner', count: 9, interval: 0.55 }],
  [{ type: 'guard', count: 5, interval: 1.05 }, { type: 'scout', count: 7, interval: 0.58 }],
  [{ type: 'guard', count: 7, interval: 0.82 }, { type: 'runner', count: 7, interval: 0.48 }],
  [{ type: 'boss', count: 1, interval: 1 }, { type: 'guard', count: 7, interval: 0.72 }],
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function createSpawnQueue(groups) {
  const queue = [];
  let delay = 0;
  groups.forEach((group) => {
    for (let index = 0; index < group.count; index++) {
      queue.push({ type: group.type, delay });
      delay += group.interval;
    }
    delay += 0.55;
  });
  return queue;
}

export default class TowerDefense {
  constructor() {
    this.bestStars = Math.max(0, Number(wx.getStorageSync('towerDefenseLevel1Stars')) || 0);
    this.enemySequence = 0;
    this.reset();
  }

  reset() {
    this.status = 'ready';
    this.lives = 15;
    this.gold = 200;
    this.score = 0;
    this.waveIndex = 0;
    this.waveActive = false;
    this.spawnQueue = [];
    this.spawnElapsed = 0;
    this.enemies = [];
    this.towers = TOWER_LEVEL.spots.map((spot, index) => ({
      id: index,
      x: spot.x,
      y: spot.y,
      type: null,
      level: 0,
      cooldown: 0,
    }));
    this.projectiles = [];
    this.particles = [];
    this.selectedTowerId = null;
    this.starsEarned = 0;
    this.lastUpdateAt = Date.now();
  }

  startWave() {
    if (this.status === 'won' || this.status === 'lost' || this.waveActive) return false;
    if (this.waveIndex >= WAVES.length) return false;
    this.status = 'playing';
    this.spawnQueue = createSpawnQueue(WAVES[this.waveIndex]);
    this.spawnElapsed = 0;
    this.waveActive = true;
    this.lastUpdateAt = Date.now();
    return true;
  }

  selectTower(id) {
    const tower = this.towers.find((item) => item.id === id);
    this.selectedTowerId = tower ? id : null;
    return tower || null;
  }

  getSelectedTower() {
    return this.towers.find((tower) => tower.id === this.selectedTowerId) || null;
  }

  buildTower(type) {
    const tower = this.getSelectedTower();
    const config = TOWER_TYPES[type];
    if (!tower || tower.type || !config || this.gold < config.cost) return false;
    this.gold -= config.cost;
    tower.type = type;
    tower.level = 1;
    tower.cooldown = 0;
    return true;
  }

  getUpgradeCost(tower) {
    if (!tower || !tower.type || tower.level >= 3) return 0;
    return Math.round(TOWER_TYPES[tower.type].cost * (0.7 + tower.level * 0.45));
  }

  upgradeTower() {
    const tower = this.getSelectedTower();
    const cost = this.getUpgradeCost(tower);
    if (!tower || !cost || this.gold < cost) return false;
    this.gold -= cost;
    tower.level += 1;
    return true;
  }

  sellTower() {
    const tower = this.getSelectedTower();
    if (!tower || !tower.type) return false;
    const baseCost = TOWER_TYPES[tower.type].cost;
    const invested = baseCost + (tower.level > 1 ? Math.round(baseCost * 1.15) : 0)
      + (tower.level > 2 ? Math.round(baseCost * 1.6) : 0);
    this.gold += Math.round(invested * 0.65);
    tower.type = null;
    tower.level = 0;
    tower.cooldown = 0;
    return true;
  }

  spawnEnemy(type) {
    const config = ENEMY_TYPES[type];
    this.enemySequence += 1;
    this.enemies.push({
      id: this.enemySequence,
      type,
      x: TOWER_LEVEL.path[0].x,
      y: TOWER_LEVEL.path[0].y,
      segment: 0,
      progress: 0,
      health: config.health,
      maxHealth: config.health,
      speed: config.speed,
      armor: config.armor,
      reward: config.reward,
      damage: config.damage,
      color: config.color,
      hitFlash: 0,
    });
  }

  update(now = Date.now()) {
    const delta = clamp((now - this.lastUpdateAt) / 1000, 0, 0.05);
    this.lastUpdateAt = now;
    if (this.status !== 'playing') {
      this.updateEffects(delta);
      return;
    }

    if (this.waveActive && this.spawnQueue.length) {
      this.spawnElapsed += delta;
      while (this.spawnQueue.length && this.spawnElapsed >= this.spawnQueue[0].delay) {
        const next = this.spawnQueue.shift();
        this.spawnEnemy(next.type);
      }
    }

    this.enemies.forEach((enemy) => this.moveEnemy(enemy, delta));
    this.enemies = this.enemies.filter((enemy) => enemy.health > 0 && !enemy.escaped);
    this.updateTowers(delta);
    this.updateEffects(delta);

    if (this.lives <= 0) {
      this.lives = 0;
      this.status = 'lost';
      this.waveActive = false;
      return;
    }

    if (this.waveActive && !this.spawnQueue.length && !this.enemies.length) {
      this.waveActive = false;
      this.waveIndex += 1;
      if (this.waveIndex >= WAVES.length) this.finishLevel();
    }
  }

  moveEnemy(enemy, delta) {
    enemy.hitFlash = Math.max(0, enemy.hitFlash - delta);
    let movement = enemy.speed * delta;
    while (movement > 0 && enemy.segment < TOWER_LEVEL.path.length - 1) {
      const start = TOWER_LEVEL.path[enemy.segment];
      const end = TOWER_LEVEL.path[enemy.segment + 1];
      const segmentLength = distance(start, end);
      const remaining = segmentLength * (1 - enemy.progress);
      if (movement < remaining) {
        enemy.progress += movement / segmentLength;
        movement = 0;
      } else {
        movement -= remaining;
        enemy.segment += 1;
        enemy.progress = 0;
      }
    }

    if (enemy.segment >= TOWER_LEVEL.path.length - 1) {
      enemy.escaped = true;
      this.lives -= enemy.damage;
      return;
    }

    const start = TOWER_LEVEL.path[enemy.segment];
    const end = TOWER_LEVEL.path[enemy.segment + 1];
    enemy.x = start.x + (end.x - start.x) * enemy.progress;
    enemy.y = start.y + (end.y - start.y) * enemy.progress;
  }

  updateTowers(delta) {
    this.towers.forEach((tower) => {
      if (!tower.type) return;
      const config = TOWER_TYPES[tower.type];
      tower.cooldown -= delta;
      if (tower.cooldown > 0) return;

      const range = config.range * (1 + (tower.level - 1) * 0.13);
      const candidates = this.enemies
        .filter((enemy) => enemy.health > 0 && distance(tower, enemy) <= range)
        .sort((first, second) => (
          second.segment + second.progress - first.segment - first.progress
        ));
      const target = candidates[0];
      if (!target) return;

      const damage = config.damage * (1 + (tower.level - 1) * 0.55);
      const appliedDamage = config.armorPiercing ? damage : damage * (1 - target.armor);
      target.health -= appliedDamage;
      target.hitFlash = 0.12;
      tower.cooldown = config.cooldown * (1 - (tower.level - 1) * 0.08);
      this.projectiles.push({
        type: tower.type,
        color: config.color,
        fromX: tower.x,
        fromY: tower.y,
        toX: target.x,
        toY: target.y,
        life: 0.2,
        maxLife: 0.2,
      });

      if (config.splash) {
        this.enemies.forEach((enemy) => {
          if (enemy.id !== target.id && distance(enemy, target) <= config.splash) {
            enemy.health -= appliedDamage * 0.45;
            enemy.hitFlash = 0.12;
          }
        });
      }

      this.collectDefeatedEnemies();
    });
  }

  collectDefeatedEnemies() {
    this.enemies.forEach((enemy) => {
      if (enemy.health <= 0 && !enemy.rewarded) {
        enemy.rewarded = true;
        this.gold += enemy.reward;
        this.score += enemy.reward * 10;
        for (let index = 0; index < 5; index++) {
          this.particles.push({
            x: enemy.x,
            y: enemy.y,
            vx: (Math.random() - 0.5) * 80,
            vy: (Math.random() - 0.5) * 80,
            life: 0.45,
            maxLife: 0.45,
            color: enemy.color,
          });
        }
      }
    });
  }

  updateEffects(delta) {
    this.projectiles.forEach((projectile) => { projectile.life -= delta; });
    this.projectiles = this.projectiles.filter((projectile) => projectile.life > 0);
    this.particles.forEach((particle) => {
      particle.life -= delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
    });
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  finishLevel() {
    this.status = 'won';
    this.starsEarned = this.lives === 15 ? 3 : this.lives >= 8 ? 2 : 1;
    if (this.starsEarned > this.bestStars) {
      this.bestStars = this.starsEarned;
      wx.setStorageSync('towerDefenseLevel1Stars', this.bestStars);
    }
  }

  serialize() {
    return {
      balanceVersion: BALANCE_VERSION,
      status: this.status,
      lives: this.lives,
      gold: this.gold,
      score: this.score,
      waveIndex: this.waveIndex,
      waveActive: this.waveActive,
      spawnQueue: this.spawnQueue.map((item) => ({ ...item })),
      spawnElapsed: this.spawnElapsed,
      enemies: this.enemies.map((enemy) => ({ ...enemy })),
      towers: this.towers.map((tower) => ({ ...tower })),
      selectedTowerId: this.selectedTowerId,
      starsEarned: this.starsEarned,
      bestStars: this.bestStars,
    };
  }

  restore(state) {
    if (!state || state.balanceVersion !== BALANCE_VERSION
      || !Array.isArray(state.towers) || state.towers.length !== TOWER_LEVEL.spots.length) {
      return false;
    }
    this.status = ['ready', 'playing', 'won', 'lost'].includes(state.status)
      ? state.status : 'ready';
    this.lives = clamp(Number(state.lives) || 0, 0, 15);
    this.gold = Math.max(0, Number(state.gold) || 0);
    this.score = Math.max(0, Number(state.score) || 0);
    this.waveIndex = clamp(Number(state.waveIndex) || 0, 0, WAVES.length);
    this.waveActive = Boolean(state.waveActive);
    this.spawnQueue = Array.isArray(state.spawnQueue)
      ? state.spawnQueue.map((item) => ({ type: item.type, delay: Number(item.delay) || 0 })) : [];
    this.spawnElapsed = Math.max(0, Number(state.spawnElapsed) || 0);
    this.enemies = Array.isArray(state.enemies) ? state.enemies.map((enemy) => ({ ...enemy })) : [];
    this.towers = state.towers.map((tower, index) => ({
      id: index,
      x: TOWER_LEVEL.spots[index].x,
      y: TOWER_LEVEL.spots[index].y,
      type: TOWER_TYPES[tower.type] ? tower.type : null,
      level: clamp(Number(tower.level) || 0, 0, 3),
      cooldown: Math.max(0, Number(tower.cooldown) || 0),
    }));
    this.selectedTowerId = this.towers.some((tower) => tower.id === state.selectedTowerId)
      ? state.selectedTowerId : null;
    this.starsEarned = clamp(Number(state.starsEarned) || 0, 0, 3);
    this.bestStars = Math.max(this.bestStars, clamp(Number(state.bestStars) || 0, 0, 3));
    this.enemySequence = this.enemies.reduce((maxId, enemy) => Math.max(maxId, enemy.id || 0), 0);
    this.projectiles = [];
    this.particles = [];
    this.lastUpdateAt = Date.now();
    return true;
  }
}
