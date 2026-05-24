/* ============================================================
   CDL CHECKERS — game.js
   Handles:  nav scroll effect (all pages)
             full checkers engine (game.html only)
   ============================================================ */

'use strict';

/* ---- Nav scroll effect (runs on every page) ---- */
(function initNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const onScroll = () => {
    nav.classList.toggle('scrolled', window.scrollY > 8);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

/* ---- Only run game logic on game.html ---- */
if (!document.getElementById('board')) {
  // Not the game page — stop here
} else {
  initGame();
}

/* ============================================================
   CONSTANTS
   ============================================================ */

const EMPTY = 0;
const P1 = 1;  // red,   moves toward row 0
const P2 = 2;  // white, moves toward row 7
const P1K = 3;  // red king
const P2K = 4;  // white king

const ROWS = 8;
const COLS = 8;

/* ============================================================
   GAME STATE
   ============================================================ */

let board = [];   // 8×8 flat array, index = row*8+col
let currentTurn = P1;
let selected = null; // { row, col }
let validMoves = [];   // array of move objects for selected piece
let mustJumps = [];   // all mandatory jump moves for current player
let gameMode = 'ai'; // 'ai' | 'pvp'
let gameOver = false;
let aiThinking = false;
let multiJumpPiece = null; // { row, col } locked piece during multi-jump

/* ============================================================
   INIT
   ============================================================ */

function initGame() {
  /* Read mode from URL */
  const params = new URLSearchParams(window.location.search);
  gameMode = params.get('mode') === 'pvp' ? 'pvp' : 'ai';

  const modeLabel = document.getElementById('mode-label');
  if (modeLabel) modeLabel.textContent = gameMode === 'ai' ? 'vs Computer' : 'vs Friend';

  document.getElementById('new-game-btn').addEventListener('click', resetGame);
  document.getElementById('play-again-btn').addEventListener('click', () => {
    hideWinOverlay();
    resetGame();
  });

  resetGame();
}

function resetGame() {
  board = buildInitialBoard();
  currentTurn = P1;
  selected = null;
  validMoves = [];
  mustJumps = [];
  gameOver = false;
  aiThinking = false;
  multiJumpPiece = null;
  renderBoard();
  refreshMustJumps();
  updateStatus();
}

/* ============================================================
   BOARD SETUP
   ============================================================ */

function buildInitialBoard() {
  const b = new Array(ROWS * COLS).fill(EMPTY);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isDark(r, c)) {
        if (r < 3) b[idx(r, c)] = P2;      // white on top rows
        if (r > 4) b[idx(r, c)] = P1;      // red   on bottom rows
      }
    }
  }
  return b;
}

const idx = (r, c) => r * COLS + c;
const isDark = (r, c) => (r + c) % 2 === 1;

/* ============================================================
   RENDERING
   ============================================================ */

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell ' + (isDark(r, c) ? 'dark' : 'light');
      cell.dataset.row = r;
      cell.dataset.col = c;

      /* Highlight selected square */
      if (selected && selected.row === r && selected.col === c) {
        cell.classList.add('selected');
      }

      /* Highlight valid move squares */
      const isValidTarget = validMoves.some(m => m.toRow === r && m.toCol === c);
      if (isValidTarget) {
        cell.classList.add('valid-move');
      }

      /* Piece */
      const piece = board[idx(r, c)];
      if (piece !== EMPTY) {
        const pieceEl = document.createElement('div');
        const isP1 = (piece === P1 || piece === P1K);
        const isKing = (piece === P1K || piece === P2K);

        pieceEl.className = 'piece ' + (isP1 ? 'p1' : 'p2');

        /* staggered fade-in on initial load */
        pieceEl.style.animationDelay = (r * COLS + c) * 4 + 'ms';

        if (isKing) {
          const crown = document.createElement('span');
          crown.className = 'king-crown';
          crown.textContent = '♛';
          crown.setAttribute('aria-label', 'king');
          pieceEl.appendChild(crown);
        }

        /* Selection highlight */
        if (selected && selected.row === r && selected.col === c) {
          pieceEl.classList.add('selected-piece');
        }

        cell.appendChild(pieceEl);
      }

      /* Click handler */
      if (isDark(r, c) && !gameOver && !aiThinking) {
        cell.addEventListener('click', () => onCellClick(r, c));
      }

      boardEl.appendChild(cell);
    }
  }

  updateCounts();
}

/* ============================================================
   CLICK HANDLING
   ============================================================ */

