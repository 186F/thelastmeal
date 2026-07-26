/**
 * Browser-native file flows: downloads via object URLs, imports via an
 * explicit user-selected file input. No filesystem permissions, storage, or
 * backend involved.
 */

export function downloadTextFile(fileName: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function createImportInput(onFileText: (text: string) => void): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.id = 'import-file';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      onFileText(text);
      input.value = '';
    });
  });
  return input;
}
