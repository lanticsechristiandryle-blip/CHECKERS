/* ============================================================
   CDL CHECKERS — game.js
   - Player vs Computer only
   - Flying kings (bishop-style slide + jump)
   - Regular pieces can capture backwards
   - Incremental DOM rendering (no flicker)
   ============================================================ */

'use strict';

/* ---- Nav scroll effect ---- */
(function initNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 8);
  }, { passive: true });
  nav.classList.toggle('scrolled', window.scrollY > 8);
})();

/* ============================================================
   CONSTANTS
   ============================================================ */

const EMPTY = 0;
const P1    = 1;   // red   — human — advances toward row 0
const P2    = 2;   // white — AI    — advances toward row 7
const P1K   = 3;
const P2K   = 4;

const ROWS = 8;
const COLS = 8;

const ALL_DIRS  = [[-1,-1],[-1,1],[1,-1],[1,1]];
const P1_FWDS   = [[-1,-1],[-1,1]];   // forward for P1
const P2_FWDS   = [[ 1,-1],[ 1,1]];   // forward for P2

/* ============================================================
   GAME STATE
   ============================================================ */

let board          = [];
let currentTurn    = P1;
let selected       = null;
let validMoves     = [];
let mustJumps      = [];
let gameOver       = false;
let aiThinking     = false;
let multiJumpPiece = null;

/* snapshot of the last board state actually painted to the DOM,
   used for incremental rendering */
let renderedBoard  = null;
let renderedSel    = null;    // stringified selected
let renderedMoves  = null;    // stringified valid move targets

/* ============================================================
   HELPERS
   ============================================================ */

const idx      = (r, c) => r * COLS + c;
const isDark   = (r, c) => (r + c) % 2 === 1;
const inBounds = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;

const isOwnedBy = (piece, player) => {
  if (player === P1) return piece === P1 || piece === P1K;
  if (player === P2) return piece === P2 || piece === P2K;
  return false;
};
const isEnemy  = (piece, player) => piece !== EMPTY && !isOwnedBy(piece, player);
const isKing   = (piece) => piece === P1K || piece === P2K;

/* Forward directions for simple moves (kings use all 4) */
function getMoveDirs(piece) {
  if (isKing(piece))   return ALL_DIRS;
  if (piece === P1)     return P1_FWDS;
  if (piece === P2)     return P2_FWDS;
  return [];
}

/* ============================================================
   BOARD SETUP
   ============================================================ */

function buildInitialBoard() {
  const b = new Array(ROWS * COLS).fill(EMPTY);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isDark(r, c)) {
        if (r < 3) b[idx(r, c)] = P2;
        if (r > 4) b[idx(r, c)] = P1;
      }
    }
  }
  return b;
}

/* ============================================================
   MOVE GENERATION
   ============================================================ */

/**
 * Simple (non-jump) moves.
 * Kings slide any number of squares along each diagonal (flying king).
 * Regular pieces move one square forward only.
 */
function getSimpleMovesForPiece(row, col, b) {
  const piece = b[idx(row, col)];
  const dirs  = getMoveDirs(piece);
  const moves = [];

  if (isKing(piece)) {
    dirs.forEach(([dr, dc]) => {
      let r = row + dr, c = col + dc;
      while (inBounds(r, c) && b[idx(r, c)] === EMPTY) {
        moves.push({ fromRow: row, fromCol: col, toRow: r, toCol: c,
                     isJump: false, captures: [] });
        r += dr; c += dc;
      }
    });
  } else {
    dirs.forEach(([dr, dc]) => {
      const nr = row + dr, nc = col + dc;
      if (inBounds(nr, nc) && b[idx(nr, nc)] === EMPTY)
        moves.push({ fromRow: row, fromCol: col, toRow: nr, toCol: nc,
                     isJump: false, captures: [] });
    });
  }
  return moves;
}

/**
 * Jump moves.
 *
 * Regular pieces: capture in ALL 4 diagonals (can capture backwards),
 *   but land exactly 2 squares away.
 *
 * Flying kings: scan along each diagonal past empty squares until an enemy
 *   is found, then offer every empty landing square beyond it.
 */