function onCellClick(row, col) {
  if (gameOver || aiThinking) return;
  if (gameMode === 'ai' && currentTurn === P2) return;

  const piece = board[idx(row, col)];
  const isCurrentPlayer = isOwnedBy(piece, currentTurn);

  /* ---- Mid multi-jump: only the locked piece can act ---- */
  if (multiJumpPiece) {
    const moveTarget = validMoves.find(m => m.toRow === row && m.toCol === col);
    if (moveTarget) {
      executeMove(moveTarget);
    }
    /* Clicking elsewhere during multi-jump is ignored */
    return;
  }

  /* ---- Select own piece ---- */
  if (isCurrentPlayer) {
    /* If there are mandatory jumps, only allow selecting a piece that has jumps */
    if (mustJumps.length > 0) {
      const pieceCan = mustJumps.some(m => m.fromRow === row && m.fromCol === col);
      if (!pieceCan) return; // this piece has no jumps available
    }

    selected = { row, col };
    validMoves = getMovesForPiece(row, col, board, currentTurn);
    /* Filter: if mandatory jumps, only show jump moves */
    if (mustJumps.length > 0) {
      validMoves = validMoves.filter(m => m.isJump);
    }
    renderBoard();
    return;
  }

  /* ---- Click on valid move target ---- */
  if (selected) {
    const moveTarget = validMoves.find(m => m.toRow === row && m.toCol === col);
    if (moveTarget) {
      executeMove(moveTarget);
      return;
    }
  }

  /* ---- Click empty / enemy square — deselect ---- */
  selected = null;
  validMoves = [];
  renderBoard();
}

/* ============================================================
   MOVE EXECUTION
   ============================================================ */

function executeMove(move) {
  const { fromRow, fromCol, toRow, toCol, captures } = move;

  /* Move piece */
  const piece = board[idx(fromRow, fromCol)];
  board[idx(toRow, toCol)] = piece;
  board[idx(fromRow, fromCol)] = EMPTY;

  /* Remove captured pieces */
  if (captures) {
    captures.forEach(({ row, col }) => {
      board[idx(row, col)] = EMPTY;
    });
  }

  /* King promotion */
  const promoted = checkKingPromotion(toRow, toCol);

  /* Check for multi-jump continuation (only if not just promoted) */
  if (move.isJump && !promoted) {
    const furtherJumps = getJumpsForPiece(toRow, toCol, board, currentTurn);
    if (furtherJumps.length > 0) {
      /* Lock this piece for continued jumping */
      selected = { row: toRow, col: toCol };
      validMoves = furtherJumps;
      multiJumpPiece = { row: toRow, col: toCol };
      renderBoard();
      updateStatus();
      return;
    }
  }

  /* End of move — switch turns */
  multiJumpPiece = null;
  selected = null;
  validMoves = [];

  /* Check win condition */
  if (checkWin()) return;

  switchTurn();
}

function checkKingPromotion(row, col) {
  const piece = board[idx(row, col)];
  if (piece === P1 && row === 0) {
    board[idx(row, col)] = P1K;
    return true;
  }
  if (piece === P2 && row === ROWS - 1) {
    board[idx(row, col)] = P2K;
    return true;
  }
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

  if (gameMode === 'ai' && currentTurn === P2 && !gameOver) {
    triggerAI();
  }
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

  /* No legal moves */
  const moves = getAllMoves(board, currentTurn);
  if (moves.length === 0) {
    const winner = (currentTurn === P1) ? P2 : P1;
    showWin(winner);
    return true;
  }
  return false;
}

function showWin(winner) {
  gameOver = true;
  const titleEl = document.getElementById('win-title');
  const subEl = document.getElementById('win-sub');
  const overlay = document.getElementById('win-overlay');

  if (winner === P1) {
    titleEl.textContent = 'Player 1 Wins!';
    titleEl.className = 'win-title p1';
    subEl.textContent = gameMode === 'ai'
      ? 'You beat the computer. Well played!'
      : 'Red takes the victory!';
  } else {
    titleEl.textContent = gameMode === 'ai' ? 'Computer Wins' : 'Player 2 Wins!';
    titleEl.className = 'win-title p2';
    subEl.textContent = gameMode === 'ai'
      ? 'The AI got you this time. Try again!'
      : 'White takes the victory!';
  }
  setTimeout(() => overlay.classList.add('visible'), 100);
}

function hideWinOverlay() {
  document.getElementById('win-overlay').classList.remove('visible');
}

/* ============================================================
   UI UPDATES
   ============================================================ */

