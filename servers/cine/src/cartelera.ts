/// <reference lib="dom" />
// Cartelera de cine en Santa Cruz de la Sierra, Bolivia.
//
// NOTA tsc: la directiva `/// <reference lib="dom" />` de arriba habilita los
// tipos del DOM (document, HTMLElement, ...) SOLO para este archivo — necesario
// porque los callbacks de page.evaluate() corren en el browser. No cambia el
// `lib` del resto del daemon.
//
// Scrapea los 3 cines de la ciudad con Playwright headless usando el Chrome
// real del sistema (`channel: "chrome"`). El Chromium propio de Playwright es
// bloqueado con 403 por el WAF de Multicine (CINEsync); el Chrome real pasa el
// fingerprint aun en headless. Cinemark y Cine Center funcionan con cualquiera,
// pero usamos Chrome para todos por consistencia.
//
// v1: solo cartelera de HOY. Los 3 sitios muestran el día actual sin necesidad
// de clicks en el selector de fecha (Cinemark /pelicula/{slug}, Multicine
// buy-tickets, Cine Center /Horarios). Fechas futuras = mejora incremental.
//
// Parseo por innerText/selectores estables, NO por clases CSS ofuscadas:
// - Cinemark: texto "2D · Doblada" + "10:20hs" bajo "HORARIOS EN CINEMARK".
// - Multicine: tripletas idioma/formato/"HH:MM hrs" dentro de .pc-movie-item-row.
// - Cine Center: título → sub-bloques "2D DOB" → funciones "HH:MM - NN Bs."
//   (Blazor SignalR: requiere ~6s de espera para el round-trip server-side).

import type { Browser, Page } from "playwright";
import { fetchCartelera } from "./cinemark-bff.js";
import { hoyLaPaz } from "./fecha.js";
// playwright está hoisted en el root del workspace (no en daemon-v2/node_modules).
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium } = require("playwright") as typeof import("playwright");

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Getter perezoso del browser: lanza Chrome la PRIMERA vez que alguien lo pide y
 * lo reusa. Los adapters lo llaman solo si de verdad necesitan Playwright, así una
 * consulta que se resuelve entera por el BFF nunca abre Chrome.
 */
type GetBrowser = () => Promise<Browser>;

export interface Funcion {
  formato: string; // "2D", "2D XL", "3D Atmos", "2D + PREMIER", etc.
  idioma: string; // "Doblada" | "Subtitulada" | "Español" | "Ingles" | ...
  hora: string; // "HH:MM"
  precioBs?: number; // solo Cine Center lo expone en cartelera
  sala?: string; // solo Cinemark
}

export interface PeliculaCartelera {
  titulo: string;
  funciones: Funcion[];
}

export interface CineResultado {
  cine: string;
  ubicacion: string;
  ok: boolean;
  /** De dónde salieron los datos. Cinemark puede venir del BFF JSON o del scraper DOM. */
  fuente?: "bff" | "scraping";
  peliculas: PeliculaCartelera[];
  error?: string;
}

const UBICACIONES = {
  cinemark: "Cinemark — Ventura Mall, 4to anillo esq. Av. San Martín, 2do piso, Santa Cruz",
  multicine: "Multicine — C.C. Las Brisas, 4to anillo y Av. Banzer, 3er piso, Santa Cruz",
  cinecenter: "Cine Center — MegaCenter, Av. El Trompillo (2do anillo) esq. René Moreno, Santa Cruz",
} as const;

// Normaliza para comparar títulos: minúsculas, sin tildes, sin puntuación.
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesPelicula(titulo: string, query?: string): boolean {
  if (!query) return true;
  const t = norm(titulo);
  const q = norm(query);
  return t.includes(q) || q.includes(t);
}

// ---------------- CINEMARK ----------------
// Lista de slugs en cartelera desde la home.
async function cinemarkSlugs(browser: Browser): Promise<{ slug: string; titulo: string }[]> {
  const page = await browser.newPage({ userAgent: CHROME_UA });
  try {
    await page.goto("https://www.cinemark.com.bo/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(3000);
    return await page.evaluate(() => {
      const seen = new Set<string>();
      const out: { slug: string; titulo: string }[] = [];
      for (const a of Array.from(document.querySelectorAll("a[href*='/pelicula/']"))) {
        const href = a.getAttribute("href") || "";
        if (href.includes("/tickets") || href.includes("/review")) continue;
        const slug = href.split("/pelicula/")[1]?.split("/")[0];
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);
        const titulo = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        out.push({ slug, titulo });
      }
      return out;
    });
  } finally {
    await page.close();
  }
}