function getJumpsForPiece(row, col, b, player, captured = []) {
  const piece = b[idx(row, col)];
  const moves = [];

  if (isKing(piece)) {
    ALL_DIRS.forEach(([dr, dc]) => {
      /* Slide past empty squares to find the first blocker */
      let r = row + dr, c = col + dc;
      while (inBounds(r, c) && b[idx(r, c)] === EMPTY) { r += dr; c += dc; }

      if (!inBounds(r, c)) return;
      const alreadyCapped = captured.some(cap => cap.row === r && cap.col === c);
      if (!isEnemy(b[idx(r, c)], player) || alreadyCapped) return;

      const capR = r, capC = c;
      /* Landing squares: any empty square beyond the captured piece */
      r += dr; c += dc;
      while (inBounds(r, c) && b[idx(r, c)] === EMPTY) {
        moves.push({ fromRow: row, fromCol: col, toRow: r, toCol: c,
                     isJump: true,
                     captures: [...captured, { row: capR, col: capC }] });
        r += dr; c += dc;
      }
    });
  } else {
    /* Regular piece — all 4 diagonal directions for captures */
    ALL_DIRS.forEach(([dr, dc]) => {
      const mr = row + dr,   mc = col + dc;
      const lr = row + dr*2, lc = col + dc*2;
      if (!inBounds(lr, lc)) return;
      const alreadyCapped = captured.some(cap => cap.row === mr && cap.col === mc);
      if (isEnemy(b[idx(mr, mc)], player) && b[idx(lr, lc)] === EMPTY && !alreadyCapped)
        moves.push({ fromRow: row, fromCol: col, toRow: lr, toCol: lc,
                     isJump: true,
                     captures: [...captured, { row: mr, col: mc }] });
    });
  }
  return moves;
}

function getMovesForPiece(row, col, b, player) {
  return [...getJumpsForPiece(row, col, b, player),
          ...getSimpleMovesForPiece(row, col, b)];
}

function getAllJumps(b, player) {
  const moves = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (isOwnedBy(b[idx(r, c)], player))
        moves.push(...getJumpsForPiece(r, c, b, player));
  return moves;
}

function getAllSimpleMoves(b, player) {
  const moves = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      if (isOwnedBy(b[idx(r, c)], player))
        moves.push(...getSimpleMovesForPiece(r, c, b));
  return moves;
}

function getAllMoves(b, player) {
  const jumps = getAllJumps(b, player);
  return jumps.length > 0 ? jumps : getAllSimpleMoves(b, player);
}

/* ============================================================
   RENDERING  — incremental (no full DOM wipe = no flicker)
   ============================================================ */

function buildBoard() {
  /* Full initial build — called once */
  const boardEl = document.getElementById('board');
  if (!boardEl) return;
  boardEl.innerHTML = '';

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell ' + (isDark(r, c) ? 'dark' : 'light');
      cell.dataset.row = r;
      cell.dataset.col = c;

      if (isDark(r, c))
        cell.addEventListener('click', () => onCellClick(r, c));

      boardEl.appendChild(cell);
    }
  }

  /* Force full repaint on next renderBoard call */
  renderedBoard = null;
  renderedSel   = null;
  renderedMoves = null;
}

