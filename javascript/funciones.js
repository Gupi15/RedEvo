// ==========================================================
//  FUNCIONES.JS – Lógica de Juego + Sesión (con Supabase)
//  - Redirige a login si NO hay sesión
//  - Redirige a menú si hay sesión y no viene ?play=1
//  - Crea/lee perfil (nombre, mejor puntaje)
//  - Controla el juego y guarda best score
//  - Botón “Menú principal” en el header (opcional)
// ==========================================================

/* ============ [IMPORTS: SDK/Helpers Supabase] ============ */
import {
  getUser, onAuthStateChange,
  upsertPerfil, getPerfil, updateBestScore,
  /* 🆕 Import para manejar el hash de Supabase en GitHub Pages */
  tryHandleAuthRedirect
} from "./conecciones.js";

/* ================== [DOM: Selectores base] ================= */
const gameView   = document.getElementById("gameView");
const userTag    = document.getElementById("userTag");

const rata       = document.getElementById("rata");
const scoreEl    = document.getElementById("score");
const livesEl    = document.getElementById("lives");
const bestScoreEl= document.getElementById("bestScore");

const mensaje        = document.getElementById("mensaje");
const mensajeTitulo  = document.getElementById("mensajeTitulo");
const mensajeSub     = document.getElementById("mensajeSub");
const btnEmpezar     = document.getElementById("btnEmpezar");

/* 🆕 [DOM: Botón volver al menú (opcional)] */
const btnMenuPrincipalHeader = document.getElementById("btnMenuPrincipalHeader") || null;

/* ============== [ESTADO GLOBAL: Usuario/Juego] ============= */
let currentUser = null;
let bestScore   = 0;

let jugando = false;
let puntos  = 0;
let vidas   = 3;
let rataX   = 50; // %
let objetos = []; // {el, x, y, v, tipo}
let ultimoTiempo = 0;
let acumuladoSpawn = 0;

/* ============== [RUTEO: Flags simples] ============== */
/* Si la URL NO trae ?play=1 y hay sesión, enviamos a ./menu.html */
const _params       = new URLSearchParams(window.location.search);
const QUIERE_JUGAR  = _params.has("play");

/* ============== [UI: Helpers de juego] ============== */
function setGameView(user, nombrePreferido) {
  const nombre =
    nombrePreferido ||
    user?.user_metadata?.nombre ||
    (user?.email ? user.email.split("@")[0] : "Jugador");
  if (userTag) userTag.textContent = `Hola, ${nombre}`;
  if (btnMenuPrincipalHeader) btnMenuPrincipalHeader.classList.remove("oculto");
}

/* 🧭 [NAV] Botón “Menú principal” */
if (btnMenuPrincipalHeader) {
  btnMenuPrincipalHeader.addEventListener("click", () => {
    window.location.href = "./menu.html"; // relativo a paginas/juego.html
  });
}

/* ========== [PERFIL: Crear si no existe + cargar datos] ========== */
async function ensurePerfil(user) {
  if (!user) return null;

  // 1) Leer perfil
  let { data, error } = await getPerfil(user.id);

  // 2) Si no existe, crearlo con nombre razonable
  if (error || !data) {
    const nombreBase =
      user.user_metadata?.nombre ||
      (user.email ? user.email.split("@")[0] : "Jugador");
    const { error: upErr } = await upsertPerfil(user.id, nombreBase);
    if (upErr) { console.error("No pude crear perfil:", upErr); return null; }
    ({ data, error } = await getPerfil(user.id));
  }

  if (error) { console.error("Error leyendo perfil:", error); return null; }

  // 3) Reflejar datos
  bestScore = data?.mejor_puntaje ?? 0;
  if (bestScoreEl) bestScoreEl.textContent = bestScore;

  const nombrePreferido = data?.nombre || user.user_metadata?.nombre || null;
  setGameView(user, nombrePreferido);
  return data;
}

