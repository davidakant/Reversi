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
let _dragHalf = 0, _dragRafId = null, _pendingClientX = 0, _pendingClientY = 0;
let _floatingEl = null;
let elphabaOnLeft = true, isAnimating = false;
let gloatUsesLeft = 0, _gloatText = '';
let hintsVisible = false;
const selectedUsers = { left: null, right: null };

function updateUsernameUI() {
  ['left', 'right'].forEach(side => {
    const other = side === 'left' ? 'right' : 'left';
    const modal = document.getElementById(`start-modal-${side}`);
    modal.querySelectorAll('.btn-username').forEach(btn => {
      btn.classList.toggle('selected', selectedUsers[side] === btn.dataset.name);
      btn.disabled = selectedUsers[other] === btn.dataset.name;
    });
    const playBtn = modal.querySelector('.btn-continue');
    playBtn.disabled = !selectedUsers[side];
    if (!selectedUsers[side]) playBtn.classList.remove('ready');
  });
}

function isAiTurn() {
  const leftColor = elphabaOnLeft ? BLACK : WHITE;
  const side = currentPlayer === leftColor ? 'left' : 'right';
  return selectedUsers[side] === 'COMPUTER';
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

// Builds the outward-rippling order of cells affected by a move: the
// placed cell (step 0), then each flipped cell and its anchor, numbered
// by distance along their line — used to stagger the flip/shimmer effects.
function getStaggerInfo(row, col, flips) {
  const flipSet = new Set(flips.map(([r, c]) => `${r},${c}`));
  const info = [{ row, col, step: 0 }];
  for (const [dr, dc] of DIRS) {
    let r = row + dr, c = col + dc;
    if (!flipSet.has(`${r},${c}`)) continue;
    let step = 1;
    while (flipSet.has(`${r},${c}`)) {
      info.push({ row: r, col: c, step });
      r += dr; c += dc; step++;
    }
    info.push({ row: r, col: c, step });
  }
  return info;
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

function refreshBoard(flipped = [], placed = null, stagger = null) {
  const validSet = (gameActive && hintsVisible)
    ? new Set(getValidMoves(board, currentPlayer).map(([r, c]) => `${r},${c}`))
    : new Set();
  const flipSet  = new Set(flipped.map(([r, c]) => `${r},${c}`));
  const placeKey = placed ? `${placed[0]},${placed[1]}` : null;

  const flipDelay = new Map();
  if (stagger) {
    stagger.forEach(({ row, col, step }) => {
      if (step > 0) flipDelay.set(`${row},${col}`, step);
    });
  }

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const cell = cells[r][c];
      cell.innerHTML = '';
      const key = `${r},${c}`;
      const val = board[r][c];

      if (val !== EMPTY) {
        const piece = document.createElement('div');
        piece.className = 'piece ' + (val === BLACK ? 'black' : 'white');
        if (flipSet.has(key)) {
          piece.classList.add('flip');
          const step = flipDelay.get(key);
          if (step) piece.style.animationDelay = `${step * STAGGER_STEP_MS}ms`;
        } else if (key === placeKey) piece.classList.add('place');
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
  const leftColor = elphabaOnLeft ? BLACK : WHITE;
  ['left', 'right'].forEach(side => {
    const slotEl = document.getElementById(`${side}-slot`);
    const player = side === 'left' ? leftColor : (leftColor === BLACK ? WHITE : BLACK);
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

  _floatingEl = document.getElementById('floating-piece');
  _floatingEl.className = `piece ${player === BLACK ? 'black' : 'white'}`;
  _floatingEl.style.transition = 'none';

  _dragHalf = _floatingEl.offsetWidth / 2; // read once; won't change during drag

  const { x, y } = toFrameCoords(e.clientX, e.clientY);
  _floatingEl.style.transform = `translate(${x - _dragHalf}px, ${y - _dragHalf}px)`;

  slotEl.style.opacity = '0.25';
  document.getElementById('ipad-frame').classList.add('dragging');
  dragFrameX = x;
  dragFrameY = y;
  _pendingClientX = e.clientX;
  _pendingClientY = e.clientY;
  lastDragMoveTime = performance.now();
  if (player === WHITE) startDragBubbles();
  else                  startDragEmbers();
}

function _applyDragPosition() {
  _dragRafId = null;
  const { x, y } = toFrameCoords(_pendingClientX, _pendingClientY);
  _floatingEl.style.transform = `translate(${x - _dragHalf}px, ${y - _dragHalf}px)`;
  updateDragHover(_pendingClientX, _pendingClientY);
}

function moveDrag(e) {
  _pendingClientX = e.clientX;
  _pendingClientY = e.clientY;
  const { x, y } = toFrameCoords(e.clientX, e.clientY);
  dragFrameX = x;
  dragFrameY = y;
  lastDragMoveTime = performance.now();
  if (!_dragRafId) _dragRafId = requestAnimationFrame(_applyDragPosition);
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
  if (_dragRafId) { cancelAnimationFrame(_dragRafId); _dragRafId = null; }
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
        const stagger = getStaggerInfo(row, col, flips);
        flashCells(stagger);
        playSfxMove(stagger, flips, [row, col]);
        advanceTurn(flips, [row, col], stagger);
        return;
      }
      sfxInvalid();
    }
  }

  hintsVisible = true;
  refreshBoard();
  cancelDrag(slotEl);
}

function cancelDrag(slotEl) {
  if (_dragRafId) { cancelAnimationFrame(_dragRafId); _dragRafId = null; }
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

const STAGGER_STEP_MS  = 120;
const FLASH_DURATION_MS = 1100;

function flashCells(stagger) {
  stagger.forEach(({ row, col, step }) => {
    const cell  = cells[row][col];
    const delay = step * STAGGER_STEP_MS;
    cell.style.setProperty('--flash-delay', `${delay}ms`);
    cell.classList.add('flash-yellow');
    cell.classList.remove('piece-glow');
    void cell.offsetWidth;
    cell.classList.add('piece-glow');
    setTimeout(() => {
      cell.classList.remove('flash-yellow', 'piece-glow');
      cell.style.removeProperty('--flash-delay');
    }, delay + FLASH_DURATION_MS);
  });
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
    const stagger = getStaggerInfo(row, col, flips);
    flashCells(stagger);
    playSfxMove(stagger, flips, [row, col]);
    advanceTurn(flips, [row, col], stagger);
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
  startMusic();
  document.getElementById('overlay').classList.add('hidden');
  buildGrid();
  refreshBoard();
  updatePanels();
  updateSlots();
  setStatus(`${playerName(BLACK)}'s turn`);
  if (isAiTurn()) scheduleAiMove();
}

function advanceTurn(flips, placed, stagger) {
  const next      = currentPlayer === BLACK ? WHITE : BLACK;
  const nextMoves = getValidMoves(board, next);
  const currMoves = getValidMoves(board, currentPlayer);

  if (nextMoves.length > 0) {
    currentPlayer = next;
    triggerBevelSpin();
    refreshBoard(flips, placed, stagger);
    updatePanels();
    updateSlots();
    setStatus(`${playerName(currentPlayer)}'s turn`);
    setTimeout(sfxTurnChange, 480);
    if (isAiTurn()) scheduleAiMove();
  } else if (currMoves.length > 0) {
    refreshBoard(flips, placed, stagger);
    updatePanels();
    updateSlots();
    setStatus(`${playerName(next)} has no moves — ${playerName(currentPlayer)} plays again`, true);
    if (isAiTurn()) scheduleAiMove();
  } else {
    gameActive = false;
    refreshBoard(flips, placed, stagger);
    updatePanels();
    updateSlots();
    setStatus('Game over');
    const { black, white } = countPieces(board);
    if (white > black) {
      spawnGlindaVictory();
      setTimeout(showGameOver, 4200);
    } else if (black > white) {
      spawnElphabaVictory();
      setTimeout(showGameOver, 4200);
    } else {
      setTimeout(sfxGameOver, 650);
      setTimeout(showGameOver, 600);
    }
  }
}

function showGameOver() {
  const { black, white } = countPieces(board);
  let msg;
  if      (black > white) msg = `${playerName(BLACK)} Wins!`;
  else if (white > black) msg = `${playerName(WHITE)} Wins!`;
  else                    msg = "It's a Tie!";

  ['left', 'right'].forEach(p => {
    document.getElementById(`${p}-final-black`).textContent = black;
    document.getElementById(`${p}-final-white`).textContent = white;
    document.getElementById(`${p}-winner`).textContent      = msg;
  });

  document.getElementById('overlay').classList.remove('hidden');

  document.querySelectorAll('.btn-play-again').forEach(b => b.classList.remove('ready'));

  // Gloat button: active only on winner's side, 3 uses
  gloatUsesLeft = 0;
  _gloatText = '';
  document.querySelectorAll('.btn-gloat').forEach(b => { b.disabled = true; });

  let winnerSide = null;
  if (black > white) {
    _gloatText = 'Elphaba wins. Haahaa!';
    winnerSide = elphabaOnLeft ? 'left' : 'right';
  } else if (white > black) {
    _gloatText = 'Glinda wins. Haahaa!';
    winnerSide = elphabaOnLeft ? 'right' : 'left';
  }
  if (winnerSide) {
    gloatUsesLeft = 3;
    document.querySelector(`#modal-${winnerSide} .btn-gloat`).disabled = false;
  }
}

// ── Audio ─────────────────────────────────────────────────────────────────────

let musicEnabled = true;
let sfxEnabled   = true;
let _audioCtx    = null;
let _musicAudio = null;   // HTMLAudioElement currently playing
let _musicTrack = 'a';   // 'a' | 'b'

let MUSIC_VOL = 0.75;
let SFX_VOL   = 0.22;

const MUSIC_FILES = { a: 'music-a.mp3', b: 'music-b.mp3', c: 'music-c.mp3' };

function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  return _audioCtx;
}

function startMusic() {
  if (!musicEnabled) return;
  if (_musicAudio && !_musicAudio.paused) return;
  if (!_musicAudio) {
    _musicAudio        = new Audio(MUSIC_FILES[_musicTrack]);
    _musicAudio.volume = MUSIC_VOL;
    _musicAudio.addEventListener('ended', () => {
      const order = ['a', 'b', 'c'];
      switchMusicTrack(order[(order.indexOf(_musicTrack) + 1) % order.length]);
    });
  }
  _musicAudio.play().catch(() => {});
}

function stopMusic() {
  if (!_musicAudio) return;
  _musicAudio.pause();
  _musicAudio.currentTime = 0;
}

function switchMusicTrack(track) {
  _musicTrack = track;
  const wasPlaying = _musicAudio && (!_musicAudio.paused || _musicAudio.ended);
  if (_musicAudio) { _musicAudio.pause(); _musicAudio = null; }
  if (wasPlaying && musicEnabled) startMusic();
  document.querySelector('.btn-music-a').classList.toggle('active', track === 'a');
  document.querySelector('.btn-music-b').classList.toggle('active', track === 'b');
  document.querySelector('.btn-music-c').classList.toggle('active', track === 'c');
  saveAudioPrefs();
}

function saveAudioPrefs() {
  localStorage.setItem('reversi_musicEnabled', musicEnabled);
  localStorage.setItem('reversi_sfxEnabled',   sfxEnabled);
  localStorage.setItem('reversi_musicVol',     MUSIC_VOL);
  localStorage.setItem('reversi_sfxVol',       SFX_VOL);
  localStorage.setItem('reversi_musicTrack',   _musicTrack);
}

function toggleMusic() {
  musicEnabled = !musicEnabled;
  document.getElementById('btn-music').classList.toggle('muted', !musicEnabled);
  if (musicEnabled) startMusic();
  else if (_musicAudio) _musicAudio.pause();
  saveAudioPrefs();
}

// ── SFX ───────────────────────────────────────────────────────────────────────

function sfxFlip(delayMs = 0) {
  if (!sfxEnabled) return;
  const ctx = getAudioCtx();
  const t   = ctx.currentTime + delayMs / 1000;

  // Mario coin: square wave jumps B5 → E6 after 45ms, fast decay
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(988.0,  t);
  osc.frequency.setValueAtTime(1319.0, t + 0.045);
  gain.gain.setValueAtTime(SFX_VOL * 0.45, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.10);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.12);
}

function sfxInvalid() {
  if (!sfxEnabled) return;
  const ctx = getAudioCtx();
  const t   = ctx.currentTime;

  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(160, t);
  osc.frequency.exponentialRampToValueAtTime(80, t + 0.10);
  gain.gain.setValueAtTime(SFX_VOL * 0.40, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.13);
}

function sfxTurnChange() {
  if (!sfxEnabled) return;
  const ctx = getAudioCtx();
  const t   = ctx.currentTime;

  [523.25, 783.99].forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    const ts   = t + i * 0.13;
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ts);
    gain.gain.linearRampToValueAtTime(SFX_VOL * 0.55, ts + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ts + 0.38);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ts);
    osc.stop(ts + 0.42);
  });
}

