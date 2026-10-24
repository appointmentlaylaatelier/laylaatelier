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

export type AppointmentPdfSummary = { canceled: number; noShow: number; placed: number; arrivedPlaced: number; walkInPlaced: number; notPlaced: number; followUp: number; walkIn: number; walkInNotPlaced: number };

export function createTextPdf(title: string, subtitle: string, rows: string[], appointmentSummary?: AppointmentPdfSummary) {
  const header = (rows[0] || "").split("|").map(cleanCell);
  const dataRows = rows.slice(1).filter(row => row.trim() && !/^-{8,}$/.test(row.trim())).map(row => row.split("|").map(cleanCell));
  const pageWidth = 842, pageHeight = 595;
  const margin = 42;
  const availableWidth = pageWidth - margin * 2;
  const headerHeight = 34;
  const rowHeight = 31;
  const headerBodyGap = 8;
  const regularRowsPerPage = 9;
  const summaryRowsPerPage = 7;
  const pages = Math.max(1, appointmentSummary
    ? dataRows.length <= summaryRowsPerPage ? 1 : 1 + Math.ceil((dataRows.length - summaryRowsPerPage) / regularRowsPerPage)
    : Math.ceil(Math.max(dataRows.length, 1) / regularRowsPerPage));

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
    const hasSummary = Boolean(appointmentSummary && pageIndex === 0);
    const headerY = hasSummary ? 315 : 365;
    const firstRowTop = headerY - headerBodyGap;
    const pageStart = hasSummary ? 0 : appointmentSummary ? summaryRowsPerPage + (pageIndex - 1) * regularRowsPerPage : pageIndex * regularRowsPerPage;
    const pageCapacity = hasSummary ? summaryRowsPerPage : regularRowsPerPage;
    const pageRows = dataRows.slice(pageStart, pageStart + pageCapacity);

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

    if (hasSummary && appointmentSummary) {
      const summaryItems = [
        { label: "CANCELED", value: appointmentSummary.canceled, detail: "", color: [0.72, 0.36, 0.40] },
        { label: "NO SHOW", value: appointmentSummary.noShow, detail: "", color: [0.49, 0.42, 0.62] },
        { label: "PLACED", value: appointmentSummary.placed, detail: `Arrived ${appointmentSummary.arrivedPlaced} / Walk-in ${appointmentSummary.walkInPlaced}`, color: [0.17, 0.55, 0.48] },
        { label: "NOT PLACED", value: appointmentSummary.notPlaced, detail: "", color: [0.85, 0.55, 0.33] },
        { label: "FOLLOW-UP", value: appointmentSummary.followUp, detail: "", color: [0.29, 0.47, 0.66] },
        { label: "WALK-IN", value: appointmentSummary.walkIn, detail: `Placed ${appointmentSummary.walkInPlaced} / Not placed ${appointmentSummary.walkInNotPlaced}`, color: [0.56, 0.43, 0.22] },
      ];
      const cardGap = 8;
      const cardWidth = (availableWidth - cardGap * (summaryItems.length - 1)) / summaryItems.length;
      commands.push("BT", "/F2 7 Tf", "0.31 0.40 0.44 rg", `48 407 Td`, `(APPOINTMENT SUMMARY) Tj`, "ET");
      summaryItems.forEach((item, index) => {
        const x = margin + index * (cardWidth + cardGap);
        commands.push("q", `${item.color.join(" ")} RG`, "0.75 w", "0.97 0.98 0.98 rg", `${x} 356 ${cardWidth} 44 re B`, "Q");
        commands.push("BT", "/F2 5.6 Tf", `${item.color.join(" ")} rg`, `${x + 6} 388 Td`, `(${pdfEscape(item.label)}) Tj`, "ET");
        commands.push("BT", "/F2 12 Tf", `${item.color.join(" ")} rg`, `${x + 6} 371 Td`, `(${item.value}) Tj`, "ET");
        if (item.detail) commands.push("BT", "/F1 4.6 Tf", "0.31 0.40 0.44 rg", `${x + 6} 360 Td`, `(${pdfEscape(item.detail)}) Tj`, "ET");
      });
    }

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


type CalendarPdfAppointment = { client: string; appointmentType: string; date: string; start: string; end: string; service: string; status: string };

function isoToDate(value: string) { return new Date(`${value}T12:00:00`); }
function isoDay(date: Date) { const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, "0"); const d = String(date.getDate()).padStart(2, "0"); return `${y}-${m}-${d}`; }
function addPdfDays(date: Date, days: number) { const next = new Date(date); next.setDate(next.getDate() + days); return next; }
function shortTime(value: string) {
  const [hh, mm] = value.split(":").map(Number); const suffix = hh >= 12 ? "pm" : "am"; const h = hh % 12 || 12; return `${h}:${String(mm || 0).padStart(2, "0")}${suffix}`;
}
function statusColor(status: string): [number, number, number] {
  const s = status.toLowerCase();
  if (s === "arrived") return [0.90, 0.96, 0.94];
  if (s === "walk-in") return [1.00, 0.94, 0.87];
  if (s === "canceled") return [0.99, 0.91, 0.93];
  if (s === "no show") return [0.93, 0.91, 0.96];
  return [0.92, 0.95, 0.98];
}
function statusBorder(status: string): [number, number, number] {
  const s = status.toLowerCase();
  if (s === "arrived") return [0.17, 0.55, 0.48];
  if (s === "walk-in") return [0.85, 0.55, 0.33];
  if (s === "canceled") return [0.72, 0.36, 0.40];
  if (s === "no show") return [0.49, 0.42, 0.62];
  return [0.29, 0.47, 0.66];
}

