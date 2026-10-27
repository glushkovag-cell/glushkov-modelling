/**
 * Загрузчик калькулятора канатов.
 *
 * Подключается глобально через BaseLayout, но сам компонент импортируется
 * динамически и только если на странице есть <gm-rope-calculator>. Так
 * остальные страницы не платят за калькулятор ни байтом его кода.
 */
const ELEMENT_TAG = 'gm-rope-calculator';

function loadCalculator(): void {
  if (!document.querySelector(ELEMENT_TAG)) return;
  if (customElements.get(ELEMENT_TAG)) return;

  void import('../widgets/rope-calculator/element');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadCalculator, { once: true });
} else {
  loadCalculator();
}
