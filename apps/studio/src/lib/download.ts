/** Save text as a file through a temporary object URL (revoked after the click). */
export function downloadText(fileName: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Read a user-picked file as text with a byte cap; resolves to text or an error message. */
export async function readFileText(file: File, maxBytes: number): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (file.size > maxBytes) return { ok: false, error: `That file is too large (limit ${Math.round(maxBytes / 1024 / 1024)} MB).` };
  try {
    return { ok: true, text: await file.text() };
  } catch {
    return { ok: false, error: 'Could not read the file.' };
  }
}