function sfxGameOver() {
  if (!sfxEnabled) return;
  const ctx = getAudioCtx();
  const t   = ctx.currentTime;

  [392, 523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    const ts   = t + i * 0.19;
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, ts);
    gain.gain.linearRampToValueAtTime(SFX_VOL * 0.75, ts + 0.04);
    gain.gain.exponentialRampToValueAtTime(0.001, ts + 0.9);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(ts);
    osc.stop(ts + 1.0);
  });
}

// Schedule a flip swoosh for each piece in the move (placed + flipped, not anchors).
function playSfxMove(stagger, flips, placed) {
  if (!sfxEnabled) return;
  const moveKeys = new Set([...flips, placed].map(([r, c]) => `${r},${c}`));
  stagger
    .filter(({ row, col }) => moveKeys.has(`${row},${col}`))
    .forEach(({ step }) => sfxFlip(step * STAGGER_STEP_MS));
}

function toggleSfx() {
  sfxEnabled = !sfxEnabled;
  document.getElementById('btn-sfx').classList.toggle('muted', !sfxEnabled);
  saveAudioPrefs();
}

// ── Victory celebrations ───────────────────────────────────────────────────────

// side: 'left' | 'right' — which panel the winner occupies
function spawnVictoryBubble(frame, delayMs, side) {
  setTimeout(() => {
    const b      = document.createElement('div');
    b.className  = 'victory-bubble';
    const size   = 22 + Math.random() * 58;
    const y      = 40 + Math.random() * 740;
    const travel = 820 + Math.random() * 300;
    const riseY  = (Math.random() - 0.4) * 220;
    const tx     = side === 'left' ? travel : -travel;
    const startX = side === 'left' ? (Math.random() * 70 - size) : (1180 - Math.random() * 70);
    const dur    = 2000 + Math.random() * 1800;
    const hue    = Math.random() * 360;
    b.style.cssText = `width:${size}px;height:${size}px;left:${startX}px;top:${y}px;`;
    frame.appendChild(b);
    const anim = b.animate([
      { transform: 'translate(0,0) scale(0.15)',                                                      opacity: 0,   filter: `hue-rotate(${hue}deg)` },
      { transform: `translate(${tx*.06}px,${-riseY*.06}px) scale(1)`,                                opacity: 0.9, filter: `hue-rotate(${hue+80}deg)`,  offset: 0.09 },
      { transform: `translate(${tx*.5}px,${-riseY*.5}px) scale(0.92)`,                               opacity: 0.8, filter: `hue-rotate(${hue+200}deg)`, offset: 0.55 },
      { transform: `translate(${tx}px,${-riseY}px) scale(0.65)`,                                     opacity: 0,   filter: `hue-rotate(${hue+360}deg)` },
    ], { duration: dur, easing: 'ease-out', fill: 'forwards' });
    anim.onfinish = () => b.remove();
  }, delayMs);
}

