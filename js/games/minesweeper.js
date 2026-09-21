const LEGACY_BEST_TIME_KEY = 'miniArcadeMinesweeperBestTime';
const BEST_TIME_MS_KEY = 'miniArcadeMinesweeperBestTimeMs';
const LEADERBOARD_KEY = 'miniArcadeMinesweeperLeaderboardV1';
const LEADERBOARD_LIMIT = 50;

export const DIFFICULTIES = {
  beginner: { label: '初级', rows: 9, cols: 9, mines: 10 },
  intermediate: { label: '中级', rows: 12, cols: 12, mines: 24 },
  expert: { label: '高级', rows: 16, cols: 16, mines: 50 },
};

export default class Minesweeper {
  constructor(difficulty = 'beginner') {
    this.difficulty = difficulty;
    this.applyDifficulty();
    this.reset();
  }

  applyDifficulty() {
    const config = DIFFICULTIES[this.difficulty] || DIFFICULTIES.beginner;
    this.rows = config.rows;
    this.cols = config.cols;
    this.mineCount = config.mines;
    const legacyBest = Number(wx.getStorageSync(this.getLegacyBestTimeKey())) || 0;
    this.bestTime = Number(wx.getStorageSync(this.getBestTimeKey())) || legacyBest * 1000;
    this.leaderboard = this.readLeaderboard();
  }

  setDifficulty(difficulty) {
    if (!DIFFICULTIES[difficulty] || difficulty === this.difficulty) return;
    this.difficulty = difficulty;
    this.applyDifficulty();
    this.reset();
  }

  getBestTimeKey() {
    return `${BEST_TIME_MS_KEY}_${this.difficulty}`;
  }

  getLegacyBestTimeKey() {
    return this.difficulty === 'beginner'
      ? LEGACY_BEST_TIME_KEY
      : `${LEGACY_BEST_TIME_KEY}_${this.difficulty}`;
  }

  getLeaderboardKey() {
    return `${LEADERBOARD_KEY}_${this.difficulty}`;
  }

  readLeaderboard() {
    const records = wx.getStorageSync(this.getLeaderboardKey());
    if (!Array.isArray(records)) return [];
    return records
      .filter((record) => record && Number(record.time) >= 0)
      .map((record) => ({
        id: String(record.id || `${record.createdAt || 0}_${record.time}`),
        playerName: String(record.playerName || '本机玩家'),
        time: Math.max(0, Math.round(Number(record.time) || 0)),
        createdAt: Math.max(0, Number(record.createdAt) || 0),
      }))
      .sort((first, second) => first.time - second.time || first.createdAt - second.createdAt)
      .slice(0, LEADERBOARD_LIMIT);
  }

  getLeaderboard(limit = 10) {
    return this.leaderboard.slice(0, limit);
  }

  recordLeaderboard() {
    const createdAt = Date.now();
    const record = {
      id: `${createdAt}_${Math.random().toString(36).slice(2, 8)}`,
      playerName: '本机玩家',
      time: this.elapsedMilliseconds,
      createdAt,
    };
    this.leaderboard.push(record);
    this.leaderboard.sort((first, second) => first.time - second.time || first.createdAt - second.createdAt);
    this.leaderboard = this.leaderboard.slice(0, LEADERBOARD_LIMIT);
    wx.setStorageSync(this.getLeaderboardKey(), this.leaderboard);
    this.lastRank = this.leaderboard.findIndex((item) => item.id === record.id) + 1;
  }

  serialize() {
    return {
      difficulty: this.difficulty,
      board: this.board.map((row) => row.map((cell) => ({ ...cell }))),
      status: this.status,
      elapsedMilliseconds: this.elapsedMilliseconds,
      flagsUsed: this.flagsUsed,
      revealedCount: this.revealedCount,
      minesPlaced: this.minesPlaced,
    };
  }

