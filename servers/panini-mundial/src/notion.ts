import { Client } from "@notionhq/client";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DB_ID = process.env.PANINI_DB_ID ?? "35cc487609dd80868b1dc68095a6f84f";

export interface Sticker {
  id: string;
  codigo: string;
  seccion: string;
  descripcion: string;
  tipo: string;
  cantidad: number;
  grupo: string;
  pagina: number | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse(page: any): Sticker {
  const p = page.properties;
  const sel = (k: string) => p[k]?.select?.name ?? "";
  const txt = (k: string) => p[k]?.rich_text?.[0]?.plain_text ?? "";
  return {
    id: page.id,
    codigo: p.Codigo?.title?.[0]?.plain_text ?? "",
    seccion: sel("Seccion"),
    descripcion: txt("Descripcion"),
    tipo: sel("Tipo"),
    cantidad: p.Cantidad?.number ?? 0,
    grupo: sel("Grupo"),
    pagina: p.Pagina?.number ?? null,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function paginate(opts: Record<string, any>): Promise<Sticker[]> {
  const out: Sticker[] = [];
  let cursor: string | undefined;
  do {
    const res: any = await notion.databases.query({
      database_id: DB_ID,
      ...opts,
      start_cursor: cursor,
      page_size: 100,
    });
    for (const page of res.results) {
      if ("properties" in page) out.push(parse(page));
    }
    cursor = res.next_cursor ?? undefined;
  } while (cursor);
  return out;
}

export async function queryAll(): Promise<Sticker[]> {
  return paginate({});
}

export async function queryBySeccion(seccion: string): Promise<Sticker[]> {
  return paginate({ filter: { property: "Seccion", select: { equals: seccion } } });
}

export async function queryMissing(seccion?: string): Promise<Sticker[]> {
  const filter: any = { and: [{ property: "Cantidad", number: { equals: 0 } }] };
  if (seccion) filter.and.push({ property: "Seccion", select: { equals: seccion } });
  return paginate({ filter });
}

export async function queryDuplicates(): Promise<Sticker[]> {
  return paginate({ filter: { property: "Cantidad", number: { greater_than_or_equal_to: 2 } } });
}

export async function findByCode(code: string): Promise<Sticker | null> {
  const res: any = await notion.databases.query({
    database_id: DB_ID,
    filter: { property: "Codigo", title: { equals: code } },
    page_size: 1,
  });
  const page = res.results[0];
  return page && "properties" in page ? parse(page) : null;
}

export async function searchStickers(query: string): Promise<Sticker[]> {
  return paginate({
    filter: {
      or: [
        { property: "Codigo", title: { contains: query } },
        { property: "Descripcion", rich_text: { contains: query } },
      ],
    },
  });
}

export async function setCantidad(pageId: string, cantidad: number): Promise<void> {
  await notion.pages.update({
    page_id: pageId,
    properties: { Cantidad: { number: cantidad } } as any,
  });
}

export async function setMeta(
  pageId: string,
  descripcion: string,
  pagina: number | null,
): Promise<void> {
  const props: any = {
    Descripcion: { rich_text: [{ text: { content: descripcion } }] },
  };
  if (pagina !== null) props.Pagina = { number: pagina };
  await notion.pages.update({ page_id: pageId, properties: props });
}