// Flames rotate 90° CW and flicker in place at Elphaba's panel edge.
// transform-origin: 50% 100% pins the hot base to the wall; the tip licks inward.
function spawnVictoryFlame(frame, side) {
  const f   = document.createElement('div');
  f.className = 'victory-flame';
  const w   = 20 + Math.random() * 45;          // thickness (vertical on screen)
  const h   = 50 + Math.random() * 180;         // length (horizontal on screen)
  const y   = 30 + Math.random() * 760;
  const rot = side === 'left' ? 90 : -90;
  const dur = 400 + Math.random() * 600;

  // Pin the base (transform-origin 50% 100%) to the panel wall
  const left = side === 'left' ? -w / 2 : 1180 - w / 2;
  const top  = y - h;

  f.style.cssText = `width:${w}px;height:${h}px;left:${left}px;top:${top}px;transform-origin:50% 100%;`;
  frame.appendChild(f);

  const pk  = (0.65 + Math.random() * 0.35).toFixed(2);   // peak length
  const d1  = (0.45 + Math.random() * 0.30).toFixed(2);   // dip
  const pk2 = (0.55 + Math.random() * 0.35).toFixed(2);   // secondary peak
  const xw  = (0.75 + Math.random() * 0.25).toFixed(2);   // width pulse

  const anim = f.animate([
    { transform: `rotate(${rot}deg) scaleY(0.05) scaleX(0.3)`,    opacity: 0   },
    { transform: `rotate(${rot}deg) scaleY(${pk})  scaleX(1)`,    opacity: 1,   offset: 0.18 },
    { transform: `rotate(${rot}deg) scaleY(${d1})  scaleX(${xw})`,opacity: 0.8, offset: 0.44 },
    { transform: `rotate(${rot}deg) scaleY(${pk2}) scaleX(0.9)`,  opacity: 0.9, offset: 0.70 },
    { transform: `rotate(${rot}deg) scaleY(0.1)   scaleX(0.4)`,   opacity: 0   },
  ], { duration: dur, easing: 'ease-in-out', fill: 'forwards' });
  anim.onfinish = () => f.remove();
}

