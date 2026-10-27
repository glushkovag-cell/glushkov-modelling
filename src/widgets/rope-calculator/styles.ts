/**
 * Стили компонента внутри Shadow DOM.
 *
 * Используются только переменные дизайн-системы сайта: они наследуются в
 * shadow tree, поэтому светлая и тёмная темы работают без дублирования
 * палитры и без :host-context. Значения в fallback — на случай, если
 * компонент встроен вне сайта.
 */
export const styles = `
:host {
  display: block;
  color: var(--color-text, #28251d);
  font-family: inherit;
  font-size: 16px;
  line-height: 1.5;
}

*, *::before, *::after {
  box-sizing: border-box;
}

[hidden] {
  display: none !important;
}

.rc {
  padding: 20px;
  border: 1px solid var(--color-border, #ddd7ce);
  border-radius: var(--radius-lg, 12px);
  background: var(--color-surface, #ffffff);
}

.rc-field {
  margin-bottom: 16px;
}

.rc-label {
  display: block;
  margin-bottom: 6px;
  font-weight: 600;
  font-size: 0.95rem;
}

.rc-control {
  display: block;
  width: 100%;
  min-height: 44px;
  padding: 10px 12px;
  border: 1px solid var(--color-border, #ddd7ce);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-bg, #ffffff);
  color: inherit;
  font: inherit;
}

.rc-control:focus-visible,
button:focus-visible {
  outline: 2px solid var(--color-primary, #01696f);
  outline-offset: 2px;
}

.rc-control[aria-invalid="true"] {
  border-color: #b42318;
}

.rc-hint {
  margin: 6px 0 0;
  color: var(--color-text-muted, #7a7974);
  font-size: 0.82rem;
}

.rc-error {
  margin: 0 0 12px;
  color: #b42318;
  font-size: 0.9rem;
}

.rc-status {
  margin: 0 0 12px;
  color: var(--color-text-muted, #7a7974);
  font-size: 0.9rem;
}

.rc-result {
  padding: 16px;
  border-radius: var(--radius-md, 8px);
  background: var(--color-primary-highlight, #cedcd8);
}

.rc-result-label {
  display: block;
  font-size: 0.85rem;
  color: var(--color-text-muted, #7a7974);
}

.rc-result-value {
  display: block;
  font-size: 1.75rem;
  font-weight: 700;
}

.rc-fieldset {
  min-width: 0;
  margin: 0 0 16px;
  padding: 14px;
  border: 1px solid var(--color-border, #ddd7ce);
  border-radius: var(--radius-md, 8px);
}

.rc-legend {
  padding: 0 6px;
  font-weight: 600;
}

.rc-thread-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 16px;
  margin-top: 12px;
}

.rc-thread-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.9rem;
  cursor: pointer;
}

.rc-thread-option input {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  margin: 2px 0 0;
  accent-color: var(--color-primary, #01696f);
}

.rc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.rc-actions button {
  padding: 7px 12px;
  border: 1px solid var(--color-border, #ddd7ce);
  border-radius: var(--radius-sm, 6px);
  background: var(--color-surface-2, #fbfbf9);
  color: inherit;
  font: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

.rc-actions button:hover {
  background: var(--color-surface-offset, #f3f0ec);
}

.rc-table-wrap {
  overflow-x: auto;
}

.rc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}

.rc-table th,
.rc-table td {
  padding: 10px 8px;
  border-bottom: 1px solid var(--color-divider, #dcd9d5);
  text-align: left;
  white-space: nowrap;
}

.rc-table th {
  background: var(--color-surface-offset, #f3f0ec);
  font-weight: 600;
}

.rc-note {
  margin: 16px 0 0;
  color: var(--color-text-muted, #7a7974);
  font-size: 0.8rem;
}

@media (max-width: 480px) {
  .rc {
    padding: 14px;
  }

  .rc-thread-list {
    grid-template-columns: 1fr;
  }
}
`;
