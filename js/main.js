import { PIXEL_RATIO, SCREEN_HEIGHT, SCREEN_WIDTH } from './render';
import Minesweeper, { DIFFICULTIES } from './games/minesweeper';
import Game2048 from './games/game2048';
import TowerDefense, { TOWER_LEVEL, TOWER_TYPES } from './games/towerDefense';
import {
  COLORS,
  drawArrow,
  drawMine,
  drawRoundedRect,
  drawSpark,
  fitText,
} from './ui/draw';

const ctx = canvas.getContext('2d');
ctx.scale(PIXEL_RATIO, PIXEL_RATIO);
ctx.imageSmoothingEnabled = true;
const SAVE_KEY = 'miniArcadeSaveV1';

export default class Main {
  constructor() {
    this.screen = 'home';
    this.hitAreas = {};
    this.touchStart = null;
    this.longPressTimer = null;
    this.magnifierTimer = null;
    this.magnifier = null;
    this.holdSelection = null;
    this.mineDrag = null;
    this.longPressTriggered = false;
    this.touchMoved = false;
    this.pressedCells = {};
    this.minesweeper = new Minesweeper();
    this.mineViewport = { offsetX: 0, offsetY: 0, zoomed: true };
    this.mineAnimations = [];
    this.mineResultReadyAt = 0;
    this.showMineLeaderboard = false;
    this.game2048 = new Game2048();
    this.game2048Animation = null;
    this.towerDefense = new TowerDefense();
    this.savedGames = this.readSaveData();
    this.lastAutoSaveAt = 0;
    this.appHiddenAt = 0;
    this.restoreSavedGames();

    this.bindTouchEvents();
    if (wx.onHide) {
      wx.onHide(() => {
        this.saveCurrentGame();
        this.appHiddenAt = Date.now();
      });
    }
    if (wx.onShow) {
      wx.onShow(() => {
        if (this.appHiddenAt && this.minesweeper.status === 'playing') {
          this.minesweeper.startTime = Date.now() - this.minesweeper.elapsedMilliseconds;
        }
        this.appHiddenAt = 0;
      });
    }
    this.loop = this.loop.bind(this);
    this.aniId = requestAnimationFrame(this.loop);
  }

  bindTouchEvents() {
    wx.onTouchStart((event) => {
      const touch = event.touches[0];
      if (!touch) return;

      this.touchStart = {
        x: touch.clientX,
        y: touch.clientY,
        time: Date.now(),
      };
      this.longPressTriggered = false;
      this.touchMoved = false;
      this.holdSelection = null;
      this.mineDrag = null;

      if (this.screen === 'minesweeper') {
        if (this.showMineLeaderboard) return;
        const touchingControl = ['panLeft', 'panRight', 'panUp', 'panDown']
          .some((key) => this.contains(this.hitAreas[key], touch.clientX, touch.clientY));
        if (touchingControl) return;
        const cell = this.getTouchedCell(touch.clientX, touch.clientY);
        const gameEnded = this.minesweeper.status === 'won' || this.minesweeper.status === 'lost';
        if (cell && !gameEnded) {
          const touchedCell = this.minesweeper.board[cell.row][cell.col];
          if (touchedCell.revealed) {
            if (!touchedCell.mine && touchedCell.adjacent === 0) {
              this.mineDrag = {
                startX: touch.clientX,
                startY: touch.clientY,
                offsetX: this.mineViewport.offsetX,
                offsetY: this.mineViewport.offsetY,
                active: false,
              };
            } else {
              this.setPressedNeighbors(cell.row, cell.col);
            }
          } else {
            this.holdSelection = {
              row: cell.row,
              col: cell.col,
              touchX: touch.clientX,
              touchY: touch.clientY,
            };
            this.magnifierTimer = setTimeout(() => {
              if (this.holdSelection) this.magnifier = { ...this.holdSelection };
            }, 120);
            this.longPressTimer = setTimeout(() => {
              if (this.holdSelection) this.longPressTriggered = true;
            }, 300);
          }
        }
      }
    });

    wx.onTouchMove((event) => {
      if (!this.touchStart || !event.touches[0]) return;
      const touch = event.touches[0];
      const moved = Math.hypot(
        touch.clientX - this.touchStart.x,
        touch.clientY - this.touchStart.y,
      );
      if (moved > 12) this.touchMoved = true;

      if (this.mineDrag) {
        if (moved > 8) {
          this.mineDrag.active = true;
          this.touchMoved = true;
          this.pressedCells = {};
          this.dragMinefield(touch.clientX, touch.clientY);
        }
      } else if (this.holdSelection) {
        const cell = this.getTouchedCell(touch.clientX, touch.clientY);
        if (cell && !this.minesweeper.board[cell.row][cell.col].revealed) {
          this.holdSelection.row = cell.row;
          this.holdSelection.col = cell.col;
        }
        this.holdSelection.touchX = touch.clientX;
        this.holdSelection.touchY = touch.clientY;
        if (this.magnifier) this.magnifier = { ...this.holdSelection };
      } else if (moved > 12) {
        this.clearLongPress();
        this.hideMagnifier();
        this.pressedCells = {};
      } else if (this.magnifier) {
        this.magnifier.touchX = touch.clientX;
        this.magnifier.touchY = touch.clientY;
      }
    });

    wx.onTouchEnd((event) => {
      const touch = event.changedTouches[0];
      this.clearLongPress();
      this.clearMagnifierTimer();
      if (!touch || !this.touchStart) return;

      const moved = Math.hypot(
        touch.clientX - this.touchStart.x,
        touch.clientY - this.touchStart.y,
      );
      if (this.screen === '2048' && moved >= 24) {
        const deltaX = touch.clientX - this.touchStart.x;
        const deltaY = touch.clientY - this.touchStart.y;
        const direction = Math.abs(deltaX) > Math.abs(deltaY)
          ? (deltaX > 0 ? 'right' : 'left')
          : (deltaY > 0 ? 'down' : 'up');
        if (this.game2048.status === 'playing') {
          const changed = this.game2048.move(direction);
          if (changed) {
            this.game2048Animation = {
              mergedCells: this.game2048.lastMove.mergedCells,
              tileMoves: this.game2048.lastMove.tileMoves,
              newTile: this.game2048.lastMove.newTile,
              scoreGained: this.game2048.lastMove.scoreGained,
              startTime: Date.now(),
            };
            this.saveCurrentGame();
          } else {
            this.game2048Animation = null;
          }
        }
      } else if (this.mineDrag && this.mineDrag.active) {
        this.saveCurrentGame();
      } else if (this.longPressTriggered && this.holdSelection) {
        const cell = this.getTouchedCell(touch.clientX, touch.clientY);
        if (cell && !this.minesweeper.board[cell.row][cell.col].revealed) {
          this.holdSelection.row = cell.row;
          this.holdSelection.col = cell.col;
        }
        this.triggerMineMark(this.holdSelection.row, this.holdSelection.col);
      } else if (moved < 14 && !this.touchMoved) {
        this.handleTap(touch.clientX, touch.clientY);
      }
      this.magnifier = null;
      this.holdSelection = null;
      this.mineDrag = null;
      this.pressedCells = {};
      this.touchStart = null;
    });

    if (wx.onTouchCancel) {
      wx.onTouchCancel(() => {
        this.clearLongPress();
        this.hideMagnifier();
        this.holdSelection = null;
        this.mineDrag = null;
        this.pressedCells = {};
        this.touchStart = null;
      });
    }
  }

  clearLongPress() {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
  }

  clearMagnifierTimer() {
    if (this.magnifierTimer) {
      clearTimeout(this.magnifierTimer);
      this.magnifierTimer = null;
    }
  }

  hideMagnifier() {
    this.clearMagnifierTimer();
    this.magnifier = null;
  }

  setPressedNeighbors(row, col) {
    const cell = this.minesweeper.board[row][col];
    if (!cell.revealed || cell.adjacent === 0) return;

    this.pressedCells = {};
    this.minesweeper.getNeighbors(row, col).forEach(({ row: nextRow, col: nextCol }) => {
      const nextCell = this.minesweeper.board[nextRow][nextCol];
      if (!nextCell.revealed && !nextCell.flagged) {
        this.pressedCells[`${nextRow}:${nextCol}`] = true;
      }
    });
  }

  clearMineEffects() {
    this.mineAnimations = [];
    this.mineResultReadyAt = 0;
  }

  triggerMineMark(row, col) {
    this.minesweeper.toggleMark(row, col);
    const cell = this.minesweeper.board[row][col];
    const state = cell.flagged ? 'flag' : cell.questioned ? 'question' : 'clear';
    this.mineAnimations.push({
      row,
      col,
      type: 'mark',
      state,
      startTime: Date.now(),
      delay: 0,
    });
    this.saveCurrentGame();
  }

  triggerMineReveal(row, col) {
    this.minesweeper.reveal(row, col);
    const startTime = Date.now();
    this.minesweeper.lastReveal.forEach((cell, index) => {
      this.mineAnimations.push({
        ...cell,
        type: cell.mine ? 'mine' : 'reveal',
        startTime,
        delay: Math.min(index * 14, 210),
      });
    });
    if (this.minesweeper.status === 'won' || this.minesweeper.status === 'lost') {
      this.mineResultReadyAt = startTime + 700;
    }
    this.saveCurrentGame();
  }

  contains(area, x, y) {
    return area && x >= area.x && x <= area.x + area.width
      && y >= area.y && y <= area.y + area.height;
  }

  readSaveData() {
    const data = wx.getStorageSync(SAVE_KEY);
    return data && typeof data === 'object' ? data : {};
  }

  restoreSavedGames() {
    if (this.savedGames.minesweeper) this.minesweeper.restore(this.savedGames.minesweeper);
    if (this.savedGames.game2048) this.game2048.restore(this.savedGames.game2048);
    if (this.savedGames.towerDefense) this.towerDefense.restore(this.savedGames.towerDefense);
    if (this.savedGames.mineViewport) {
      this.mineViewport.offsetX = Math.max(0, Number(this.savedGames.mineViewport.offsetX) || 0);
      this.mineViewport.offsetY = Math.max(0, Number(this.savedGames.mineViewport.offsetY) || 0);
      this.mineViewport.zoomed = this.savedGames.mineViewport.zoomed !== false;
    }
  }

  saveCurrentGame() {
    if (!['minesweeper', '2048', 'towerDefense'].includes(this.screen)) return;
    if (this.screen === 'minesweeper') this.minesweeper.updateTimer();
    this.savedGames = {
      version: 1,
      lastGame: this.screen,
      minesweeper: this.minesweeper.serialize(),
      mineViewport: { ...this.mineViewport },
      game2048: this.game2048.serialize(),
      towerDefense: this.towerDefense.serialize(),
    };
    wx.setStorageSync(SAVE_KEY, this.savedGames);
    this.lastAutoSaveAt = Date.now();
  }

  getResumeInfo() {
    if (this.savedGames.lastGame === 'minesweeper'
      && (this.minesweeper.status === 'ready' || this.minesweeper.status === 'playing')) {
      return {
        screen: 'minesweeper',
        title: `继续扫雷 · ${DIFFICULTIES[this.minesweeper.difficulty].label}`,
        detail: this.formatDuration(this.minesweeper.elapsedMilliseconds),
      };
    }
    if (this.savedGames.lastGame === '2048'
      && (this.game2048.status === 'playing' || this.game2048.status === 'won')) {
      return {
        screen: '2048',
        title: '继续 2048',
        detail: `${this.game2048.score} 分`,
      };
    }
    if (this.savedGames.lastGame === 'towerDefense'
      && (this.towerDefense.status === 'ready' || this.towerDefense.status === 'playing')) {
      return {
        screen: 'towerDefense',
        title: '继续塔防 · 晨曦林地',
        detail: `第 ${Math.min(this.towerDefense.waveIndex + 1, TOWER_LEVEL.totalWaves)} 波`,
      };
    }
    return null;
  }

