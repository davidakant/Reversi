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
let dragFrameX = 0, dragFrameY = 0, lastDragMoveTime = 0, bubbleLoopId = null, embersLoopId = null;
let elphabaOnLeft = true, isAnimating = false;
let hintsVisible = false;
const selectedUsers = { left: null, right: null };
const UNLOCK_SEQ = [1, 3, 5, 4, 2];
let unlockProgress = [];

function updateUsernameUI() {
  ['left', 'right'].forEach(side => {
    const other = side === 'left' ? 'right' : 'left';
    const modal = document.getElementById(`start-modal-${side}`);
    modal.querySelectorAll('.btn-username').forEach(btn => {
      btn.classList.toggle('selected', selectedUsers[side] === btn.dataset.name);
      btn.disabled = selectedUsers[other] === btn.dataset.name;
    });
    modal.querySelector('.btn-ai-toggle').classList.toggle('selected', selectedUsers[side] === 'AI');
    const playBtn = modal.querySelector('.btn-continue');
    playBtn.disabled = !selectedUsers[side];
    if (!selectedUsers[side]) playBtn.classList.remove('ready');
  });
}

function isAiTurn() {
  const leftColor = elphabaOnLeft ? BLACK : WHITE;
  const side = currentPlayer === leftColor ? 'left' : 'right';
  return selectedUsers[side] === 'AI';
}

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
  const validSet = (gameActive && hintsVisible)
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
  });

  const leftIsActive = gameActive && (elphabaOnLeft ? currentPlayer === BLACK : currentPlayer === WHITE);
  document.getElementById('panel-left').classList.toggle('active', leftIsActive);
  document.getElementById('panel-right').classList.toggle('active', gameActive && !leftIsActive);
}

function triggerBevelSpin() {
  const isLeft = elphabaOnLeft ? currentPlayer === BLACK : currentPlayer === WHITE;
  const span = document.querySelector(`#${isLeft ? 'name-strip-left' : 'name-strip-right'} span`);
  span.classList.remove('bevel-spinning');
  void span.offsetWidth;
  span.classList.add('bevel-spinning');
  span.addEventListener('animationend', () => span.classList.remove('bevel-spinning'), { once: true });
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
    if (isAiTurn()) return;

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
  dragFrameX = x;
  dragFrameY = y;
  lastDragMoveTime = performance.now();
  if (player === WHITE) startDragBubbles();
  else                  startDragEmbers();
}

function moveDrag(e) {
  const floatingEl = document.getElementById('floating-piece');
  const { x, y }   = toFrameCoords(e.clientX, e.clientY);
  const half        = floatingEl.offsetWidth / 2;
  floatingEl.style.left = `${x - half}px`;
  floatingEl.style.top  = `${y - half}px`;

  dragFrameX = x;
  dragFrameY = y;
  lastDragMoveTime = performance.now();
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
  stopDragBubbles();
  stopDragEmbers();
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
        hintsVisible = false;
        document.getElementById('floating-piece').className = 'piece hidden';
        slotEl.style.opacity = '';

        board[row][col] = currentPlayer;
        flips.forEach(([r, c]) => { board[r][c] = currentPlayer; });
        if (currentPlayer === WHITE) spawnGlindaBubbles(row, col);
        else                         spawnElphabaEffect(row, col);
        spawnCellShimmer(row, col);
        advanceTurn(flips, [row, col]);
        return;
      }
    }
  }

  hintsVisible = true;
  refreshBoard();
  cancelDrag(slotEl);
}