export function createCalendarPdf(title: string, subtitle: string, appointments: CalendarPdfAppointment[], view: string, from: string, to: string, heading = "") {
  const pageWidth = 842, pageHeight = 595, margin = 34;
  const logoHex = reportLogoHex();
  const pages: string[][] = [];
  const reportTitle = title.replace(/^LELA ATELIER\s*-\s*/i, "");

  function basePage(pageHeading: string) {
    const c: string[] = [];
    c.push("1 0.992 0.984 rg", `0 0 ${pageWidth} ${pageHeight} re f`, "1 1 1 rg", `0 ${pageHeight - 92} ${pageWidth} 92 re f`, "0.875 0.549 0.373 rg", `0 ${pageHeight - 96} ${pageWidth} 4 re f`);
    if (logoHex) c.push("q", "100 0 0 50 38 515 cm", "/Logo Do", "Q");
    else c.push("BT", "/F2 20 Tf", "0.000 0.149 0.243 rg", `40 ${pageHeight - 55} Td`, `(LELA ATELIER) Tj`, "ET");
    c.push("BT", "/F2 18 Tf", "0.000 0.149 0.243 rg", `38 ${pageHeight - 130} Td`, `(${pdfEscape(reportTitle)}) Tj`, "ET");
    c.push("BT", "/F2 12 Tf", "0.65 0.30 0.16 rg", `38 ${pageHeight - 151} Td`, `(${pdfEscape(pageHeading || heading || view)}) Tj`, "ET");
    c.push("BT", "/F1 7.2 Tf", "0.31 0.40 0.44 rg", `38 ${pageHeight - 168} Td`, `(${pdfEscape(truncate(subtitle, 118))}) Tj`, "ET");
    return c;
  }

  function footer(c: string[], pageNo: number, total: number) {
    c.push("0.875 0.549 0.373 RG", "0.7 w", `38 28 m ${pageWidth - 38} 28 l S`);
    c.push("BT", "/F2 7 Tf", "0.000 0.149 0.243 rg", `38 14 Td`, `(LELA ATELIER) Tj`, "ET");
    c.push("BT", "/F1 7 Tf", "0.41 0.47 0.50 rg", `${pageWidth - 95} 14 Td`, `(Page ${pageNo} of ${total}) Tj`, "ET");
  }

  const sorted = [...appointments].sort((a,b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

  if (view === "Monthly") {
    const first = isoToDate(from); const year = first.getFullYear(); const month = first.getMonth();
    const gridStart = new Date(year, month, 1, 12); const offset = (gridStart.getDay() + 6) % 7; gridStart.setDate(gridStart.getDate() - offset);
    const c = basePage(heading || first.toLocaleDateString("en-GB", { month: "long", year: "numeric" }));
    const x0 = margin, yTop = 390, totalW = pageWidth - margin*2, cellW = totalW/7, cellH = 52;
    ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].forEach((d,i)=>{ const x=x0+i*cellW; c.push("0.000 0.149 0.243 rg", `${x} ${yTop} ${cellW} 24 re f`, "BT", "/F2 7.5 Tf", "1 1 1 rg", `${x+cellW/2-10} ${yTop+8} Td`, `(${d}) Tj`, "ET"); });
    for (let index=0; index<42; index++) {
      const d=addPdfDays(gridStart,index); const key=isoDay(d); const row=Math.floor(index/7), col=index%7; const x=x0+col*cellW, y=yTop-24-(row+1)*cellH;
      c.push(d.getMonth()===month ? "1 1 1 rg" : "0.97 0.96 0.95 rg", `${x} ${y} ${cellW} ${cellH} re f`, "0.88 0.84 0.80 RG", "0.4 w", `${x} ${y} ${cellW} ${cellH} re S`);
      c.push("BT", "/F2 7 Tf", d.getMonth()===month ? "0.09 0.20 0.25 rg" : "0.55 0.55 0.55 rg", `${x+5} ${y+cellH-11} Td`, `(${d.getDate()}) Tj`, "ET");
      const allEvents=sorted.filter(a=>a.date===key); const events=allEvents.slice(0,2); events.forEach((a,j)=>{ const yy=y+cellH-24-j*17; const [rr,gg,bb]=statusColor(a.status); c.push(`${rr} ${gg} ${bb} rg`, `${x+5} ${yy-10} ${cellW-10} 15 re f`, "BT", "/F2 5.1 Tf", "0.12 0.24 0.30 rg", `${x+7} ${yy-2} Td`, `(${pdfEscape(truncate(`${shortTime(a.start)} ${a.client}`, 21))}) Tj`, "ET", "BT", "/F1 4.7 Tf", "0.31 0.40 0.44 rg", `${x+7} ${yy-8} Td`, `(${pdfEscape(truncate(`${a.appointmentType} | ${a.service} | ${a.status}`, 24))}) Tj`, "ET"); });
      const extra=allEvents.length-events.length; if(extra>0)c.push("BT","/F1 5 Tf","0.41 0.47 0.50 rg",`${x+6} ${y+4} Td`,`(+${extra} more) Tj`,`ET`);
    }
    pages.push(c);
  } else if (view === "Yearly") {
    const year = isoToDate(from).getFullYear();
    for (let quarter=0; quarter<4; quarter++) {
      const c=basePage(`${year} · ${["Jan–Mar","Apr–Jun","Jul–Sep","Oct–Dec"][quarter]}`);
      for (let m=0;m<3;m++) {
        const month=quarter*3+m; const boxX=margin+m*((pageWidth-margin*2-24)/3+12); const boxY=75; const boxW=(pageWidth-margin*2-24)/3; const boxH=330;
        c.push("1 1 1 rg",`${boxX} ${boxY} ${boxW} ${boxH} re f`,`0.85 0.82 0.79 RG`,`0.6 w`,`${boxX} ${boxY} ${boxW} ${boxH} re S`);
        const monthDate=new Date(year,month,1,12); c.push("BT","/F2 11 Tf","0.000 0.149 0.243 rg",`${boxX+10} ${boxY+boxH-22} Td`,`(${monthDate.toLocaleDateString("en-GB",{month:"long"})}) Tj`,`ET`);
        const start=new Date(year,month,1,12); const offset=(start.getDay()+6)%7; const grid=addPdfDays(start,-offset); const cw=(boxW-16)/7, ch=42;
        ["M","T","W","T","F","S","S"].forEach((d,i)=>c.push("BT","/F2 5.5 Tf","0.41 0.47 0.50 rg",`${boxX+8+i*cw+cw/2-2} ${boxY+boxH-40} Td`,`(${d}) Tj`,`ET`));
        for(let i=0;i<42;i++){ const d=addPdfDays(grid,i); const key=isoDay(d); const row=Math.floor(i/7),col=i%7; const x=boxX+8+col*cw,y=boxY+boxH-56-(row+1)*ch; const count=sorted.filter(a=>a.date===key).length; if(d.getMonth()===month&&count>0)c.push("1 0.94 0.90 rg",`${x+1} ${y+8} ${cw-2} 24 re f`); c.push("BT", count>0?"/F2 6 Tf":"/F1 6 Tf", d.getMonth()===month?"0.12 0.24 0.30 rg":"0.70 0.70 0.70 rg",`${x+cw/2-3} ${y+17} Td`,`(${d.getDate()}) Tj`,`ET`); if(count>0)c.push("BT","/F2 5 Tf","0.65 0.30 0.16 rg",`${x+cw-8} ${y+28} Td`,`(${count}) Tj`,`ET`); }
      }
      pages.push(c);
    }
  } else {
    const start = isoToDate(from);
    const end = isoToDate(to);
    const dates: Date[] = [];
    for (let d = new Date(start); d <= end; d = addPdfDays(d, 1)) dates.push(d);
    const groups = view === "Daily" ? dates.map(d => [d]) : [dates];

    for (const dateGroup of groups) {
      const rangeItems = sorted.filter(a => dateGroup.some(d => isoDay(d) === a.date));
      const minuteValues = rangeItems.flatMap(a => [
        Number(a.start.slice(0, 2)) * 60 + Number(a.start.slice(3, 5)),
        Number(a.end.slice(0, 2)) * 60 + Number(a.end.slice(3, 5)),
      ]);
      const firstMinute = Math.max(0, Math.floor((Math.min(...minuteValues, 9 * 60) - 60) / 30) * 30);
      const lastMinute = Math.min(24 * 60, Math.ceil((Math.max(...minuteValues, 18 * 60) + 60) / 30) * 30);
      const slots: number[] = [];
      for (let min = firstMinute; min < lastMinute; min += 30) slots.push(min);
      const chunks: number[][] = [];
      for (let i = 0; i < slots.length; i += 12) chunks.push(slots.slice(i, i + 12));

      for (const chunk of chunks) {
        const label = view === "Daily"
          ? dateGroup[0].toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
          : heading;
        const c = basePage(label);
        const x0 = margin;
        const yTop = 390;
        const totalW = pageWidth - margin * 2;
        const timeW = 58;
        const dayW = (totalW - timeW) / dateGroup.length;
        const rowH = 27;

        c.push(
          "0.000 0.149 0.243 rg", `${x0} ${yTop} ${timeW} 27 re f`,
          "BT", "/F2 6.5 Tf", "1 1 1 rg", `${x0 + 16} ${yTop + 9} Td`, "(TIME) Tj", "ET",
        );

        dateGroup.forEach((d, i) => {
          const x = x0 + timeW + i * dayW;
          c.push(
            "0.000 0.149 0.243 rg", `${x} ${yTop} ${dayW} 27 re f`,
            "BT", "/F2 7 Tf", "1 1 1 rg", `${x + 7} ${yTop + 14} Td`,
            `(${pdfEscape(d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }))}) Tj`, "ET",
          );
        });

        chunk.forEach((minute, row) => {
          const y = yTop - (row + 1) * rowH;
          const hh = String(Math.floor(minute / 60)).padStart(2, "0");
          const mm = String(minute % 60).padStart(2, "0");
          c.push(
            "0.98 0.97 0.95 rg", `${x0} ${y} ${timeW} ${rowH} re f`,
            "0.88 0.84 0.80 RG", "0.35 w", `${x0} ${y} ${totalW} ${rowH} re S`,
            "BT", "/F1 6 Tf", "0.41 0.38 0.36 rg", `${x0 + 8} ${y + 8} Td`,
            `(${pdfEscape(shortTime(`${hh}:${mm}`))}) Tj`, "ET",
          );

          dateGroup.forEach((d, i) => {
            const x = x0 + timeW + i * dayW;
            const key = isoDay(d);
            const items = rangeItems.filter(a => {
              const startMin = Number(a.start.slice(0, 2)) * 60 + Number(a.start.slice(3, 5));
              return a.date === key && startMin >= minute && startMin < minute + 30;
            });
            c.push(
              "1 1 1 rg", `${x} ${y} ${dayW} ${rowH} re f`,
              "0.90 0.87 0.84 RG", "0.3 w", `${x} ${y} ${dayW} ${rowH} re S`,
            );
            items.slice(0, 2).forEach((a, j) => {
              const [rr, gg, bb] = statusColor(a.status);
              const [br, bg, bb2] = statusBorder(a.status);
              const yy = y + 2 + j * 12;
              c.push(
                `${rr} ${gg} ${bb} rg`, `${x + 3} ${yy} ${dayW - 6} 11 re f`,
                `${br} ${bg} ${bb2} RG`, "1 w", `${x + 3} ${yy} m ${x + 3} ${yy + 11} l S`,
                "BT", "/F2 4.8 Tf", "0.12 0.24 0.30 rg", `${x + 6} ${yy + 6} Td`,
                `(${pdfEscape(truncate(`${shortTime(a.start)} ${a.client}`, Math.max(9, Math.floor(dayW / 5.4))))}) Tj`, "ET",
                "BT", "/F1 4.2 Tf", "0.31 0.40 0.44 rg", `${x + 6} ${yy + 1} Td`,
                `(${pdfEscape(truncate(`${a.appointmentType} | ${a.service} | ${a.status}`, Math.max(10, Math.floor(dayW / 5.1))))}) Tj`, "ET",
              );
            });
          });
        });
        pages.push(c);
      }
    }
  }

  if (!pages.length) pages.push(basePage(heading || view));
  pages.forEach((c,i)=>footer(c,i+1,pages.length));

  const objects:string[]=[]; const logoId=5; const firstPageId=logoHex?6:5; const pageIds=pages.map((_,i)=>firstPageId+i*2);
  objects[1]="<< /Type /Catalog /Pages 2 0 R >>"; objects[2]=`<< /Type /Pages /Kids [${pageIds.map(id=>`${id} 0 R`).join(" ")}] /Count ${pages.length} >>`; objects[3]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"; objects[4]="<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  if(logoHex)objects[logoId]=`<< /Type /XObject /Subtype /Image /Width 360 /Height 180 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${logoHex.length+1} >>\nstream\n${logoHex}>\nendstream`;
  pages.forEach((commands,i)=>{ const pageId=firstPageId+i*2,contentId=pageId+1,stream=commands.join("\n"),xObjects=logoHex?`/XObject << /Logo ${logoId} 0 R >>`:""; objects[pageId]=`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xObjects} >> /Contents ${contentId} 0 R >>`; objects[contentId]=`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`; });
  let out="%PDF-1.4\n"; const offsets:number[]=[0]; for(let id=1;id<objects.length;id++){offsets[id]=Buffer.byteLength(out);out+=`${id} 0 obj\n${objects[id]}\nendobj\n`;} const xref=Buffer.byteLength(out); out+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`; for(let id=1;id<objects.length;id++)out+=`${String(offsets[id]).padStart(10,"0")} 00000 n \n`; out+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(out);
}
