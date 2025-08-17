/* ==========================================================
   [JUEGO PRÓLOGO] – Lógica principal en porcentajes (%)
   Archivo: javascript/juego_prologo.js
   Requiere en el HTML: type="module" y nodos con ids:
   #gameView, #rata, #score, #lives
   ========================================================== */


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

  /* ► Clases CSS por tipo (defínelas en tu CSS si las usas) */
  claseBueno:   "obj-bueno",     // 🧀 normal +1
  claseMalo:    "obj-malo",      // 💩 -1 vida
  claseDorado:  "obj-dorado",    // 🧀✨ +10
  claseRefresc: "obj-refresco",  // 💨 turbo lateral x1.75 por 5s
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
  refresco: "💨",
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

/* ► Dificultad actual (se recalcula con el puntaje) */
let velCaidaPctPorSeg = 20;       // % alto/seg
let spawnCadaMs       = CFG.spawnBaseMs;
let maxSimultaneos    = 4;

/* ► Potenciadores y estados temporales */
let speedMult = 1;                // multiplicador velocidad lateral
let fallMult  = 1;                // multiplicador caída
let shieldOn  = false;            // casco activo
let _tSpeed = null, _tFall = null, _tShield = null; // timeouts
let velHorizontalPctPorSeg = 60;  // velocidad lateral base
const baseVelLateral = 60;        // respaldo


/* ========== [UTILIDADES] ========== */
/* ► Entero aleatorio en [min, max] */
const rndInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/* ► Clamp */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ► Rect en % relativo a gameView */
function getRectPercent(el) {
  const rect = el.getBoundingClientRect();
  const base = gameView.getBoundingClientRect();
  const left   = ((rect.left - base.left) / base.width) * 100;
  const top    = ((rect.top  - base.top)  / base.height) * 100;
  const width  = (rect.width  / base.width)  * 100;
  const height = (rect.height / base.height) * 100;
  return { left, top, width, height };
}

/* ► Intersección AABB en % */
function intersectan(a, b) {
  return !(
    a.left + a.width  < b.left  ||
    b.left + b.width  < a.left  ||
    a.top  + a.height < b.top   ||
    b.top  + b.height < a.top
  );
}

/* ► Elección ponderada por pesos */
function pickByWeight(table) {
  const total = table.reduce((s, t) => s + t.w, 0);
  let r = Math.random() * total;
  for (const t of table) { r -= t.w; if (r <= 0) return t.v; }
  return table.at(-1).v;
}


/* ========== [DIFICULTAD: TRAMOS] ========== */
/* ► Ajusta velocidad de caída, frecuencia de spawn y cantidad simultánea
   NOTA: umbrales adaptados a tu progresión actual (10/20/50). */
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
  resetSpawnTimer(); // aplicar nuevo intervalo
}


/* ========== [POTENCIADORES: APLICADORES] ========== */
/* ► Turbo lateral (refresco) */
function aplicarRefresco() {
  if (_tSpeed) clearTimeout(_tSpeed);
  speedMult = 1.75;
  _tSpeed = setTimeout(() => { speedMult = 1; }, CFG.buffDurSec * 1000);
}

/* ► Casco (inmunidad) */
function aplicarCasco() {
  if (_tShield) clearTimeout(_tShield);
  shieldOn = true;
  _tShield = setTimeout(() => { shieldOn = false; }, CFG.buffDurSec * 1000);
}

/* ► Reloj (ralentiza caída) */
function aplicarReloj() {
  if (_tFall) clearTimeout(_tFall);
  fallMult = 0.5;
  _tFall = setTimeout(() => { fallMult = 1; }, CFG.buffDurSec * 1000);
}

/* ► Queso podrido (penaliza puntos) */
function aplicarPodrido() {
  puntos = Math.max(0, puntos - 5);
  if (scoreEl) scoreEl.textContent = String(puntos);
  actualizarDificultad(puntos);
}