function cancelDrag(slotEl) {
  stopDragBubbles();
  stopDragEmbers();
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

function spawnGlindaBubbles(row, col) {
  const frame = document.getElementById('ipad-frame');
  const cell  = cells[row][col];
  const fRect = frame.getBoundingClientRect();
  const cRect = cell.getBoundingClientRect();
  const s     = fRect.width / 1180;
  const cx    = (cRect.left + cRect.width  / 2 - fRect.left) / s;
  const cy    = (cRect.top  + cRect.height / 2 - fRect.top)  / s;
  const count = 14 + Math.floor(Math.random() * 6);

  for (let i = 0; i < count; i++) {
    const b     = document.createElement('div');
    b.className = 'glinda-bubble';
    const size  = 16 + Math.random() * 30;
    const angle = Math.random() * 2 * Math.PI;
    const dist  = 40 + Math.random() * 100;
    const tx    = Math.cos(angle) * dist;
    const ty    = Math.sin(angle) * dist;

    b.style.width  = `${size}px`;
    b.style.height = `${size}px`;
    b.style.left   = `${cx - size / 2}px`;
    b.style.top    = `${cy - size / 2}px`;
    b.style.filter = `hue-rotate(${Math.floor(Math.random() * 320)}deg) saturate(1.6)`;
    frame.appendChild(b);

    const anim = b.animate([
      { transform: 'scale(0.4) translate(0px, 0px)', opacity: 0.95 },
      { transform: 'scale(0.4) translate(0px, 0px)', opacity: 0.95, offset: 0.08 },
      { transform: `scale(3.2) translate(${tx}px, ${ty}px)`, opacity: 0 }
    ], {
      duration: 900 + Math.random() * 600,
      delay:    Math.random() * 200,
      easing:   'ease-out',
      fill:     'forwards'
    });

    anim.onfinish = () => b.remove();
  }
}

function emitDragBubble(cx, cy) {
  const frame = document.getElementById('ipad-frame');
  const n     = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < n; i++) {
    const b     = document.createElement('div');
    b.className = 'glinda-bubble';
    const size  = 16 + Math.random() * 26;
    const angle = Math.random() * 2 * Math.PI;
    const dist  = 40 + Math.random() * 60;
    const tx    = Math.cos(angle) * dist;
    const ty    = Math.sin(angle) * dist;

    b.style.width  = `${size}px`;
    b.style.height = `${size}px`;
    b.style.left   = `${cx - size / 2}px`;
    b.style.top    = `${cy - size / 2}px`;
    b.style.filter = `hue-rotate(${Math.floor(Math.random() * 320)}deg) saturate(1.6)`;
    frame.appendChild(b);

    const anim = b.animate([
      { transform: 'scale(0.4) translate(0px, 0px)', opacity: 0.95 },
      { transform: 'scale(0.4) translate(0px, 0px)', opacity: 0.95, offset: 0.09 },
      { transform: `scale(3.0) translate(${tx}px, ${ty}px)`, opacity: 0 }
    ], {
      duration: 800 + Math.random() * 500,
      delay:    Math.random() * 80,
      easing:   'ease-out',
      fill:     'forwards'
    });

    anim.onfinish = () => b.remove();
  }
}

function startDragBubbles() {
  function loop() {
    if (!dragActive) return;
    if (performance.now() - lastDragMoveTime < 150) {
      emitDragBubble(dragFrameX, dragFrameY);
    }
    bubbleLoopId = setTimeout(loop, 60);
  }
  bubbleLoopId = setTimeout(loop, 60);
}

function stopDragBubbles() {
  if (bubbleLoopId !== null) {
    clearTimeout(bubbleLoopId);
    bubbleLoopId = null;
  }
}