// Smoke starts at Elphaba's panel edge and travels horizontally toward Glinda's side,
// with a gentle upward drift as it expands.
function spawnVictorySmoke(frame, side) {
  const s      = document.createElement('div');
  s.className  = 'victory-smoke';
  const size   = 45 + Math.random() * 80;
  const y      = 50 + Math.random() * 720;
  const travel = 600 + Math.random() * 400;
  const riseY  = 60 + Math.random() * 180;
  const tx     = side === 'left' ? travel : -travel;
  const startX = side === 'left' ? (-size + Math.random() * 30) : (1180 - Math.random() * 30);
  const dur    = 2800 + Math.random() * 1800;
  const delay  = Math.random() * 400;
  s.style.cssText = `width:${size}px;height:${size}px;left:${startX}px;top:${y}px;`;
  frame.appendChild(s);
  const anim = s.animate([
    { transform: 'translate(0,0) scale(0.25)',                                                   opacity: 0   },
    { transform: `translate(${tx*.08}px,${-riseY*.08}px) scale(0.85)`,                          opacity: 0.6, offset: 0.14 },
    { transform: `translate(${tx*.5}px,${-riseY*.5}px) scale(1.4)`,                             opacity: 0.4, offset: 0.6  },
    { transform: `translate(${tx}px,${-riseY}px) scale(2.2)`,                                   opacity: 0   },
  ], { duration: dur, delay, easing: 'ease-out', fill: 'forwards' });
  anim.onfinish = () => s.remove();
}