/* ========== [SPAWN DE OBJETOS] ========== */
/* ► Crea un objeto DOM con emoji inline y clase por tipo */
function crearObjeto(tipo = "bueno") {
  if (objetos.length >= maxSimultaneos) return;

  const el = document.createElement("div");

  // Mantengo tus clases (por si tienes estilos), pero ahora pongo emoji por JS.
  el.className =
    tipo === "bueno"    ? CFG.claseBueno   :
    tipo === "malo"     ? CFG.claseMalo    :
    tipo === "dorado"   ? CFG.claseDorado  :
    tipo === "refresco" ? CFG.claseRefresc :
    tipo === "casco"    ? CFG.claseCasco   :
    tipo === "reloj"    ? CFG.claseReloj   :
    /* podrido */          CFG.clasePodrido;

  // ► Emoji directo
  el.textContent = EMOJI[tipo] || "•";
  el.setAttribute("aria-label", tipo);

  // ► Layout responsivo mínimo en inline-styles
  el.style.position = "absolute";
  el.style.width  = CFG.objAnchoPct + "%";
  el.style.height = CFG.objAltoPct + "%";
  el.style.display = "flex";
  el.style.alignItems = "center";
  el.style.justifyContent = "center";
  el.style.borderRadius = "20%";
  el.style.fontSize = "180%";   // relativo al tamaño del objeto
  el.style.lineHeight = "100%";
  el.style.userSelect = "none";

  const xPct = rndInt(CFG.minX, CFG.maxX);
  const yPct = CFG.startY;
  el.style.left = xPct + "%";
  el.style.top  = yPct + "%";

  gameView.appendChild(el);
  objetos.push({ el, xPct, yPct, tipo });
}

/* ► Temporizador de spawns con mezcla por pesos */
function resetSpawnTimer() {
  if (spawnTimer) clearInterval(spawnTimer);
  spawnTimer = setInterval(() => {
    /* Pesos (suman ~1). Ajusta rareza de cada tipo aquí. */
    const tipo = pickByWeight([
      { v: "bueno",    w: 0.55 }, // 🧀 +1
      { v: "malo",     w: 0.15 }, // 💩 -vida
      { v: "podrido",  w: 0.10 }, // 💣 -5 pts
      { v: "dorado",   w: 0.07 }, // 🧀✨ +10
      { v: "refresco", w: 0.05 }, // 💨 turbo
      { v: "casco",    w: 0.04 }, // 🛡️
      { v: "reloj",    w: 0.04 }, // ⏳
    ]);
    crearObjeto(tipo);
  }, spawnCadaMs);
}


/* ========== [MOVIMIENTO Y COLISIONES] ========== */
/* ► Avance de simulación y manejo de colisiones */
function actualizar(dtSeg) {
  // Caída en Y: velocidad por tramo * efecto de reloj
  const dy = velCaidaPctPorSeg * fallMult * dtSeg;

  for (let i = objetos.length - 1; i >= 0; i--) {
    const o = objetos[i];
    o.yPct += dy;
    o.el.style.top = o.yPct + "%";

    // Colisión con la rata
    const rRect = getRectPercent(rataEl);
    const oRect = getRectPercent(o.el);
    if (intersectan(rRect, oRect)) {
      const t = o.tipo;

      /* ► Efectos por tipo */
      if (t === "bueno") {
        puntos += 1;
      } else if (t === "dorado") {
        puntos += 10;
      } else if (t === "refresco") {
        aplicarRefresco();
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
          if (livesEl) livesEl.textContent = String(vidas);
          if (vidas <= 0) return terminarJuego();
        }
      }

      // ► UI y dificultad tras sumar puntos
      if (t === "bueno" || t === "dorado") {
        if (scoreEl) scoreEl.textContent = String(puntos);
        actualizarDificultad(puntos);
        if (typeof window !== "undefined" && typeof window.actualizarObjetivos === "function") {
          window.actualizarObjetivos(puntos);
        }
      }

      // Eliminar objeto procesado
      o.el.remove();
      objetos.splice(i, 1);
      continue;
    }

    // Fuera de pantalla
    if (o.yPct > CFG.endY) {
      o.el.remove();
      objetos.splice(i, 1);
    }
  }
}