function emitDragEmbers(cx, cy) {
  const frame = document.getElementById('ipad-frame');

  const nSparks = 4 + Math.floor(Math.random() * 4);
  for (let i = 0; i < nSparks; i++) {
    const b     = document.createElement('div');
    b.className = 'elphaba-spark';
    const angle    = Math.random() * 2 * Math.PI;
    const dist     = 25 + Math.random() * 40;
    const degrees  = angle * (180 / Math.PI);
    const isStreak = Math.random() < 0.65;
    const sparkW   = isStreak ? (10 + Math.random() * 18) : (5 + Math.random() * 9);
    const sparkH   = isStreak ? (1.5 + Math.random() * 2) : sparkW * (0.7 + Math.random() * 0.5);
    const scaleEnd = (2.0 + Math.random() * 1.4).toFixed(2);
    b.style.width  = `${sparkW}px`;
    b.style.height = `${sparkH}px`;
    b.style.left   = `${cx - sparkW / 2}px`;
    b.style.top    = `${cy - sparkH / 2}px`;
    b.style.filter = `hue-rotate(${Math.floor(Math.random() * 70)}deg) brightness(${(1.2 + Math.random() * 0.6).toFixed(2)})`;
    frame.appendChild(b);
    const anim = b.animate([
      { transform: `rotate(${degrees}deg) translateX(0px) scale(1)`,       opacity: 1 },
      { transform: `rotate(${degrees}deg) translateX(${dist}px) scale(${scaleEnd})`, opacity: 0 }
    ], { duration: 320 + Math.random() * 280, delay: Math.random() * 60, easing: 'ease-out', fill: 'forwards' });
    anim.onfinish = () => b.remove();
  }

  const nSmoke = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < nSmoke; i++) {
    const s     = document.createElement('div');
    s.className = 'elphaba-smoke';
    const size  = 22 + Math.random() * 22;
    const angle = Math.random() * 2 * Math.PI;
    const dist  = 30 + Math.random() * 50;
    const tx    = Math.cos(angle) * dist;
    const ty    = Math.sin(angle) * dist;
    s.style.width  = `${size}px`;
    s.style.height = `${size}px`;
    s.style.left   = `${cx - size / 2}px`;
    s.style.top    = `${cy - size / 2}px`;
    frame.appendChild(s);
    const anim = s.animate([
      { transform: 'scale(0.4) translate(0px, 0px)', opacity: 0.80 },
      { transform: 'scale(0.4) translate(0px, 0px)', opacity: 0.80, offset: 0.08 },
      { transform: `scale(3.5) translate(${tx}px, ${ty}px)`, opacity: 0 }
    ], { duration: 1000 + Math.random() * 600, delay: Math.random() * 80, easing: 'ease-out', fill: 'forwards' });
    anim.onfinish = () => s.remove();
  }
}

function spawnElphabaEffect(row, col) {
  const frame = document.getElementById('ipad-frame');
  const cell  = cells[row][col];
  const fRect = frame.getBoundingClientRect();
  const cRect = cell.getBoundingClientRect();
  const s     = fRect.width / 1180;
  const cx    = (cRect.left + cRect.width  / 2 - fRect.left) / s;
  const cy    = (cRect.top  + cRect.height / 2 - fRect.top)  / s;

  const nSparks = 16 + Math.floor(Math.random() * 6);
  for (let i = 0; i < nSparks; i++) {
    const b     = document.createElement('div');
    b.className = 'elphaba-spark';
    const angle    = Math.random() * 2 * Math.PI;
    const dist     = 50 + Math.random() * 80;
    const degrees  = angle * (180 / Math.PI);
    const isStreak = Math.random() < 0.65;
    const sparkW   = isStreak ? (14 + Math.random() * 22) : (6 + Math.random() * 12);
    const sparkH   = isStreak ? (1.5 + Math.random() * 2.5) : sparkW * (0.7 + Math.random() * 0.5);
    const scaleEnd = (2.5 + Math.random() * 1.5).toFixed(2);
    b.style.width  = `${sparkW}px`;
    b.style.height = `${sparkH}px`;
    b.style.left   = `${cx - sparkW / 2}px`;
    b.style.top    = `${cy - sparkH / 2}px`;
    b.style.filter = `hue-rotate(${Math.floor(Math.random() * 70)}deg) brightness(${(1.2 + Math.random() * 0.6).toFixed(2)})`;
    frame.appendChild(b);
    const anim = b.animate([
      { transform: `rotate(${degrees}deg) translateX(0px) scale(0.8)`,              opacity: 1 },
      { transform: `rotate(${degrees}deg) translateX(0px) scale(0.8)`,              opacity: 1, offset: 0.06 },
      { transform: `rotate(${degrees}deg) translateX(${dist}px) scale(${scaleEnd})`, opacity: 0 }
    ], { duration: 550 + Math.random() * 400, delay: Math.random() * 200, easing: 'ease-out', fill: 'forwards' });
    anim.onfinish = () => b.remove();
  }

  const nSmoke = 13 + Math.floor(Math.random() * 7);
  for (let i = 0; i < nSmoke; i++) {
    const sm    = document.createElement('div');
    sm.className = 'elphaba-smoke';
    const size  = 30 + Math.random() * 36;
    const angle = Math.random() * 2 * Math.PI;
    const dist  = 40 + Math.random() * 90;
    const tx    = Math.cos(angle) * dist;
    const ty    = Math.sin(angle) * dist;
    sm.style.width  = `${size}px`;
    sm.style.height = `${size}px`;
    sm.style.left   = `${cx - size / 2}px`;
    sm.style.top    = `${cy - size / 2}px`;
    frame.appendChild(sm);
    const anim = sm.animate([
      { transform: 'scale(0.4) translate(0px, 0px)', opacity: 0.90 },
      { transform: 'scale(0.4) translate(0px, 0px)', opacity: 0.90, offset: 0.08 },
      { transform: `scale(4.0) translate(${tx}px, ${ty}px)`, opacity: 0 }
    ], { duration: 1100 + Math.random() * 700, delay: Math.random() * 200, easing: 'ease-out', fill: 'forwards' });
    anim.onfinish = () => sm.remove();
  }
}