/* ======= [SESIÓN: Inicio + ruteo a login/menú] ======= */
(async () => {
  /* 🆕 Consumir hash de Supabase (#access_token/#refresh_token) y limpiar URL */
  await tryHandleAuthRedirect();

  const user = await getUser();
  currentUser = user;

  if (!user) {                 // A) Sin sesión → login
    window.location.href = "./login.html";
    return;
  }
  if (user && !QUIERE_JUGAR) { // B) Con sesión, sin ?play → menú
    window.location.href = "./menu.html";
    return;
  }

  // C) Con sesión y ?play=1 → cargar perfil y mostrar juego
  await ensurePerfil(user);
})();

/* ========= [SESIÓN: Cambios en vivo] ========= */
onAuthStateChange(async (user) => {
  currentUser = user;

  if (!user) {
    window.location.href = "./login.html";
    return;
  }
  if (user && !QUIERE_JUGAR) {
    window.location.href = "./menu.html";
    return;
  }
  await ensurePerfil(user);
});

/* ============= [JUEGO: Utilidades y constantes CSS] ============= */
const rand = (min, max) => Math.random() * (max - min) + min;
const getCSSPercent = (name) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return parseFloat(v.replace("%", ""));
};
const VEL_MIN = () => getCSSPercent("--vel-min");
const VEL_MAX = () => getCSSPercent("--vel-max");

/* ============== [JUEGO: Reset/Overlay Mensajes] ============== */
function resetear() {
  puntos = 0; vidas = 3; rataX = 50;
  objetos.forEach((o) => o.el.remove());
  objetos = [];
  scoreEl.textContent = puntos;
  livesEl.textContent = vidas;
  posicionarRata();
}
function mostrarMensaje(titulo, sub, mostrarBoton = true) {
  mensajeTitulo.textContent = titulo;
  mensajeSub.textContent = sub || "";
  btnEmpezar.style.display = mostrarBoton ? "inline-block" : "none";
  mensaje.classList.remove("oculto");
}
function ocultarMensaje() { mensaje.classList.add("oculto"); }

/* ================== [JUEGO: Posición del jugador] ================== */
function posicionarRata() { rata.style.left = rataX + "%"; }

/* ================= [JUEGO: Spawning de objetos] ================= */
function crearObjeto() {
  const tipoBueno = Math.random() < 0.7;
  const el = document.createElement("div");
  el.className = "obj " + (tipoBueno ? "bueno" : "malo");
  el.textContent = tipoBueno ? "🧀" : "💩";
  gameView.appendChild(el);

  const x = rand(5, 95);
  const y = -10;
  const v = rand(VEL_MIN(), VEL_MAX());
  el.style.left = x + "%";
  el.style.top  = y + "%";

  objetos.push({ el, x, y, v, tipo: tipoBueno ? "bueno" : "malo" });
}

/* ============== [JUEGO: Bucle principal (update)] ============== */
function actualizar(ts) {
  if (!jugando) return;
  if (!ultimoTiempo) ultimoTiempo = ts;
  const dt = (ts - ultimoTiempo) / 1000;
  ultimoTiempo = ts;

  acumuladoSpawn += dt;
  const intervalo = 0.6 + Math.random() * 0.6;
  if (acumuladoSpawn >= intervalo) { crearObjeto(); acumuladoSpawn = 0; }

  objetos.forEach((o) => { o.y += o.v * dt; o.el.style.top = o.y + "%"; });
  manejarColisionesYLimpieza();
  requestAnimationFrame(actualizar);
}

/* ============== [JUEGO: Colisiones y limpieza] ============== */
/* ► Ajuste global del alcance (en % del tablero) */
const HITBOX_SHRINK = 2; // sube/baja para cambiar el alcance

function getRectPercent(el, shrink = 0) {
  const rect = el.getBoundingClientRect();
  const base = gameView.getBoundingClientRect();
  let left   = ((rect.left - base.left) / base.width) * 100;
  let top    = ((rect.top  - base.top)  / base.height) * 100;
  let width  = (rect.width  / base.width)  * 100;
  let height = (rect.height / base.height) * 100;

  // 🔹 Reducir el área de colisión (shrink controla el recorte)
  left   += shrink;
  top    += shrink;
  width  -= shrink * 2;
  height -= shrink * 2;

  return { left, top, width, height };
}

