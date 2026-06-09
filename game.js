'use strict';

const EMPTY = 0;
const BLACK = 1;
const WHITE = 2;
const SIZE  = 8;
const DIRS  = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],           [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1]
];

let board, currentPlayer, gameActive, cells;
let dragActive = false, dragPlayer = null;

// ── Board logic ───────────────────────────────────────────────────────────────

function createBoard() {
  const b = Array.from({ length: SIZE }, () => new Array(SIZE).fill(EMPTY));
  b[3][3] = WHITE; b[3][4] = BLACK;
  b[4][3] = BLACK; b[4][4] = WHITE;
  return b;
}

function getFlips(b, row, col, player) {
  if (b[row][col] !== EMPTY) return [];
  const opp = player === BLACK ? WHITE : BLACK;
  const result = [];
  for (const [dr, dc] of DIRS) {
    let r = row + dr, c = col + dc;
    const line = [];
    while (r >= 0 && r < SIZE && c >= 0 && c < SIZE && b[r][c] === opp) {
      line.push([r, c]);
      r += dr;
      c += dc;
    }
    if (line.length > 0 && r >= 0 && r < SIZE && c >= 0 && c < SIZE && b[r][c] === player) {
      result.push(...line);
    }
  }
  return result;
}

function getValidMoves(b, player) {
  const moves = [];
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++)
      if (getFlips(b, r, c, player).length > 0) moves.push([r, c]);
  return moves;
}

function countPieces(b) {
  let black = 0, white = 0;
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      if (b[r][c] === BLACK) black++;
      else if (b[r][c] === WHITE) white++;
    }
  return { black, white };
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function buildGrid() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  cells = Array.from({ length: SIZE }, (_, r) =>
    Array.from({ length: SIZE }, (_, c) => {
      const cell = document.createElement('div');
      cell.className = 'cell';
      boardEl.appendChild(cell);
      return cell;
    })
  );
}

function refreshBoard(flipped = [], placed = null) {
  const validSet = gameActive
    ? new Set(getValidMoves(board, currentPlayer).map(([r, c]) => `${r},${c}`))
    : new Set();
  const flipSet  = new Set(flipped.map(([r, c]) => `${r},${c}`));
  const placeKey = placed ? `${placed[0]},${placed[1]}` : null;

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = cells[r][c];
      cell.innerHTML = '';
      const key = `${r},${c}`;
      const val = board[r][c];

      if (val !== EMPTY) {
        const piece = document.createElement('div');
        piece.className = 'piece ' + (val === BLACK ? 'black' : 'white');
        if (flipSet.has(key))      piece.classList.add('flip');
        else if (key === placeKey) piece.classList.add('place');
        cell.appendChild(piece);
      } else if (validSet.has(key)) {
        const hint = document.createElement('div');
        hint.className = 'hint';
        cell.appendChild(hint);
      }
    }
  }
}

function updatePanels() {
  const { black, white } = countPieces(board);
  ['left', 'right'].forEach(p => {
    document.getElementById(`${p}-black-count`).textContent = black;
    document.getElementById(`${p}-white-count`).textContent = white;
    document.getElementById(`${p}-score-black`).classList.toggle('active', currentPlayer === BLACK && gameActive);
    document.getElementById(`${p}-score-white`).classList.toggle('active', currentPlayer === WHITE && gameActive);
  });
}

function setStatus(text, warn = false) {
  ['left', 'right'].forEach(p => {
    const el = document.getElementById(`${p}-status`);
    el.textContent = text;
    el.classList.toggle('warning', warn);
  });
}

function playerName(p) {
  return p === BLACK ? 'Elphaba' : 'Glinda';
}

// ── Drag and drop ─────────────────────────────────────────────────────────────

function toFrameCoords(clientX, clientY) {
  const frame = document.getElementById('ipad-frame');
  const rect  = frame.getBoundingClientRect();
  const scale = rect.width / 1180;
  return {
    x: (clientX - rect.left) / scale,
    y: (clientY - rect.top)  / scale
  };
}

