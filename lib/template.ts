// The property sheet template offered on the Map tab. Its columns match the "All Properties" sheet, plus
// Latitude, Longitude, State, Status and Beds. Every column the upload understands is here; only Property Name and a location are needed.

const transit = (kind: string, place: string) => [`${kind} Name`, `Distance of ${place} from Property`];
export const TEMPLATE_COLS = [
  "Zolo Code", "Property Name", "City", "State", "Gender", "Full Address", "Google Maps Link", "Latitude", "Longitude", "Status", "Beds",
  "Property Description", "Drive Link of Property Photos", "About the Property",
  "Food Availability", "Gym", "Lounge (Common sitting area)", "Terrace (Open space for walking/drying clothes)", "Game Zone / Indoor Games",
  "Kitchen", "Washing Machine", "Refrigerator", "Parking",
  ...[1, 2, 3, 4].flatMap((n) => [`Demand Centre ${n}`, `Distance of Demand Centre ${n} from property`]),
  ...transit("Train Station", "Train station"), ...transit("Bus Terminal", "Bus Terminal"), ...transit("Metro Station", "Metro Station"), ...transit("Airport", "Airport"),
  "CEM Name", "CEM Mobile", "ACEM Name", "ACEM Mobile", "GRO Name", "GRO Mobile", "Total On-site Staff", "Remarks", "Compliance %",
];
export const TEMPLATE_EXAMPLE = [
  "ZOEXMP", "Zolo Example (delete this row)", "Bangalore", "Karnataka", "couple", "80 Feet Road, Koramangala, Bengaluru, Karnataka 560034", "https://maps.app.goo.gl/…", "12.9352", "77.6245", "Live", "120",
  "Short listing description.", "https://drive.google.com/…", "**Zolo Example – PG in Koramangala**\n\nA line or two about the property.\n\n* Fully furnished rooms\n* High-speed Wi-Fi",
  "Yes", "No", "Yes", "No", "No", "Yes", "Yes", "Yes", "Yes",
  "Forum Mall", "500 m", "Embassy Tech Square", "2 km", "St. John's Hospital", "1.5 km", "Christ University", "3 km",
  "Bangalore Cantonment", "7 km", "Koramangala Bus Stop", "300 m", "Indiranagar", "4 km", "Kempegowda International Airport", "40 km",
  "CEM name", "9800000000", "ACEM name", "9800000001", "GRO name", "9800000002", "3", "", "100%",
];

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
/** CSV text with a byte-order mark, so Excel opens it as UTF-8. */
export const toCsv = (rows: string[][]) => "﻿" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
export const templateCsv = () => toCsv([TEMPLATE_COLS, TEMPLATE_EXAMPLE]);

// A small .xlsx writer (uncompressed zip), enough for a template: bold, frozen header row and sensible column widths.
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const colName = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

function zip(files: [string, string][]): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  for (const [name, text] of files) {
    const n = enc.encode(name), d = enc.encode(text), crc = crc32(d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true);
    h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, n.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
    c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, n.length, true); c.setUint32(42, off, true);
    parts.push(new Uint8Array(h.buffer), n, d); central.push(new Uint8Array(c.buffer), n);
    off += 30 + n.length + d.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out;
}

export function templateXlsx(): Uint8Array {
  return toXlsx("Properties", [TEMPLATE_COLS, TEMPLATE_EXAMPLE], TEMPLATE_COLS.map((h) => (/description|about/i.test(h) ? 50 : /address|link/i.test(h) ? 36 : Math.min(30, Math.max(12, h.length + 2)))));
}

/** One-sheet workbook: the first row is a bold, frozen header. */
export function toXlsx(name: string, rows: string[][], widths: number[]): Uint8Array {
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${colName(ci)}${ri + 1}" t="inlineStr"${ri === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${esc(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  return zip([
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(name)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF0FF"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/></cellXfs></styleSheet>`],
    ["xl/worksheets/sheet1.xml", sheet],
  ]);
}
