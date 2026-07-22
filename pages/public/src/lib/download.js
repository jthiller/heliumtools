/**
 * Trigger a client-side download of an in-memory text file (object URL + a
 * transient anchor click). Used for token backups and certificate files.
 */
export function downloadTextFile(filename, text, mimeType = "text/plain") {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
