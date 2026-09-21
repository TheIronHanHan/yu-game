const BEST_SCORE_KEY = 'miniArcade2048BestScore';

export default class Game2048 {
  constructor(size = 4) {
    this.size = size;
    this.bestScore = Number(wx.getStorageSync(BEST_SCORE_KEY)) || 0;
    this.reset();
  }

  reset() {
    this.grid = Array.from({ length: this.size }, () => Array(this.size).fill(0));
    this.score = 0;
    this.status = 'playing';
    this.hasWon = false;
    this.lastMove = null;
    this.addRandomTile();
    this.addRandomTile();
  }

  serialize() {
    return {
      grid: this.grid.map((row) => row.slice()),
      score: this.score,
      status: this.status,
      hasWon: this.hasWon,
    };
  }

  restore(state) {
    if (!state || !Array.isArray(state.grid) || state.grid.length !== this.size
      || state.grid.some((row) => !Array.isArray(row) || row.length !== this.size)) return false;
    this.grid = state.grid.map((row) => row.map((value) => Math.max(0, Number(value) || 0)));
    this.score = Math.max(0, Number(state.score) || 0);
    const restoredStatus = ['playing', 'won', 'lost'].includes(state.status)
      ? state.status : 'playing';
    this.hasWon = Boolean(state.hasWon)
      || this.grid.some((row) => row.some((value) => value >= 2048));
    this.status = restoredStatus === 'won'
      ? (this.canMove() ? 'playing' : 'lost')
      : restoredStatus;
    this.lastMove = null;
    return true;
  }

  getEmptyCells() {
    const cells = [];
    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        if (this.grid[row][col] === 0) cells.push({ row, col });
      }
    }
    return cells;
  }

  addRandomTile() {
    const emptyCells = this.getEmptyCells();
    if (!emptyCells.length) return null;
    const cell = emptyCells[Math.floor(Math.random() * emptyCells.length)];
    const value = Math.random() < 0.9 ? 2 : 4;
    this.grid[cell.row][cell.col] = value;
    return { ...cell, value };
  }

  getLineCoordinates(index, direction) {
    const coordinates = [];
    for (let offset = 0; offset < this.size; offset++) {
      if (direction === 'left') coordinates.push({ row: index, col: offset });
      if (direction === 'right') coordinates.push({ row: index, col: this.size - 1 - offset });
      if (direction === 'up') coordinates.push({ row: offset, col: index });
      if (direction === 'down') coordinates.push({ row: this.size - 1 - offset, col: index });
    }
    return coordinates;
  }

  mergeLine(values) {
    const compact = values
      .map((value, sourceIndex) => ({ value, sourceIndex }))
      .filter((item) => item.value !== 0);
    const merged = [];
    const mergedIndexes = [];
    const sourceGroups = [];
    let scoreGained = 0;

    for (let index = 0; index < compact.length; index++) {
      if (compact[index + 1] && compact[index].value === compact[index + 1].value) {
        const value = compact[index].value * 2;
        mergedIndexes.push(merged.length);
        sourceGroups.push([compact[index].sourceIndex, compact[index + 1].sourceIndex]);
        merged.push(value);
        scoreGained += value;
        index++;
      } else {
        sourceGroups.push([compact[index].sourceIndex]);
        merged.push(compact[index].value);
      }
    }

    while (merged.length < this.size) merged.push(0);
    return {
      values: merged,
      scoreGained,
      mergedIndexes,
      sourceGroups,
    };
  }

  move(direction) {
    if (this.status !== 'playing') return false;
    let changed = false;
    let scoreGained = 0;
    const mergedCells = [];
    const tileMoves = [];

    for (let index = 0; index < this.size; index++) {
      const coordinates = this.getLineCoordinates(index, direction);
      const values = coordinates.map(({ row, col }) => this.grid[row][col]);
      const result = this.mergeLine(values);
      scoreGained += result.scoreGained;
      result.mergedIndexes.forEach((mergedIndex) => {
        mergedCells.push(coordinates[mergedIndex]);
      });
      result.sourceGroups.forEach((sourceIndexes, destinationIndex) => {
        sourceIndexes.forEach((sourceIndex) => {
          tileMoves.push({
            from: coordinates[sourceIndex],
            to: coordinates[destinationIndex],
            value: values[sourceIndex],
            merged: sourceIndexes.length > 1,
          });
        });
      });

      coordinates.forEach(({ row, col }, valueIndex) => {
        if (this.grid[row][col] !== result.values[valueIndex]) changed = true;
        this.grid[row][col] = result.values[valueIndex];
      });
    }

    if (!changed) {
      this.lastMove = null;
      return false;
    }

    this.score += scoreGained;
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      wx.setStorageSync(BEST_SCORE_KEY, this.bestScore);
    }

    const newTile = this.addRandomTile();
    this.lastMove = {
      direction,
      mergedCells,
      tileMoves,
      newTile,
      scoreGained,
    };
    if (!this.hasWon && this.grid.some((row) => row.some((value) => value >= 2048))) {
      this.hasWon = true;
    }
    if (!this.canMove()) {
      this.status = 'lost';
    } else {
      this.status = 'playing';
    }
    return true;
  }

  canMove() {
    if (this.getEmptyCells().length) return true;

    for (let row = 0; row < this.size; row++) {
      for (let col = 0; col < this.size; col++) {
        const value = this.grid[row][col];
        if (row + 1 < this.size && this.grid[row + 1][col] === value) return true;
        if (col + 1 < this.size && this.grid[row][col + 1] === value) return true;
      }
    }
    return false;
  }

  continueGame() {
    this.hasWon = true;
    this.status = this.canMove() ? 'playing' : 'lost';
  }
}