function updateStatus() {
  const dotEl = document.getElementById('turn-dot');
  const textEl = document.getElementById('turn-text');
  if (!dotEl || !textEl) return;

  if (gameOver) return;

  if (aiThinking) {
    dotEl.className = 'turn-dot p2';
    textEl.innerHTML = 'AI is thinking <span class="thinking"><span></span><span></span><span></span></span>';
    return;
  }

  if (currentTurn === P1) {
    dotEl.className = 'turn-dot p1';
    textEl.textContent = 'Player 1\'s turn';
  } else {
    dotEl.className = 'turn-dot p2';
    textEl.textContent = gameMode === 'pvp' ? 'Player 2\'s turn' : 'AI\'s turn';
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
   MOVE GENERATION
   ============================================================ */

/**
 * Returns all legal moves for a player on a given board.
 * Mandatory jumps are enforced: if any jump exists, only jumps are returned.
 */
function getAllMoves(b, player) {
  const jumps = getAllJumps(b, player);
  if (jumps.length > 0) return jumps;
  return getAllSimpleMoves(b, player);
}

function getAllJumps(b, player) {
  const moves = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isOwnedBy(b[idx(r, c)], player)) {
        moves.push(...getJumpsForPiece(r, c, b, player));
      }
    }
  }
  return moves;
}

function getAllSimpleMoves(b, player) {
  const moves = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isOwnedBy(b[idx(r, c)], player)) {
        moves.push(...getSimpleMovesForPiece(r, c, b, player));
      }
    }
  }
  return moves;
}

/**
 * All moves (simple + jump) for one piece, respecting mandatory jumps.
 * Called during player interaction — filters to jumps only if mustJumps exist.
 */
function getMovesForPiece(row, col, b, player) {
  const jumps = getJumpsForPiece(row, col, b, player);
  const simples = getSimpleMovesForPiece(row, col, b, player);
  return [...jumps, ...simples];
}

/* ---- Directions ---- */
function getDirs(piece) {
  if (piece === P1 || piece === P1K || piece === P2K) {
    // P1 moves toward row 0 (up, negative row direction)
    // Kings move both ways
  }
  const forward = (piece === P1 || piece === P1K) ? -1 : 1;
  if (piece === P1K || piece === P2K) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  if (piece === P1) return [[-1, -1], [-1, 1]];
  if (piece === P2) return [[1, -1], [1, 1]];
  return [];
}

function getSimpleMovesForPiece(row, col, b, player) {
  const piece = b[idx(row, col)];
  const dirs = getDirs(piece);
  const moves = [];

  dirs.forEach(([dr, dc]) => {
    const nr = row + dr;
    const nc = col + dc;
    if (inBounds(nr, nc) && b[idx(nr, nc)] === EMPTY) {
      moves.push({ fromRow: row, fromCol: col, toRow: nr, toCol: nc, isJump: false, captures: [] });
    }
  });
  return moves;
}

function getJumpsForPiece(row, col, b, player, captured = []) {
  const piece = b[idx(row, col)];
  const dirs = getDirs(piece);
  const moves = [];

  dirs.forEach(([dr, dc]) => {
    const mr = row + dr;       // middle (enemy)
    const mc = col + dc;
    const lr = row + dr * 2;   // landing
    const lc = col + dc * 2;

    if (!inBounds(lr, lc)) return;

    const middle = b[idx(mr, mc)];
    const landing = b[idx(lr, lc)];

    const alreadyCaptured = captured.some(cap => cap.row === mr && cap.col === mc);

    if (
      isEnemy(middle, player) &&
      landing === EMPTY &&
      !alreadyCaptured
    ) {
      const newCaptures = [...captured, { row: mr, col: mc }];
      moves.push({
        fromRow: row,
        fromCol: col,
        toRow: lr,
        toCol: lc,
        isJump: true,
        captures: newCaptures
      });
    }
  });
  return moves;
}

/* ============================================================
   HELPERS
   ============================================================ */

const inBounds = (r, c) => r >= 0 && r < ROWS && c >= 0 && c < COLS;
const isOwnedBy = (piece, player) => {
  if (player === P1) return piece === P1 || piece === P1K;
  if (player === P2) return piece === P2 || piece === P2K;
  return false;
};
const isEnemy = (piece, player) => {
  if (piece === EMPTY) return false;
  return !isOwnedBy(piece, player);
};

/* ============================================================
   AI — MINIMAX WITH ALPHA-BETA PRUNING
   ============================================================ */

