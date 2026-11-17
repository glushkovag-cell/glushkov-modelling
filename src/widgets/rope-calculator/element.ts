import type {
  ApiWarning,
  CatalogResponse,
  ForwardBody,
  ForwardResponse,
  ReverseMatch,
  ReverseResponse,
} from './api';
import { ApiError, fetchCatalog, isAbortError, postForward, postReverse } from './api';
import {
  MAX_CUSTOM_DTEX,
  MEASURED_DTEX_MAX,
  MIN_CUSTOM_DTEX,
  TOLERANCE_PERCENT,
  formatConstruction,
  formatDeviation,
  formatDiameter,
  formatSelectionSummary,
  formatThreadLabel,
  parseCustomDtex,
  parseTargetDiameter,
} from './format';
import { styles } from './styles';

const DEFAULT_API_BASE = 'https://api.glushkov-modelling.com';
const DEBOUNCE_MS = 250;

/**
 * Каталог общий для всех экземпляров на странице: два калькулятора не должны
 * тянуть его дважды.
 */
const catalogPool = new Map<string, Promise<CatalogResponse>>();

function loadCatalog(apiBase: string): Promise<CatalogResponse> {
  const existing = catalogPool.get(apiBase);
  if (existing) return existing;

  const pending = fetchCatalog(apiBase).catch((error: unknown) => {
    catalogPool.delete(apiBase);
    throw error;
  });

  catalogPool.set(apiBase, pending);
  return pending;
}

function must<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Rope calculator: missing element ${selector}`);
  }
  return element;
}

const template = `
<section class="rc" aria-label="Rope diameter calculator">
  <div class="rc-field">
    <label class="rc-label" for="mode">Calculator mode</label>
    <select id="mode" class="rc-control">
      <option value="forward">Calculate rope diameter</option>
      <option value="reverse">Find threads for a target diameter</option>
    </select>
    <p class="rc-status" data-catalog-status role="status" aria-live="polite"></p>
  </div>

  <div data-panel="forward">
    <div class="rc-field">
      <label class="rc-label" for="basis">Calculation basis</label>
      <select id="basis" class="rc-control">
        <option value="catalog">Catalog thread</option>
        <option value="dtex">Custom dTex</option>
      </select>
    </div>

    <div class="rc-field" data-field="catalog">
      <label class="rc-label" for="thread">Thread</label>
      <select id="thread" class="rc-control"></select>
    </div>

    <div class="rc-field" data-field="dtex" hidden>
      <label class="rc-label" for="dtex">Linear density (dTex)</label>
      <input
        id="dtex"
        class="rc-control"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        spellcheck="false"
        value="750"
        aria-invalid="false"
      >
      <p class="rc-hint">
        Enter a value from ${MIN_CUSTOM_DTEX} to ${MAX_CUSTOM_DTEX} dTex. A decimal comma is accepted.
      </p>
    </div>

    <div class="rc-field">
      <label class="rc-label" for="count">Threads per strand</label>
      <select id="count" class="rc-control">
        <option value="1">1</option>
        <option value="2" selected>2</option>
        <option value="3">3</option>
        <option value="4">4</option>
        <option value="5">5</option>
      </select>
      <p class="rc-hint">
        All ropes have three strands. A 2 × 3 construction uses two threads per
        strand, six threads in total.
      </p>
    </div>

    <p class="rc-error" data-error="forward" role="alert" hidden></p>

    <div class="rc-result" role="status" aria-live="polite" aria-atomic="true">
      <span class="rc-result-label">Estimated rope diameter</span>
      <output class="rc-result-value" data-result>—</output>
      <dl class="rc-details">
        <div><dt>Construction</dt><dd data-detail="construction">—</dd></div>
      </dl>
    </div>
    <ul class="rc-warnings" data-warnings="forward" hidden></ul>
  </div>

  <div data-panel="reverse" hidden>
    <div class="rc-field">
      <label class="rc-label" for="target">Target rope diameter (mm)</label>
      <input
        id="target"
        class="rc-control"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        spellcheck="false"
        value="1.00"
        aria-invalid="false"
      >
      <p class="rc-hint">
        Enter a diameter greater than zero. Only matches within ±${TOLERANCE_PERCENT}% of the
        target are shown. A decimal comma is accepted.
      </p>
    </div>

    <div class="rc-catalog-summary">
      <span data-selection-summary aria-live="polite" aria-atomic="true">Loading thread catalog…</span>
      <button
        type="button"
        class="rc-link-button"
        data-action="toggle-catalog"
        aria-expanded="false"
        aria-controls="thread-panel"
      >Show catalog</button>
    </div>

    <fieldset class="rc-fieldset" id="thread-panel" data-thread-panel hidden>
      <legend class="rc-legend">Available threads</legend>
      <div class="rc-actions">
        <button type="button" data-action="select-all">Select all</button>
        <button type="button" data-action="clear-all">Clear all</button>
      </div>
      <div class="rc-thread-list" data-thread-list></div>
    </fieldset>

    <p class="rc-hint">
      The calculator checks 1-5 threads per strand for each selected
      thread. Results are sorted by absolute percentage deviation from the target.
    </p>

    <p class="rc-error" data-error="reverse" role="alert" hidden></p>
    <p class="rc-status" data-status aria-live="polite" aria-atomic="true"></p>
    <ul class="rc-warnings" data-warnings="reverse" hidden></ul>

    <div class="rc-table-wrap" data-table-wrap hidden>
      <table class="rc-table">
        <caption class="rc-hint">Threads matching the target diameter</caption>
        <thead>
          <tr>
            <th scope="col">Brand</th>
            <th scope="col">Number</th>
            <th scope="col">dTex</th>
            <th scope="col">Construction</th>
            <th scope="col">Diameter (mm)</th>
            <th scope="col">Deviation</th>
            <th scope="col" data-select-column hidden>Use</th>
          </tr>
        </thead>
        <tbody data-results></tbody>
      </table>
    </div>
  </div>

  <p class="rc-note">
    Diameters are calculated estimates, not measured values. The model is
    empirical: it was fitted on measurements from ${MIN_CUSTOM_DTEX} to ${MEASURED_DTEX_MAX} dTex,
    so very thin and very thick threads carry the largest uncertainty.
  </p>