function spawnGlindaVictory() {
  const frame = document.getElementById('ipad-frame');
  const side  = elphabaOnLeft ? 'right' : 'left';  // Glinda's panel side
  for (let i = 0; i < 18; i++) spawnVictoryBubble(frame, Math.random() * 600, side);
  const end = Date.now() + 4000;
  const id  = setInterval(() => {
    if (Date.now() >= end) { clearInterval(id); return; }
    for (let i = 0; i < 4; i++) spawnVictoryBubble(frame, Math.random() * 80, side);
  }, 90);
  sfxGlindaVictory();
}

function spawnElphabaVictory() {
  const frame = document.getElementById('ipad-frame');
  const side  = elphabaOnLeft ? 'left' : 'right';  // Elphaba's side — smoke drifts opposite
  const end   = Date.now() + 4000;
  const id    = setInterval(() => {
    if (Date.now() >= end) { clearInterval(id); return; }
    for (let i = 0; i < 5; i++) spawnVictoryFlame(frame, side);
    for (let i = 0; i < 4; i++) spawnVictorySmoke(frame, side);
  }, 75);
  sfxElphabaVictory();
}

function sfxGlindaVictory() {
  if (!sfxEnabled) return;
  const ctx   = getAudioCtx();
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1567.98]; // C5–G6
  [0, 1.3, 2.7].forEach((offset, wave) => {
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      const t    = ctx.currentTime + offset + i * 0.13;
      osc.type   = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(SFX_VOL * (0.5 - wave * 0.06), t + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.75);
    });
  });
}