function updateSlots() {
  ['left', 'right'].forEach(side => {
    const slotEl = document.getElementById(`${side}-slot`);
    const player = side === 'left' ? BLACK : WHITE;
    slotEl.innerHTML = '';

    if (!gameActive || currentPlayer !== player) return;

    const piece = document.createElement('div');
    piece.className = `piece ${player === BLACK ? 'black' : 'white'} draggable-piece`;
    slotEl.appendChild(piece);

    piece.addEventListener('pointerdown', e => {
      e.preventDefault();
      piece.setPointerCapture(e.pointerId);
      startDrag(e, player, slotEl);
    });
    piece.addEventListener('pointermove', e => {
      if (dragActive) moveDrag(e);
    });
    piece.addEventListener('pointerup', e => {
      if (dragActive) endDrag(e, slotEl);
    });
    piece.addEventListener('pointercancel', () => {
      if (dragActive) cancelDrag(slotEl);
    });
  });
}

function startDrag(e, player, slotEl) {
  dragActive = true;
  dragPlayer = player;

  const floatingEl = document.getElementById('floating-piece');
  floatingEl.className = `piece ${player === BLACK ? 'black' : 'white'}`;
  floatingEl.style.transition = 'none';

  const { x, y } = toFrameCoords(e.clientX, e.clientY);
  const half = floatingEl.offsetWidth / 2;
  floatingEl.style.left = `${x - half}px`;
  floatingEl.style.top  = `${y - half}px`;

  slotEl.style.opacity = '0.25';
  document.getElementById('ipad-frame').classList.add('dragging');
}

function moveDrag(e) {
  const floatingEl = document.getElementById('floating-piece');
  const { x, y }   = toFrameCoords(e.clientX, e.clientY);
  const half        = floatingEl.offsetWidth / 2;
  floatingEl.style.left = `${x - half}px`;
  floatingEl.style.top  = `${y - half}px`;

  updateDragHover(e.clientX, e.clientY);
}

function updateDragHover(clientX, clientY) {
  document.querySelectorAll('.cell.drag-over').forEach(c => c.classList.remove('drag-over'));

  const el   = document.elementFromPoint(clientX, clientY);
  const cell = el?.closest('.cell');
  if (!cell) return;

  const boardEl = document.getElementById('board');
  const idx     = Array.from(boardEl.children).indexOf(cell);
  if (idx < 0) return;

  const row = Math.floor(idx / SIZE);
  const col = idx % SIZE;
  if (getFlips(board, row, col, currentPlayer).length > 0) {
    cell.classList.add('drag-over');
  }
}

function endDrag(e, slotEl) {
  dragActive = false;
  document.getElementById('ipad-frame').classList.remove('dragging');
  document.querySelectorAll('.cell.drag-over').forEach(c => c.classList.remove('drag-over'));

  const el   = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el?.closest('.cell');

  if (cell) {
    const boardEl = document.getElementById('board');
    const idx     = Array.from(boardEl.children).indexOf(cell);
    if (idx >= 0) {
      const row   = Math.floor(idx / SIZE);
      const col   = idx % SIZE;
      const flips = getFlips(board, row, col, currentPlayer);
      if (flips.length > 0) {
        document.getElementById('floating-piece').className = 'piece hidden';
        slotEl.style.opacity = '';

        board[row][col] = currentPlayer;
        flips.forEach(([r, c]) => { board[r][c] = currentPlayer; });
        advanceTurn(flips, [row, col]);
        return;
      }
    }
  }

  cancelDrag(slotEl);
}