  handleTap(x, y) {
    if (this.screen === 'home') {
      const resumeInfo = this.getResumeInfo();
      if (resumeInfo && this.contains(this.hitAreas.continueGame, x, y)) {
        this.screen = resumeInfo.screen;
        if (resumeInfo.screen === 'minesweeper' && this.minesweeper.status === 'playing') {
          this.minesweeper.startTime = Date.now() - this.minesweeper.elapsedMilliseconds;
        }
        this.clearMineEffects();
      } else if (this.contains(this.hitAreas.minesweeperCard, x, y)) {
        this.screen = 'minesweeper';
        this.minesweeper.reset();
        this.resetMineViewport();
        this.clearMineEffects();
        this.showMineLeaderboard = false;
        this.saveCurrentGame();
      } else if (this.contains(this.hitAreas.game2048Card, x, y)) {
        this.screen = '2048';
        this.game2048.reset();
        this.game2048Animation = null;
        this.saveCurrentGame();
      } else if (this.contains(this.hitAreas.towerDefenseCard, x, y)) {
        this.screen = 'towerMap';
      }
      return;
    }

    if (this.screen === 'minesweeper' && this.showMineLeaderboard) {
      if (this.contains(this.hitAreas.leaderboardClose, x, y)) {
        this.showMineLeaderboard = false;
      }
      return;
    }

    if (this.contains(this.hitAreas.back, x, y)) {
      this.saveCurrentGame();
      this.clearMineEffects();
      this.showMineLeaderboard = false;
      this.game2048Animation = null;
      this.screen = this.screen === 'towerDefense' ? 'towerMap' : 'home';
      return;
    }

    if (this.screen === 'towerMap') {
      if (this.contains(this.hitAreas.level1, x, y)
        || this.contains(this.hitAreas.level1Button, x, y)) {
        this.towerDefense.reset();
        this.screen = 'towerDefense';
        this.saveCurrentGame();
      }
      return;
    }

    if (this.contains(this.hitAreas.reset, x, y)) {
      if (this.screen === 'minesweeper') {
        this.minesweeper.reset();
        this.resetMineViewport();
        this.clearMineEffects();
        this.showMineLeaderboard = false;
        this.saveCurrentGame();
      }
      if (this.screen === '2048') {
        this.game2048.reset();
        this.game2048Animation = null;
        this.saveCurrentGame();
      }
      if (this.screen === 'towerDefense') {
        this.towerDefense.reset();
        this.saveCurrentGame();
      }
      return;
    }

    if (this.screen === '2048') {
      if (this.contains(this.hitAreas.overlayAction, x, y)) {
        if (this.game2048.status === 'won') this.game2048.continueGame();
        else this.game2048.reset();
        this.game2048Animation = null;
        this.saveCurrentGame();
      }
      return;
    }

    if (this.screen === 'towerDefense') {
      this.handleTowerDefenseTap(x, y);
      return;
    }

    if (this.contains(this.hitAreas.leaderboard, x, y)) {
      this.showMineLeaderboard = true;
      return;
    }

    if (this.contains(this.hitAreas.zoom, x, y)) {
      this.toggleMineZoom();
      this.saveCurrentGame();
      return;
    }

    const panActions = [
      ['panLeft', -1, 0],
      ['panRight', 1, 0],
      ['panUp', 0, -1],
      ['panDown', 0, 1],
    ];
    const panAction = panActions.find(([key]) => this.contains(this.hitAreas[key], x, y));
    if (panAction) {
      this.panMinefield(panAction[1], panAction[2]);
      this.saveCurrentGame();
      return;
    }

    const difficulty = Object.keys(DIFFICULTIES).find((key) => (
      this.contains(this.hitAreas[`difficulty_${key}`], x, y)
    ));
    if (difficulty) {
      this.minesweeper.setDifficulty(difficulty);
      this.resetMineViewport();
      this.clearMineEffects();
      this.showMineLeaderboard = false;
      this.saveCurrentGame();
      return;
    }

    if (this.contains(this.hitAreas.overlayAction, x, y)) {
      this.minesweeper.reset();
      this.clearMineEffects();
      this.saveCurrentGame();
      return;
    }

    const cell = this.getTouchedCell(x, y);
    if (cell) this.triggerMineReveal(cell.row, cell.col);
  }

  getTouchedCell(x, y) {
    const board = this.hitAreas.board;
    if (!board || !this.contains(board, x, y)) return null;

    const col = Math.floor((x - board.x - board.insetX + this.mineViewport.offsetX) / board.cellSize);
    const row = Math.floor((y - board.y - board.insetY + this.mineViewport.offsetY) / board.cellSize);
    if (row < 0 || row >= this.minesweeper.rows
      || col < 0 || col >= this.minesweeper.cols) return null;
    return { row, col };
  }

  resetMineViewport() {
    this.mineViewport.offsetX = 0;
    this.mineViewport.offsetY = 0;
  }

  getMineCellSize(viewportSize) {
    const fittedSize = Math.floor(viewportSize / this.minesweeper.cols);
    return this.mineViewport.zoomed ? Math.max(32, fittedSize) : fittedSize;
  }

  toggleMineZoom() {
    const board = this.hitAreas.board;
    if (!board) return;
    const centerCol = (this.mineViewport.offsetX + board.width / 2) / board.cellSize;
    const centerRow = (this.mineViewport.offsetY + board.height / 2) / board.cellSize;
    this.mineViewport.zoomed = !this.mineViewport.zoomed;
    const cellSize = this.getMineCellSize(board.width);
    const maxOffsetX = Math.max(0, this.minesweeper.cols * cellSize - board.width);
    const maxOffsetY = Math.max(0, this.minesweeper.rows * cellSize - board.height);
    this.mineViewport.offsetX = Math.max(0, Math.min(maxOffsetX, centerCol * cellSize - board.width / 2));
    this.mineViewport.offsetY = Math.max(0, Math.min(maxOffsetY, centerRow * cellSize - board.height / 2));
  }

  panMinefield(horizontal, vertical) {
    const board = this.hitAreas.board;
    if (!board) return;
    const step = board.cellSize * 3;
    this.mineViewport.offsetX = Math.max(
      0,
      Math.min(board.maxOffsetX, this.mineViewport.offsetX + horizontal * step),
    );
    this.mineViewport.offsetY = Math.max(
      0,
      Math.min(board.maxOffsetY, this.mineViewport.offsetY + vertical * step),
    );
  }

  dragMinefield(x, y) {
    const board = this.hitAreas.board;
    if (!board || !this.mineDrag) return;
    this.mineViewport.offsetX = Math.max(
      0,
      Math.min(board.maxOffsetX, this.mineDrag.offsetX - (x - this.mineDrag.startX)),
    );
    this.mineViewport.offsetY = Math.max(
      0,
      Math.min(board.maxOffsetY, this.mineDrag.offsetY - (y - this.mineDrag.startY)),
    );
  }