</section>
`;

/**
 * Калькулятор канатов как Web Component.
 *
 * Формулы и каталога внутри нет: только запросы к JSON API Worker. Тема
 * наследуется через CSS-переменные сайта, поэтому компонент одинаково
 * работает в светлой и тёмной теме и вне сайта (за счёт fallback-значений).
 *
 * Груза в интерфейсе нет: модель без нагрузки, состояния loadMode/loadGrams
 * не существует, в запросы и localStorage они не попадают.
 */
export class RopeCalculatorElement extends HTMLElement {
  static observedAttributes = ['api-base', 'selectable'];

  #root: ShadowRoot;
  #apiBase = DEFAULT_API_BASE;

  #mode: HTMLSelectElement;
  #basis: HTMLSelectElement;
  #catalogOption: HTMLOptionElement;
  #reverseOption: HTMLOptionElement;
  #catalogField: HTMLElement;
  #dtexField: HTMLElement;
  #thread: HTMLSelectElement;
  #dtex: HTMLInputElement;
  #count: HTMLSelectElement;
  #forwardPanel: HTMLElement;
  #reversePanel: HTMLElement;
  #target: HTMLInputElement;
  #threadList: HTMLElement;
  #forwardError: HTMLElement;
  #reverseError: HTMLElement;
  #catalogStatus: HTMLElement;
  #reverseStatus: HTMLElement;
  #result: HTMLOutputElement;
  #tableWrap: HTMLElement;
  #results: HTMLElement;
  #detailConstruction: HTMLElement;
  #forwardWarnings: HTMLElement;
  #reverseWarnings: HTMLElement;
  #selectionSummary: HTMLElement;
  #catalogToggle: HTMLButtonElement;
  #threadPanel: HTMLElement;

  #catalog: CatalogResponse['threads'] | null = null;
  #lastReverse: ReverseResponse | null = null;
  #catalogLoading = false;
  #initialRunDone = false;
  #listenersBound = false;
  #themeObserver: MutationObserver | undefined;

  #forwardAbort: AbortController | undefined;
  #reverseAbort: AbortController | undefined;
  #forwardTimer = 0;
  #reverseTimer = 0;
  #forwardSeq = 0;
  #reverseSeq = 0;

  constructor() {
    super();

    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = `<style>${styles}</style>${template}`;

    this.#mode = must(this.#root, '#mode');
    this.#basis = must(this.#root, '#basis');
    this.#catalogOption = must(this.#root, '#basis option[value="catalog"]');
    this.#reverseOption = must(this.#root, '#mode option[value="reverse"]');
    this.#catalogField = must(this.#root, '[data-field="catalog"]');
    this.#dtexField = must(this.#root, '[data-field="dtex"]');
    this.#thread = must(this.#root, '#thread');
    this.#dtex = must(this.#root, '#dtex');
    this.#count = must(this.#root, '#count');
    this.#forwardPanel = must(this.#root, '[data-panel="forward"]');
    this.#reversePanel = must(this.#root, '[data-panel="reverse"]');
    this.#target = must(this.#root, '#target');
    this.#threadList = must(this.#root, '[data-thread-list]');
    this.#forwardError = must(this.#root, '[data-error="forward"]');
    this.#reverseError = must(this.#root, '[data-error="reverse"]');
    this.#catalogStatus = must(this.#root, '[data-catalog-status]');
    this.#reverseStatus = must(this.#root, '[data-status]');
    this.#result = must(this.#root, '[data-result]');
    this.#tableWrap = must(this.#root, '[data-table-wrap]');
    this.#results = must(this.#root, '[data-results]');
    this.#detailConstruction = must(this.#root, '[data-detail="construction"]');
    this.#forwardWarnings = must(this.#root, '[data-warnings="forward"]');
    this.#reverseWarnings = must(this.#root, '[data-warnings="reverse"]');
    this.#selectionSummary = must(this.#root, '[data-selection-summary]');
    this.#catalogToggle = must(this.#root, '[data-action="toggle-catalog"]');
    this.#threadPanel = must(this.#root, '[data-thread-panel]');

    this.#bindListeners();
    this.#syncPanels();
    this.#syncBasisFields();
  }

  connectedCallback(): void {
    this.#apiBase = (this.getAttribute('api-base') ?? '').trim() || DEFAULT_API_BASE;

    this.#applyColorScheme();
    if (!this.#themeObserver) {
      this.#themeObserver = new MutationObserver(() => this.#applyColorScheme());
      this.#themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }

    if (!this.#catalog && !this.#catalogLoading) {
      void this.#startCatalog();
    }
  }

  disconnectedCallback(): void {
    this.#themeObserver?.disconnect();
    this.#themeObserver = undefined;

    this.#forwardAbort?.abort();
    this.#reverseAbort?.abort();
    window.clearTimeout(this.#forwardTimer);
    window.clearTimeout(this.#reverseTimer);
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;

    if (name === 'selectable') {
      if (this.#lastReverse) this.#renderReverse(this.#lastReverse);
      return;
    }

    if (name !== 'api-base') return;

    this.#apiBase = (newValue ?? '').trim() || DEFAULT_API_BASE;
    if (!this.isConnected) return;

    this.#catalog = null;
    this.#lastReverse = null;
    this.#initialRunDone = false;
    this.#catalogOption.disabled = false;
    this.#reverseOption.disabled = false;
    this.#thread.replaceChildren();
    this.#threadList.replaceChildren();
    this.#catalogStatus.textContent = '';
    this.#selectionSummary.textContent = 'Loading thread catalog…';

    void this.#startCatalog();
  }

  #bindListeners(): void {
    if (this.#listenersBound) return;
    this.#listenersBound = true;

    this.#mode.addEventListener('change', () => {
      this.#syncPanels();
      this.#runCurrent();
    });

    this.#catalogToggle.addEventListener('click', () => {
      this.#setCatalogOpen(this.#threadPanel.hidden === true);
    });

    this.#basis.addEventListener('change', () => {
      this.#syncBasisFields();
      void this.#runForward();
    });

    this.#thread.addEventListener('change', () => {
      void this.#runForward();
    });

    this.#count.addEventListener('change', () => {
      void this.#runForward();
    });

    this.#dtex.addEventListener('input', () => {
      this.#scheduleForward();
    });

    this.#target.addEventListener('input', () => {
      this.#scheduleReverse();
    });

    this.#threadList.addEventListener('change', () => {
      this.#updateSelectionSummary();
      void this.#runReverse();
    });

    must<HTMLButtonElement>(this.#root, '[data-action="select-all"]').addEventListener('click', () => {
      this.#setAllThreads(true);
    });

    must<HTMLButtonElement>(this.#root, '[data-action="clear-all"]').addEventListener('click', () => {
      this.#setAllThreads(false);
    });
  }

  #applyColorScheme(): void {
    const theme = document.documentElement.dataset.theme;
    this.style.colorScheme = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : 'light dark';
  }

  #syncPanels(): void {
    const reverse = this.#mode.value === 'reverse';
    this.#forwardPanel.hidden = reverse;
    this.#reversePanel.hidden = !reverse;
  }

  #runCurrent(): void {
    if (this.#mode.value === 'reverse') {
      void this.#runReverse();
    } else {
      void this.#runForward();
    }
  }

  #setCatalogOpen(open: boolean): void {
    // Свёрнутость — только отображение: выбор нитей живёт в DOM и не
    // сбрасывается при открытии и закрытии панели.
    this.#threadPanel.hidden = !open;
    this.#catalogToggle.setAttribute('aria-expanded', String(open));
    this.#catalogToggle.textContent = open ? 'Hide catalog' : 'Show catalog';
  }

  /** Сводка выбора по фактически отмеченным нитям. */
  #updateSelectionSummary(): void {
    if (!this.#catalog) return;
    const selected = new Set(this.#selectedThreadIds());
    const brands = new Set(
      this.#catalog.filter((thread) => selected.has(thread.threadId)).map((thread) => thread.brand),
    );
    this.#selectionSummary.textContent = formatSelectionSummary(selected.size, brands.size);
  }

  /** Предупреждения Worker'а выводятся у результата и не блокируют расчёт. */
  #renderWarnings(list: HTMLElement, warnings: readonly ApiWarning[] | undefined): void {
    const items = (warnings ?? [])
      .map((warning) => warning.message.trim())
      .filter((message) => message !== '');

    list.replaceChildren(
      ...items.map((message) => {
        const item = document.createElement('li');
        item.textContent = message;
        return item;
      }),
    );
    list.hidden = items.length === 0;
  }

  #renderForward(response: ForwardResponse): void {
    const { result } = response;
    this.#result.textContent = formatDiameter(result.diameterMm);
    this.#detailConstruction.textContent = formatConstruction(result.threadsPerStrand);
    this.#renderWarnings(this.#forwardWarnings, response.warnings);
  }

  #clearForward(placeholder: string): void {
    this.#result.textContent = placeholder;
    this.#detailConstruction.textContent = '—';
    this.#renderWarnings(this.#forwardWarnings, []);
  }

  #syncBasisFields(): void {
    const custom = this.#basis.value === 'dtex';
    this.#catalogField.hidden = custom;
    this.#dtexField.hidden = !custom;
  }

  async #startCatalog(): Promise<void> {
    if (this.#catalogLoading) return;
    this.#catalogLoading = true;
    this.#catalogStatus.textContent = 'Loading thread catalog…';

    try {
      const response = await loadCatalog(this.#apiBase);
      if (!this.isConnected) return;

      this.#catalog = response.threads;
      this.#catalogStatus.textContent = '';
      this.#populateThreads(response.threads);
    } catch {
      if (!this.isConnected) return;

      this.#catalogStatus.textContent =
        'Thread catalog is unavailable. Check your connection, or use a custom dTex.';
      this.#selectionSummary.textContent = 'Thread catalog is unavailable.';
      this.#catalogOption.disabled = true;
      this.#reverseOption.disabled = true;

      if (this.#basis.value === 'catalog') {
        this.#basis.value = 'dtex';
      }
      if (this.#mode.value === 'reverse') {
        this.#mode.value = 'forward';
      }
    } finally {
      this.#catalogLoading = false;
    }

    if (!this.isConnected) return;

    this.#syncPanels();
    this.#syncBasisFields();

    if (this.#mode.value === 'reverse') {
      void this.#runReverse();
      return;
    }

    if (!this.#initialRunDone) {
      this.#initialRunDone = true;
      void this.#runForward();
    }
  }

  #populateThreads(threads: CatalogResponse['threads']): void {
    const options = threads.map((thread) => {
      const option = document.createElement('option');
      option.value = thread.threadId;
      option.textContent = formatThreadLabel(thread);
      return option;
    });
    this.#thread.replaceChildren(...options);

    const preferred = threads.find((thread) => thread.threadId === 'tera-40') ?? threads[0];
    if (preferred) {
      this.#thread.value = preferred.threadId;
    }

    const items = threads.map((thread) => {
      const label = document.createElement('label');
      label.className = 'rc-thread-option';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = thread.threadId;
      checkbox.checked = true;

      const text = document.createElement('span');
      text.textContent = formatThreadLabel(thread);

      label.append(checkbox, text);
      return label;
    });
    this.#threadList.replaceChildren(...items);
    this.#updateSelectionSummary();
  }

  #selectedThreadIds(): string[] {
    return Array.from(
      this.#threadList.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked'),
    ).map((checkbox) => checkbox.value);
  }

  #setAllThreads(checked: boolean): void {
    this.#threadList
      .querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      .forEach((checkbox) => {
        checkbox.checked = checked;
      });
    this.#updateSelectionSummary();
    void this.#runReverse();
  }

  #scheduleForward(): void {
    window.clearTimeout(this.#forwardTimer);
    this.#forwardTimer = window.setTimeout(() => {
      void this.#runForward();
    }, DEBOUNCE_MS);
  }

  #scheduleReverse(): void {
    window.clearTimeout(this.#reverseTimer);
    this.#reverseTimer = window.setTimeout(() => {
      void this.#runReverse();
    }, DEBOUNCE_MS);
  }

  #showForwardError(message: string, markDtex: boolean): void {
    this.#forwardError.textContent = message;
    this.#forwardError.hidden = false;
    this.#dtex.setAttribute('aria-invalid', markDtex ? 'true' : 'false');
  }

  #clearForwardError(): void {
    this.#forwardError.textContent = '';
    this.#forwardError.hidden = true;
    this.#dtex.setAttribute('aria-invalid', 'false');
  }

  #showReverseError(message: string, markTarget: boolean): void {
    this.#reverseError.textContent = message;
    this.#reverseError.hidden = false;
    this.#target.setAttribute('aria-invalid', markTarget ? 'true' : 'false');
  }

  #clearReverseError(): void {
    this.#reverseError.textContent = '';
    this.#reverseError.hidden = true;
    this.#target.setAttribute('aria-invalid', 'false');
  }

  #messageFor(error: unknown): string {
    if (error instanceof ApiError) {
      if (error.code === 'CATALOG_UNAVAILABLE') {
        return 'The thread catalog is temporarily unavailable. Please try again later.';
      }
      if (error.code === 'THREAD_NOT_FOUND') {
        return 'This thread is no longer available in the catalog. Choose another one.';
      }
      return error.message;
    }
    return 'The calculator service is temporarily unavailable. Please try again.';
  }

  async #runForward(): Promise<void> {
    const custom = this.#basis.value === 'dtex';
    const threadsPerStrand = Number(this.#count.value);

    this.#forwardAbort?.abort();
    const controller = new AbortController();
    this.#forwardAbort = controller;
    const sequence = ++this.#forwardSeq;

    this.#clearForwardError();

    let body: ForwardBody;

    if (custom) {
      const dtex = parseCustomDtex(this.#dtex.value);
      if (dtex === null) {
        this.#showForwardError(
          `Enter a dTex value from ${MIN_CUSTOM_DTEX} to ${MAX_CUSTOM_DTEX}.`,
          true,
        );
        this.#clearForward('—');
        return;
      }
      body = { basis: 'dtex', dtex, threadsPerStrand };
    } else {
      if (!this.#catalog) {
        this.#clearForward('—');
        return;
      }
      const threadId = this.#thread.value;
      if (!threadId) {
        this.#showForwardError('Choose a catalog thread.', false);
        this.#clearForward('—');
        return;
      }
      body = { basis: 'catalog', threadId, threadsPerStrand };
    }

    this.#clearForward('…');

    try {
      const response = await postForward(this.#apiBase, body, controller.signal);
      if (sequence !== this.#forwardSeq || controller.signal.aborted) return;
      this.#renderForward(response);
    } catch (error) {
      if (isAbortError(error) || sequence !== this.#forwardSeq) return;
      this.#clearForward('—');
      this.#showForwardError(this.#messageFor(error), custom);
    }
  }

  async #runReverse(): Promise<void> {
    if (this.#mode.value !== 'reverse') return;

    const target = parseTargetDiameter(this.#target.value);

    this.#clearReverseError();

    if (target === null) {
      this.#showReverseError('Enter a target diameter greater than zero.', true);
      this.#resetReverseOutput();
      return;
    }

    if (!this.#catalog) {
      this.#showReverseError(
        this.#catalogLoading
          ? 'Thread catalog is still loading. Try again in a moment.'
          : 'Thread catalog is unavailable. Check your connection and try again.',
        false,
      );
      this.#resetReverseOutput();
      return;
    }

    const threadIds = this.#selectedThreadIds();
    if (threadIds.length === 0) {
      this.#showReverseError('Select at least one available thread.', false);
      this.#resetReverseOutput();
      return;
    }

    this.#reverseAbort?.abort();
    const controller = new AbortController();
    this.#reverseAbort = controller;
    const sequence = ++this.#reverseSeq;

    this.#reverseStatus.textContent = 'Searching…';
    this.#tableWrap.hidden = true;
    // Предупреждение относится к прежнему набору совпадений и не должно
    // висеть, пока считается новый.
    this.#renderWarnings(this.#reverseWarnings, []);

    try {
      const response = await postReverse(
        this.#apiBase,
        { targetDiameterMm: target, threadIds },
        controller.signal,
      );
      if (sequence !== this.#reverseSeq || controller.signal.aborted) return;
      this.#renderReverse(response);
    } catch (error) {
      if (isAbortError(error) || sequence !== this.#reverseSeq) return;
      this.#showReverseError(this.#messageFor(error), false);
      this.#resetReverseOutput(false);
    }
  }

  #resetReverseOutput(clearStatus = true): void {
    this.#results.replaceChildren();
    this.#tableWrap.hidden = true;
    this.#renderWarnings(this.#reverseWarnings, []);
    if (clearStatus) {
      this.#reverseStatus.textContent = '';
    }
  }

  #isSelectable(): boolean {
    return this.hasAttribute('selectable');
  }

  #selectThread(match: ReverseMatch): void {
    const targetMm = parseTargetDiameter(this.#target.value);
    if (targetMm === null) return;

    this.dispatchEvent(
      new CustomEvent('thread-select', {
        bubbles: true,
        composed: true,
        detail: { thread: { ...match }, targetMm },
      }),
    );
  }

  #renderReverse(response: ReverseResponse): void {
    this.#lastReverse = response;

    const selectable = this.#isSelectable();
    const selectHeader = this.#root.querySelector<HTMLElement>('[data-select-column]');
    if (selectHeader) selectHeader.hidden = !selectable;

    const rows = response.results.map((match) => {
      const row = document.createElement('tr');
      const cells = [
        match.brand,
        match.number,
        String(match.dtex),
        formatConstruction(match.threadsPerStrand),
        match.diameterMm.toFixed(3),
        formatDeviation(match.deviationPercent),
      ];

      for (const value of cells) {
        const cell = document.createElement('td');
        cell.textContent = value;
        row.appendChild(cell);
      }

      if (selectable) {
        const cell = document.createElement('td');
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'rc-use';
        button.textContent = 'Use';
        button.setAttribute(
          'aria-label',
          `Use ${match.brand} ${match.number} for this rope`,
        );
        button.addEventListener('click', () => this.#selectThread(match));
        cell.appendChild(button);
        row.appendChild(cell);
      }

      return row;
    });

    this.#results.replaceChildren(...rows);
    this.#tableWrap.hidden = response.results.length === 0;
    this.#renderWarnings(this.#reverseWarnings, response.warnings);

    if (response.results.length === 0) {
      this.#reverseStatus.textContent =
        `No matching combinations found within ±${TOLERANCE_PERCENT}% of the target. ` +
        'Select additional threads or change the target diameter.';
      return;
    }

    const suffix = response.results.length === 1 ? '' : 's';
    this.#reverseStatus.textContent =
      `${response.results.length} matching combination${suffix} within ±${TOLERANCE_PERCENT}% of the target. ` +
      'Negative deviation means thinner; positive means thicker.';
  }
}

if (!customElements.get('gm-rope-calculator')) {
  customElements.define('gm-rope-calculator', RopeCalculatorElement);
}
