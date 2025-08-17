/* ========== [CONFIGURACIÓN INICIAL] ========== */
const CFG = {
  vidasIniciales: 3,

  /* ► Tamaños relativos de objetos en % del ancho/alto del tablero */
  objAnchoPct: 6,
  objAltoPct: 8,

  /* ► Spawn base (ms) – se ajusta con la dificultad */
  spawnBaseMs: 1200,

  /* ► Límites del tablero en % */
  minX: 0, maxX: 94,          // 100 - objAnchoPct aprox
  startY: -10, endY: 110,     // sale por abajo al 110%

  /* ► Clases CSS por tipo (si las usas) */
  claseBueno:   "obj-bueno",     // 🧀 normal +1
  claseMalo:    "obj-malo",      // 💩 -1 vida
  claseDorado:  "obj-dorado",    // 🧀✨ +10
  claseCasco:   "obj-casco",     // 🛡️ inmunidad 5s
  claseReloj:   "obj-reloj",     // ⏳ caída x0.5 por 5s
  clasePodrido: "obj-podrido",   // 💣 -5 puntos

  /* ► Duración estándar de efectos (segundos) */
  buffDurSec: 5
};

/* ========== [OBJETOS: emojis por tipo] ========== */
const EMOJI = {
  bueno: "🧀",
  malo: "💩",
  dorado: "🧀",
  casco: "🛡️",
  reloj: "⏳",
  podrido: "💣",
};


/* ========== [ESTADO DE JUEGO] ========== */
let gameView, rataEl, scoreEl, livesEl;
let puntos = 0;
let vidas = CFG.vidasIniciales;
let objetos = [];                 // cada item: { el, xPct, yPct, tipo }
let rafId = null;
let lastTs = 0;
let spawnTimer = null;
let gameOver = false;             // ← NUEVO

/* ► Dificultad actual */
let velCaidaPctPorSeg = 20;       // % alto/seg
let spawnCadaMs       = CFG.spawnBaseMs;
let maxSimultaneos    = 4;

/* ► Estados temporales (sin botella) */
let fallMult  = 1;                // multiplicador de caída
let shieldOn  = false;            // casco activo
let _tFall = null, _tShield = null; // timeouts
let velHorizontalPctPorSeg = 60;  // velocidad lateral fija
const baseVelLateral = 60;


/* ========== [UTILIDADES] ========== */
const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function getRectPercent(el) {
  const rect = el.getBoundingClientRect();
  const base = gameView.getBoundingClientRect();
  const left   = ((rect.left - base.left) / base.width) * 100;
  const top    = ((rect.top  - base.top)  / base.height) * 100;
  const width  = (rect.width  / base.width)  * 100;
  const height = (rect.height / base.height) * 100;
  return { left, top, width, height };
}

function intersectan(a, b) {
  return !(
    a.left + a.width  < b.left  ||
    b.left + b.width  < a.left  ||
    a.top  + a.height < b.top   ||
    b.top  + b.height < a.top
  );
}

function pickByWeight(table) {
  const total = table.reduce((s, t) => s + t.w, 0);
  let r = Math.random() * total;
  for (const t of table) { r -= t.w; if (r <= 0) return t.v; }
  return table.at(-1).v;
}


/* ========== [HUD SEGURO: validación y escrituras] ========== */
function validarHUD() {
  const nScore = document.querySelectorAll("#score").length;
  const nLives = document.querySelectorAll("#lives").length;
  if (nScore !== 1) console.error("[HUD] #score duplicado o ausente:", nScore);
  if (nLives !== 1) console.error("[HUD] #lives duplicado o ausente:", nLives);
  if (scoreEl && livesEl && scoreEl === livesEl) {
    console.error("[HUD] scoreEl y livesEl apuntan al mismo nodo");
  }
}

function setScoreSafe(valor) {
  if (!scoreEl) return;
  if (scoreEl === livesEl) return;
  console.log("[WRITE score]", valor, "->", scoreEl);
  scoreEl.textContent = String(valor);
}

function setLivesSafe(valor) {
  if (!livesEl) return;
  if (livesEl === scoreEl) return;
  console.log("[WRITE lives]", valor, "->", livesEl);
  livesEl.textContent = String(valor);
}


