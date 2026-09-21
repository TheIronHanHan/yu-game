const SIZE = 9;
const BOX_SIZE = 3;
const TARGET_CLUES = 27;

function makeGrid(value = 0) {
  return Array.from({ length: SIZE }, () => Array(SIZE).fill(value));
}

function cloneGrid(grid) {
  return grid.map((row) => row.slice());
}

function shuffle(values, random) {
  const output = values.slice();
  for (let index = output.length - 1; index > 0; index--) {
    const nextIndex = Math.floor(random() * (index + 1));
    [output[index], output[nextIndex]] = [output[nextIndex], output[index]];
  }
  return output;
}

function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isGridShape(grid) {
  return Array.isArray(grid) && grid.length === SIZE
    && grid.every((row) => Array.isArray(row) && row.length === SIZE);
}

export function getDailySudokuKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export default class Sudoku {
  constructor(date = new Date()) {
    this.dateKey = '';
    this.puzzle = makeGrid();
    this.solution = makeGrid();
    this.grid = makeGrid();
    this.notes = makeGrid();
    this.selected = null;
    this.notesMode = false;
    this.status = 'ready';
    this.mistakes = 0;
    this.elapsedMilliseconds = 0;
    this.startTime = 0;
    this.generateDaily(date);
  }

  generateDaily(date = new Date()) {
    this.dateKey = getDailySudokuKey(date);
    const random = createRandom(hashSeed(`yu-game-sudoku-${this.dateKey}`));
    this.solution = this.generateSolution(random);
    this.puzzle = this.createPuzzle(this.solution, random);
    this.grid = cloneGrid(this.puzzle);
    this.notes = makeGrid();
    this.selected = null;
    this.notesMode = false;
    this.status = 'ready';
    this.mistakes = 0;
    this.elapsedMilliseconds = 0;
    this.startTime = 0;
  }

  ensureDaily(date = new Date()) {
    const dateKey = getDailySudokuKey(date);
    if (dateKey === this.dateKey) return false;
    this.generateDaily(date);
    return true;
  }

  generateSolution(random) {
    const groups = shuffle([0, 1, 2], random);
    const rows = groups.flatMap((group) => (
      shuffle([0, 1, 2], random).map((offset) => group * BOX_SIZE + offset)
    ));
    const stacks = shuffle([0, 1, 2], random);
    const columns = stacks.flatMap((stack) => (
      shuffle([0, 1, 2], random).map((offset) => stack * BOX_SIZE + offset)
    ));
    const numbers = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], random);
    return rows.map((row) => columns.map((column) => (
      numbers[(row * BOX_SIZE + Math.floor(row / BOX_SIZE) + column) % SIZE]
    )));
  }

  createPuzzle(solution, random) {
    const puzzle = cloneGrid(solution);
    const pairs = [];
    for (let index = 0; index <= Math.floor((SIZE * SIZE - 1) / 2); index++) {
      pairs.push([index, SIZE * SIZE - 1 - index]);
    }

    let clueCount = SIZE * SIZE;
    shuffle(pairs, random).forEach(([first, second]) => {
      if (clueCount <= TARGET_CLUES) return;
      const positions = first === second ? [first] : [first, second];
      if (clueCount - positions.length < TARGET_CLUES) return;
      const removed = positions.map((position) => {
        const row = Math.floor(position / SIZE);
        const col = position % SIZE;
        const value = puzzle[row][col];
        puzzle[row][col] = 0;
        return { row, col, value };
      });
      if (this.countSolutions(puzzle, 2) !== 1) {
        removed.forEach(({ row, col, value }) => {
          puzzle[row][col] = value;
        });
      } else {
        clueCount -= positions.length;
      }
    });

    const remaining = shuffle(Array.from({ length: SIZE * SIZE }, (_, index) => index), random);
    remaining.forEach((position) => {
      if (clueCount <= TARGET_CLUES) return;
      const row = Math.floor(position / SIZE);
      const col = position % SIZE;
      if (puzzle[row][col] === 0) return;
      const value = puzzle[row][col];
      puzzle[row][col] = 0;
      if (this.countSolutions(puzzle, 2) !== 1) {
        puzzle[row][col] = value;
      } else {
        clueCount--;
      }
    });
    return puzzle;
  }

  countSolutions(source, limit = 2) {
    const grid = cloneGrid(source);
    let solutions = 0;

    const solve = () => {
      if (solutions >= limit) return;
      let target = null;
      let targetCandidates = null;

      for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
          if (grid[row][col] !== 0) continue;
          const candidates = this.getCandidates(grid, row, col);
          if (!candidates.length) return;
          if (!targetCandidates || candidates.length < targetCandidates.length) {
            target = { row, col };
            targetCandidates = candidates;
            if (candidates.length === 1) break;
          }
        }
        if (targetCandidates && targetCandidates.length === 1) break;
      }

      if (!target) {
        solutions++;
        return;
      }

      targetCandidates.forEach((value) => {
        if (solutions >= limit) return;
        grid[target.row][target.col] = value;
        solve();
        grid[target.row][target.col] = 0;
      });
    };

    solve();
    return solutions;
  }

  getCandidates(grid, row, col) {
    const used = new Set();
    for (let index = 0; index < SIZE; index++) {
      used.add(grid[row][index]);
      used.add(grid[index][col]);
    }
    const boxRow = Math.floor(row / BOX_SIZE) * BOX_SIZE;
    const boxCol = Math.floor(col / BOX_SIZE) * BOX_SIZE;
    for (let rowOffset = 0; rowOffset < BOX_SIZE; rowOffset++) {
      for (let colOffset = 0; colOffset < BOX_SIZE; colOffset++) {
        used.add(grid[boxRow + rowOffset][boxCol + colOffset]);
      }
    }
    return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((value) => !used.has(value));
  }

  reset() {
    this.grid = cloneGrid(this.puzzle);
    this.notes = makeGrid();
    this.selected = null;
    this.notesMode = false;
    this.status = 'ready';
    this.mistakes = 0;
    this.elapsedMilliseconds = 0;
    this.startTime = 0;
  }

  start() {
    if (this.status !== 'ready') return;
    this.status = 'playing';
    this.startTime = Date.now() - this.elapsedMilliseconds;
  }

  updateTimer() {
    if (this.status === 'playing') {
      this.elapsedMilliseconds = Date.now() - this.startTime;
    }
  }

  select(row, col) {
    if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return false;
    this.selected = { row, col };
    return true;
  }

  input(value) {
    if (!this.selected || this.status === 'won') return false;
    const { row, col } = this.selected;
    if (this.puzzle[row][col] !== 0) return false;
    this.start();

    if (this.notesMode && this.grid[row][col] === 0) {
      this.notes[row][col] ^= 1 << (value - 1);
      return true;
    }

    this.grid[row][col] = value;
    this.notes[row][col] = 0;
    if (value !== this.solution[row][col]) {
      this.mistakes++;
    } else {
      this.clearPeerNotes(row, col, value);
      if (this.isComplete()) {
        this.updateTimer();
        this.status = 'won';
      }
    }
    return true;
  }

  erase() {
    if (!this.selected || this.status === 'won') return false;
    const { row, col } = this.selected;
    if (this.puzzle[row][col] !== 0) return false;
    this.start();
    this.grid[row][col] = 0;
    this.notes[row][col] = 0;
    return true;
  }

  clearPeerNotes(row, col, value) {
    const bit = ~(1 << (value - 1));
    for (let index = 0; index < SIZE; index++) {
      this.notes[row][index] &= bit;
      this.notes[index][col] &= bit;
    }
    const boxRow = Math.floor(row / BOX_SIZE) * BOX_SIZE;
    const boxCol = Math.floor(col / BOX_SIZE) * BOX_SIZE;
    for (let rowOffset = 0; rowOffset < BOX_SIZE; rowOffset++) {
      for (let colOffset = 0; colOffset < BOX_SIZE; colOffset++) {
        this.notes[boxRow + rowOffset][boxCol + colOffset] &= bit;
      }
    }
  }

  isComplete() {
    return this.grid.every((row, rowIndex) => (
      row.every((value, colIndex) => value === this.solution[rowIndex][colIndex])
    ));
  }

  get clueCount() {
    return this.puzzle.reduce((total, row) => (
      total + row.filter((value) => value !== 0).length
    ), 0);
  }

  get filledCount() {
    return this.grid.reduce((total, row) => (
      total + row.filter((value) => value !== 0).length
    ), 0);
  }

  serialize() {
    return {
      dateKey: this.dateKey,
      puzzle: cloneGrid(this.puzzle),
      solution: cloneGrid(this.solution),
      grid: cloneGrid(this.grid),
      notes: cloneGrid(this.notes),
      selected: this.selected ? { ...this.selected } : null,
      notesMode: this.notesMode,
      status: this.status,
      mistakes: this.mistakes,
      elapsedMilliseconds: this.elapsedMilliseconds,
    };
  }

  restore(state, date = new Date()) {
    if (!state || state.dateKey !== getDailySudokuKey(date)) return false;
    if (![state.puzzle, state.solution, state.grid, state.notes].every(isGridShape)) return false;
    this.dateKey = state.dateKey;
    this.puzzle = cloneGrid(state.puzzle);
    this.solution = cloneGrid(state.solution);
    this.grid = cloneGrid(state.grid);
    this.notes = cloneGrid(state.notes);
    this.selected = state.selected && Number.isInteger(state.selected.row)
      && Number.isInteger(state.selected.col) ? { ...state.selected } : null;
    this.notesMode = Boolean(state.notesMode);
    this.status = ['ready', 'playing', 'won'].includes(state.status) ? state.status : 'ready';
    this.mistakes = Math.max(0, Number(state.mistakes) || 0);
    this.elapsedMilliseconds = Math.max(0, Number(state.elapsedMilliseconds) || 0);
    this.startTime = this.status === 'playing'
      ? Date.now() - this.elapsedMilliseconds
      : 0;
    return true;
  }
}
