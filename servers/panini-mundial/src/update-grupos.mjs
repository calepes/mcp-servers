#!/usr/bin/env node
// update-grupos.mjs — rellena el campo Grupo en la DB Panini desde Seccion
// Uso: NOTION_TOKEN=secret_xxx node src/update-grupos.mjs
// No requiere dependencias (usa fetch nativo de Node 18+)

const TOKEN = process.env.NOTION_TOKEN;
const DB_ID = process.env.PANINI_DB_ID || "35cc487609dd80868b1dc68095a6f84f";

if (!TOKEN) {
  console.error("Error: falta NOTION_TOKEN");
  console.error("Crear una integración en https://www.notion.so/profile/integrations");
  console.error("Compartir la DB con esa integración, luego:");
  console.error("  NOTION_TOKEN=secret_xxx node src/update-grupos.mjs");
  process.exit(1);
}

const SECCION_TO_GRUPO = {
  "Mexico": "A", "South Africa": "A", "South Korea": "A", "Czechia": "A",
  "Canada": "B", "Switzerland": "B", "Qatar": "B", "Bosnia y Herzegovina": "B",
  "Brazil": "C", "Morocco": "C", "Haiti": "C", "Scotland": "C",
  "USA": "D", "Paraguay": "D", "Australia": "D", "Turkey": "D",
  "Germany": "E", "Curaçao": "E", "Ivory Coast": "E", "Ecuador": "E",
  "Netherlands": "F", "Japan": "F", "Tunisia": "F", "Sweden": "F",
  "Belgium": "G", "Egypt": "G", "Iran": "G", "New Zealand": "G",
  "Spain": "H", "Cape Verde": "H", "Saudi Arabia": "H", "Uruguay": "H",
  "France": "I", "Senegal": "I", "Norway": "I", "Iraq": "I",
  "Argentina": "J", "Algeria": "J", "Austria": "J", "Jordan": "J",
  "Portugal": "K", "Uzbekistan": "K", "Colombia": "K", "Congo DR": "K",
  "England": "L", "Croatia": "L", "Ghana": "L", "Panama": "L",
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
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Notion ${res.status}: ${err}`);
  }
  return res.json();
}

async function main() {
  let cursor = undefined;
  let total = 0;
  let updated = 0;
  let skipped = 0;

  console.log("Leyendo páginas de la DB...");

  do {
    const result = await notionReq(`databases/${DB_ID}/query`, "POST", {
      start_cursor: cursor,
      page_size: 100,
    });

    cursor = result.next_cursor;

    for (const page of result.results) {
      total++;
      const seccion = page.properties?.Seccion?.select?.name;
      const grupo = SECCION_TO_GRUPO[seccion];

      if (!grupo) {
        skipped++;
        continue;
      }

      await notionReq(`pages/${page.id}`, "PATCH", {
        properties: { Grupo: { select: { name: grupo } } },
      });
      updated++;
      process.stdout.write(`\r  ${updated} actualizadas, ${skipped} sin grupo (FWC intro)...`);
    }
  } while (cursor);

  console.log(`\nListo. ${updated} páginas actualizadas, ${skipped} sin grupo (FWC intro).`);
}

main().catch((err) => {
  console.error("\nError:", err.message);
  process.exit(1);
});
