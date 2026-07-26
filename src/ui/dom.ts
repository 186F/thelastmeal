/** Tiny DOM helpers for the plain HTML/CSS operator UI. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (HTMLElement | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child);
  }
  return node;
}

export function button(id: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', { id, type: 'button', text: label });
  b.addEventListener('click', onClick);
  return b;
}

export function kvRow(dl: HTMLDListElement, label: string, field: string): HTMLElement {
  dl.append(el('dt', { text: label }));
  const dd = el('dd', { 'data-field': field, text: '—' });
  dl.append(dd);
  return dd;
}