function renderBoard() {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  const selKey   = selected  ? `${selected.row},${selected.col}` : '';
  const moveKeys = new Set(validMoves.map(m => `${m.toRow},${m.toCol}`));

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i       = idx(r, c);
      const piece   = board[i];
      const prevPiece = renderedBoard ? renderedBoard[i] : -1; // -1 = force update

      const key     = `${r},${c}`;
      const isSel   = (selKey === key);
      const isMove  = moveKeys.has(key);
      const wasSel  = renderedSel   === key;
      const wasMove = renderedMoves ? renderedMoves.has(key) : false;

      const pieceChanged = piece !== prevPiece;
      const stateChanged = isSel !== wasSel || isMove !== wasMove;

      if (!pieceChanged && !stateChanged) continue; // nothing to do

      const cell = boardEl.children[i];
      if (!cell) continue;

      /* ---- Highlight classes ---- */
      cell.classList.toggle('selected',   isSel);
      cell.classList.toggle('valid-move', isMove);

      if (!pieceChanged) continue; // highlight only, no piece rebuild

      /* ---- Piece content ---- */
      /* Remove existing piece element if any */
      const existing = cell.querySelector('.piece');

      if (piece === EMPTY) {
        if (existing) existing.remove();
        continue;
      }

      const isP1piece = (piece === P1 || piece === P1K);
      const isKingPiece = isKing(piece);
      const newClass = 'piece ' + (isP1piece ? 'p1' : 'p2');

      if (existing) {
        /* Piece already present — just update class and crown */
        existing.className = newClass + (isSel ? ' selected-piece' : '');
        const hasCrown = !!existing.querySelector('.king-crown');
        if (isKingPiece && !hasCrown) {
          const crown = document.createElement('span');
          crown.className = 'king-crown';
          crown.textContent = '♛';
          crown.setAttribute('aria-label', 'king');
          existing.appendChild(crown);
        } else if (!isKingPiece && hasCrown) {
          existing.querySelector('.king-crown').remove();
        }
      } else {
        /* New piece — create with fade-in animation */
        const pieceEl = document.createElement('div');
        pieceEl.className = newClass + ' piece-new' + (isSel ? ' selected-piece' : '');
        /* Remove animation class after it plays so future re-renders don't retrigger it */
        pieceEl.addEventListener('animationend', () => pieceEl.classList.remove('piece-new'), { once: true });

        if (isKingPiece) {
          const crown = document.createElement('span');
          crown.className = 'king-crown';
          crown.textContent = '♛';
          crown.setAttribute('aria-label', 'king');
          pieceEl.appendChild(crown);
        }
        cell.appendChild(pieceEl);
      }
    }
  }

  /* Update selected-piece highlight separately (highlight only, no re-create) */
  boardEl.querySelectorAll('.piece').forEach(el => {
    const cell = el.parentElement;
    const r = +cell.dataset.row, c = +cell.dataset.col;
    const isSel = selected && selected.row === r && selected.col === c;
    el.classList.toggle('selected-piece', isSel);
  });

  renderedBoard = board.slice();
  renderedSel   = selKey;
  renderedMoves = moveKeys;

  updateCounts();
}

function updateStatus() {
  const dotEl  = document.getElementById('turn-dot');
  const textEl = document.getElementById('turn-text');
  if (!dotEl || !textEl || gameOver) return;

  if (aiThinking) {
    dotEl.className = 'turn-dot p2';
    textEl.innerHTML = 'AI is thinking <span class="thinking"><span></span><span></span><span></span></span>';
    return;
  }
  if (currentTurn === P1) {
    dotEl.className = 'turn-dot p1';
    textEl.textContent = 'Your turn';
  } else {
    dotEl.className = 'turn-dot p2';
    textEl.textContent = "AI's turn";
  }
}

function updateCounts() {
  const p1 = board.filter(p => p === P1 || p === P1K).length;
  const p2 = board.filter(p => p === P2 || p === P2K).length;
  const e1 = document.getElementById('p1-count');
  const e2 = document.getElementById('p2-count');
  if (e1) e1.textContent = p1;
  if (e2) e2.textContent = p2;
}

/* ============================================================
   INIT & RESET
   ============================================================ */

function resetGame() {
  board          = buildInitialBoard();
  currentTurn    = P1;
  selected       = null;
  validMoves     = [];
  mustJumps      = [];
  gameOver       = false;
  aiThinking     = false;
  multiJumpPiece = null;
  renderedBoard  = null;
  hideWinOverlay();
  buildBoard();     // rebuild empty cells
  renderBoard();    // paint pieces
  refreshMustJumps();
  updateStatus();
}

/* ============================================================
   CLICK HANDLING
   ============================================================ */

