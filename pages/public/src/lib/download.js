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
  // Defer revocation off the click tick: a.click() only initiates the download;
  // the browser fetches the blob URL in a later task, and revoking it in the
  // same tick can abort that fetch in some browsers (the standard FileSaver idiom).
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
