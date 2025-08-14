// ==========================================================
//  CONECCIONES.JS – Cliente Supabase + Helpers de Auth/DB
//  - Crea el cliente Supabase
//  - Health check para diagnosticar conexión/CORS
//  - Helpers de autenticación (login/registro/logout)
//  - Helpers de base de datos (perfil y mejor puntaje)
//  - Manejo de redirects de verificación/email y OAuth
//  - Reenvío de correo de verificación
// ==========================================================

/* ============= [IMPORTAR SDK DE SUPABASE (ESM)] ============= */
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm";

/* =================== [CONFIGURACIÓN DEL PROYECTO] =================== */
const SUPABASE_URL = "https://cryflatzxyjjvgretkem.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNyeWZsYXR6eHlqanZncmV0a2VtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTUwMTM3OTMsImV4cCI6MjA3MDU4OTc5M30.J4hhX1I3gdZHe8S8oLG60sMyS5C2bflfvVEsr2-UuLA";

/* ================ [CREAR CLIENTE DE SUPABASE] ================ */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* =================== [DIAGNÓSTICO / HEALTH CHECK] =================== */
// Útil para saber si hay problema de CORS o URL errónea.
export async function healthCheck() {
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, { mode: "cors" });
    const ok = res.ok ? await res.text() : `HTTP ${res.status}`;
    return { ok: res.ok, detail: ok };
  } catch (e) {
    return { ok: false, detail: e?.message || "Fetch failed" };
  }
}

/* ====================== [AUTH: HELPERS BÁSICOS] ====================== */
export async function getUser() {
  const { data: { user } } = await supabase.auth.getUser();
  return user || null;
}

export function onAuthStateChange(cb){
  // Retorna la suscripción por si quieres .unsubscribe() más adelante
  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user || null);
  });
  return subscription;
}

/* =========== [AUTH: LOGIN / REGISTRO / LOGOUT con try/catch] =========== */
export async function signInWithEmail(email, password){
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { user: data?.user || null, error };
  } catch (e) {
    console.error("signInWithEmail failed:", e);
    return { user: null, error: { message: "No se pudo conectar con Supabase (revisa URL/clave/CORS)." } };
  }
}

export async function signUpWithEmail(email, password, nombre){
  try {
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: { nombre },
        // ===== MOD: forzar redirección al deploy de GitHub Pages =====
        emailRedirectTo: "https://gupi15.github.io/RedEvo/index.html"
        // Alternativa si quieres ir directo al juego:
        // emailRedirectTo: "https://gupi15.github.io/RedEvo/paginas/juego.html"
      }
    });
    return { user: data?.user || null, error };
  } catch (e) {
    console.error("signUpWithEmail failed:", e);
    return { user: null, error: { message: "No se pudo conectar con Supabase (revisa URL/clave/CORS)." } };
  }
}

export async function signOut(){
  try {
    const { error } = await supabase.auth.signOut();
    return { error };
  } catch (e) {
    return { error: { message: "Falló el logout." } };
  }
}

/* =================== [DB: HELPERS DE PERFIL/PUNTAJE] =================== */
export async function upsertPerfil(userId, nombre){
  try {
    const { error } = await supabase
      .from("perfiles")
      .upsert({ id: userId, nombre }, { onConflict: "id" });
    return { error };
  } catch (e) {
    return { error: { message: "No se pudo guardar el perfil." } };
  }
}

export async function getPerfil(userId){
  try {
    const { data, error } = await supabase
      .from("perfiles")
      .select("id, nombre, mejor_puntaje")
      .eq("id", userId)
      .single();
    return { data, error };
  } catch (e) {
    return { data: null, error: { message: "No se pudo leer el perfil." } };
  }
}

export async function updateBestScore(userId, best){
  try {
    const { error } = await supabase
      .from("perfiles")
      .update({ mejor_puntaje: best })
      .eq("id", userId);
    return { error };
  } catch (e) {
    return { error: { message: "No se pudo actualizar el mejor puntaje." } };
  }
}

/* ============== [AUTH: MANEJO DE REDIRECTS (Email/OAuth)] ============== */
// - Procesa errores en hash (#error=...)
// - Toma sesiones en hash (#access_token + #refresh_token)
// - Intercambia ?code=... (PKCE) usando la URL completa
// - Limpia la URL después
export async function tryHandleAuthRedirect() {
  // 0) #error=...
  if (window.location.hash && window.location.hash.includes("error=")) {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const code = params.get("error_code") || "unknown_error";
    const description = params.get("error_description") || "Unknown error";
    history.replaceState({}, document.title, window.location.pathname);
    return { handled: true, redirectError: { code, description: decodeURIComponent(description) } };
  }

  // 1) #access_token=...&refresh_token=...
  if (window.location.hash && window.location.hash.includes("access_token")) {
    const params = new URLSearchParams(window.location.hash.substring(1));
    const access_token = params.get("access_token");
    const refresh_token = params.get("refresh_token");
    if (access_token && refresh_token) {
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });
      history.replaceState({}, document.title, window.location.pathname);
      return { handled: true, error };
    }
  }

  // 2) ?code=... (PKCE) — ===== MOD: usar URL completa =====
  const url = new URL(window.location.href);
  if (url.searchParams.get("code")) {
    const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
    url.searchParams.delete("code");
    url.searchParams.delete("type");
    history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    return { handled: true, error };
  }

  return { handled: false, error: null };
}

/* ============== [AUTH: REENVIAR VERIFICACIÓN DE EMAIL] ============== */
export async function resendSignup(email){
  try {
    const { data, error } = await supabase.auth.resend({ type: "signup", email });
    return { data, error };
  } catch (e) {
    return { data: null, error: { message: "No se pudo reenviar la verificación." } };
  }
}