// Horarios de HOY de una película en Cinemark.
async function cinemarkMovie(
  browser: Browser,
  slug: string,
  tituloFallback: string,
): Promise<PeliculaCartelera | null> {
  const page = await browser.newPage({ userAgent: CHROME_UA });
  try {
    await page.goto(`https://www.cinemark.com.bo/pelicula/${slug}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(3500);
    const res = await page.evaluate(() => {
      const all = document.body.innerText;
      const titleEl = document.querySelector("h1");
      const titulo = titleEl ? titleEl.innerText.trim() : "";
      const i = all.indexOf("HORARIOS EN");
      if (i < 0) return { titulo, funciones: [] as { formato: string; idioma: string; hora: string }[] };
      const seg = all
        .slice(i, i + 2000)
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const HORA = /^(\d{1,2}:\d{2})hs$/;
      const FMT = /^(\d?D|2D|3D|4D|IMAX|XD|PREMIER)/i;
      const funciones: { formato: string; idioma: string; hora: string }[] = [];
      let curFmt = "";
      let curIdioma = "";
      for (const l of seg) {
        if (/^HORARIOS EN|^Dirección:/i.test(l)) continue;
        if (/^CARTELERA$/i.test(l)) break;
        const hm = HORA.exec(l);
        if (hm) {
          funciones.push({ formato: curFmt, idioma: curIdioma, hora: hm[1] });
          continue;
        }
        if (/^·/.test(l)) {
          curIdioma = l.replace(/^·\s*/, "");
          continue;
        }
        if (FMT.test(l) && l.length < 30) {
          curFmt = l;
          curIdioma = "";
          continue;
        }
      }
      return { titulo, funciones };
    });
    if (!res.funciones.length) return null;
    return { titulo: res.titulo || tituloFallback, funciones: res.funciones };
  } catch {
    return null;
  } finally {
    await page.close();
  }
}

async function scrapeCinemarkDom(browser: Browser, pelicula?: string): Promise<CineResultado> {
  try {
    const slugs = await cinemarkSlugs(browser);
    const objetivo = pelicula
      ? slugs.filter((s) => matchesPelicula(s.titulo, pelicula) || matchesPelicula(s.slug.replace(/-/g, " "), pelicula))
      : slugs;
    // Modo detalle (película específica): traer horarios. Modo lista: solo títulos
    // para no disparar 11 navegaciones (cada /pelicula/ es una carga separada).
    if (pelicula) {
      const pelis: PeliculaCartelera[] = [];
      for (const s of objetivo.slice(0, 4)) {
        const m = await cinemarkMovie(browser, s.slug, s.titulo);
        if (m) pelis.push(m);
      }
      return { cine: "Cinemark", ubicacion: UBICACIONES.cinemark, ok: true, peliculas: pelis };
    }
    return {
      cine: "Cinemark",
      ubicacion: UBICACIONES.cinemark,
      ok: true,
      peliculas: slugs.map((s) => ({ titulo: s.titulo, funciones: [] })),
    };
  } catch (e) {
    return { cine: "Cinemark", ubicacion: UBICACIONES.cinemark, ok: false, peliculas: [], error: String(e) };
  }
}

// Cinemark: BFF JSON como fuente primaria, scraper DOM como plan B.
// Si el BFF responde, `getBrowser` NUNCA se llama y Chrome no se lanza.
async function scrapeCinemark(
  getBrowser: GetBrowser,
  pelicula?: string,
  fecha?: string,
): Promise<CineResultado> {
  const dia = fecha ?? hoyLaPaz();
  try {
    const pelis = await fetchCartelera(dia, pelicula);
    return {
      cine: "Cinemark",
      ubicacion: UBICACIONES.cinemark,
      ok: true,
      fuente: "bff",
      peliculas: pelis.map((p) => ({ titulo: p.titulo, funciones: p.funciones })),
    };
  } catch (e) {
    // El BFF falló (red, 4xx/5xx, shape raro) → degradamos al scraper DOM.
    // OJO: una respuesta vacía NO es un fallo — a la noche el BFF omite las
    // funciones ya empezadas y devolver [] es correcto.
    //
    // LIMITACIÓN: el scraper DOM solo sabe leer HOY. Si el usuario pidió otra
    // fecha, devolver las funciones de hoy sería MENTIRLE. Fallamos explícito.
    if (dia !== hoyLaPaz()) {
      return {
        cine: "Cinemark",
        ubicacion: UBICACIONES.cinemark,
        ok: false,
        fuente: "scraping",
        error: `No pude consultar Cinemark para el ${dia} (su API no respondió: ${
          e instanceof Error ? e.message : String(e)
        }). Puedo consultarte la cartelera de hoy.`,
        peliculas: [],
      };
    }
    try {
      const r = await scrapeCinemarkDom(await getBrowser(), pelicula);
      return { ...r, fuente: "scraping" };
    } catch (e2) {
      // Único camino que llega acá: no se pudo lanzar Chrome (scrapeCinemarkDom
      // atrapa sus propios errores). Devolvemos resultado, no excepción, para no
      // tumbar de paso a Multicine y Cine Center.
      return {
        cine: "Cinemark",
        ubicacion: UBICACIONES.cinemark,
        ok: false,
        fuente: "scraping",
        error: `El BFF de Cinemark falló y tampoco pude abrir el navegador: ${
          e2 instanceof Error ? e2.message : String(e2)
        }`,
        peliculas: [],
      };
    }
  }
}

// ---------------- MULTICINE ----------------
// `fecha` queda declarada y sin usar: la navegación por fecha es la Tarea 6.
async function scrapeMulticine(
  getBrowser: GetBrowser,
  pelicula?: string,
  fecha?: string,
): Promise<CineResultado> {
  // `newPage` va DENTRO del try: ahora abrir el browser puede fallar (lanzamos
  // Chrome recién acá) y ese fallo tiene que volver como ok:false, no como throw.
  let page: Page | undefined;
  try {
    const browser = await getBrowser();
    page = await browser.newPage({ userAgent: CHROME_UA, locale: "es-BO", viewport: { width: 1280, height: 900 } });
    await page.goto(
      "https://www.multicine.com.bo/es-BO/buy-tickets?location=santa-cruz&locationKey=5",
      { waitUntil: "domcontentloaded", timeout: 30000 },
    );
    await page.waitForTimeout(5500);
    const denied = await page.evaluate(() => /Access Denied|Error 403/i.test(document.body.innerText));
    if (denied) {
      return {
        cine: "Multicine",
        ubicacion: UBICACIONES.multicine,
        ok: false,
        peliculas: [],
        error: "403 WAF (CINEsync) — Chrome real requerido",
      };
    }
    const pelis = await page.evaluate(() => {
      const IDIOMAS = /^(Español|Ingl[eé]s|Portugu[eé]s|Subtitulad|Doblad)/i;
      const FMT = /^(2D|3D|4D)\b/;
      const HORA = /(\d{1,2}:\d{2})\s*hrs/i;
      const out: { titulo: string; funciones: { formato: string; idioma: string; hora: string }[] }[] = [];
      for (const row of Array.from(document.querySelectorAll(".pc-movie-item-row"))) {
        const titleEl = row.querySelector("h1,h2,h3,h4,[class*='movie-title'],[class*='title']");
        const titulo = titleEl ? (titleEl as HTMLElement).innerText.trim() : "";
        const lines = (row as HTMLElement).innerText
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
        const funciones: { formato: string; idioma: string; hora: string }[] = [];
        for (let i = 0; i < lines.length; i++) {
          const hm = HORA.exec(lines[i]);
          if (!hm) continue;
          let formato = "";
          let idioma = "";
          if (i >= 1 && FMT.test(lines[i - 1])) formato = lines[i - 1];
          if (i >= 2 && IDIOMAS.test(lines[i - 2])) idioma = lines[i - 2];
          funciones.push({ formato, idioma, hora: hm[1] });
        }
        if (funciones.length) out.push({ titulo, funciones });
      }
      return out;
    });
    const filtradas = pelicula ? pelis.filter((p) => matchesPelicula(p.titulo, pelicula)) : pelis;
    return { cine: "Multicine", ubicacion: UBICACIONES.multicine, ok: true, peliculas: filtradas };
  } catch (e) {
    return { cine: "Multicine", ubicacion: UBICACIONES.multicine, ok: false, peliculas: [], error: String(e) };
  } finally {
    await page?.close();
  }
}

// ---------------- CINE CENTER ----------------
// `fecha` queda declarada y sin usar: la navegación por fecha es la Tarea 6.
async function scrapeCineCenter(
  getBrowser: GetBrowser,
  pelicula?: string,
  fecha?: string,
): Promise<CineResultado> {
  // Ver nota en scrapeMulticine: `newPage` dentro del try.
  let page: Page | undefined;
  try {
    const browser = await getBrowser();
    page = await browser.newPage({ userAgent: CHROME_UA, locale: "es-BO", viewport: { width: 1280, height: 900 } });
    await page.goto("https://www.cinecenter.com.bo/Horarios", { waitUntil: "domcontentloaded", timeout: 30000 });
    // Blazor Server (SignalR): la cartelera llega server-side tras el handshake.
    await page.waitForTimeout(6500);
    const pelis = await page.evaluate(() => {
      const lines = document.body.innerText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const FMT = /^(2D|3D|4D)\b/;
      const FUNC = /^(\d{1,2}:\d{2})\s*-\s*(\d+)\s*Bs/i;
      const out: {
        titulo: string;
        formatos: { formato: string; funciones: { hora: string; precioBs: number }[] }[];
      }[] = [];
      let cur: (typeof out)[number] | null = null;
      let curFmt: (typeof out)[number]["formatos"][number] | null = null;
      for (const l of lines) {
        const fm = FUNC.exec(l);
        if (fm) {
          if (cur && curFmt) curFmt.funciones.push({ hora: fm[1], precioBs: Number(fm[2]) });
          continue;
        }
        if (/^(Género|Genero|Clasificación|Clasificacion):/i.test(l)) continue;
        if (FMT.test(l)) {
          if (cur) {
            curFmt = { formato: l, funciones: [] };
            cur.formatos.push(curFmt);
          }
          continue;
        }
        // Título: mayúsculas, longitud razonable, no ítems de navegación.
        if (
          l.length > 2 &&
          l.length < 60 &&
          l === l.toUpperCase() &&
          /[A-ZÁÉÍÓÚÑ]/.test(l) &&
          !/^(INICIO|CARTELERA|HORARIOS|INICIAR|REGISTR|HOLA|SELECCIONA|TODOS)/i.test(l)
        ) {
          cur = { titulo: l, formatos: [] };
          curFmt = null;
          out.push(cur);
        }
      }
      // Aplanar a la forma común Funcion[].
      return out
        .filter((m) => m.formatos.length)
        .map((m) => ({
          titulo: m.titulo,
          funciones: m.formatos.flatMap((f) => {
            // "2D DOB", "3D Atmos DOB", "2D SUB", "2D SIN DIALOGO"
            const idioma = /\bSUB\b/i.test(f.formato)
              ? "Subtitulada"
              : /SIN DIALOGO/i.test(f.formato)
                ? "Sin diálogo"
                : /\bDOB\b/i.test(f.formato)
                  ? "Doblada"
                  : "";
            const formato = f.formato.replace(/\s*(DOB|SUB|SIN DIALOGO)\s*/gi, "").trim();
            return f.funciones.map((fn) => ({ formato, idioma, hora: fn.hora, precioBs: fn.precioBs }));
          }),
        }));
    });
    const filtradas = pelicula ? pelis.filter((p) => matchesPelicula(p.titulo, pelicula)) : pelis;
    return { cine: "Cine Center", ubicacion: UBICACIONES.cinecenter, ok: true, peliculas: filtradas };
  } catch (e) {
    return { cine: "Cine Center", ubicacion: UBICACIONES.cinecenter, ok: false, peliculas: [], error: String(e) };
  } finally {
    await page?.close();
  }
}

export type CineNombre = "cinemark" | "multicine" | "cinecenter";

export interface GetCarteleraOpts {
  pelicula?: string;
  cines?: CineNombre[];
  /** YYYY-MM-DD ya resuelto por fecha.ts — NUNCA 'hoy'/'mañana' acá. */
  fecha?: string;
}

// Punto de entrada. Scrapea los cines pedidos en paralelo (páginas
// independientes) y cierra el browser al final. ~6-9s típico con Playwright.
//
// Chrome se lanza PEREZOSAMENTE, solo si algún cine lo necesita: pedir únicamente
// Cinemark con el BFF sano no toca Playwright en absoluto (~0.9s y cero procesos).
export async function getCartelera(opts: GetCarteleraOpts = {}): Promise<CineResultado[]> {
  const cines = opts.cines?.length ? opts.cines : (["cinemark", "multicine", "cinecenter"] as CineNombre[]);

  // Cacheamos la PROMESA, no el Browser ya resuelto: los adapters corren en
  // paralelo y con `if (!browser)` dos de ellos entrarían antes de que el primer
  // launch termine, lanzando dos Chrome y filtrando uno.
  let browserPromise: Promise<Browser> | undefined;
  const getBrowser: GetBrowser = () => {
    browserPromise ??= chromium.launch({ headless: true, channel: "chrome" });
    return browserPromise;
  };

  try {
    const jobs: Promise<CineResultado>[] = [];
    if (cines.includes("cinemark")) jobs.push(scrapeCinemark(getBrowser, opts.pelicula, opts.fecha));
    if (cines.includes("multicine")) jobs.push(scrapeMulticine(getBrowser, opts.pelicula, opts.fecha));
    if (cines.includes("cinecenter")) jobs.push(scrapeCineCenter(getBrowser, opts.pelicula, opts.fecha));
    return await Promise.all(jobs);
  } finally {
    // Cerrar solo si se llegó a lanzar, y best-effort: un fallo al cerrar (o un
    // launch que rechazó) no debe tumbar una respuesta ya armada.
    if (browserPromise) {
      try {
        await (await browserPromise).close();
      } catch {
        /* ignorado a propósito */
      }
    }
  }
}