function intersectan(a, b) {
  return !(a.left + a.width < b.left || b.left + b.width < a.left ||
           a.top + a.height < b.top || b.top + b.height < a.top);
}

/* ► Debug visual del hitbox reducido de la rata */
let _debugHB = null;
function _drawRataHitboxDebug(r){
  if (!_debugHB){
    _debugHB = document.createElement('div');
    _debugHB.className = 'debug-hitbox';
    _debugHB.style.position = 'absolute';
    _debugHB.style.outline  = '0.8% solid red';
    _debugHB.style.pointerEvents = 'none';
    _debugHB.style.zIndex = '5';
    gameView.appendChild(_debugHB);
  }
  _debugHB.style.left   = r.left + '%';
  _debugHB.style.top    = r.top + '%';
  _debugHB.style.width  = r.width + '%';
  _debugHB.style.height = r.height + '%';
}

function manejarColisionesYLimpieza() {
  // 👇 Usa el hitbox reducido configurado
  const rRect = getRectPercent(rata, HITBOX_SHRINK);

  // 🔴 Dibuja el hitbox reducido para verificar el alcance
  _drawRataHitboxDebug(rRect);

  const restantes = [];
  for (const o of objetos) {
    const oRect = getRectPercent(o.el);
    if (intersectan(rRect, oRect)) {
      if (o.tipo === "bueno") puntos += 1;
      else vidas -= 1;

      o.el.remove();
      scoreEl.textContent = puntos;
      livesEl.textContent = vidas;
      if (vidas <= 0) { terminarJuego(); return; }
      continue;
    }
    if (o.y > 110) { o.el.remove(); continue; }
    restantes.push(o);
  }
  objetos = restantes;
}

/* =================== [JUEGO: Controles pointer] =================== */
function moverConPointer(clientX) {
  const base = gameView.getBoundingClientRect();
  let x = ((clientX - base.left) / base.width) * 100;
  x = Math.max(5, Math.min(95, x));
  rataX = x;
  posicionarRata();
}
gameView.addEventListener("mousemove", (e) => moverConPointer(e.clientX));
gameView.addEventListener("touchmove", (e) => {
  if (e.touches && e.touches[0]) moverConPointer(e.touches[0].clientX);
}, { passive: true });

/* =================== [JUEGO: Ciclo de vida] =================== */
gameView.addEventListener("pointerdown", () => {
  if (!jugando && mensaje.classList.contains("oculto")) iniciarJuego();
});
btnEmpezar.addEventListener("click", iniciarJuego);

function iniciarJuego() {
  resetear();
  jugando = true;
  ocultarMensaje();
  ultimoTiempo = 0;
  acumuladoSpawn = 0;
  requestAnimationFrame(actualizar);
}

async function terminarJuego() {
  jugando = false;
  mostrarMensaje("Juego terminado", `Puntaje: ${puntos}. ¿Otra vez?`);
  if (currentUser) {
    await ensurePerfil(currentUser); // por si no estaba en memoria
    if (puntos > bestScore) {
      bestScore = puntos;
      bestScoreEl.textContent = bestScore;
      const { error } = await updateBestScore(currentUser.id, bestScore);
      if (error) console.error("No pude actualizar mejor puntaje:", error);
    }
  }
}

/* ========== [OBJETIVOS: sistema de logros - script clásico] ========== */

/* ► Marca un objetivo por id y quita 'ghost' si aplica */
function marcarObjetivo(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("completado");
  el.classList.remove("ghost");           // evita fondo/outline del ghost
  el.setAttribute("aria-disabled", "false");
}

/* ► Marca según puntaje */
function actualizarObjetivos(puntos) {
  if (puntos >= 100) marcarObjetivo("obj-100");
  if (puntos >= 200) marcarObjetivo("obj-200");
  if (puntos >= 500) marcarObjetivo("obj-500");
}

/* ► Exponer global */
window.actualizarObjetivos = actualizarObjetivos;


/* =================== [INIT: Pantalla inicial] =================== */
resetear();
mostrarMensaje("¡Listo!", "Haz clic o toca para empezar");