/* ========== [LOOP PRINCIPAL] ========== */
/* ► Bucle de juego basado en requestAnimationFrame */
function loop(ts) {
  if (!lastTs) lastTs = ts;
  const dtMs = ts - lastTs;
  lastTs = ts;

  const dtSeg = dtMs / 1000;
  actualizar(dtSeg);

  rafId = window.requestAnimationFrame(loop);
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

/* ► Movimiento lateral de la rata aplicando turbo */
function moverRata(dtSeg) {
  const rectR = getRectPercent(rataEl);
  let x = rectR.left;
  const dx = velHorizontalPctPorSeg * speedMult * dtSeg;
  if (moviendo.izq) x -= dx;
  if (moviendo.der) x += dx;
  x = clamp(x, 0, 100 - rectR.width);
  rataEl.style.left = x + "%";
}


/* ========== [INICIALIZACIÓN / TEAR DOWN] ========== */
/* ► Reset del estado de la partida */
function resetEstado() {
  puntos = 0;
  vidas  = CFG.vidasIniciales;

  objetos.forEach(o => o.el.remove());
  objetos = [];

  lastTs = 0;
  if (scoreEl) scoreEl.textContent = "0";
  if (livesEl) livesEl.textContent = String(vidas);

  // Dificultad base
  actualizarDificultad(0);

  // Limpiar efectos activos
  if (_tSpeed)  { clearTimeout(_tSpeed);  _tSpeed  = null; }
  if (_tFall)   { clearTimeout(_tFall);   _tFall   = null; }
  if (_tShield) { clearTimeout(_tShield); _tShield = null; }
  speedMult = 1; fallMult = 1; shieldOn = false;
  velHorizontalPctPorSeg = baseVelLateral;
}

/* ► Suscripción de controles */
function bindControles() {
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
}
function unbindControles() {
  window.removeEventListener("keydown", onKeyDown);
  window.removeEventListener("keyup", onKeyUp);
}

/* ► Fin de partida */
function terminarJuego() {
  // Guardar mejor puntaje local
  const prev = parseInt(localStorage.getItem("maxPuntos") || "0", 10);
  if (puntos > prev) localStorage.setItem("maxPuntos", String(puntos));

  // Parar bucles y limpiar
  if (rafId) cancelAnimationFrame(rafId);
  if (spawnTimer) clearInterval(spawnTimer);
  unbindControles();

  // Señal visual simple
  if (gameView) gameView.style.filter = "grayscale(0.3)";
  // Puedes redirigir o mostrar modal de Game Over aquí
  // window.location.href = "./menu.html";
}


/* ========== [API PÚBLICA] ========== */
/**
 * Inicia el prólogo.
 * @param {{ gameViewId?:string, rataId?:string, scoreId?:string, livesId?:string }} cfg
 */
export function startPrologo(cfg = {}) {
  // DOM
  gameView = document.getElementById(cfg.gameViewId || "gameView");
  rataEl   = document.getElementById(cfg.rataId     || "rata");
  scoreEl  = document.getElementById(cfg.scoreId    || "score");
  livesEl  = document.getElementById(cfg.livesId    || "lives");

  if (!gameView || !rataEl) {
    console.error("[juego_prologo] Faltan #gameView o #rata");
    return;
  }

  // Estilos base para posicionamiento en %
  gameView.style.position = "relative";
  rataEl.style.position   = "absolute";
  if (!rataEl.style.left) rataEl.style.left = "45%";
  if (!rataEl.style.top)  rataEl.style.top  = "80%";

  resetEstado();
  bindControles();
  resetSpawnTimer();

  // Bucle principal: mover y actualizar
  rafId = window.requestAnimationFrame(function step(ts) {
    const dtSeg = lastTs ? (ts - lastTs) / 1000 : 0;
    moverRata(dtSeg);
    loop(ts);
  });
}

/** Detiene el prólogo limpiamente. */
export function stopPrologo() {
  if (rafId) cancelAnimationFrame(rafId);
  if (spawnTimer) clearInterval(spawnTimer);
  unbindControles();
}