function onCellClick(row, col) {
  if (gameOver || aiThinking || currentTurn === P2) return;

  const piece           = board[idx(row, col)];
  const isCurrentPlayer = isOwnedBy(piece, currentTurn);

  /* Mid multi-jump */
  if (multiJumpPiece) {
    const moveTarget = validMoves.find(m => m.toRow === row && m.toCol === col);
    if (moveTarget) executeMove(moveTarget);
    return;
  }

  /* Select own piece */
  if (isCurrentPlayer) {
    if (mustJumps.length > 0 && !mustJumps.some(m => m.fromRow === row && m.fromCol === col))
      return;
    selected   = { row, col };
    validMoves = getMovesForPiece(row, col, board, currentTurn);
    if (mustJumps.length > 0) validMoves = validMoves.filter(m => m.isJump);
    renderBoard();
    return;
  }

  /* Move to valid target */
  if (selected) {
    const moveTarget = validMoves.find(m => m.toRow === row && m.toCol === col);
    if (moveTarget) { executeMove(moveTarget); return; }
  }

  /* Deselect */
  selected   = null;
  validMoves = [];
  renderBoard();
}

/* ============================================================
   MOVE EXECUTION
   ============================================================ */

function executeMove(move) {
  const { fromRow, fromCol, toRow, toCol, captures } = move;

  board[idx(toRow, toCol)]     = board[idx(fromRow, fromCol)];
  board[idx(fromRow, fromCol)] = EMPTY;
  if (captures) captures.forEach(({ row, col }) => { board[idx(row, col)] = EMPTY; });

  const promoted = checkKingPromotion(toRow, toCol);

  /* Multi-jump continuation */
  if (move.isJump && !promoted) {
    const furtherJumps = getJumpsForPiece(toRow, toCol, board, currentTurn);
    if (furtherJumps.length > 0) {
      selected       = { row: toRow, col: toCol };
      validMoves     = furtherJumps;
      multiJumpPiece = { row: toRow, col: toCol };
      renderBoard();
      updateStatus();
      return;
    }
  }

  multiJumpPiece = null;
  selected       = null;
  validMoves     = [];

  if (checkWin()) return;
  switchTurn();
}

function checkKingPromotion(row, col) {
  const piece = board[idx(row, col)];
  if (piece === P1 && row === 0)        { board[idx(row, col)] = P1K; return true; }
  if (piece === P2 && row === ROWS - 1) { board[idx(row, col)] = P2K; return true; }
  return false;
}

/* ============================================================
   TURN MANAGEMENT
   ============================================================ */

function switchTurn() {
  currentTurn = (currentTurn === P1) ? P2 : P1;
  refreshMustJumps();
  renderBoard();
  updateStatus();
  if (currentTurn === P2 && !gameOver) triggerAI();
}

function refreshMustJumps() {
  mustJumps = getAllJumps(board, currentTurn);
}

/* ============================================================
   WIN CHECK
   ============================================================ */

function checkWin() {
  const p1pieces = board.filter(p => p === P1 || p === P1K).length;
  const p2pieces = board.filter(p => p === P2 || p === P2K).length;
  if (p1pieces === 0) { showWin(P2); return true; }
  if (p2pieces === 0) { showWin(P1); return true; }
  if (getAllMoves(board, currentTurn).length === 0) {
    showWin(currentTurn === P1 ? P2 : P1);
    return true;
  }
  return false;
}

function showWin(winner) {
  gameOver = true;
  const titleEl = document.getElementById('win-title');
  const subEl   = document.getElementById('win-sub');
  const overlay = document.getElementById('win-overlay');
  if (!titleEl || !subEl || !overlay) return;
  if (winner === P1) {
    titleEl.textContent = 'You Win!';
    titleEl.className   = 'win-title p1';
    subEl.textContent   = 'You beat the computer. Well played!';
  } else {
    titleEl.textContent = 'Computer Wins';
    titleEl.className   = 'win-title p2';
    subEl.textContent   = 'The AI got you this time. Try again!';
  }
  setTimeout(() => overlay.classList.add('visible'), 100);
}

function hideWinOverlay() {
  const overlay = document.getElementById('win-overlay');
  if (overlay) overlay.classList.remove('visible');
}

/* ============================================================
   AI — MINIMAX WITH ALPHA-BETA PRUNING
   ============================================================ */