/* ========== [DIFICULTAD: TRAMOS] ========== */
function actualizarDificultad(p) {
  if (p >= 50) {
    velCaidaPctPorSeg = 55;
    spawnCadaMs       = 500;
    maxSimultaneos    = 9;
  } else if (p >= 20) {
    velCaidaPctPorSeg = 40;
    spawnCadaMs       = 700;
    maxSimultaneos    = 7;
  } else if (p >= 10) {
    velCaidaPctPorSeg = 30;
    spawnCadaMs       = 900;
    maxSimultaneos    = 5;
  } else {
    velCaidaPctPorSeg = 20;
    spawnCadaMs       = CFG.spawnBaseMs;
    maxSimultaneos    = 4;
  }
  resetSpawnTimer();
}


/* ========== [POTENCIADORES: APLICADORES] ========== */
function aplicarCasco() {
  if (_tShield) clearTimeout(_tShield);
  shieldOn = true;
  _tShield = setTimeout(() => { shieldOn = false; }, CFG.buffDurSec * 1000);
}

function aplicarReloj() {
  if (_tFall) clearTimeout(_tFall);
  fallMult = 0.5;
  _tFall = setTimeout(() => { fallMult = 1; }, CFG.buffDurSec * 1000);
}

function aplicarPodrido() {
  puntos = Math.max(0, puntos - 5);
  setScoreSafe(puntos);
  actualizarDificultad(puntos);
}


/* ========== [SPAWN DE OBJETOS] ========== */
function crearObjeto(tipo = "bueno") {
  if (objetos.length >= maxSimultaneos) return;

  const el = document.createElement("div");
  el.className =
    tipo === "bueno"    ? CFG.claseBueno   :
    tipo === "malo"     ? CFG.claseMalo    :
    tipo === "dorado"   ? CFG.claseDorado  :
    tipo === "casco"    ? CFG.claseCasco   :
    tipo === "reloj"    ? CFG.claseReloj   :
    /* podrido */          CFG.clasePodrido;

  el.textContent = EMOJI[tipo] || "•";
  el.setAttribute("aria-label", tipo);
  el.style.position = "absolute";
  el.style.width  = CFG.objAnchoPct + "%";
  el.style.height = CFG.objAltoPct + "%";
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.borderRadius = "20%";
  el.style.fontSize = "180%";
  el.style.lineHeight = "100%";
  el.style.userSelect = "none";

  const xPct = rndInt(CFG.minX, CFG.maxX);
  const yPct = CFG.startY;
  el.style.left = xPct + "%";
  el.style.top  = yPct + "%";

  gameView.appendChild(el);
  objetos.push({ el, xPct, yPct, tipo });
}

function resetSpawnTimer() {
  if (spawnTimer) clearInterval(spawnTimer);
  spawnTimer = setInterval(() => {
    const tipo = pickByWeight([
      { v: "bueno",    w: 0.60 }, // 🧀 +1
      { v: "malo",     w: 0.15 }, // 💩 -vida
      { v: "podrido",  w: 0.10 }, // 💣 -5 pts
      { v: "dorado",   w: 0.07 }, // 🧀✨ +10
      { v: "casco",    w: 0.04 }, // 🛡️
      { v: "reloj",    w: 0.04 }, // ⏳
    ]);
    crearObjeto(tipo);
  }, spawnCadaMs);
}


/* ========== [MOVIMIENTO Y COLISIONES] ========== */
function actualizar(dtSeg) {
  if (gameOver) return;                         // ← NUEVO
  const dy = velCaidaPctPorSeg * fallMult * dtSeg;

  for (let i = objetos.length - 1; i >= 0; i--) {
    const o = objetos[i];
    o.yPct += dy;
    o.el.style.top = o.yPct + "%";

    const rRect = getRectPercent(rataEl);
    const oRect = getRectPercent(o.el);
    if (intersectan(rRect, oRect)) {
      const t = o.tipo;

      if (t === "bueno") {
        puntos += 1;
      } else if (t === "dorado") {
        puntos += 10;
      } else if (t === "casco") {
        aplicarCasco();
      } else if (t === "reloj") {
        aplicarReloj();
      } else if (t === "podrido") {
        aplicarPodrido();
      } else if (t === "malo") {
        if (shieldOn) {
          shieldOn = false;
          if (_tShield) { clearTimeout(_tShield); _tShield = null; }
        } else {
          vidas -= 1;
          setLivesSafe(vidas);
          if (vidas <= 0) return terminarJuego();
        }
      }

      if (t === "bueno" || t === "dorado") {
        setScoreSafe(puntos);
        actualizarDificultad(puntos);
        if (typeof window !== "undefined" && typeof window.actualizarObjetivos === "function") {
          window.actualizarObjetivos(puntos);
        }
      }

      o.el.remove();
      objetos.splice(i, 1);
      continue;
    }

    if (o.yPct > CFG.endY) {
      o.el.remove();
      objetos.splice(i, 1);
    }
  }
}


