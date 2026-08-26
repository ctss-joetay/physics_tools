/** Build a CSV string from a header row and body rows. */
export function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (cell: string | number) => {
    const s = String(cell);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
}

/**
 * Build a tab-separated block.
 *
 * Google Sheets, Excel and Numbers all split a pasted TSV block into individual
 * cells without showing an import dialog, which CSV does not reliably do.
 */
export function toTsv(headers: string[], rows: (string | number)[][]): string {
  const clean = (cell: string | number) =>
    String(cell).replace(/[\t\r\n]/g, " ");
  return [headers, ...rows].map((r) => r.map(clean).join("\t")).join("\n");
}

/**
 * Copy text to the clipboard, returning whether it worked.
 *
 * Must be called from inside a user gesture — Safari rejects clipboard writes
 * otherwise. The execCommand path is the fallback for insecure origins (plain
 * http://, e.g. a laptop dev server reached from an iPad) where
 * navigator.clipboard is undefined.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    // Keep it off-screen but still selectable; display:none would not be.
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Trigger a file download in the browser.
 *
 * iPad note: Safari honours the download attribute in a normal tab, but in a
 * home-screen (standalone) PWA it may open the file in a viewer instead. The
 * on-screen table and the copy button are the fallbacks for that case.
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