function cancelDrag(slotEl) {
  dragActive = false;
  document.getElementById('ipad-frame').classList.remove('dragging');
  document.querySelectorAll('.cell.drag-over').forEach(c => c.classList.remove('drag-over'));

  const floatingEl = document.getElementById('floating-piece');
  const frame      = document.getElementById('ipad-frame');
  const frameRect  = frame.getBoundingClientRect();
  const scale      = frameRect.width / 1180;
  const slotRect   = slotEl.getBoundingClientRect();

  const cx   = (slotRect.left + slotRect.width  / 2 - frameRect.left) / scale;
  const cy   = (slotRect.top  + slotRect.height / 2 - frameRect.top)  / scale;
  const half = floatingEl.offsetWidth / 2;

  floatingEl.style.transition = 'left 0.25s ease-out, top 0.25s ease-out';
  floatingEl.style.left = `${cx - half}px`;
  floatingEl.style.top  = `${cy - half}px`;

  setTimeout(() => {
    floatingEl.className = 'piece hidden';
    floatingEl.style.transition = '';
    slotEl.style.opacity = '';
  }, 270);
}

// ── Game flow ─────────────────────────────────────────────────────────────────

function newGame() {
  dragActive = false;
  document.getElementById('ipad-frame').classList.remove('dragging');
  const floatingEl = document.getElementById('floating-piece');
  if (floatingEl) {
    floatingEl.className = 'piece hidden';
    floatingEl.style.transition = '';
  }
  document.querySelectorAll('.piece-slot').forEach(s => { s.style.opacity = ''; });

  board         = createBoard();
  currentPlayer = BLACK;
  gameActive    = true;
  document.getElementById('overlay').classList.add('hidden');
  buildGrid();
  refreshBoard();
  updatePanels();
  updateSlots();
  setStatus(`${playerName(BLACK)}'s turn`);
}

function advanceTurn(flips, placed) {
  const next      = currentPlayer === BLACK ? WHITE : BLACK;
  const nextMoves = getValidMoves(board, next);
  const currMoves = getValidMoves(board, currentPlayer);

  if (nextMoves.length > 0) {
    currentPlayer = next;
    refreshBoard(flips, placed);
    updatePanels();
    updateSlots();
    setStatus(`${playerName(currentPlayer)}'s turn`);
  } else if (currMoves.length > 0) {
    refreshBoard(flips, placed);
    updatePanels();
    updateSlots();
    setStatus(`${playerName(next)} has no moves — ${playerName(currentPlayer)} plays again`, true);
  } else {
    gameActive = false;
    refreshBoard(flips, placed);
    updatePanels();
    updateSlots();
    setStatus('Game over');
    setTimeout(showGameOver, 500);
  }
}

function showGameOver() {
  const { black, white } = countPieces(board);
  let msg;
  if      (black > white) msg = `${playerName(BLACK)} wins!`;
  else if (white > black) msg = `${playerName(WHITE)} wins!`;
  else                    msg = "It's a tie!";

  ['left', 'right'].forEach(p => {
    document.getElementById(`${p}-final-black`).textContent = black;
    document.getElementById(`${p}-final-white`).textContent = white;
    document.getElementById(`${p}-winner`).textContent      = msg;
  });

  document.getElementById('overlay').classList.remove('hidden');
}

// ── Scale frame to fit browser window ────────────────────────────────────────

function scaleFrame() {
  const frame  = document.getElementById('ipad-frame');
  const scaleX = (window.innerWidth  - 40) / 1180;
  const scaleY = (window.innerHeight - 40) / 820;
  const scale  = Math.min(scaleX, scaleY, 1);
  frame.style.transform = `scale(${scale})`;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.btn-continue').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('start-overlay').classList.add('hidden');
      newGame();
    });
  });

  document.querySelectorAll('.btn-new-game').forEach(btn =>
    btn.addEventListener('click', newGame)
  );
  document.querySelectorAll('.btn-play-again').forEach(btn =>
    btn.addEventListener('click', newGame)
  );

  window.addEventListener('resize', scaleFrame);
  scaleFrame();
});