function triggerAI() {
  if (gameOver || currentTurn !== P2) return;
  aiThinking = true;
  updateStatus();

  /* Delay 400–700ms so it feels natural */
  const delay = 400 + Math.random() * 300;
  setTimeout(() => {
    const move = getBestMove(board, P2, 5);
    if (move) {
      executeAIMove(move);
    }
    aiThinking = false;
  }, delay);
}

function executeAIMove(move) {
  if (gameOver) return;

  /* Apply move on actual board */
  const { fromRow, fromCol, toRow, toCol, captures } = move;
  const piece = board[idx(fromRow, fromCol)];
  board[idx(toRow, toCol)] = piece;
  board[idx(fromRow, fromCol)] = EMPTY;
  if (captures) captures.forEach(cap => { board[idx(cap.row, cap.col)] = EMPTY; });

  checkKingPromotion(toRow, toCol);

  /* Check for multi-jump */
  if (move.isJump) {
    const furtherJumps = getJumpsForPiece(toRow, toCol, board, P2);
    if (furtherJumps.length > 0 && board[idx(toRow, toCol)] !== P2K) {
      /* AI continues jump (pick best continuation) */
      const cont = furtherJumps[0];
      setTimeout(() => executeAIMove(cont), 300);
      renderBoard();
      return;
    }
  }

  selected = null;
  validMoves = [];
  multiJumpPiece = null;

  if (checkWin()) return;
  switchTurn();
}

function getBestMove(b, player, depth) {
  const moves = getAllMoves(b, player);
  if (moves.length === 0) return null;

  let bestMove = null;
  let bestScore = -Infinity;

  moves.forEach(move => {
    const newBoard = applyMove(b, move, player);
    const score = minimax(newBoard, depth - 1, -Infinity, Infinity, false, player);
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  });
  return bestMove;
}

/**
 * Minimax with alpha-beta pruning.
 * maximizing: true when it's the AI's (P2) turn.
 */
function minimax(b, depth, alpha, beta, maximizing, aiPlayer) {
  const humanPlayer = (aiPlayer === P2) ? P1 : P2;
  const current = maximizing ? aiPlayer : humanPlayer;

  if (depth === 0) return evaluate(b, aiPlayer);

  const moves = getAllMoves(b, current);
  if (moves.length === 0) {
    /* Current player has no moves — they lose */
    return maximizing ? -1000 : 1000;
  }

  if (maximizing) {
    let maxEval = -Infinity;
    for (const move of moves) {
      const nb = applyMove(b, move, current);
      const val = minimax(nb, depth - 1, alpha, beta, false, aiPlayer);
      maxEval = Math.max(maxEval, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break; // prune
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (const move of moves) {
      const nb = applyMove(b, move, current);
      const val = minimax(nb, depth - 1, alpha, beta, true, aiPlayer);
      minEval = Math.min(minEval, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break; // prune
    }
    return minEval;
  }
}

/**
 * Returns a new board state after applying a move.
 * Does NOT mutate the input board.
 */
function applyMove(b, move, player) {
  const nb = b.slice();
  const { fromRow, fromCol, toRow, toCol, captures } = move;
  const piece = nb[idx(fromRow, fromCol)];
  nb[idx(toRow, toCol)] = piece;
  nb[idx(fromRow, fromCol)] = EMPTY;
  if (captures) {
    captures.forEach(cap => { nb[idx(cap.row, cap.col)] = EMPTY; });
  }
  /* King promotion in simulated board */
  if (nb[idx(toRow, toCol)] === P1 && toRow === 0) nb[idx(toRow, toCol)] = P1K;
  if (nb[idx(toRow, toCol)] === P2 && toRow === ROWS - 1) nb[idx(toRow, toCol)] = P2K;
  return nb;
}

/**
 * Board evaluation heuristic for the AI player.
 * Positive = good for AI.
 */
function evaluate(b, aiPlayer) {
  const human = (aiPlayer === P2) ? P1 : P1;
  let score = 0;

  b.forEach((piece, i) => {
    if (piece === EMPTY) return;
    const r = Math.floor(i / COLS);
    const c = i % COLS;

    let val = 0;
    if (piece === P1 || piece === P2) val = 1;
    if (piece === P1K || piece === P2K) val = 2.5; // kings are significantly stronger

    /* Positional bonus — advancement */
    if (piece === P1) val += (ROWS - 1 - r) * 0.05;
    if (piece === P2) val += r * 0.05;

    /* Center control bonus */
    const centerDist = Math.abs(c - 3.5) + Math.abs(r - 3.5);
    val += (7 - centerDist) * 0.02;

    if (isOwnedBy(piece, aiPlayer)) {
      score += val;
    } else {
      score -= val;
    }
  });

  return score;
}