  restore(state) {
    if (!state || !DIFFICULTIES[state.difficulty] || !Array.isArray(state.board)) return false;
    this.difficulty = state.difficulty;
    this.applyDifficulty();
    if (state.board.length !== this.rows
      || state.board.some((row) => !Array.isArray(row) || row.length !== this.cols)) return false;

    this.board = state.board.map((row) => row.map((cell) => ({
      mine: Boolean(cell.mine),
      revealed: Boolean(cell.revealed),
      flagged: Boolean(cell.flagged),
      questioned: Boolean(cell.questioned),
      adjacent: Number(cell.adjacent) || 0,
    })));
    this.status = ['ready', 'playing', 'won', 'lost'].includes(state.status) ? state.status : 'ready';
    this.elapsedMilliseconds = Math.max(
      0,
      Number(state.elapsedMilliseconds) || (Number(state.elapsedSeconds) || 0) * 1000,
    );
    this.flagsUsed = Math.max(0, Number(state.flagsUsed) || 0);
    this.revealedCount = Math.max(0, Number(state.revealedCount) || 0);
    this.minesPlaced = Boolean(state.minesPlaced);
    this.startTime = this.status === 'playing'
      ? Date.now() - this.elapsedMilliseconds
      : 0;
    this.lastReveal = [];
    this.lastRank = 0;
    return true;
  }

  reset() {
    this.board = Array.from({ length: this.rows }, () => (
      Array.from({ length: this.cols }, () => ({
        mine: false,
        revealed: false,
        flagged: false,
        questioned: false,
        adjacent: 0,
      }))
    ));
    this.status = 'ready';
    this.startTime = 0;
    this.elapsedMilliseconds = 0;
    this.flagsUsed = 0;
    this.revealedCount = 0;
    this.minesPlaced = false;
    this.lastReveal = [];
    this.lastRank = 0;
  }

  get minesLeft() {
    return this.mineCount - this.flagsUsed;
  }

  updateTimer(now = Date.now()) {
    if (this.status === 'playing') {
      this.elapsedMilliseconds = Math.max(0, now - this.startTime);
    }
  }

