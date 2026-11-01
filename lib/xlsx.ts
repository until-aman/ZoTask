// Reads the first sheet of an .xlsx file into rows of text, without a library. Server only (uses zlib).
import { inflateRawSync } from "node:zlib";

function unzip(buf: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error("This doesn't look like an Excel (.xlsx) file.");
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    files.set(name, method === 8 ? inflateRawSync(raw) : Buffer.from(raw));
    p += 46 + nameLen + extra + comment;
  }
  return files;
}

const unxml = (s: string) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
  e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'" : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));
const text = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");
const colOf = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Rows of the first worksheet. A cell that links somewhere but shows other text (e.g. "Link") gives the link instead. */
export function readXlsx(buf: Buffer): string[][] {
  const z = unzip(buf), get = (n: string) => z.get(n)?.toString("utf8") ?? "";
  const strings = [...get("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => text(m[1]));
  // The first sheet in the workbook's own order.
  const rid = get("xl/workbook.xml").match(/<sheet\b[^>]*r:id="([^"]+)"/)?.[1];
  const target = rid && get("xl/_rels/workbook.xml.rels").match(new RegExp(`<Relationship[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1];
  const sheetPath = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target}`) : "xl/worksheets/sheet1.xml";
  const sheet = get(sheetPath);
  if (!sheet) throw new Error("Couldn't find a worksheet in this file.");
  const relsPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
  const rels = new Map([...get(relsPath).matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [m[1].match(/Id="([^"]+)"/)?.[1], unxml(m[1].match(/Target="([^"]+)"/)?.[1] ?? "")]));
  const links = new Map([...sheet.matchAll(/<hyperlink\b([^>]*)\/?>/g)].map((m) => [m[1].match(/ref="([A-Z]+\d+)/)?.[1], rels.get(m[1].match(/r:id="([^"]+)"/)?.[1])]));
  const rows: string[][] = [];
  for (const r of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], body = c[2] ?? "", ref = attrs.match(/r="([A-Z]+\d+)"/)?.[1] ?? "";
      const t = attrs.match(/t="([^"]+)"/)?.[1], v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = t === "s" ? strings[Number(v)] ?? "" : t === "inlineStr" ? text(body) : v !== undefined ? unxml(v) : "";
      const link = links.get(ref);
      if (link && /^https?:/i.test(link) && !/^https?:/i.test(val.trim())) val = link;
      const i = ref ? colOf(ref) : row.length;
      while (row.length < i) row.push("");
      row[i] = val;
    }
    rows.push(row);
  }
  return rows;
}
