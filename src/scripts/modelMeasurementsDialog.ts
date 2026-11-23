/**
 * Открытие/закрытие нативных <dialog> с размерами модели.
 *
 * showModal() даёт удержание фокуса внутри диалога, закрытие по Escape и
 * инертность остальной страницы. Возврат фокуса на кнопку и блокировку
 * прокрутки фона делаем явно, чтобы поведение не зависело от браузера.
 */

const OPEN_SELECTOR = '[data-model-measurements-open]';
const CLOSE_SELECTOR = '[data-model-measurements-close]';

const triggers = new WeakMap<HTMLDialogElement, HTMLElement>();

let scrollLocked = false;
let previousBodyOverflow = '';

function lockScroll(): void {
  if (scrollLocked) return;
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  scrollLocked = true;
}

function unlockScroll(): void {
  if (!scrollLocked) return;
  document.body.style.overflow = previousBodyOverflow;
  scrollLocked = false;
}

function dialogFor(trigger: HTMLElement): HTMLDialogElement | null {
  const id = trigger.getAttribute('aria-controls');
  if (!id) return null;
  const element = document.getElementById(id);
  return element instanceof HTMLDialogElement ? element : null;
}

function openDialog(trigger: HTMLElement): void {
  const dialog = dialogFor(trigger);
  if (!dialog || dialog.open) return;

  // Карточки имеют overflow:hidden и transform при наведении. Перенос диалога
  // в body исключает зависимость модального окна от containing block карточки.
  if (dialog.parentElement !== document.body) {
    document.body.appendChild(dialog);
  }

  triggers.set(dialog, trigger);
  dialog.showModal();
  lockScroll();

  const closeButton = dialog.querySelector<HTMLElement>(CLOSE_SELECTOR);
  closeButton?.focus();
}

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const trigger = target.closest<HTMLElement>(OPEN_SELECTOR);
  if (trigger) {
    event.preventDefault();
    openDialog(trigger);
    return;
  }

  const closeButton = target.closest<HTMLElement>(CLOSE_SELECTOR);
  if (closeButton) {
    const dialog = closeButton.closest('dialog');
    if (dialog instanceof HTMLDialogElement) {
      event.preventDefault();
      dialog.close();
    }
    return;
  }

  // Клик по подложке приходит на сам <dialog>, а не на панель внутри.
  if (target instanceof HTMLDialogElement && target.hasAttribute('open')) {
    target.close();
  }
});

document.addEventListener(
  'close',
  (event) => {
    const dialog = event.target;
    if (!(dialog instanceof HTMLDialogElement)) return;

    unlockScroll();

    const trigger = triggers.get(dialog);
    if (trigger && trigger.isConnected) {
      trigger.focus();
    }
  },
  true,
);