  placeMines(safeRow, safeCol) {
    const candidates = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const isSafeZone = Math.abs(row - safeRow) <= 1 && Math.abs(col - safeCol) <= 1;
        if (!isSafeZone) candidates.push({ row, col });
      }
    }

    for (let i = candidates.length - 1; i > 0; i--) {
      const randomIndex = Math.floor(Math.random() * (i + 1));
      const current = candidates[i];
      candidates[i] = candidates[randomIndex];
      candidates[randomIndex] = current;
    }

    candidates.slice(0, this.mineCount).forEach(({ row, col }) => {
      this.board[row][col].mine = true;
    });
    this.calculateAdjacentCounts();
    this.minesPlaced = true;
  }

  calculateAdjacentCounts() {
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        if (this.board[row][col].mine) continue;
        this.board[row][col].adjacent = this.getNeighbors(row, col)
          .filter(({ row: nextRow, col: nextCol }) => this.board[nextRow][nextCol].mine)
          .length;
      }
    }
  }

  getNeighbors(row, col) {
    const neighbors = [];
    for (let rowOffset = -1; rowOffset <= 1; rowOffset++) {
      for (let colOffset = -1; colOffset <= 1; colOffset++) {
        if (rowOffset === 0 && colOffset === 0) continue;
        const nextRow = row + rowOffset;
        const nextCol = col + colOffset;
        if (nextRow >= 0 && nextRow < this.rows && nextCol >= 0 && nextCol < this.cols) {
          neighbors.push({ row: nextRow, col: nextCol });
        }
      }
    }
    return neighbors;
  }

  reveal(row, col) {
    if (this.status === 'won' || this.status === 'lost') return;
    this.lastReveal = [];
    const cell = this.board[row][col];
    if (cell.revealed) {
      this.revealAround(row, col);
      return;
    }
    if (cell.flagged) return;

    if (!this.minesPlaced) {
      this.placeMines(row, col);
      this.status = 'playing';
      this.startTime = Date.now();
    }

    if (cell.mine) {
      cell.revealed = true;
      this.lastReveal.push({ row, col, mine: true });
      this.finish(false);
      return;
    }

    this.revealSafeArea(row, col);
    this.checkWin();
  }

  revealAround(row, col) {
    const cell = this.board[row][col];
    if (!cell.revealed || cell.adjacent === 0) return;

    const neighbors = this.getNeighbors(row, col);
    const flaggedCount = neighbors.filter(({ row: nextRow, col: nextCol }) => (
      this.board[nextRow][nextCol].flagged
    )).length;
    if (flaggedCount !== cell.adjacent) return;

    const coveredCells = neighbors.filter(({ row: nextRow, col: nextCol }) => {
      const nextCell = this.board[nextRow][nextCol];
      return !nextCell.revealed && !nextCell.flagged;
    });
    const mineCell = coveredCells.find(({ row: nextRow, col: nextCol }) => (
      this.board[nextRow][nextCol].mine
    ));

    if (mineCell) {
      this.board[mineCell.row][mineCell.col].revealed = true;
      this.lastReveal.push({ row: mineCell.row, col: mineCell.col, mine: true });
      this.finish(false);
      return;
    }

    coveredCells.forEach(({ row: nextRow, col: nextCol }) => {
      this.revealSafeArea(nextRow, nextCol);
    });
    this.checkWin();
  }

  checkWin() {
    if (this.revealedCount === this.rows * this.cols - this.mineCount) this.finish(true);
  }

  revealSafeArea(startRow, startCol) {
    const queue = [{ row: startRow, col: startCol }];
    const queued = {};
    queued[`${startRow}:${startCol}`] = true;

    while (queue.length) {
      const { row, col } = queue.shift();
      const cell = this.board[row][col];
      if (cell.revealed || cell.flagged || cell.mine) continue;

      cell.revealed = true;
      cell.questioned = false;
      this.revealedCount++;
      this.lastReveal.push({ row, col, mine: false });

      if (cell.adjacent === 0) {
        this.getNeighbors(row, col).forEach((neighbor) => {
          const key = `${neighbor.row}:${neighbor.col}`;
          const nextCell = this.board[neighbor.row][neighbor.col];
          if (!queued[key] && !nextCell.revealed && !nextCell.mine) {
            queued[key] = true;
            queue.push(neighbor);
          }
        });
      }
    }
  }

  toggleMark(row, col) {
    if (this.status === 'won' || this.status === 'lost') return;
    const cell = this.board[row][col];
    if (cell.revealed) return;

    if (cell.flagged) {
      cell.flagged = false;
      cell.questioned = true;
      this.flagsUsed--;
    } else if (cell.questioned) {
      cell.questioned = false;
    } else {
      cell.flagged = true;
      cell.questioned = false;
      this.flagsUsed++;
    }
  }

  finish(won) {
    this.updateTimer();
    this.status = won ? 'won' : 'lost';

    if (won) {
      for (let row = 0; row < this.rows; row++) {
        for (let col = 0; col < this.cols; col++) {
          if (this.board[row][col].mine) {
            this.board[row][col].flagged = true;
            this.board[row][col].questioned = false;
          }
        }
      }
      this.flagsUsed = this.mineCount;
      if (!this.bestTime || this.elapsedMilliseconds < this.bestTime) {
        this.bestTime = this.elapsedMilliseconds;
        wx.setStorageSync(this.getBestTimeKey(), this.bestTime);
      }
      this.recordLeaderboard();
    } else {
      this.board.forEach((row, rowIndex) => row.forEach((cell, colIndex) => {
        if (cell.mine && !cell.revealed) {
          cell.revealed = true;
          this.lastReveal.push({ row: rowIndex, col: colIndex, mine: true });
        }
      }));
    }
  }
}