  drawBackground() {
    const gradient = ctx.createLinearGradient(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    gradient.addColorStop(0, COLORS.backgroundTop);
    gradient.addColorStop(1, COLORS.backgroundBottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(SCREEN_WIDTH - 32, 92, 126, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-28, SCREEN_HEIGHT - 80, 94, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  renderHome() {
    this.drawBackground();
    this.hitAreas = {};

    const width = SCREEN_WIDTH;
    const side = 24;
    const top = Math.max(54, GameGlobal.safeArea.top + 26);

    ctx.fillStyle = COLORS.muted;
    ctx.font = '600 13px sans-serif';
    ctx.fillText('MINI ARCADE', side, top);

    ctx.fillStyle = COLORS.text;
    ctx.font = '800 36px sans-serif';
    ctx.fillText('今天玩点什么？', side, top + 48);

    const resumeInfo = this.getResumeInfo();
    if (resumeInfo) {
      this.hitAreas.continueGame = {
        x: side,
        y: top + 59,
        width: width - side * 2,
        height: 36,
      };
      drawRoundedRect(ctx, side, top + 59, width - side * 2, 36, 14, '#202646');
      ctx.fillStyle = '#FFD166';
      ctx.font = '700 13px sans-serif';
      ctx.fillText(resumeInfo.title, side + 14, top + 82);
      ctx.fillStyle = COLORS.subtext;
      ctx.textAlign = 'right';
      ctx.fillText(`${resumeInfo.detail}  ›`, width - side - 14, top + 82);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = COLORS.subtext;
      ctx.font = '15px sans-serif';
      ctx.fillText('轻松开一局，随时再来一局。', side, top + 78);
    }

    const cardY = top + 116;
    const cardWidth = width - side * 2;
    const cardHeight = Math.min(214, SCREEN_HEIGHT * 0.29);
    this.hitAreas.minesweeperCard = {
      x: side,
      y: cardY,
      width: cardWidth,
      height: cardHeight,
    };

    const cardGradient = ctx.createLinearGradient(side, cardY, width - side, cardY + cardHeight);
    cardGradient.addColorStop(0, '#7457FF');
    cardGradient.addColorStop(1, '#A675FF');
    drawRoundedRect(ctx, side, cardY, cardWidth, cardHeight, 28, cardGradient);

    ctx.globalAlpha = 0.15;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(width - 48, cardY + 24, 88, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    drawMine(ctx, width - 78, cardY + 76, 34, '#FFFFFF', '#392880');
    drawSpark(ctx, width - 142, cardY + 42, 10, '#FFE182');
    drawSpark(ctx, width - 45, cardY + 144, 7, '#FFFFFF');

    ctx.fillStyle = '#E8E1FF';
    ctx.font = '600 13px sans-serif';
    ctx.fillText('经典益智', side + 22, cardY + 34);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 30px sans-serif';
    ctx.fillText('扫雷', side + 22, cardY + 72);
    ctx.font = '14px sans-serif';
    ctx.fillStyle = '#EEE9FF';
    ctx.fillText('三档难度，挑战你的排雷速度', side + 22, cardY + 102);

    drawRoundedRect(ctx, side + 22, cardY + cardHeight - 54, 112, 36, 18, '#FFFFFF');
    ctx.fillStyle = '#6547E8';
    ctx.font = '700 14px sans-serif';
    ctx.fillText('开始游戏', side + 39, cardY + cardHeight - 31);
    drawArrow(ctx, side + 112, cardY + cardHeight - 36, '#6547E8');

    const comingY = cardY + cardHeight + 30;
    ctx.fillStyle = COLORS.text;
    ctx.font = '700 18px sans-serif';
    ctx.fillText('更多游戏', side, comingY);

    const gap = 12;
    const smallWidth = (cardWidth - gap) / 2;
    this.hitAreas.game2048Card = {
      x: side,
      y: comingY + 20,
      width: smallWidth,
      height: 116,
    };
    this.drawComingCard(side, comingY + 20, smallWidth, 116, '2048', '滑动合成', '#FFB85C', true);
    this.hitAreas.towerDefenseCard = {
      x: side + smallWidth + gap,
      y: comingY + 20,
      width: smallWidth,
      height: 116,
    };
    this.drawComingCard(
      side + smallWidth + gap,
      comingY + 20,
      smallWidth,
      116,
      '塔防',
      '第一关开放',
      '#54D3A3',
      true,
    );

    ctx.fillStyle = COLORS.muted;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('小游戏合集 · 持续更新中', width / 2, SCREEN_HEIGHT - 30);
    ctx.textAlign = 'left';
  }

  drawComingCard(x, y, width, height, title, label, accent, playable = false) {
    drawRoundedRect(ctx, x, y, width, height, 22, COLORS.panel);
    drawRoundedRect(ctx, x + 16, y + 16, 36, 36, 12, accent);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(title === '2048' ? '2⁸' : '塔', x + 34, y + 39);
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.text;
    ctx.font = '700 17px sans-serif';
    ctx.fillText(title, x + 16, y + 78);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '12px sans-serif';
    ctx.fillText(label, x + 16, y + 99);
    if (playable) drawArrow(ctx, x + width - 22, y + 92, accent);
  }

  drawBackButton(top, title) {
    this.hitAreas.back = { x: 14, y: top - 18, width: 48, height: 44 };
    drawRoundedRect(ctx, 18, top - 14, 38, 38, 14, COLORS.panel);
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(41, top - 2);
    ctx.lineTo(32, top + 5);
    ctx.lineTo(41, top + 12);
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 24px sans-serif';
    ctx.fillText(title, 70, top + 13);
  }

  drawStars(centerX, y, count, size = 20) {
    for (let index = 0; index < 3; index++) {
      const x = centerX + (index - 1) * (size + 6);
      ctx.fillStyle = index < count ? '#FFD166' : '#4A516D';
      ctx.beginPath();
      for (let point = 0; point < 10; point++) {
        const angle = -Math.PI / 2 + point * Math.PI / 5;
        const radius = point % 2 === 0 ? size / 2 : size / 4.4;
        const px = x + Math.cos(angle) * radius;
        const py = y + Math.sin(angle) * radius;
        if (point === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
    }
  }

  renderTowerMap() {
    this.drawBackground();
    this.hitAreas = {};
    const width = SCREEN_WIDTH;
    const top = Math.max(48, GameGlobal.safeArea.top + 18);
    this.drawBackButton(top, '冒险地图');

    ctx.fillStyle = COLORS.subtext;
    ctx.font = '13px sans-serif';
    ctx.fillText('第一章 · 翡翠边境', 70, top + 36);

    const mapX = 18;
    const mapY = top + 66;
    const mapWidth = width - 36;
    const mapHeight = Math.min(500, SCREEN_HEIGHT - mapY - 28);
    const gradient = ctx.createLinearGradient(mapX, mapY, mapX, mapY + mapHeight);
    gradient.addColorStop(0, '#315E55');
    gradient.addColorStop(1, '#173B3B');
    drawRoundedRect(ctx, mapX, mapY, mapWidth, mapHeight, 28, gradient);

    ctx.save();
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = '#B8F2C8';
    for (let index = 0; index < 18; index++) {
      const treeX = mapX + 18 + ((index * 71) % Math.max(40, mapWidth - 36));
      const treeY = mapY + 24 + ((index * 97) % Math.max(50, mapHeight - 48));
      ctx.beginPath();
      ctx.arc(treeX, treeY, 9 + (index % 3) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const nodes = [
      { x: 0.28, y: 0.19 },
      { x: 0.68, y: 0.34 },
      { x: 0.35, y: 0.52 },
      { x: 0.72, y: 0.68 },
      { x: 0.43, y: 0.84 },
    ].map((node) => ({
      x: mapX + mapWidth * node.x,
      y: mapY + mapHeight * node.y,
    }));

    ctx.strokeStyle = '#D2B47A';
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    nodes.forEach((node, index) => {
      if (index === 0) ctx.moveTo(node.x, node.y);
      else ctx.lineTo(node.x, node.y);
    });
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 8]);
    ctx.stroke();
    ctx.setLineDash([]);

    nodes.forEach((node, index) => {
      const unlocked = index === 0;
      ctx.fillStyle = unlocked ? '#FFD166' : '#3C5160';
      ctx.strokeStyle = unlocked ? '#FFF2B3' : '#667581';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(node.x, node.y, unlocked ? 30 : 23, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = unlocked ? '#503E24' : '#9EABB3';
      ctx.font = `800 ${unlocked ? 20 : 15}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(index + 1), node.x, node.y + 1);
      if (!unlocked) {
        ctx.font = '11px sans-serif';
        ctx.fillText('锁', node.x, node.y + 34);
      }
    });

    const first = nodes[0];
    this.hitAreas.level1 = { x: first.x - 46, y: first.y - 46, width: 92, height: 92 };
    this.drawStars(first.x, first.y + 49, this.towerDefense.bestStars, 16);

    const panelHeight = 102;
    const panelY = mapY + mapHeight - panelHeight - 14;
    drawRoundedRect(ctx, mapX + 14, panelY, mapWidth - 28, panelHeight, 20, 'rgba(15,31,38,0.88)');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 19px sans-serif';
    ctx.fillText('第 1 关 · 晨曦林地', mapX + 30, panelY + 30);
    ctx.fillStyle = '#B9D6CE';
    ctx.font = '12px sans-serif';
    ctx.fillText('守住 6 波进攻，根据剩余生命获得星级', mapX + 30, panelY + 54);
    drawRoundedRect(ctx, mapX + 30, panelY + 65, 104, 28, 14, '#FFD166');
    this.hitAreas.level1Button = { x: mapX + 24, y: panelY + 59, width: 116, height: 40 };
    ctx.fillStyle = '#44351E';
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('点击关卡开始', mapX + 82, panelY + 84);
    ctx.textAlign = 'left';
  }

  handleTowerDefenseTap(x, y) {
    if (this.contains(this.hitAreas.tdMapAction, x, y)) {
      this.saveCurrentGame();
      this.screen = 'towerMap';
      return;
    }
    if (this.contains(this.hitAreas.tdOverlayAction, x, y)) {
      this.towerDefense.reset();
      this.saveCurrentGame();
      return;
    }
    if (this.towerDefense.status === 'won' || this.towerDefense.status === 'lost') return;

    if (this.contains(this.hitAreas.waveButton, x, y)) {
      if (this.towerDefense.startWave()) this.saveCurrentGame();
      return;
    }

    const buildType = Object.keys(TOWER_TYPES).find((type) => (
      this.contains(this.hitAreas[`build_${type}`], x, y)
    ));
    if (buildType) {
      if (this.towerDefense.buildTower(buildType)) this.saveCurrentGame();
      return;
    }
    if (this.contains(this.hitAreas.upgradeTower, x, y)) {
      if (this.towerDefense.upgradeTower()) this.saveCurrentGame();
      return;
    }
    if (this.contains(this.hitAreas.sellTower, x, y)) {
      if (this.towerDefense.sellTower()) this.saveCurrentGame();
      return;
    }

    const towerArea = Object.keys(this.hitAreas).find((key) => (
      key.indexOf('towerSpot_') === 0 && this.contains(this.hitAreas[key], x, y)
    ));
    if (towerArea) {
      this.towerDefense.selectTower(Number(towerArea.split('_')[1]));
    } else if (this.contains(this.hitAreas.towerBoard, x, y)) {
      this.towerDefense.selectTower(null);
    }
  }

  getTowerBoardMetrics() {
    const top = Math.max(48, GameGlobal.safeArea.top + 18);
    const x = 12;
    const y = top + 70;
    const width = SCREEN_WIDTH - 24;
    const height = Math.min(width * 0.68, 270);
    return {
      x,
      y,
      width,
      height,
      scale: width / 1000,
      depthScale: 0.86,
      groundY: y + 16,
    };
  }

  projectTowerPoint(metrics, worldX, worldY) {
    const perspectiveSkew = (worldY - 310) * metrics.scale * 0.018;
    return {
      x: metrics.x + worldX * metrics.scale + perspectiveSkew,
      y: metrics.groundY + worldY * metrics.scale * metrics.depthScale,
    };
  }

  renderTowerDefense() {
    this.drawBackground();
    this.hitAreas = {};
    const top = Math.max(48, GameGlobal.safeArea.top + 18);
    this.drawBackButton(top, TOWER_LEVEL.name);

    this.hitAreas.reset = { x: SCREEN_WIDTH - 94, y: top - 18, width: 76, height: 38 };
    drawRoundedRect(ctx, SCREEN_WIDTH - 90, top - 14, 72, 38, 14, COLORS.panel);
    ctx.fillStyle = COLORS.subtext;
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('重新挑战', SCREEN_WIDTH - 54, top + 10);
    ctx.textAlign = 'left';

    const metrics = this.getTowerBoardMetrics();
    this.drawTowerBoard(metrics);
    this.drawTowerControls(metrics);
    if (this.towerDefense.status === 'won' || this.towerDefense.status === 'lost') {
      this.drawTowerResultOverlay();
    }
  }

  drawTowerBoard(metrics) {
    const { x, y, width, height, scale, depthScale } = metrics;
    this.hitAreas.towerBoard = { x, y, width, height };
    drawRoundedRect(ctx, x, y + 7, width, height - 3, 22, '#102A2A');
    const groundGradient = ctx.createLinearGradient(x, y, x, y + height - 14);
    groundGradient.addColorStop(0, '#4B7757');
    groundGradient.addColorStop(0.55, '#315D48');
    groundGradient.addColorStop(1, '#23483E');
    drawRoundedRect(ctx, x, y, width, height - 14, 22, groundGradient);
    ctx.fillStyle = '#173934';
    ctx.beginPath();
    ctx.moveTo(x + 8, y + height - 18);
    ctx.lineTo(x + width - 8, y + height - 18);
    ctx.lineTo(x + width - 18, y + height - 4);
    ctx.lineTo(x + 18, y + height - 4);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height - 10);
    ctx.clip();

    ctx.strokeStyle = 'rgba(191,229,180,0.08)';
    ctx.lineWidth = 1;
    for (let worldY = 70; worldY < 620; worldY += 105) {
      const start = this.projectTowerPoint(metrics, 0, worldY);
      const end = this.projectTowerPoint(metrics, 1000, worldY);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#69553C';
    ctx.lineWidth = Math.max(22, 88 * scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    TOWER_LEVEL.path.forEach((point, index) => {
      const projected = this.projectTowerPoint(metrics, point.x, point.y);
      if (index === 0) ctx.moveTo(projected.x, projected.y + 4);
      else ctx.lineTo(projected.x, projected.y + 4);
    });
    ctx.stroke();
    ctx.strokeStyle = '#C9A66B';
    ctx.lineWidth = Math.max(18, 74 * scale);
    ctx.beginPath();
    TOWER_LEVEL.path.forEach((point, index) => {
      const projected = this.projectTowerPoint(metrics, point.x, point.y);
      if (index === 0) ctx.moveTo(projected.x, projected.y);
      else ctx.lineTo(projected.x, projected.y);
    });
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,239,190,0.32)';
    ctx.lineWidth = Math.max(2, 6 * scale);
    ctx.setLineDash([9 * scale, 15 * scale]);
    ctx.stroke();
    ctx.setLineDash([]);

    const terrainProps = [
      { x: 55, y: 70, type: 'tree', size: 1.05 },
      { x: 330, y: 68, type: 'tree', size: 0.78 },
      { x: 790, y: 70, type: 'tree', size: 1.08 },
      { x: 935, y: 250, type: 'rock', size: 0.85 },
      { x: 70, y: 505, type: 'rock', size: 0.75 },
      { x: 480, y: 535, type: 'tree', size: 0.88 },
      { x: 940, y: 565, type: 'tree', size: 0.72 },
    ];
    const selectedTower = this.towerDefense.getSelectedTower();
    if (selectedTower && selectedTower.type) {
      const config = TOWER_TYPES[selectedTower.type];
      const range = config.range * (1 + (selectedTower.level - 1) * 0.13) * scale;
      const selectedPoint = this.projectTowerPoint(metrics, selectedTower.x, selectedTower.y);
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      ctx.strokeStyle = 'rgba(255,224,145,0.56)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(selectedPoint.x, selectedPoint.y, range, range * depthScale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    this.towerDefense.towers.forEach((tower) => {
      const point = this.projectTowerPoint(metrics, tower.x, tower.y);
      this.hitAreas[`towerSpot_${tower.id}`] = {
        x: point.x - 24,
        y: point.y - 30,
        width: 46,
        height: 54,
      };
    });

    const actors = this.towerDefense.towers
      .map((tower) => ({ kind: 'tower', worldY: tower.y, value: tower }))
      .concat(this.towerDefense.enemies.map((enemy) => ({
        kind: 'enemy',
        worldY: enemy.y,
        value: enemy,
      })))
      .concat(terrainProps.map((prop) => ({
        kind: 'prop',
        worldY: prop.y,
        value: prop,
      })))
      .sort((first, second) => first.worldY - second.worldY);

    actors.forEach((actor) => {
      const point = this.projectTowerPoint(metrics, actor.value.x, actor.value.y);
      if (actor.kind === 'prop') {
        this.drawTowerTerrainProp(metrics, actor.value);
      } else if (actor.kind === 'tower') {
        const tower = actor.value;
        const selected = tower.id === this.towerDefense.selectedTowerId;
        if (tower.type) {
          this.drawTowerIcon(point.x, point.y, Math.max(20, 56 * scale), tower.type, tower.level, selected);
        } else {
          this.drawTowerPad(point.x, point.y, Math.max(15, 38 * scale), selected);
        }
      } else {
        this.drawTowerEnemy(actor.value, point.x, point.y, scale);
      }
    });

    this.towerDefense.projectiles.forEach((projectile) => {
      const progress = 1 - projectile.life / projectile.maxLife;
      const projectileX = projectile.fromX + (projectile.toX - projectile.fromX) * progress;
      const projectileY = projectile.fromY + (projectile.toY - projectile.fromY) * progress;
      const projected = this.projectTowerPoint(metrics, projectileX, projectileY);
      const arcHeight = projectile.type === 'cannon' ? 28 : projectile.type === 'mage' ? 18 : 12;
      const lift = Math.sin(progress * Math.PI) * arcHeight;
      ctx.strokeStyle = projectile.color;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = projectile.type === 'cannon' ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(projected.x - 4, projected.y - lift + 4);
      ctx.lineTo(projected.x, projected.y - lift);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = projectile.color;
      ctx.beginPath();
      ctx.arc(projected.x, projected.y - lift, projectile.type === 'cannon' ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    this.towerDefense.particles.forEach((particle) => {
      const projected = this.projectTowerPoint(metrics, particle.x, particle.y);
      ctx.save();
      ctx.globalAlpha = particle.life / particle.maxLife;
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(projected.x, projected.y - (1 - particle.life / particle.maxLife) * 8, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
    ctx.restore();

    const badgeY = y + 10;
    this.drawTowerBadge(x + 10, badgeY, `❤ ${this.towerDefense.lives}`, '#F9788D');
    this.drawTowerBadge(x + 82, badgeY, `● ${this.towerDefense.gold}`, '#FFD166');
    this.drawTowerBadge(x + width - 90, badgeY, `${Math.min(this.towerDefense.waveIndex + 1, 6)} / 6`, '#AFC7FF');
  }

  drawTowerTerrainProp(metrics, prop) {
    const point = this.projectTowerPoint(metrics, prop.x, prop.y);
    const size = Math.max(8, 26 * metrics.scale) * prop.size;
    if (prop.type === 'rock') {
      ctx.fillStyle = 'rgba(9,24,25,0.32)';
      ctx.beginPath();
      ctx.ellipse(point.x + 2, point.y + 3, size * 0.72, size * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      const rockGradient = ctx.createLinearGradient(point.x, point.y - size, point.x, point.y + size * 0.4);
      rockGradient.addColorStop(0, '#8AA29A');
      rockGradient.addColorStop(1, '#526D68');
      ctx.fillStyle = rockGradient;
      ctx.beginPath();
      ctx.moveTo(point.x - size * 0.65, point.y);
      ctx.lineTo(point.x - size * 0.38, point.y - size * 0.72);
      ctx.lineTo(point.x + size * 0.25, point.y - size * 0.88);
      ctx.lineTo(point.x + size * 0.7, point.y - size * 0.12);
      ctx.lineTo(point.x + size * 0.36, point.y + size * 0.25);
      ctx.closePath();
      ctx.fill();
      return;
    }

    ctx.fillStyle = 'rgba(8,23,20,0.3)';
    ctx.beginPath();
    ctx.ellipse(point.x + 3, point.y + 3, size * 0.72, size * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#6B4D37';
    ctx.fillRect(point.x - size * 0.12, point.y - size * 0.62, size * 0.24, size * 0.7);
    const leafGradient = ctx.createLinearGradient(point.x, point.y - size * 1.8, point.x, point.y - size * 0.35);
    leafGradient.addColorStop(0, '#8BCB68');
    leafGradient.addColorStop(1, '#2F7651');
    ctx.fillStyle = leafGradient;
    ctx.beginPath();
    ctx.arc(point.x, point.y - size * 1.04, size * 0.7, 0, Math.PI * 2);
    ctx.arc(point.x - size * 0.4, point.y - size * 0.72, size * 0.5, 0, Math.PI * 2);
    ctx.arc(point.x + size * 0.42, point.y - size * 0.76, size * 0.48, 0, Math.PI * 2);
    ctx.fill();
  }

  drawTowerPad(centerX, centerY, radius, selected) {
    ctx.fillStyle = 'rgba(6,18,18,0.34)';
    ctx.beginPath();
    ctx.ellipse(centerX + 2, centerY + 5, radius * 1.08, radius * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = selected ? '#8B7545' : '#536B61';
    ctx.beginPath();
    ctx.ellipse(centerX, centerY + 3, radius, radius * 0.54, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = selected ? '#D8B963' : '#8DACA0';
    ctx.strokeStyle = selected ? '#FFE28A' : '#B7D3C7';
    ctx.lineWidth = selected ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, radius, radius * 0.54, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const plusRadius = radius * 0.33;
    ctx.strokeStyle = selected ? '#5B461C' : '#315348';
    ctx.lineWidth = Math.max(2, radius * 0.14);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(centerX - plusRadius, centerY);
    ctx.lineTo(centerX + plusRadius, centerY);
    ctx.moveTo(centerX, centerY - plusRadius * 0.58);
    ctx.lineTo(centerX, centerY + plusRadius * 0.58);
    ctx.stroke();
  }

  drawTowerBadge(x, y, text, color) {
    drawRoundedRect(ctx, x, y, 64, 25, 10, 'rgba(12,22,29,0.82)');
    ctx.fillStyle = color;
    ctx.font = '700 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 32, y + 13);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  drawTowerIcon(centerX, centerY, size, type, level, selected = false, showLevel = true) {
    const config = TOWER_TYPES[type];
    ctx.save();
    ctx.translate(centerX, centerY);

    ctx.fillStyle = 'rgba(5,14,17,0.38)';
    ctx.beginPath();
    ctx.ellipse(size * 0.08, size * 0.12, size * 0.58, size * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    if (selected) {
      ctx.strokeStyle = '#FFE28A';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(0, size * 0.03, size * 0.62, size * 0.29, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = '#374A48';
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.52, size * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#71877C';
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.08, size * 0.48, size * 0.23, 0, 0, Math.PI * 2);
    ctx.fill();

    if (type === 'archer') {
      const wallGradient = ctx.createLinearGradient(-size * 0.4, -size * 0.7, size * 0.38, 0);
      wallGradient.addColorStop(0, '#E0D4AA');
      wallGradient.addColorStop(1, '#8D886B');
      ctx.fillStyle = wallGradient;
      ctx.beginPath();
      ctx.moveTo(-size * 0.34, -size * 0.05);
      ctx.lineTo(-size * 0.27, -size * 0.66);
      ctx.lineTo(size * 0.27, -size * 0.66);
      ctx.lineTo(size * 0.36, -size * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#746E55';
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(-size * 0.04, -size * 0.62);
      ctx.lineTo(-size * 0.04, -size * 0.08);
      ctx.stroke();
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = Math.max(0.8, size * 0.035);
      ctx.beginPath();
      ctx.moveTo(-size * 0.27, -size * 0.25);
      ctx.lineTo(size * 0.31, -size * 0.25);
      ctx.moveTo(-size * 0.24, -size * 0.46);
      ctx.lineTo(size * 0.28, -size * 0.46);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#33453C';
      ctx.beginPath();
      ctx.ellipse(size * 0.14, -size * 0.34, size * 0.09, size * 0.15, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#426D58';
      ctx.beginPath();
      ctx.moveTo(-size * 0.45, -size * 0.58);
      ctx.lineTo(0, -size * 1.04);
      ctx.lineTo(size * 0.47, -size * 0.58);
      ctx.lineTo(size * 0.2, -size * 0.43);
      ctx.lineTo(-size * 0.26, -size * 0.43);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = config.color;
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.04);
      ctx.lineTo(size * 0.47, -size * 0.58);
      ctx.lineTo(size * 0.18, -size * 0.55);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#294D3C';
      ctx.lineWidth = Math.max(1, size * 0.045);
      ctx.beginPath();
      ctx.moveTo(-size * 0.34, -size * 0.58);
      ctx.lineTo(size * 0.33, -size * 0.58);
      ctx.stroke();

      ctx.strokeStyle = '#4D3425';
      ctx.lineWidth = Math.max(1.5, size * 0.06);
      ctx.beginPath();
      ctx.arc(0, -size * 0.57, size * 0.13, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -size * 0.7);
      ctx.lineTo(0, -size * 0.44);
      ctx.stroke();
    } else if (type === 'cannon') {
      ctx.fillStyle = '#8E5B38';
      ctx.beginPath();
      ctx.moveTo(-size * 0.42, -size * 0.08);
      ctx.lineTo(-size * 0.34, -size * 0.45);
      ctx.lineTo(size * 0.28, -size * 0.45);
      ctx.lineTo(size * 0.42, -size * 0.08);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#C58B54';
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(-size * 0.3, -size * 0.26);
      ctx.lineTo(size * 0.34, -size * 0.26);
      ctx.stroke();
      ctx.fillStyle = '#E7B46F';
      [-0.25, 0, 0.25].forEach((offset) => {
        ctx.beginPath();
        ctx.arc(size * offset, -size * 0.26, Math.max(1, size * 0.035), 0, Math.PI * 2);
        ctx.fill();
      });

      const cannonGradient = ctx.createLinearGradient(-size * 0.15, -size * 0.75, size * 0.45, -size * 0.3);
      cannonGradient.addColorStop(0, '#596874');
      cannonGradient.addColorStop(1, '#202B35');
      ctx.strokeStyle = cannonGradient;
      ctx.lineWidth = Math.max(5, size * 0.23);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-size * 0.12, -size * 0.42);
      ctx.lineTo(size * 0.42, -size * 0.72);
      ctx.stroke();
      ctx.fillStyle = '#161E25';
      ctx.beginPath();
      ctx.ellipse(size * 0.43, -size * 0.72, size * 0.13, size * 0.1, -0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#9AA9B3';
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.beginPath();
      ctx.moveTo(size * 0.18, -size * 0.6);
      ctx.lineTo(size * 0.28, -size * 0.65);
      ctx.stroke();
      ctx.fillStyle = '#46535F';
      ctx.beginPath();
      ctx.arc(-size * 0.22, -size * 0.06, size * 0.18, 0, Math.PI * 2);
      ctx.arc(size * 0.23, -size * 0.06, size * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#26323A';
      ctx.beginPath();
      ctx.arc(-size * 0.22, -size * 0.06, size * 0.08, 0, Math.PI * 2);
      ctx.arc(size * 0.23, -size * 0.06, size * 0.08, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#242D34';
      ctx.beginPath();
      ctx.arc(-size * 0.34, -size * 0.48, size * 0.09, 0, Math.PI * 2);
      ctx.arc(-size * 0.16, -size * 0.52, size * 0.08, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const towerGradient = ctx.createLinearGradient(-size * 0.38, -size * 0.8, size * 0.34, 0);
      towerGradient.addColorStop(0, '#9A82C8');
      towerGradient.addColorStop(1, '#4B3F78');
      ctx.fillStyle = towerGradient;
      ctx.beginPath();
      ctx.moveTo(-size * 0.34, -size * 0.04);
      ctx.lineTo(-size * 0.23, -size * 0.69);
      ctx.lineTo(size * 0.23, -size * 0.69);
      ctx.lineTo(size * 0.35, -size * 0.04);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#D5C7F0';
      ctx.beginPath();
      ctx.ellipse(0, -size * 0.65, size * 0.28, size * 0.13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#CAB7ED';
      ctx.lineWidth = Math.max(1, size * 0.04);
      ctx.beginPath();
      ctx.moveTo(-size * 0.22, -size * 0.43);
      ctx.lineTo(size * 0.22, -size * 0.43);
      ctx.moveTo(-size * 0.25, -size * 0.2);
      ctx.lineTo(size * 0.27, -size * 0.2);
      ctx.stroke();
      ctx.fillStyle = '#D7C7FF';
      ctx.beginPath();
      ctx.arc(0, -size * 0.34, size * 0.075, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.shadowColor = config.color;
      ctx.shadowBlur = size * 0.45;
      ctx.fillStyle = '#EDE4FF';
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.14);
      ctx.lineTo(size * 0.22, -size * 0.83);
      ctx.lineTo(0, -size * 0.56);
      ctx.lineTo(-size * 0.22, -size * 0.83);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = config.color;
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.08);
      ctx.lineTo(size * 0.16, -size * 0.83);
      ctx.lineTo(0, -size * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#FFFFFF';
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = Math.max(1, size * 0.035);
      ctx.beginPath();
      ctx.moveTo(0, -size * 1.05);
      ctx.lineTo(0, -size * 0.68);
      ctx.moveTo(-size * 0.13, -size * 0.83);
      ctx.lineTo(size * 0.13, -size * 0.83);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (showLevel) {
      this.drawTowerLevelDetails(size, type, level);
      drawRoundedRect(ctx, size * 0.22, -size * 1.03, size * 0.34, size * 0.28, size * 0.1, '#17242B');
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `800 ${Math.max(8, size * 0.2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(level), size * 0.39, -size * 0.89);
    }
    ctx.restore();
  }

  drawTowerLevelDetails(size, type, level) {
    if (level < 2) return;
    const accent = TOWER_TYPES[type].color;
    ctx.strokeStyle = '#E7D4A4';
    ctx.lineWidth = Math.max(1, size * 0.045);
    ctx.beginPath();
    ctx.moveTo(-size * 0.34, -size * 0.73);
    ctx.lineTo(-size * 0.34, -size * 1.18);
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(-size * 0.34, -size * 1.16);
    ctx.lineTo(-size * 0.02, -size * 1.04);
    ctx.lineTo(-size * 0.34, -size * 0.92);
    ctx.closePath();
    ctx.fill();
    if (level < 3) return;

    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = size * 0.25;
    ctx.fillStyle = '#FFF4B5';
    [-0.42, 0.42].forEach((offset) => {
      ctx.beginPath();
      ctx.moveTo(size * offset, -size * 0.32);
      ctx.lineTo(size * (offset - 0.08), -size * 0.48);
      ctx.lineTo(size * offset, -size * 0.66);
      ctx.lineTo(size * (offset + 0.08), -size * 0.48);
      ctx.closePath();
      ctx.fill();
    });
    ctx.restore();
  }

  drawTowerEnemy(enemy, centerX, centerY, scale) {
    const boss = enemy.type === 'boss';
    const size = Math.max(boss ? 17 : 11, (boss ? 38 : 25) * scale);
    const phase = Date.now() * 0.009 + enemy.id * 1.7;
    const bob = Math.sin(phase) * Math.max(0.8, size * 0.06);
    const pathStart = TOWER_LEVEL.path[enemy.segment] || TOWER_LEVEL.path[0];
    const pathEnd = TOWER_LEVEL.path[enemy.segment + 1] || pathStart;
    const facing = pathEnd.x < pathStart.x ? -1 : 1;

    ctx.fillStyle = 'rgba(5,13,15,0.38)';
    ctx.beginPath();
    ctx.ellipse(centerX + 2, centerY + 2, size * 0.72, size * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.translate(centerX, centerY - size * 0.88 + bob);
    ctx.scale(facing, 1);

    const legSwing = Math.sin(phase * 1.6) * size * 0.16;
    ctx.strokeStyle = enemy.type === 'guard' ? '#596A78' : '#543D4D';
    ctx.lineWidth = Math.max(2, size * 0.2);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-size * 0.24, size * 0.46);
    ctx.lineTo(-size * 0.3 + legSwing, size * 0.92);
    ctx.moveTo(size * 0.22, size * 0.46);
    ctx.lineTo(size * 0.3 - legSwing, size * 0.92);
    ctx.stroke();

    if (enemy.type === 'scout') this.drawScoutEnemy(size, enemy.hitFlash > 0);
    else if (enemy.type === 'runner') this.drawRunnerEnemy(size, enemy.hitFlash > 0, phase);
    else if (enemy.type === 'guard') this.drawGuardEnemy(size, enemy.hitFlash > 0);
    else this.drawBossEnemy(size, enemy.hitFlash > 0, phase);
    ctx.restore();

    this.drawTowerEnemyHealth(enemy, centerX, centerY - size * 1.92 + bob, size);
  }

  drawScoutEnemy(size, flashing) {
    ctx.fillStyle = flashing ? '#FFFFFF' : '#8ECF78';
    ctx.beginPath();
    ctx.moveTo(-size * 0.48, -size * 0.28);
    ctx.lineTo(-size * 0.86, -size * 0.46);
    ctx.lineTo(-size * 0.54, size * 0.02);
    ctx.lineTo(size * 0.54, size * 0.02);
    ctx.lineTo(size * 0.86, -size * 0.46);
    ctx.lineTo(size * 0.48, -size * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.58, size * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = flashing ? '#F7F7FF' : '#773D5A';
    ctx.beginPath();
    ctx.moveTo(-size * 0.62, -size * 0.2);
    ctx.quadraticCurveTo(0, -size * 0.9, size * 0.62, -size * 0.2);
    ctx.lineTo(size * 0.44, -size * 0.04);
    ctx.quadraticCurveTo(0, -size * 0.42, -size * 0.44, -size * 0.04);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#5A2E42';
    ctx.fillRect(-size * 0.5, size * 0.3, size, size * 0.16);
    ctx.fillStyle = '#D6B25D';
    ctx.fillRect(-size * 0.09, size * 0.28, size * 0.18, size * 0.2);
    ctx.strokeStyle = '#CBD8D2';
    ctx.lineWidth = Math.max(1.2, size * 0.08);
    ctx.beginPath();
    ctx.moveTo(size * 0.48, size * 0.18);
    ctx.lineTo(size * 0.78, size * 0.55);
    ctx.stroke();
    ctx.fillStyle = '#E4ECDF';
    ctx.beginPath();
    ctx.moveTo(size * 0.75, size * 0.51);
    ctx.lineTo(size * 0.94, size * 0.72);
    ctx.lineTo(size * 0.68, size * 0.62);
    ctx.closePath();
    ctx.fill();
    this.drawEnemyFace(size, '#26352B', '#FFE88A');
    ctx.fillStyle = '#68A95D';
    ctx.beginPath();
    ctx.ellipse(size * 0.04, size * 0.13, size * 0.13, size * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  drawRunnerEnemy(size, flashing, phase) {
    ctx.fillStyle = flashing ? '#FFFFFF' : '#F4B94E';
    ctx.beginPath();
    ctx.moveTo(-size * 0.5, -size * 0.28);
    ctx.lineTo(-size * 0.36, -size * 0.92);
    ctx.lineTo(-size * 0.05, -size * 0.55);
    ctx.lineTo(size * 0.36, -size * 0.92);
    ctx.lineTo(size * 0.52, -size * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.55, size * 0.63, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flashing ? '#FFFFFF' : '#FFE19B';
    ctx.beginPath();
    ctx.ellipse(size * 0.22, size * 0.15, size * 0.34, size * 0.23, -0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = flashing ? '#FFFFFF' : '#FFEAB8';
    ctx.beginPath();
    ctx.moveTo(-size * 0.3, size * 0.32);
    ctx.lineTo(0, size * 0.62);
    ctx.lineTo(size * 0.32, size * 0.32);
    ctx.lineTo(0, size * 0.45);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = flashing ? '#FFFFFF' : '#F36F81';
    ctx.lineWidth = Math.max(2, size * 0.2);
    ctx.beginPath();
    ctx.moveTo(-size * 0.42, size * 0.35);
    ctx.quadraticCurveTo(-size * 0.9, size * (0.28 + Math.sin(phase) * 0.12), -size * 1.02, size * 0.02);
    ctx.stroke();
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.beginPath();
    ctx.moveTo(-size * 1.18, -size * 0.1);
    ctx.lineTo(-size * 0.78, -size * 0.1);
    ctx.moveTo(-size * 1.08, size * 0.16);
    ctx.lineTo(-size * 0.72, size * 0.16);
    ctx.stroke();
    ctx.globalAlpha = 1;
    this.drawEnemyFace(size, '#4A321C', '#FFFFFF');
    ctx.fillStyle = '#5C361D';
    ctx.beginPath();
    ctx.arc(size * 0.46, size * 0.08, size * 0.08, 0, Math.PI * 2);
    ctx.fill();
  }

  drawGuardEnemy(size, flashing) {
    ctx.fillStyle = flashing ? '#FFFFFF' : '#8BA5B8';
    ctx.beginPath();
    ctx.ellipse(0, size * 0.08, size * 0.62, size * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = flashing ? '#FFFFFF' : '#526779';
    ctx.beginPath();
    ctx.arc(0, -size * 0.12, size * 0.62, Math.PI, Math.PI * 2);
    ctx.lineTo(size * 0.52, size * 0.14);
    ctx.lineTo(-size * 0.52, size * 0.14);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#263640';
    ctx.fillRect(-size * 0.46, -size * 0.22, size * 0.92, size * 0.12);
    ctx.fillStyle = '#A9BEC9';
    for (let slit = -1; slit <= 1; slit++) {
      ctx.fillRect(slit * size * 0.2 - size * 0.025, -size * 0.2, size * 0.05, size * 0.09);
    }
    ctx.fillStyle = '#C7D5DD';
    ctx.fillRect(-size * 0.06, -size * 0.72, size * 0.12, size * 0.45);
    ctx.strokeStyle = '#667D8A';
    ctx.lineWidth = Math.max(1, size * 0.07);
    ctx.beginPath();
    ctx.moveTo(-size * 0.38, size * 0.23);
    ctx.lineTo(size * 0.38, size * 0.23);
    ctx.moveTo(-size * 0.3, size * 0.48);
    ctx.lineTo(size * 0.3, size * 0.48);
    ctx.stroke();

    ctx.fillStyle = flashing ? '#FFFFFF' : '#526779';
    ctx.strokeStyle = '#D5E1E6';
    ctx.lineWidth = Math.max(1.5, size * 0.1);
    ctx.beginPath();
    ctx.arc(-size * 0.58, size * 0.26, size * 0.38, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#9FD4FF';
    ctx.beginPath();
    ctx.moveTo(-size * 0.58, size * 0.02);
    ctx.lineTo(-size * 0.4, size * 0.25);
    ctx.lineTo(-size * 0.58, size * 0.5);
    ctx.lineTo(-size * 0.76, size * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#E9F1F4';
    [-0.74, -0.58, -0.42].forEach((offset) => {
      ctx.beginPath();
      ctx.arc(size * offset, size * 0.25, Math.max(1, size * 0.035), 0, Math.PI * 2);
      ctx.fill();
    });
    this.drawEnemyFace(size, '#26343E', '#FFDA68');
  }

  drawBossEnemy(size, flashing, phase) {
    ctx.fillStyle = flashing ? '#FFFFFF' : '#A45AC8';
    ctx.beginPath();
    ctx.ellipse(0, size * 0.08, size * 0.72, size * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();
    const armorGradient = ctx.createLinearGradient(-size * 0.55, size * 0.05, size * 0.55, size * 0.62);
    armorGradient.addColorStop(0, flashing ? '#FFFFFF' : '#7C3E98');
    armorGradient.addColorStop(1, flashing ? '#FFFFFF' : '#4E2863');
    ctx.fillStyle = armorGradient;
    ctx.beginPath();
    ctx.moveTo(-size * 0.58, size * 0.2);
    ctx.lineTo(-size * 0.34, size * 0.66);
    ctx.lineTo(size * 0.34, size * 0.66);
    ctx.lineTo(size * 0.58, size * 0.2);
    ctx.lineTo(size * 0.35, size * 0.34);
    ctx.lineTo(-size * 0.35, size * 0.34);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#D7A94E';
    ctx.beginPath();
    ctx.arc(0, size * 0.43, size * 0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = flashing ? '#FFFFFF' : '#E5C9A1';
    ctx.beginPath();
    ctx.moveTo(-size * 0.48, -size * 0.42);
    ctx.quadraticCurveTo(-size * 1.02, -size * 1.06, -size * 0.84, -size * 0.08);
    ctx.lineTo(-size * 0.5, -size * 0.2);
    ctx.moveTo(size * 0.48, -size * 0.42);
    ctx.quadraticCurveTo(size * 1.02, -size * 1.06, size * 0.84, -size * 0.08);
    ctx.lineTo(size * 0.5, -size * 0.2);
    ctx.fill();
    ctx.strokeStyle = flashing ? '#FFFFFF' : '#6D397F';
    ctx.lineWidth = Math.max(2, size * 0.14);
    ctx.beginPath();
    ctx.moveTo(-size * 0.62, size * 0.24);
    ctx.lineTo(-size * (0.9 + Math.sin(phase) * 0.04), size * 0.5);
    ctx.moveTo(size * 0.62, size * 0.24);
    ctx.lineTo(size * (0.9 + Math.sin(phase) * 0.04), size * 0.5);
    ctx.stroke();
    ctx.fillStyle = flashing ? '#FFFFFF' : '#D2A6DE';
    ctx.beginPath();
    ctx.arc(-size * 0.74, size * 0.34, size * 0.18, 0, Math.PI * 2);
    ctx.arc(size * 0.74, size * 0.34, size * 0.18, 0, Math.PI * 2);
    ctx.fill();
    this.drawEnemyFace(size, '#321D3A', '#FFEF78', true);
    ctx.fillStyle = '#F4E7D1';
    ctx.beginPath();
    ctx.moveTo(-size * 0.18, size * 0.3);
    ctx.lineTo(-size * 0.05, size * 0.55);
    ctx.lineTo(size * 0.04, size * 0.3);
    ctx.moveTo(size * 0.08, size * 0.3);
    ctx.lineTo(size * 0.2, size * 0.52);
    ctx.lineTo(size * 0.27, size * 0.27);
    ctx.fill();
  }

  drawEnemyFace(size, eyeColor, pupilColor, angry = false) {
    const eyeY = -size * 0.06;
    ctx.strokeStyle = eyeColor;
    ctx.lineWidth = Math.max(1.3, size * 0.1);
    if (angry) {
      ctx.beginPath();
      ctx.moveTo(-size * 0.4, eyeY - size * 0.2);
      ctx.lineTo(-size * 0.12, eyeY - size * 0.1);
      ctx.moveTo(size * 0.4, eyeY - size * 0.2);
      ctx.lineTo(size * 0.12, eyeY - size * 0.1);
      ctx.stroke();
    }
    ctx.fillStyle = pupilColor;
    ctx.beginPath();
    ctx.ellipse(-size * 0.22, eyeY, size * 0.11, size * 0.15, 0, 0, Math.PI * 2);
    ctx.ellipse(size * 0.22, eyeY, size * 0.11, size * 0.15, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = eyeColor;
    ctx.beginPath();
    ctx.arc(-size * 0.18, eyeY, Math.max(1, size * 0.045), 0, Math.PI * 2);
    ctx.arc(size * 0.26, eyeY, Math.max(1, size * 0.045), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = eyeColor;
    ctx.lineWidth = Math.max(1.2, size * 0.08);
    ctx.beginPath();
    ctx.moveTo(-size * 0.18, size * 0.3);
    ctx.quadraticCurveTo(0, size * 0.42, size * 0.2, size * 0.27);
    ctx.stroke();
  }

  drawTowerEnemyHealth(enemy, centerX, y, size) {
    const healthRatio = Math.max(0, enemy.health / enemy.maxHealth);
    const barWidth = Math.max(enemy.type === 'boss' ? 34 : 25, size * 2.25);
    const barHeight = enemy.type === 'boss' ? 5 : 4;
    drawRoundedRect(ctx, centerX - barWidth / 2 - 1, y - 1, barWidth + 2, barHeight + 2, 3, 'rgba(9,18,18,0.82)');
    const healthColor = healthRatio > 0.55 ? '#63E69B' : healthRatio > 0.25 ? '#FFD166' : '#FF6F88';
    if (healthRatio > 0) {
      drawRoundedRect(ctx, centerX - barWidth / 2, y, barWidth * healthRatio, barHeight, 2, healthColor);
    }
    if (enemy.type === 'guard') {
      ctx.fillStyle = '#BFD4E0';
      ctx.font = '700 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('盾', centerX + barWidth / 2 + 7, y + 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  drawTowerControls(metrics) {
    const panelX = 12;
    const panelY = metrics.y + metrics.height + 12;
    const panelWidth = SCREEN_WIDTH - 24;
    const availableHeight = SCREEN_HEIGHT - panelY - 14;
    const panelHeight = Math.max(142, Math.min(190, availableHeight));
    const panelGradient = ctx.createLinearGradient(panelX, panelY, panelX, panelY + panelHeight);
    panelGradient.addColorStop(0, '#293153');
    panelGradient.addColorStop(1, '#1C223E');
    drawRoundedRect(ctx, panelX, panelY + 4, panelWidth, panelHeight, 22, '#11162B');
    drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 22, panelGradient);

    const tower = this.towerDefense.getSelectedTower();
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 16px sans-serif';
    ctx.fillText(tower ? (tower.type ? `${TOWER_TYPES[tower.type].name} · ${tower.level}级` : '选择防御塔') : '点击圆形塔位开始建造', panelX + 16, panelY + 26);

    if (tower && !tower.type) {
      const types = Object.keys(TOWER_TYPES);
      const gap = 8;
      const buttonWidth = (panelWidth - 32 - gap * 2) / 3;
      types.forEach((type, index) => {
        const config = TOWER_TYPES[type];
        const buttonX = panelX + 16 + index * (buttonWidth + gap);
        const affordable = this.towerDefense.gold >= config.cost;
        this.hitAreas[`build_${type}`] = {
          x: buttonX,
          y: panelY + 38,
          width: buttonWidth,
          height: 58,
        };
        drawRoundedRect(ctx, buttonX, panelY + 41, buttonWidth, 58, 14, '#171C32');
        const cardGradient = ctx.createLinearGradient(buttonX, panelY + 38, buttonX, panelY + 96);
        cardGradient.addColorStop(0, affordable ? '#3B456B' : '#292E45');
        cardGradient.addColorStop(1, affordable ? '#29314F' : '#22263A');
        drawRoundedRect(ctx, buttonX, panelY + 38, buttonWidth, 58, 14, cardGradient);
        this.drawTowerIcon(buttonX + 22, panelY + 82, 16, type, 1, false, false);
        ctx.fillStyle = affordable ? config.color : '#697087';
        ctx.font = '800 14px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(config.name, buttonX + 43, panelY + 60);
        ctx.fillStyle = affordable ? '#FFFFFF' : '#697087';
        ctx.font = '11px sans-serif';
        ctx.fillText(`${config.cost} 金币`, buttonX + 43, panelY + 82);
      });
      ctx.textAlign = 'left';
    } else if (tower && tower.type) {
      const upgradeCost = this.towerDefense.getUpgradeCost(tower);
      this.hitAreas.upgradeTower = { x: panelX + 16, y: panelY + 38, width: panelWidth * 0.58, height: 54 };
      this.hitAreas.sellTower = { x: panelX + panelWidth * 0.62, y: panelY + 38, width: panelWidth * 0.32, height: 54 };
      drawRoundedRect(ctx, panelX + 16, panelY + 38, panelWidth * 0.58, 54, 14, upgradeCost ? '#7457FF' : '#363B50');
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '700 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(upgradeCost ? `升级 · ${upgradeCost} 金币` : '已满级', panelX + 16 + panelWidth * 0.29, panelY + 70);
      drawRoundedRect(ctx, panelX + panelWidth * 0.62, panelY + 38, panelWidth * 0.32, 54, 14, '#343A51');
      ctx.fillStyle = '#FF9AAE';
      ctx.fillText('出售', panelX + panelWidth * 0.78, panelY + 70);
      ctx.textAlign = 'left';
    } else {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '13px sans-serif';
      ctx.fillText('箭塔攻速快 · 炮塔范围伤害 · 法师无视护甲', panelX + 16, panelY + 56);
    }

    const waveY = panelY + panelHeight - 48;
    this.hitAreas.waveButton = { x: panelX + 16, y: waveY, width: panelWidth - 32, height: 36 };
    const canStart = !this.towerDefense.waveActive && this.towerDefense.waveIndex < TOWER_LEVEL.totalWaves;
    drawRoundedRect(ctx, panelX + 16, waveY, panelWidth - 32, 36, 16, canStart ? '#54D3A3' : '#353C55');
    ctx.fillStyle = canStart ? '#123B32' : COLORS.subtext;
    ctx.font = '800 14px sans-serif';
    ctx.textAlign = 'center';
    const label = this.towerDefense.waveActive
      ? `第 ${this.towerDefense.waveIndex + 1} 波战斗中`
      : `开始第 ${Math.min(this.towerDefense.waveIndex + 1, TOWER_LEVEL.totalWaves)} 波`;
    ctx.fillText(label, SCREEN_WIDTH / 2, waveY + 23);
    ctx.textAlign = 'left';
  }

  drawTowerResultOverlay() {
    ctx.fillStyle = 'rgba(7,10,25,0.78)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    const width = Math.min(SCREEN_WIDTH - 42, 340);
    const height = 238;
    const x = (SCREEN_WIDTH - width) / 2;
    const y = (SCREEN_HEIGHT - height) / 2;
    drawRoundedRect(ctx, x, y, width, height, 26, '#252B4C');
    const won = this.towerDefense.status === 'won';
    ctx.fillStyle = won ? '#FFD166' : '#FF7892';
    ctx.font = '800 27px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(won ? '关卡胜利！' : '防线失守', SCREEN_WIDTH / 2, y + 48);
    if (won) this.drawStars(SCREEN_WIDTH / 2, y + 87, this.towerDefense.starsEarned, 28);
    ctx.fillStyle = COLORS.subtext;
    ctx.font = '13px sans-serif';
    ctx.fillText(won ? `剩余 ${this.towerDefense.lives} 点生命 · 得分 ${this.towerDefense.score}` : '调整塔的位置和升级顺序再试试', SCREEN_WIDTH / 2, y + 126);

    this.hitAreas.tdOverlayAction = { x: x + 18, y: y + 154, width: (width - 48) / 2, height: 48 };
    this.hitAreas.tdMapAction = { x: x + 30 + (width - 48) / 2, y: y + 154, width: (width - 48) / 2, height: 48 };
    drawRoundedRect(ctx, x + 18, y + 154, (width - 48) / 2, 48, 16, '#7457FF');
    drawRoundedRect(ctx, x + 30 + (width - 48) / 2, y + 154, (width - 48) / 2, 48, 16, '#343A58');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 14px sans-serif';
    ctx.fillText('再来一次', x + 18 + (width - 48) / 4, y + 184);
    ctx.fillText('返回地图', x + 30 + (width - 48) * 0.75, y + 184);
    ctx.textAlign = 'left';
  }

  render2048() {
    this.drawBackground();
    this.hitAreas = {};

    const width = SCREEN_WIDTH;
    const top = Math.max(48, GameGlobal.safeArea.top + 18);
    const side = 18;

    this.hitAreas.back = { x: 14, y: top - 18, width: 48, height: 44 };
    drawRoundedRect(ctx, 18, top - 14, 38, 38, 14, COLORS.panel);
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(41, top - 2);
    ctx.lineTo(32, top + 5);
    ctx.lineTo(41, top + 12);
    ctx.stroke();

    ctx.fillStyle = COLORS.text;
    ctx.font = '800 23px sans-serif';
    ctx.fillText('2048', 70, top + 12);

    const resetWidth = 76;
    this.hitAreas.reset = { x: width - resetWidth - 18, y: top - 14, width: resetWidth, height: 38 };
    drawRoundedRect(ctx, width - resetWidth - 18, top - 14, resetWidth, 38, 15, COLORS.panel);
    ctx.fillStyle = COLORS.subtext;
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('重新开局', width - resetWidth / 2 - 18, top + 10);
    ctx.textAlign = 'left';

    const statsY = top + 54;
    const statGap = 12;
    const statWidth = (width - side * 2 - statGap) / 2;
    this.drawStat(side, statsY, statWidth, '当前分数', String(this.game2048.score), '#FFB85C');
    this.drawStat(side + statWidth + statGap, statsY, statWidth, '最佳成绩', String(this.game2048.bestScore), '#62D9B0');

    const boardWidth = Math.min(width - side * 2, 396);
    const boardX = Math.round((width - boardWidth) / 2);
    const boardY = statsY + 116;

    ctx.fillStyle = COLORS.subtext;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('滑动方块，让相同数字合并', width / 2, boardY - 24);
    ctx.textAlign = 'left';

    this.draw2048Board(boardX, boardY, boardWidth);

    ctx.fillStyle = COLORS.muted;
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      this.game2048.hasWon ? '已达成 2048 · 继续挑战更高分' : '合成 2048 后仍可继续挑战高分',
      width / 2,
      boardY + boardWidth + 28,
    );
    ctx.textAlign = 'left';

    const effectAge = this.game2048Animation
      ? Date.now() - this.game2048Animation.startTime
      : Infinity;
    if (this.game2048.status !== 'playing' && effectAge > 430) this.draw2048ResultOverlay();
  }

  draw2048Board(x, y, size) {
    const slideDuration = 140;
    let effect = this.game2048Animation;
    const elapsed = effect ? Date.now() - effect.startTime : Infinity;
    if (effect && elapsed > 650) {
      this.game2048Animation = null;
      effect = null;
    }

    const padding = 10;
    const gap = 8;
    const tileSize = (size - padding * 2 - gap * 3) / 4;
    drawRoundedRect(ctx, x, y, size, size, 22, '#202646');

    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const tileX = x + padding + col * (tileSize + gap);
        const tileY = y + padding + row * (tileSize + gap);
        this.draw2048Tile(tileX, tileY, tileSize, 0);
      }
    }

    const isSliding = effect && elapsed < slideDuration && effect.tileMoves.length;
    if (isSliding) {
      const progress = Math.min(1, elapsed / slideDuration);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      effect.tileMoves.forEach((move) => {
        const fromX = x + padding + move.from.col * (tileSize + gap);
        const fromY = y + padding + move.from.row * (tileSize + gap);
        const toX = x + padding + move.to.col * (tileSize + gap);
        const toY = y + padding + move.to.row * (tileSize + gap);
        const tileX = fromX + (toX - fromX) * easedProgress;
        const tileY = fromY + (toY - fromY) * easedProgress;
        this.draw2048Tile(tileX, tileY, tileSize, move.value);
      });
      return;
    }

    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const value = this.game2048.grid[row][col];
        const tileX = x + padding + col * (tileSize + gap);
        const tileY = y + padding + row * (tileSize + gap);
        let scale = 1;

        if (effect) {
          const settleElapsed = elapsed - slideDuration;
          const merged = effect.mergedCells.some((cell) => cell.row === row && cell.col === col);
          const isNew = effect.newTile && effect.newTile.row === row && effect.newTile.col === col;
          if (merged && settleElapsed >= 0 && settleElapsed < 220) {
            scale = 1 + Math.sin((settleElapsed / 220) * Math.PI) * 0.16;
          } else if (isNew && settleElapsed >= 0 && settleElapsed < 190) {
            const progress = Math.min(1, settleElapsed / 190);
            scale = 0.4 + 0.6 * (1 - Math.pow(1 - progress, 3));
          }
        }

        const renderSize = tileSize * scale;
        const offset = (tileSize - renderSize) / 2;
        this.draw2048Tile(tileX + offset, tileY + offset, renderSize, value);
      }
    }
  }

  draw2048Tile(x, y, size, value) {
    const tileColors = {
      0: '#30375B',
      2: '#EEE4DA',
      4: '#EDE0C8',
      8: '#F2B179',
      16: '#F59563',
      32: '#F67C5F',
      64: '#F65E3B',
      128: '#EDCF72',
      256: '#EDCC61',
      512: '#EDC850',
      1024: '#EDC53F',
      2048: '#EDC22E',
    };
    const fill = tileColors[value] || '#7B63F4';
    drawRoundedRect(ctx, x, y, size, size, Math.max(10, size * 0.14), fill);
    if (!value) return;

    const digits = String(value).length;
    const fontSize = Math.floor(size * (digits <= 2 ? 0.42 : digits === 3 ? 0.34 : 0.27));
    ctx.fillStyle = value <= 4 ? '#776E65' : '#FFFFFF';
    ctx.font = `800 ${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x + size / 2, y + size / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  draw2048ResultOverlay() {
    const width = SCREEN_WIDTH;
    const height = SCREEN_HEIGHT;
    const won = this.game2048.status === 'won';
    ctx.fillStyle = 'rgba(8, 11, 29, 0.74)';
    ctx.fillRect(0, 0, width, height);

    const modalWidth = Math.min(width - 44, 330);
    const modalHeight = 250;
    const x = (width - modalWidth) / 2;
    const y = (height - modalHeight) / 2;
    drawRoundedRect(ctx, x, y, modalWidth, modalHeight, 28, '#202646');
    drawRoundedRect(ctx, width / 2 - 34, y + 26, 68, 68, 20, won ? '#EDC22E' : '#FF6688');

    ctx.fillStyle = '#FFFFFF';
    ctx.font = won ? '800 18px sans-serif' : '800 25px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(won ? '2048' : '×', width / 2, y + 60);
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = COLORS.text;
    ctx.font = '800 26px sans-serif';
    ctx.fillText(won ? '挑战成功！' : '没有可移动方块', width / 2, y + 132);
    ctx.fillStyle = COLORS.subtext;
    ctx.font = '14px sans-serif';
    ctx.fillText(won ? `当前得分 ${this.game2048.score}` : `最终得分 ${this.game2048.score}`, width / 2, y + 158);

    this.hitAreas.overlayAction = { x: x + 24, y: y + 181, width: modalWidth - 48, height: 48 };
    drawRoundedRect(ctx, x + 24, y + 181, modalWidth - 48, 48, 17, won ? '#EDC22E' : '#7457FF');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 15px sans-serif';
    ctx.fillText(won ? '继续挑战' : '再来一局', width / 2, y + 211);
    ctx.textAlign = 'left';
  }

  renderMinesweeper() {
    this.drawBackground();
    this.hitAreas = {};

    const width = SCREEN_WIDTH;
    const top = Math.max(48, GameGlobal.safeArea.top + 18);
    const side = 18;

    this.hitAreas.back = { x: 14, y: top - 18, width: 48, height: 44 };
    drawRoundedRect(ctx, 18, top - 14, 38, 38, 14, COLORS.panel);
    ctx.strokeStyle = COLORS.text;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(41, top - 2);
    ctx.lineTo(32, top + 5);
    ctx.lineTo(41, top + 12);
    ctx.stroke();

    ctx.fillStyle = COLORS.text;
    ctx.font = '800 23px sans-serif';
    ctx.fillText('扫雷', 70, top + 12);

    const leaderboardWidth = 82;
    const leaderboardX = 126;
    this.hitAreas.leaderboard = {
      x: leaderboardX - 8,
      y: top - 18,
      width: leaderboardWidth + 16,
      height: 46,
    };
    drawRoundedRect(ctx, leaderboardX, top - 14, leaderboardWidth, 38, 14, COLORS.panel);
    ctx.fillStyle = '#FFD166';
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('排行榜', leaderboardX + leaderboardWidth / 2, top + 10);
    ctx.textAlign = 'left';

    const difficultyY = top + 42;
    const resetWidth = 68;
    const zoomWidth = 58;
    const controlGap = 7;
    const difficultyWidth = width - side * 2 - resetWidth - zoomWidth - controlGap * 2;
    const zoomX = side + difficultyWidth + controlGap;
    const resetX = zoomX + zoomWidth + controlGap;

    this.drawDifficultySelector(side, difficultyY, difficultyWidth, 38);

    this.hitAreas.zoom = { x: zoomX, y: difficultyY, width: zoomWidth, height: 38 };
    drawRoundedRect(ctx, zoomX, difficultyY, zoomWidth, 38, 15, COLORS.panel);
    ctx.fillStyle = this.mineViewport.zoomed ? '#FFD166' : COLORS.subtext;
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.mineViewport.zoomed ? '缩小' : '放大', zoomX + zoomWidth / 2, difficultyY + 24);

    this.hitAreas.reset = { x: resetX, y: difficultyY, width: resetWidth, height: 38 };
    drawRoundedRect(ctx, resetX, difficultyY, resetWidth, 38, 15, COLORS.panel);
    ctx.fillStyle = COLORS.subtext;
    ctx.font = '700 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('重开', resetX + resetWidth / 2, difficultyY + 24);
    ctx.textAlign = 'left';

    const statsY = difficultyY + 48;
    const statGap = 10;
    const statWidth = (width - side * 2 - statGap * 2) / 3;
    this.drawStat(side, statsY, statWidth, '剩余雷区', String(this.minesweeper.minesLeft), '#FF6F91');
    this.drawStat(side + statWidth + statGap, statsY, statWidth, '用时', this.formatTime(), '#FFD166');
    this.drawStat(side + (statWidth + statGap) * 2, statsY, statWidth, '最佳', this.formatBest(), '#62D9B0');

    const boardTop = statsY + 78;
    const boardWidth = Math.min(width - side * 2, 396);
    const cellSize = this.getMineCellSize(boardWidth);
    const contentWidth = cellSize * this.minesweeper.cols;
    const contentHeight = cellSize * this.minesweeper.rows;
    const maxOffsetX = Math.max(0, contentWidth - boardWidth);
    const maxOffsetY = Math.max(0, contentHeight - boardWidth);
    this.mineViewport.offsetX = Math.max(0, Math.min(maxOffsetX, this.mineViewport.offsetX));
    this.mineViewport.offsetY = Math.max(0, Math.min(maxOffsetY, this.mineViewport.offsetY));
    const insetX = Math.max(0, (boardWidth - contentWidth) / 2);
    const insetY = Math.max(0, (boardWidth - contentHeight) / 2);
    const boardX = Math.round((width - boardWidth) / 2);
    const boardY = boardTop;

    this.hitAreas.board = {
      x: boardX,
      y: boardY,
      width: boardWidth,
      height: boardWidth,
      cellSize,
      insetX,
      insetY,
      maxOffsetX,
      maxOffsetY,
    };

    drawRoundedRect(ctx, boardX - 5, boardY - 5, boardWidth + 10, boardWidth + 10, 18, '#161B39');
    ctx.save();
    ctx.beginPath();
    ctx.rect(boardX, boardY, boardWidth, boardWidth);
    ctx.clip();
    this.drawBoard(
      boardX + insetX - this.mineViewport.offsetX,
      boardY + insetY - this.mineViewport.offsetY,
      cellSize,
    );
    this.drawMineCellEffects(
      boardX + insetX - this.mineViewport.offsetX,
      boardY + insetY - this.mineViewport.offsetY,
      cellSize,
    );
    ctx.restore();
    this.drawMineNavigation(boardX, boardY, boardWidth, maxOffsetX, maxOffsetY);

    const tipY = boardY + boardWidth + 28;
    ctx.fillStyle = COLORS.subtext;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('轻触翻开 · 长按切换旗子 / 问号', width / 2, tipY);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '12px sans-serif';
    ctx.fillText('按住空白已开格拖动棋盘 · 点击数字快速展开', width / 2, tipY + 24);
    ctx.textAlign = 'left';

    if (this.magnifier) this.drawMagnifier();

    const resultReady = !this.mineResultReadyAt || Date.now() >= this.mineResultReadyAt;
    if (resultReady && (this.minesweeper.status === 'won' || this.minesweeper.status === 'lost')) {
      this.drawResultOverlay();
    }
    if (this.showMineLeaderboard) this.drawMineLeaderboard();
  }

  drawMineNavigation(x, y, size, maxOffsetX, maxOffsetY) {
    const buttonSize = 38;
    const centerOffset = (size - buttonSize) / 2;
    const canMoveLeft = this.mineViewport.offsetX > 0.5;
    const canMoveRight = this.mineViewport.offsetX < maxOffsetX - 0.5;
    const canMoveUp = this.mineViewport.offsetY > 0.5;
    const canMoveDown = this.mineViewport.offsetY < maxOffsetY - 0.5;

    if (canMoveLeft) this.drawMinePanButton('panLeft', x + 5, y + centerOffset, 'left');
    if (canMoveRight) this.drawMinePanButton('panRight', x + size - buttonSize - 5, y + centerOffset, 'right');
    if (canMoveUp) this.drawMinePanButton('panUp', x + centerOffset, y + 5, 'up');
    if (canMoveDown) this.drawMinePanButton('panDown', x + centerOffset, y + size - buttonSize - 5, 'down');
  }

  drawMinePanButton(key, x, y, direction) {
    const size = 38;
    this.hitAreas[key] = { x, y, width: size, height: size };

    ctx.save();
    ctx.globalAlpha = 0.94;
    drawRoundedRect(ctx, x, y, size, size, 14, '#11162F');
    ctx.restore();

    const centerX = x + size / 2;
    const centerY = y + size / 2;
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    if (direction === 'left') {
      ctx.moveTo(centerX - 6, centerY);
      ctx.lineTo(centerX + 4, centerY - 7);
      ctx.lineTo(centerX + 4, centerY + 7);
    } else if (direction === 'right') {
      ctx.moveTo(centerX + 6, centerY);
      ctx.lineTo(centerX - 4, centerY - 7);
      ctx.lineTo(centerX - 4, centerY + 7);
    } else if (direction === 'up') {
      ctx.moveTo(centerX, centerY - 6);
      ctx.lineTo(centerX - 7, centerY + 4);
      ctx.lineTo(centerX + 7, centerY + 4);
    } else {
      ctx.moveTo(centerX, centerY + 6);
      ctx.lineTo(centerX - 7, centerY - 4);
      ctx.lineTo(centerX + 7, centerY - 4);
    }
    ctx.closePath();
    ctx.fill();
  }

  drawStat(x, y, width, label, value, accent) {
    drawRoundedRect(ctx, x, y, width, 70, 18, COLORS.panel);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '12px sans-serif';
    ctx.fillText(label, x + 13, y + 22);
    ctx.fillStyle = accent;
    ctx.font = `800 ${String(value).length > 7 ? 16 : 22}px sans-serif`;
    ctx.fillText(value, x + 13, y + 52);
  }

  drawDifficultySelector(x, y, width, height) {
    const difficultyKeys = Object.keys(DIFFICULTIES);
    const segmentWidth = width / difficultyKeys.length;
    drawRoundedRect(ctx, x, y, width, height, 15, '#202646');

    difficultyKeys.forEach((key, index) => {
      const segmentX = x + index * segmentWidth;
      const selected = this.minesweeper.difficulty === key;
      this.hitAreas[`difficulty_${key}`] = {
        x: segmentX,
        y,
        width: segmentWidth,
        height,
      };

      if (selected) {
        drawRoundedRect(ctx, segmentX + 3, y + 3, segmentWidth - 6, height - 6, 12, '#7457FF');
      }

      ctx.fillStyle = selected ? '#FFFFFF' : COLORS.subtext;
      ctx.font = `${selected ? '700' : '600'} 13px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(DIFFICULTIES[key].label, segmentX + segmentWidth / 2, y + height / 2 + 1);
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  drawBoard(boardX, boardY, cellSize) {
    const colors = ['#8A93A8', '#6C8CFF', '#47C9A2', '#FFB84D', '#F26D86', '#A980FF', '#4FC3E8', '#F18ED0', '#FFFFFF'];
    const gap = Math.max(2, Math.floor(cellSize * 0.08));
    const radius = Math.max(5, Math.floor(cellSize * 0.18));

    for (let row = 0; row < this.minesweeper.rows; row++) {
      for (let col = 0; col < this.minesweeper.cols; col++) {
        const cell = this.minesweeper.board[row][col];
        const x = boardX + col * cellSize + gap / 2;
        const y = boardY + row * cellSize + gap / 2;
        const size = cellSize - gap;

        if (cell.revealed) {
          drawRoundedRect(ctx, x, y, size, size, radius, cell.mine ? '#FF6688' : '#242A4C');
          if (cell.mine) {
            drawMine(ctx, x + size / 2, y + size / 2, size * 0.25, '#FFFFFF', '#FF6688');
          } else if (cell.adjacent > 0) {
            ctx.fillStyle = colors[cell.adjacent];
            ctx.font = `800 ${Math.floor(cellSize * 0.48)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(cell.adjacent), x + size / 2, y + size / 2 + 1);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
          }
        } else {
          const isPressed = this.pressedCells[`${row}:${col}`];
          const fill = ctx.createLinearGradient(x, y, x + size, y + size);
          fill.addColorStop(0, isPressed ? '#9B8AF8' : '#7B63F4');
          fill.addColorStop(1, isPressed ? '#8068E8' : '#6548D7');
          drawRoundedRect(ctx, x, y, size, size, radius, fill);
          if (cell.flagged) this.drawFlag(x, y, size);
          else if (cell.questioned) this.drawQuestion(x, y, size);
        }
      }
    }
  }

  drawMineCellEffects(boardX, boardY, cellSize) {
    if (!this.mineAnimations.length) return;
    const now = Date.now();
    const activeAnimations = [];

    this.mineAnimations.forEach((animation) => {
      const elapsed = now - animation.startTime - animation.delay;
      const duration = animation.type === 'mine' ? 460 : animation.type === 'mark' ? 360 : 300;
      if (elapsed < 0) {
        activeAnimations.push(animation);
        return;
      }
      if (elapsed >= duration) return;
      activeAnimations.push(animation);

      const progress = elapsed / duration;
      const x = boardX + animation.col * cellSize;
      const y = boardY + animation.row * cellSize;
      const centerX = x + cellSize / 2;
      const centerY = y + cellSize / 2;

      if (animation.type === 'reveal') {
        const coverSize = cellSize * (1 - progress * 0.72);
        ctx.save();
        ctx.globalAlpha = (1 - progress) * 0.72;
        drawRoundedRect(
          ctx,
          centerX - coverSize / 2,
          centerY - coverSize / 2,
          coverSize,
          coverSize,
          Math.max(4, coverSize * 0.18),
          '#8D76F7',
        );
        ctx.restore();
        this.drawMineEffectRing(centerX, centerY, cellSize, progress, '#B6A8FF');
      } else if (animation.type === 'mine') {
        this.drawMineEffectRing(centerX, centerY, cellSize, progress, '#FF6688', 1.4);
        this.drawMineEffectRing(centerX, centerY, cellSize, Math.max(0, progress - 0.18), '#FFD166');
      } else {
        const scale = progress < 0.58
          ? 0.45 + (progress / 0.58) * 0.82
          : 1.27 - ((progress - 0.58) / 0.42) * 0.27;
        const iconSize = cellSize * 0.78 * scale;
        const iconX = centerX - iconSize / 2;
        const iconY = centerY - iconSize / 2;
        const color = animation.state === 'flag' ? '#FFD166' : '#FFFFFF';
        this.drawMineEffectRing(centerX, centerY, cellSize, progress, color);
        if (animation.state === 'flag') this.drawFlag(iconX, iconY, iconSize);
        if (animation.state === 'question') this.drawQuestion(iconX, iconY, iconSize);
      }
    });

    this.mineAnimations = activeAnimations;
  }

  drawMineEffectRing(centerX, centerY, cellSize, progress, color, scale = 1) {
    const radius = cellSize * (0.18 + progress * 0.52) * scale;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - progress) * 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, cellSize * 0.07 * (1 - progress * 0.4));
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawFlag(x, y, size) {
    const centerX = x + size / 2;
    const top = y + size * 0.22;
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = Math.max(2, size * 0.07);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(centerX - size * 0.12, top);
    ctx.lineTo(centerX - size * 0.12, y + size * 0.72);
    ctx.moveTo(centerX - size * 0.25, y + size * 0.75);
    ctx.lineTo(centerX + size * 0.18, y + size * 0.75);
    ctx.stroke();
    ctx.fillStyle = '#FFD166';
    ctx.beginPath();
    ctx.moveTo(centerX - size * 0.09, top);
    ctx.lineTo(centerX + size * 0.28, top + size * 0.14);
    ctx.lineTo(centerX - size * 0.09, top + size * 0.29);
    ctx.closePath();
    ctx.fill();
  }

  drawQuestion(x, y, size) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = `800 ${Math.floor(size * 0.62)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + size / 2, y + size / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  drawMagnifier() {
    const { row: centerRow, col: centerCol, touchX, touchY } = this.magnifier;
    const cellSize = 42;
    const gap = 3;
    const gridSize = cellSize * 3;
    const panelWidth = gridSize + 28;
    const panelHeight = gridSize + 58;
    const safeTop = GameGlobal.safeArea.top + 8;
    const panelX = Math.max(12, Math.min(SCREEN_WIDTH - panelWidth - 12, touchX - panelWidth / 2));
    const panelY = Math.max(safeTop, touchY - panelHeight - 34);
    const gridX = panelX + 14;
    const gridY = panelY + 42;
    const colors = ['#8A93A8', '#6C8CFF', '#47C9A2', '#FFB84D', '#F26D86', '#A980FF', '#4FC3E8', '#F18ED0', '#FFFFFF'];

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;
    drawRoundedRect(ctx, panelX, panelY, panelWidth, panelHeight, 22, '#292F55');
    ctx.restore();

    ctx.fillStyle = '#D9DDF0';
    ctx.font = '700 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      this.longPressTriggered ? '松手切换标记' : '拖动选择格子',
      panelX + panelWidth / 2,
      panelY + 26,
    );
    ctx.textAlign = 'left';

    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
      for (let colOffset = -1; colOffset <= 1; colOffset++) {
        const row = centerRow + rowOffset;
        const col = centerCol + colOffset;
        const x = gridX + (colOffset + 1) * cellSize + gap / 2;
        const y = gridY + (rowOffset + 1) * cellSize + gap / 2;
        const size = cellSize - gap;
        const isTarget = rowOffset === 0 && colOffset === 0;

        if (row < 0 || row >= this.minesweeper.rows || col < 0 || col >= this.minesweeper.cols) {
          drawRoundedRect(ctx, x, y, size, size, 8, '#171B36');
          continue;
        }

        const cell = this.minesweeper.board[row][col];
        if (cell.revealed) {
          drawRoundedRect(ctx, x, y, size, size, 8, cell.mine ? '#FF6688' : '#202646');
          if (cell.mine) {
            drawMine(ctx, x + size / 2, y + size / 2, size * 0.23, '#FFFFFF', '#FF6688');
          } else if (cell.adjacent > 0) {
            ctx.fillStyle = colors[cell.adjacent];
            ctx.font = '800 21px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(cell.adjacent), x + size / 2, y + size / 2 + 1);
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
          }
        } else {
          const fill = ctx.createLinearGradient(x, y, x + size, y + size);
          fill.addColorStop(0, '#8D76F7');
          fill.addColorStop(1, '#6C52DD');
          drawRoundedRect(ctx, x, y, size, size, 8, fill);
          if (cell.flagged) this.drawFlag(x, y, size);
          else if (cell.questioned) this.drawQuestion(x, y, size);
        }

        if (isTarget) {
          ctx.strokeStyle = '#FFD166';
          ctx.lineWidth = 3;
          ctx.strokeRect(x - 1, y - 1, size + 2, size + 2);
        }
      }
    }
  }

  drawResultOverlay() {
    const width = SCREEN_WIDTH;
    const height = SCREEN_HEIGHT;
    ctx.fillStyle = 'rgba(8, 11, 29, 0.72)';
    ctx.fillRect(0, 0, width, height);

    const modalWidth = Math.min(width - 44, 330);
    const modalHeight = 250;
    const x = (width - modalWidth) / 2;
    const y = (height - modalHeight) / 2;
    drawRoundedRect(ctx, x, y, modalWidth, modalHeight, 28, '#202646');

    const won = this.minesweeper.status === 'won';
    drawRoundedRect(ctx, width / 2 - 29, y + 28, 58, 58, 20, won ? '#3FC89D' : '#FF6688');
    if (won) {
      drawSpark(ctx, width / 2, y + 57, 17, '#FFFFFF');
    } else {
      drawMine(ctx, width / 2, y + 57, 17, '#FFFFFF', '#FF6688');
    }

    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.text;
    ctx.font = '800 26px sans-serif';
    ctx.fillText(won ? '排雷成功！' : '踩到雷啦', width / 2, y + 126);
    ctx.fillStyle = COLORS.subtext;
    ctx.font = '14px sans-serif';
    const rankText = this.minesweeper.lastRank ? ` · 排行第 ${this.minesweeper.lastRank}` : '';
    const subtitle = won ? `本局用时 ${this.formatTime()}${rankText}` : '别灰心，换个思路再试一次';
    fitText(ctx, subtitle, width / 2, y + 154, modalWidth - 40);

    this.hitAreas.overlayAction = { x: x + 24, y: y + 181, width: modalWidth - 48, height: 48 };
    drawRoundedRect(ctx, x + 24, y + 181, modalWidth - 48, 48, 17, '#7457FF');
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 15px sans-serif';
    ctx.fillText('再来一局', width / 2, y + 211);
    ctx.textAlign = 'left';
  }

  drawMineLeaderboard() {
    const width = SCREEN_WIDTH;
    const height = SCREEN_HEIGHT;
    ctx.fillStyle = 'rgba(8, 11, 29, 0.82)';
    ctx.fillRect(0, 0, width, height);

    const modalWidth = Math.min(width - 36, 350);
    const modalHeight = Math.min(430, height - 64);
    const x = (width - modalWidth) / 2;
    const y = (height - modalHeight) / 2;
    drawRoundedRect(ctx, x, y, modalWidth, modalHeight, 26, '#202646');

    ctx.fillStyle = COLORS.text;
    ctx.font = '800 24px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('扫雷排行榜', x + 24, y + 39);
    ctx.fillStyle = COLORS.subtext;
    ctx.font = '13px sans-serif';
    ctx.fillText(`${DIFFICULTIES[this.minesweeper.difficulty].label} · 每次通关都会上榜`, x + 24, y + 63);

    const closeSize = 36;
    const closeX = x + modalWidth - closeSize - 16;
    const closeY = y + 16;
    this.hitAreas.leaderboardClose = { x: closeX, y: closeY, width: closeSize, height: closeSize };
    drawRoundedRect(ctx, closeX, closeY, closeSize, closeSize, 12, '#303758');
    ctx.strokeStyle = COLORS.subtext;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(closeX + 12, closeY + 12);
    ctx.lineTo(closeX + 24, closeY + 24);
    ctx.moveTo(closeX + 24, closeY + 12);
    ctx.lineTo(closeX + 12, closeY + 24);
    ctx.stroke();

    const records = this.minesweeper.getLeaderboard(8);
    const listTop = y + 84;
    const rowHeight = 38;
    if (!records.length) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('完成一局后，这里会记录你的成绩', width / 2, listTop + 75);
    } else {
      records.forEach((record, index) => {
        const rowY = listTop + index * rowHeight;
        if (index < 3) {
          drawRoundedRect(ctx, x + 18, rowY, modalWidth - 36, rowHeight - 4, 11, 'rgba(116,87,255,0.2)');
        }
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillStyle = index === 0 ? '#FFD166' : COLORS.subtext;
        ctx.font = '800 14px sans-serif';
        ctx.fillText(String(index + 1), x + 38, rowY + 17);
        ctx.textAlign = 'left';
        ctx.fillStyle = COLORS.text;
        ctx.font = '600 13px sans-serif';
        ctx.fillText(record.playerName, x + 58, rowY + 17);
        ctx.fillStyle = COLORS.muted;
        ctx.font = '11px sans-serif';
        ctx.fillText(this.formatLeaderboardDate(record.createdAt), x + 126, rowY + 17);
        ctx.textAlign = 'right';
        ctx.fillStyle = '#62D9B0';
        ctx.font = '700 13px sans-serif';
        ctx.fillText(this.formatDuration(record.time), x + modalWidth - 24, rowY + 17);
      });
    }
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.muted;
    ctx.font = '11px sans-serif';
    ctx.fillText('本地保存前 50 次最佳通关记录', width / 2, y + modalHeight - 22);
    ctx.textAlign = 'left';
  }

  formatLeaderboardDate(timestamp) {
    if (!timestamp) return '--/-- --:--';
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  formatDuration(milliseconds) {
    const safeMilliseconds = Math.max(0, Math.round(Number(milliseconds) || 0));
    const minutes = Math.floor(safeMilliseconds / 60000);
    const seconds = Math.floor((safeMilliseconds % 60000) / 1000);
    const fraction = String(safeMilliseconds % 1000).padStart(3, '0');
    if (minutes > 0) return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${fraction}`;
    return `${seconds}.${fraction}s`;
  }

  formatTime() {
    return this.formatDuration(this.minesweeper.elapsedMilliseconds);
  }

  formatBest() {
    return this.minesweeper.bestTime ? this.formatDuration(this.minesweeper.bestTime) : '--';
  }

  render() {
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    if (this.screen === 'home') this.renderHome();
    else if (this.screen === 'minesweeper') this.renderMinesweeper();
    else if (this.screen === '2048') this.render2048();
    else if (this.screen === 'towerMap') this.renderTowerMap();
    else this.renderTowerDefense();
  }

  loop() {
    if (this.screen === 'minesweeper') this.minesweeper.updateTimer();
    if (this.screen === 'towerDefense') this.towerDefense.update();
    if (!['home', 'towerMap'].includes(this.screen) && Date.now() - this.lastAutoSaveAt >= 2000) {
      this.saveCurrentGame();
    }
    this.render();
    this.aniId = requestAnimationFrame(this.loop);
  }
}
