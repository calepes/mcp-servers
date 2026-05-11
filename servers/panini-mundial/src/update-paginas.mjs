#!/usr/bin/env node
// update-paginas.mjs — asigna campo Pagina a cada lámina según el índice del álbum
// Fuente: foto del índice del álbum (página 1)
// Uso: NOTION_TOKEN=secret_xxx node src/update-paginas.mjs

const TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.PANINI_DB_ID || "35cc487609dd80868b1dc68095a6f84f";

if (!TOKEN) {
  console.error("Error: falta NOTION_TOKEN");
  process.exit(1);
}

// Página de inicio de cada sección según el índice físico del álbum (pág. 1)
// Formato: stickers 1-10 → página de inicio, stickers 11-20 → página de inicio + 1
const SECTION_START_PAGE = {
  // Grupo A
  "Mexico": 8,
  "South Africa": 10,
  "South Korea": 12,
  "Czechia": 14,
  // Grupo B
  "Canada": 16,
  "Bosnia y Herzegovina": 18,
  "Qatar": 20,
  "Switzerland": 22,
  // Grupo C
  "Brazil": 24,
  "Morocco": 26,
  "Haiti": 28,
  "Scotland": 30,
  // Grupo D
  "USA": 32,
  "Paraguay": 34,
  "Australia": 36,
  "Turkey": 38,
  // Grupo E
  "Germany": 40,
  "Curaçao": 42,
  "Ivory Coast": 44,
  "Ecuador": 46,
  // Grupo F
  "Netherlands": 48,
  "Japan": 50,
  "Sweden": 52,
  "Tunisia": 54,
  // [Páginas 56-57: contenido especial entre grupos F y G]
  // Grupo G
  "Belgium": 58,
  "Egypt": 60,
  "Iran": 62,
  "New Zealand": 64,
  // Grupo H
  "Spain": 66,
  "Cape Verde": 68,
  "Saudi Arabia": 70,
  "Uruguay": 72,
  // Grupo I
  "France": 74,
  "Senegal": 76,
  "Iraq": 78,
  "Norway": 80,
  // Grupo J
  "Argentina": 82,
  "Algeria": 84,
  "Austria": 86,
  "Jordan": 88,
  // Grupo K
  "Portugal": 90,
  "Congo DR": 92,
  "Uzbekistan": 94,
  "Colombia": 96,
  // Grupo L
  "England": 98,
  "Croatia": 100,
  "Ghana": 102,
  "Panama": 104,
};

// Páginas FWC (Introducción) — según fotos del álbum
// Foto pág 1: FWC 1-4 | Foto pág 2: FWC 5-6 | Foto pág 3: FWC 7-8
// Páginas 4-7: FWC 9-20 (a completar cuando se vean esas páginas)
const FWC_PAGE = {
  1: 1, 2: 1, 3: 1, 4: 1,   // página 1 (índice)
  5: 2, 6: 2,                 // página 2 (pelota oficial + emblema Canadá)
  7: 3, 8: 3,                 // página 3 (emblemas México + USA)
  // FWC 9-20: se actualizarán con fotos de esas páginas
};

async function notionReq(endpoint, method = "GET", body = undefined) {
  const res = await fetch(`https://api.notion.com/v1/${endpoint}`, {
    method,
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Notion ${res.status}: ${await res.text()}`);
  return res.json();
}

function calcPagina(seccion, codigo) {
  if (seccion === "Introducción") {
    const num = parseInt(codigo.split(" ")[1] ?? "0");
    return FWC_PAGE[num] ?? null;
  }
  const startPage = SECTION_START_PAGE[seccion];
  if (!startPage) return null;
  const num = parseInt(codigo.split(" ").pop() ?? "0");
  if (!num) return null;
  return num <= 10 ? startPage : startPage + 1;
}

async function main() {
  let cursor;
  let total = 0, updated = 0, skipped = 0;

  console.log("Leyendo páginas de la DB...");

  do {
    const result = await notionReq(`databases/${DB_ID}/query`, "POST", {
      start_cursor: cursor,
      page_size: 100,
    });
    cursor = result.next_cursor;

    for (const page of result.results) {
      total++;
      const codigo = page.properties?.Codigo?.title?.[0]?.plain_text ?? "";
      const seccion = page.properties?.Seccion?.select?.name ?? "";
      const currentPagina = page.properties?.Pagina?.number;

      const pagina = calcPagina(seccion, codigo);

      if (pagina === null) {
        skipped++;
        continue;
      }
      if (currentPagina === pagina) {
        skipped++;
        continue;
      }

      await notionReq(`pages/${page.id}`, "PATCH", {
        properties: { Pagina: { number: pagina } },
      });
      updated++;
      if (updated % 50 === 0) process.stdout.write(`\r  ${updated} actualizadas...`);
    }
  } while (cursor);

  console.log(`\nListo. ${updated} actualizadas, ${skipped} sin cambio/skip. Total: ${total}.`);
}

main().catch(err => { console.error("\nError:", err.message); process.exit(1); });
