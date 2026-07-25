/**
 * Minimal DOM builders for core.
 *
 * Core is platform-agnostic, so it can't use Obsidian's `createEl`/`createDiv`
 * helpers. These exist so tooltip content — all of it vault- or agent-authored
 * text — is set via `textContent` instead of being interpolated into innerHTML.
 * The building tooltip previously interpolated `project.status`, `.priority` and
 * `.category` unescaped, which made crafted frontmatter executable.
 */

/** Append a `<div>` with an optional class and text. */
export function appendDiv(parent: HTMLElement, className?: string, text?: string): HTMLDivElement {
  const el = document.createElement('div');
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  parent.appendChild(el);
  return el;
}

/** Append a `<span>` with an optional class and text. */
export function appendSpan(parent: HTMLElement, className?: string, text?: string): HTMLSpanElement {
  const el = document.createElement('span');
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  parent.appendChild(el);
  return el;
}

/**
 * `<div class="tooltip-row"><span>Label:</span> value</div>` — the shape every
 * tooltip line uses. The value lands as a text node, never as markup.
 */
export function appendTooltipRow(
  parent: HTMLElement,
  label: string,
  value: string,
  className = 'tooltip-row',
): HTMLDivElement {
  const row = appendDiv(parent, className);
  appendSpan(row, undefined, label);
  row.appendChild(document.createTextNode(` ${value}`));
  return row;
}