function sfxElphabaVictory() {
  sfxGlindaVictory();
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
  // Restore saved audio preferences
  const sm = localStorage.getItem('reversi_musicEnabled');
  const ss = localStorage.getItem('reversi_sfxEnabled');
  const mv = localStorage.getItem('reversi_musicVol');
  const sv = localStorage.getItem('reversi_sfxVol');
  const st = localStorage.getItem('reversi_musicTrack');
  if (sm !== null) musicEnabled = sm === 'true';
  if (ss !== null) sfxEnabled   = ss === 'true';
  if (mv !== null) MUSIC_VOL    = parseFloat(mv);
  if (sv !== null) SFX_VOL      = parseFloat(sv);
  if (st !== null) _musicTrack  = st;
  document.getElementById('btn-music').classList.toggle('muted', !musicEnabled);
  document.getElementById('btn-sfx').classList.toggle('muted', !sfxEnabled);
  document.getElementById('music-slider').value = Math.round(MUSIC_VOL * 100);
  document.getElementById('sfx-slider').value   = Math.round(SFX_VOL   * 100);
  document.querySelector('.btn-music-a').classList.toggle('active', _musicTrack === 'a');
  document.querySelector('.btn-music-b').classList.toggle('active', _musicTrack === 'b');
  document.querySelector('.btn-music-c').classList.toggle('active', _musicTrack === 'c');

  document.getElementById('randomize-btn').addEventListener('click', startRandomize);

  ['left', 'right'].forEach(side => {
    document.querySelectorAll(`#start-modal-${side} .btn-username`).forEach(btn => {
      btn.addEventListener('click', () => {
        selectedUsers[side] = selectedUsers[side] === btn.dataset.name ? null : btn.dataset.name;
        updateUsernameUI();
      });
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

  document.getElementById('board').addEventListener('dblclick', () => {
    if (!gameActive) return;
    const isLeft = elphabaOnLeft ? currentPlayer === BLACK : currentPlayer === WHITE;
    const quitOverlay = document.getElementById('quit-overlay');
    quitOverlay.classList.toggle('rotate-left', isLeft);
    quitOverlay.classList.toggle('rotate-right', !isLeft);
    quitOverlay.querySelector('.quit-text').textContent = `${playerName(currentPlayer)} paused the game`;
    quitOverlay.classList.remove('hidden');
  });

  document.getElementById('quit-overlay').addEventListener('click', function(e) {
    if (e.target === this) this.classList.add('hidden');
  });

  document.querySelector('.btn-start-over').addEventListener('click', () => {
    document.getElementById('quit-overlay').classList.add('hidden');
    newGame();
  });

  document.querySelector('.btn-exit').addEventListener('click', () => {
    gameActive = false;
    document.getElementById('quit-overlay').classList.add('hidden');
    document.getElementById('start-overlay').classList.remove('hidden');
  });

  document.getElementById('btn-music').addEventListener('click', toggleMusic);
  document.getElementById('btn-sfx').addEventListener('click', toggleSfx);

  document.getElementById('music-slider').addEventListener('input', e => {
    MUSIC_VOL = e.target.value / 100;
    if (_musicAudio) _musicAudio.volume = MUSIC_VOL;
    saveAudioPrefs();
  });

  document.getElementById('sfx-slider').addEventListener('input', e => {
    SFX_VOL = e.target.value / 100;
    saveAudioPrefs();
  });

  document.querySelector('.btn-music-a').addEventListener('click', () => switchMusicTrack('a'));
  document.querySelector('.btn-music-b').addEventListener('click', () => switchMusicTrack('b'));
  document.querySelector('.btn-music-c').addEventListener('click', () => switchMusicTrack('c'));

  document.querySelectorAll('.btn-play-again').forEach(btn =>
    btn.addEventListener('click', () => {
      btn.classList.toggle('ready');
      if (document.querySelectorAll('.btn-play-again.ready').length === 2) {
        document.querySelectorAll('.btn-play-again').forEach(b => b.classList.remove('ready'));
        newGame();
      }
    })
  );

  document.querySelectorAll('.btn-gloat').forEach(btn =>
    btn.addEventListener('click', () => {
      if (gloatUsesLeft <= 0 || !_gloatText) return;
      const utt = new SpeechSynthesisUtterance(_gloatText);
      const femaleVoice = window.speechSynthesis.getVoices()
        .find(v => /zira|samantha|eva|aria|female/i.test(v.name));
      if (femaleVoice) utt.voice = femaleVoice;
      window.speechSynthesis.speak(utt);
      gloatUsesLeft--;
      if (gloatUsesLeft <= 0) {
        document.querySelectorAll('.btn-gloat').forEach(b => { b.disabled = true; });
      }
    })
  );

  window.addEventListener('resize', scaleFrame);
  scaleFrame();
});