function startDragEmbers() {
  function loop() {
    if (!dragActive) return;
    if (performance.now() - lastDragMoveTime < 150) {
      emitDragEmbers(dragFrameX, dragFrameY);
    }
    embersLoopId = setTimeout(loop, 60);
  }
  embersLoopId = setTimeout(loop, 60);
}

function stopDragEmbers() {
  if (embersLoopId !== null) {
    clearTimeout(embersLoopId);
    embersLoopId = null;
  }
}

function spawnCellShimmer(row, col) {
  const frame = document.getElementById('ipad-frame');
  const cell  = cells[row][col];
  const fRect = frame.getBoundingClientRect();
  const cRect = cell.getBoundingClientRect();
  const s     = fRect.width / 1180;

  const el = document.createElement('div');
  el.className  = 'cell-shimmer';
  el.style.left   = `${(cRect.left - fRect.left) / s}px`;
  el.style.top    = `${(cRect.top  - fRect.top)  / s}px`;
  el.style.width  = `${cRect.width  / s}px`;
  el.style.height = `${cRect.height / s}px`;
  frame.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

// ── AI ────────────────────────────────────────────────────────────────────────

const AI_WEIGHTS = [
  [120, -20,  20,  5,  5,  20, -20, 120],
  [-20, -40,  -5, -5, -5,  -5, -40, -20],
  [ 20,  -5,  15,  3,  3,  15,  -5,  20],
  [  5,  -5,   3,  3,  3,   3,  -5,   5],
  [  5,  -5,   3,  3,  3,   3,  -5,   5],
  [ 20,  -5,  15,  3,  3,  15,  -5,  20],
  [-20, -40,  -5, -5, -5,  -5, -40, -20],
  [120, -20,  20,  5,  5,  20, -20, 120],
];

function applyMove(b, row, col, player) {
  const nb = b.map(r => [...r]);
  const flips = getFlips(nb, row, col, player);
  nb[row][col] = player;
  flips.forEach(([r, c]) => { nb[r][c] = player; });
  return nb;
}

function aiEval(b, aiPlayer) {
  const opp = aiPlayer === BLACK ? WHITE : BLACK;
  let score = 0;
  for (let r = 0; r < SIZE; r++)
    for (let c = 0; c < SIZE; c++) {
      if      (b[r][c] === aiPlayer) score += AI_WEIGHTS[r][c];
      else if (b[r][c] === opp)      score -= AI_WEIGHTS[r][c];
    }
  score += 8 * (getValidMoves(b, aiPlayer).length - getValidMoves(b, opp).length);
  return score;
}

function minimax(b, depth, alpha, beta, maximizing, aiPlayer) {
  const player = maximizing ? aiPlayer : (aiPlayer === BLACK ? WHITE : BLACK);
  const moves  = getValidMoves(b, player);

  if (depth === 0) return aiEval(b, aiPlayer);
  if (moves.length === 0) {
    const opp = aiPlayer === BLACK ? WHITE : BLACK;
    if (getValidMoves(b, opp).length === 0) return aiEval(b, aiPlayer);
    return minimax(b, depth - 1, alpha, beta, !maximizing, aiPlayer);
  }

  if (maximizing) {
    let best = -Infinity;
    for (const [r, c] of moves) {
      best = Math.max(best, minimax(applyMove(b, r, c, player), depth - 1, alpha, beta, false, aiPlayer));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const [r, c] of moves) {
      best = Math.min(best, minimax(applyMove(b, r, c, player), depth - 1, alpha, beta, true, aiPlayer));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function getBestMove(player) {
  const moves = getValidMoves(board, player);
  if (moves.length === 0) return null;
  let best = moves[0], bestVal = -Infinity;
  for (const [r, c] of moves) {
    const val = minimax(applyMove(board, r, c, player), 5, -Infinity, Infinity, false, player);
    if (val > bestVal) { bestVal = val; best = [r, c]; }
  }
  return best;
}

function scheduleAiMove() {
  setTimeout(() => {
    if (!gameActive) return;
    const move = getBestMove(currentPlayer);
    if (!move) return;
    const [row, col] = move;
    const idx   = row * SIZE + col;
    const flips = getFlips(board, row, col, currentPlayer);
    board[row][col] = currentPlayer;
    flips.forEach(([r, c]) => { board[r][c] = currentPlayer; });
    if (currentPlayer === WHITE) spawnGlindaBubbles(row, col);
    else                         spawnElphabaEffect(row, col);
    spawnCellShimmer(row, col);
    advanceTurn(flips, [row, col]);
  }, 700);
}

// ── Character assignment ──────────────────────────────────────────────────────

function updateStartModals() {
  document.querySelector('#start-modal-left  .start-char-name').textContent =
    elphabaOnLeft ? 'Elphaba' : 'Glinda';
  document.querySelector('#start-modal-right .start-char-name').textContent =
    elphabaOnLeft ? 'Glinda' : 'Elphaba';
}

function startRandomize() {
  if (isAnimating) return;
  isAnimating = true;

  const willSwap   = Math.random() < 0.5;
  const totalAngle = 3 * 2 * Math.PI + (willSwap ? Math.PI : 0);
  const duration   = 2400;

  const overlay  = document.getElementById('start-overlay');
  const tokenE   = document.getElementById('token-elphaba');
  const tokenG   = document.getElementById('token-glinda');

  const cx = 590, cy = 410, r = 260, half = 40;

  // Starting angle: Elphaba left = π, Elphaba right = 0
  const startAngle = elphabaOnLeft ? Math.PI : 0;

  function place(el, angle) {
    el.style.left = `${cx + r * Math.cos(angle) - half}px`;
    el.style.top  = `${cy + r * Math.sin(angle) - half}px`;
  }

  // Set initial token positions before revealing
  place(tokenE, startAngle);
  place(tokenG, startAngle + Math.PI);

  overlay.classList.add('animating');

  // Brief delay so modals fade before tokens appear
  setTimeout(() => {
    tokenE.style.opacity = '1';
    tokenG.style.opacity = '1';
  }, 200);

  const t0 = performance.now();

  function tick(now) {
    const t     = Math.min((now - t0) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);      // cubic ease-out
    const θ     = eased * totalAngle;

    place(tokenE, startAngle         + θ);
    place(tokenG, startAngle + Math.PI + θ);

    if (t < 1) {
      requestAnimationFrame(tick);
    } else {
      // Commit assignment
      if (willSwap) elphabaOnLeft = !elphabaOnLeft;
      document.getElementById('ipad-frame').classList.toggle('glinda-left', !elphabaOnLeft);
      updateStartModals();

      // Fade tokens, restore modals
      tokenE.style.opacity = '0';
      tokenG.style.opacity = '0';
      overlay.classList.remove('animating');
      document.querySelectorAll('.btn-continue').forEach(b => b.classList.remove('ready'));
      isAnimating = false;
    }
  }

  requestAnimationFrame(tick);
}

// ── Game flow ─────────────────────────────────────────────────────────────────

function newGame() {
  dragActive = false;
  hintsVisible = false;
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
  if (isAiTurn()) scheduleAiMove();
}

function advanceTurn(flips, placed) {
  const next      = currentPlayer === BLACK ? WHITE : BLACK;
  const nextMoves = getValidMoves(board, next);
  const currMoves = getValidMoves(board, currentPlayer);

  if (nextMoves.length > 0) {
    currentPlayer = next;
    triggerBevelSpin();
    refreshBoard(flips, placed);
    updatePanels();
    updateSlots();
    setStatus(`${playerName(currentPlayer)}'s turn`);
    if (isAiTurn()) scheduleAiMove();
  } else if (currMoves.length > 0) {
    refreshBoard(flips, placed);
    updatePanels();
    updateSlots();
    setStatus(`${playerName(next)} has no moves — ${playerName(currentPlayer)} plays again`, true);
    if (isAiTurn()) scheduleAiMove();
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

  document.querySelectorAll('.btn-play-again').forEach(b => b.classList.remove('ready'));
  ['left', 'right'].forEach(side => {
    if (selectedUsers[side] === 'AI')
      document.querySelector(`#modal-${side} .btn-play-again`).classList.add('ready');
  });
  if (document.querySelectorAll('.btn-play-again.ready').length === 2)
    setTimeout(() => { document.querySelectorAll('.btn-play-again').forEach(b => b.classList.remove('ready')); newGame(); }, 1500);
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
  document.getElementById('randomize-btn').addEventListener('click', startRandomize);

  ['left', 'right'].forEach(side => {
    document.querySelectorAll(`#start-modal-${side} .btn-username`).forEach(btn => {
      btn.addEventListener('click', () => {
        selectedUsers[side] = selectedUsers[side] === btn.dataset.name ? null : btn.dataset.name;
        updateUsernameUI();
      });
    });

    document.querySelector(`#start-modal-${side} .btn-ai-toggle`).addEventListener('click', () => {
      selectedUsers[side] = selectedUsers[side] === 'AI' ? null : 'AI';
      updateUsernameUI();
    });
  });

  document.querySelectorAll('.btn-continue').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('ready');
      const bothReady = document.querySelectorAll('#start-overlay .btn-continue.ready').length === 2;
      if (bothReady) {
        setTimeout(() => {
          document.querySelectorAll('.btn-continue').forEach(b => b.classList.remove('ready'));
          document.getElementById('start-overlay').classList.add('hidden');
          document.querySelector('#name-strip-left  span').textContent = selectedUsers.left  || '';
          document.querySelector('#name-strip-right span').textContent = selectedUsers.right || '';
          newGame();
        }, 350);
      }
    });
  });

  document.querySelectorAll('.unlock-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const n = parseInt(btn.dataset.n);
      btn.classList.add('lit');
      setTimeout(() => btn.classList.remove('lit'), 380);
      unlockProgress.push(n);
      if (unlockProgress.length > UNLOCK_SEQ.length) unlockProgress.shift();
      if (unlockProgress.length === UNLOCK_SEQ.length &&
          unlockProgress.every((v, i) => v === UNLOCK_SEQ[i])) {
        unlockProgress = [];
        document.querySelectorAll('.btn-ai-toggle').forEach(b => b.disabled = false);
        document.querySelectorAll('.unlock-btn').forEach(b => {
          b.classList.add('lit');
          setTimeout(() => b.classList.remove('lit'), 700);
        });
      }
    });
  });

  document.querySelectorAll('.btn-new-game').forEach(btn =>
    btn.addEventListener('click', newGame)
  );
  document.querySelectorAll('.btn-play-again').forEach(btn =>
    btn.addEventListener('click', () => {
      btn.classList.toggle('ready');
      if (document.querySelectorAll('.btn-play-again.ready').length === 2) {
        document.querySelectorAll('.btn-play-again').forEach(b => b.classList.remove('ready'));
        newGame();
      }
    })
  );

  window.addEventListener('resize', scaleFrame);
  scaleFrame();
});