function triggerAI() {
  if (gameOver || currentTurn !== P2) return;
  aiThinking = true;
  updateStatus();
  const delay = 400 + Math.random() * 300;
  setTimeout(() => {
    const move = getBestMove(board, P2, 5);
    if (move) executeAIMove(move);
    else aiThinking = false;
  }, delay);
}

function executeAIMove(move) {
  if (gameOver) return;
  const { fromRow, fromCol, toRow, toCol, captures } = move;

  board[idx(toRow, toCol)]     = board[idx(fromRow, fromCol)];
  board[idx(fromRow, fromCol)] = EMPTY;
  if (captures) captures.forEach(cap => { board[idx(cap.row, cap.col)] = EMPTY; });
  const promoted = checkKingPromotion(toRow, toCol);

  if (move.isJump && !promoted) {
    const furtherJumps = getJumpsForPiece(toRow, toCol, board, P2);
    if (furtherJumps.length > 0) {
      renderBoard();
      setTimeout(() => executeAIMove(furtherJumps[0]), 350);
      return;
    }
  }

  selected = null; validMoves = []; multiJumpPiece = null;
  aiThinking = false;
  renderBoard();
  if (checkWin()) return;
  switchTurn();
}

function applyMove(b, move) {
  const nb = b.slice();
  const { fromRow, fromCol, toRow, toCol, captures } = move;
  nb[idx(toRow, toCol)]     = nb[idx(fromRow, fromCol)];
  nb[idx(fromRow, fromCol)] = EMPTY;
  if (captures) captures.forEach(cap => { nb[idx(cap.row, cap.col)] = EMPTY; });
  if (nb[idx(toRow, toCol)] === P1 && toRow === 0)        nb[idx(toRow, toCol)] = P1K;
  if (nb[idx(toRow, toCol)] === P2 && toRow === ROWS - 1) nb[idx(toRow, toCol)] = P2K;
  return nb;
}

function getBestMove(b, player, depth) {
  const moves = getAllMoves(b, player);
  if (moves.length === 0) return null;
  let bestMove = null, bestScore = -Infinity;
  moves.forEach(move => {
    const score = minimax(applyMove(b, move), depth - 1, -Infinity, Infinity, false, player);
    if (score > bestScore) { bestScore = score; bestMove = move; }
  });
  return bestMove;
}

function minimax(b, depth, alpha, beta, maximizing, aiPlayer) {
  const humanPlayer = (aiPlayer === P2) ? P1 : P2;
  const current     = maximizing ? aiPlayer : humanPlayer;
  if (depth === 0) return evaluate(b, aiPlayer);
  const moves = getAllMoves(b, current);
  if (moves.length === 0) return maximizing ? -1000 : 1000;

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      const val = minimax(applyMove(b, move), depth - 1, alpha, beta, false, aiPlayer);
      if (val > maxEval) maxEval = val;
      if (val > alpha)   alpha   = val;
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      const val = minimax(applyMove(b, move), depth - 1, alpha, beta, true, aiPlayer);
      if (val < minEval) minEval = val;
      if (val < beta)    beta    = val;
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function evaluate(b, aiPlayer) {
  let score = 0;
  b.forEach((piece, i) => {
    if (piece === EMPTY) return;
    const r = Math.floor(i / COLS), c = i % COLS;
    let val = isKing(piece) ? 3.0 : 1.0;
    /* Advancement bonus */
    if (piece === P1) val += (ROWS - 1 - r) * 0.06;
    if (piece === P2) val += r * 0.06;
    /* Center control */
    val += (7 - (Math.abs(c - 3.5) + Math.abs(r - 3.5))) * 0.02;
    score += isOwnedBy(piece, aiPlayer) ? val : -val;
  });
  return score;
}

/* ============================================================
   BOOT
   ============================================================ */

(function boot() {
  const boardEl = document.getElementById('board');
  if (!boardEl) return;

  document.getElementById('new-game-btn').addEventListener('click', resetGame);
  document.getElementById('play-again-btn').addEventListener('click', resetGame);

  resetGame();
})();
