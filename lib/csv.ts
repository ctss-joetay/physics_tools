/** Build a CSV string from a header row and body rows. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (cell: string | number) => {
    const s = String(cell);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}

/**
 * Trigger a file download in the browser.
 *
 * iPad note: Safari honours the download attribute in a normal tab, but in a
 * home-screen (standalone) PWA it may open the file in a viewer instead. The
 * on-screen table is the fallback for that case.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give Safari a moment to start the download before revoking.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