/* ========== [LOOP PRINCIPAL] ========== */
function loop(ts) {
  if (gameOver) return;                         // ← NUEVO
  if (!lastTs) lastTs = ts;
  const dtMs = ts - lastTs;
  lastTs = ts;

  const dtSeg = dtMs / 1000;
  actualizar(dtSeg);

  if (!gameOver) {                              // ← NUEVO
    rafId = window.requestAnimationFrame(loop);
  }
}


/* ========== [CONTROLES: TECLADO] ========== */
let moviendo = { izq: false, der: false };

function onKeyDown(e) {
  if (e.key === "ArrowLeft"  || e.key === "a") moviendo.izq = true;
  if (e.key === "ArrowRight" || e.key === "d") moviendo.der = true;
}
function onKeyUp(e) {
  if (e.key === "ArrowLeft"  || e.key === "a") moviendo.izq = false;
  if (e.key === "ArrowRight" || e.key === "d") moviendo.der = false;
}

function moverRata(dtSeg) {
  const rectR = getRectPercent(rataEl);
  let x = rectR.left;
  const dx = velHorizontalPctPorSeg * dtSeg; // velocidad lateral fija
  if (moviendo.izq) x -= dx;
  if (moviendo.der) x += dx;
  x = clamp(x, 0, 100 - rectR.width);
  rataEl.style.left = x + "%";
}


/* ========== [INICIALIZACIÓN / TEAR DOWN] ========== */
function resetEstado() {
  puntos = 0;
  vidas  = CFG.vidasIniciales;
  gameOver = false;                              // ← NUEVO

  objetos.forEach(o => o.el.remove());
  objetos = [];

  lastTs = 0;
  setScoreSafe(0);
  setLivesSafe(vidas);

  actualizarDificultad(0);

  if (_tFall)   { clearTimeout(_tFall);   _tFall   = null; }
  if (_tShield) { clearTimeout(_tShield); _tShield = null; }
  fallMult = 1; shieldOn = false;
  velHorizontalPctPorSeg = baseVelLateral;
}

function bindControles() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
}
function unbindControles() {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
}

function terminarJuego() {
  if (gameOver) return;                          // ← NUEVO
  gameOver = true;                               // ← NUEVO

  const prev = parseInt(localStorage.getItem("maxPuntos") || "0", 10);
  if (puntos > prev) localStorage.setItem("maxPuntos", String(puntos));

  if (rafId) cancelAnimationFrame(rafId);
  if (spawnTimer) clearInterval(spawnTimer);
  unbindControles();

  if (gameView) gameView.style.filter = "grayscale(0.3)";
}


/* ========== [API PÚBLICA] ========== */
export function startPrologo(cfg = {}) {
  gameView = document.getElementById(cfg.gameViewId || "gameView");
  rataEl   = document.getElementById(cfg.rataId     || "rata");
  scoreEl  = document.getElementById(cfg.scoreId    || "score");
  livesEl  = document.getElementById(cfg.livesId    || "lives");

  if (!gameView || !rataEl) {
    console.error("[juego_prologo] Faltan #gameView o #rata");
    return;
  }

  validarHUD();

  gameView.style.position = "relative";
  rataEl.style.position   = "absolute";
  if (!rataEl.style.left) rataEl.style.left = "45%";
  if (!rataEl.style.top)  rataEl.style.top  = "80%";

  gameOver = false;                               // ← NUEVO
  resetEstado();
  bindControles();
  resetSpawnTimer();

  rafId = window.requestAnimationFrame(function step(ts) {
    const dtSeg = lastTs ? (ts - lastTs) / 1000 : 0;
    moverRata(dtSeg);
    loop(ts);
  });
}

export function stopPrologo() {
  gameOver = true;                                 // ← NUEVO
  if (rafId) cancelAnimationFrame(rafId);
  if (spawnTimer) clearInterval(spawnTimer);
  unbindControles();
}
