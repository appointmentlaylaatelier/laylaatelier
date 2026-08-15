import fs from "node:fs";
import path from "node:path";

function pdfEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "-");
}

function cleanCell(value: string) { return value.replace(/\s+/g, " ").trim(); }
function truncate(value: string, max: number) {
  const clean = cleanCell(value);
  return clean.length > max ? `${clean.slice(0, Math.max(1, max - 3))}...` : clean;
}

function reportLogoHex() {
  try {
    return fs.readFileSync(path.join(process.cwd(), "public", "report-logo.jpg")).toString("hex").toUpperCase();
  } catch {
    return "";
  }
}

export function createTextPdf(title: string, subtitle: string, rows: string[]) {
  const header = (rows[0] || "").split("|").map(cleanCell);
  const dataRows = rows.slice(1).filter(row => row.trim() && !/^-{8,}$/.test(row.trim())).map(row => row.split("|").map(cleanCell));
  const pageWidth = 842, pageHeight = 595;
  const margin = 42;
  const availableWidth = pageWidth - margin * 2;
  const headerY = 365;
  const headerHeight = 34;
  const rowHeight = 31;
  const headerBodyGap = 8;
  const firstRowTop = headerY - headerBodyGap;
  const rowsPerPage = 9;
  const pages = Math.max(1, Math.ceil(Math.max(dataRows.length, 1) / rowsPerPage));

  function columnWidths(count: number) {
    const presets: Record<number, number[]> = {
      5: [0.22, 0.16, 0.31, 0.13, 0.18],
      6: [0.18, 0.18, 0.24, 0.13, 0.13, 0.14],
    };
    return (presets[count] || Array(count).fill(1 / Math.max(count, 1))).map(v => v * availableWidth);
  }
  const widths = columnWidths(header.length || 1);
  const logoHex = reportLogoHex();

  const objects: string[] = [];
  const logoId = 5;
  const firstPageId = logoHex ? 6 : 5;
  const pageIds = Array.from({ length: pages }, (_, i) => firstPageId + i * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  if (logoHex) {
    objects[logoId] = `<< /Type /XObject /Subtype /Image /Width 360 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${logoHex.length + 1} >>\nstream\n${logoHex}>\nendstream`;
  }

  for (let pageIndex = 0; pageIndex < pages; pageIndex++) {
    const pageId = firstPageId + pageIndex * 2, contentId = pageId + 1;
    const commands: string[] = [];
    const pageRows = dataRows.slice(pageIndex * rowsPerPage, (pageIndex + 1) * rowsPerPage);

    // White branded header keeps the application's real logo visually clean.
    commands.push("1 0.992 0.984 rg", `0 0 ${pageWidth} ${pageHeight} re f`);
    commands.push("1 1 1 rg", `0 ${pageHeight - 104} ${pageWidth} 104 re f`);
    commands.push("0.875 0.549 0.373 rg", `0 ${pageHeight - 108} ${pageWidth} 4 re f`);

    if (logoHex) {
      commands.push("q", "120 0 0 60 46 500 cm", "/Logo Do", "Q");
    } else {
      commands.push("BT", "/F2 22 Tf", "0.000 0.149 0.243 rg", `48 ${pageHeight - 61} Td`, `(LELA ATELIER) Tj`, "ET");
    }

    commands.push("BT", "/F1 7.5 Tf", "0.65 0.30 0.16 rg", `690 ${pageHeight - 52} Td`, `(PRIVATE SHOWROOM) Tj`, "ET");
    commands.push("BT", "/F1 7 Tf", "0.31 0.40 0.44 rg", `690 ${pageHeight - 68} Td`, `(DOHA - QATAR) Tj`, "ET");

    const reportTitle = title.replace(/^LELA ATELIER\s*-\s*/i, "");
    commands.push("BT", "/F2 21 Tf", "0.000 0.149 0.243 rg", `48 ${pageHeight - 151} Td`, `(${pdfEscape(reportTitle)}) Tj`, "ET");
    commands.push("BT", "/F1 9 Tf", "0.31 0.40 0.44 rg", `48 ${pageHeight - 174} Td`, `(${pdfEscape(subtitle)}) Tj`, "ET");

    // Header is deliberately separated from body by an 8pt gap to prevent visual collision.
    commands.push("0.000 0.149 0.243 rg", `${margin} ${headerY} ${availableWidth} ${headerHeight} re f`);
    let x = margin;
    header.forEach((cell, i) => {
      commands.push("BT", "/F2 7.2 Tf", "1 1 1 rg", `${x + 8} ${headerY + 12} Td`, `(${pdfEscape(truncate(cell, Math.max(8, Math.floor(widths[i] / 6))))}) Tj`, "ET");
      x += widths[i];
    });

    if (!pageRows.length) {
      commands.push("BT", "/F1 11 Tf", "0.40 0.43 0.44 rg", `${margin + 12} ${firstRowTop - 38} Td`, `(No records found for this date range.) Tj`, "ET");
    }

    pageRows.forEach((cells, rowIndex) => {
      const rowTop = firstRowTop - rowIndex * rowHeight;
      const y = rowTop - rowHeight;
      commands.push(rowIndex % 2 === 0 ? "0.989 0.973 0.961 rg" : "1 0.996 0.991 rg", `${margin} ${y} ${availableWidth} ${rowHeight} re f`);
      commands.push("0.91 0.85 0.81 RG", "0.45 w", `${margin} ${y} m ${margin + availableWidth} ${y} l S`);
      let cellX = margin;
      cells.slice(0, widths.length).forEach((cell, i) => {
        const maxChars = Math.max(7, Math.floor(widths[i] / 5.7));
        commands.push("BT", `${i === 0 ? "/F2" : "/F1"} 7.5 Tf`, "0.09 0.20 0.25 rg", `${cellX + 8} ${y + 11} Td`, `(${pdfEscape(truncate(cell, maxChars))}) Tj`, "ET");
        cellX += widths[i];
      });
    });

    commands.push("0.875 0.549 0.373 RG", "0.8 w", `48 43 m ${pageWidth - 48} 43 l S`);
    commands.push("BT", "/F2 7.2 Tf", "0.000 0.149 0.243 rg", `48 25 Td`, `(LELA ATELIER) Tj`, "ET");
    commands.push("BT", "/F1 7 Tf", "0.41 0.47 0.50 rg", `112 25 Td`, `(Confidential client report) Tj`, "ET");
    commands.push("BT", "/F1 7 Tf", "0.41 0.47 0.50 rg", `${pageWidth - 96} 25 Td`, `(Page ${pageIndex + 1} of ${pages}) Tj`, "ET");

    const stream = commands.join("\n");
    const xObjects = logoHex ? `/XObject << /Logo ${logoId} 0 R >>` : "";
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xObjects} >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf);
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
