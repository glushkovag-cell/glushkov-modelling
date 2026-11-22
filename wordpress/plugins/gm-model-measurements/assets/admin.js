/**
 * Model measurements metabox.
 *
 * Matches the markup rendered by includes/admin.php.
 *
 * Responsibilities:
 * - add and remove additional measurement rows;
 * - synchronize element choices with measurement definitions;
 * - preserve incompatible selections visibly instead of replacing them;
 * - prevent reselecting released inactive options in the same row;
 * - maintain expected_rows and the final completion marker;
 * - maintain unique DOM IDs and accessible descriptions.
 *
 * No AJAX, metadata writes or publication enforcement are implemented.
 * Server-side validation remains authoritative.
 */
(function () {
    'use strict';

    const ROOT_SELECTOR = '[data-gm-measurements]';
    const ROW_SELECTOR = '[data-gm-measurement-row]';

    /**
     * Read the selected definition's target kind.
     *
     * null means that no usable definition is selected.
     *
     * @param {HTMLSelectElement} definitionSelect
     * @returns {string|null}
     */
    function getTargetKind(definitionSelect) {
        const option = definitionSelect.selectedOptions[0];

        if (!option || option.value === '') {
            return null;
        }

        const kind = option.dataset.targetKind;

        return ['none', 'mast', 'yard'].includes(kind)
            ? kind
            : null;
    }

    /**
     * Synchronize the target controls with the selected definition.
     *
     * An incompatible selected element is kept visible with an error.
     * It is never silently replaced with another element.
     *
     * @param {HTMLElement} row
     * @returns {void}
     */
    function synchronizeTarget(row) {
        const definitionSelect = row.querySelector(
            '[data-gm-definition]'
        );
        const targetSelect = row.querySelector(
            '[data-gm-target]'
        );
        const targetKindInput = row.querySelector(
            '[data-gm-target-kind]'
        );
        const targetContainer = row.querySelector(
            '[data-gm-target-container]'
        );
        const targetStatus = row.querySelector(
            '[data-gm-target-status]'
        );

        if (
            !(definitionSelect instanceof HTMLSelectElement) ||
            !(targetSelect instanceof HTMLSelectElement) ||
            !(targetKindInput instanceof HTMLInputElement) ||
            !targetContainer ||
            !targetStatus
        ) {
            return;
        }

        const kind = getTargetKind(definitionSelect);
        const needsTarget = kind === 'mast' || kind === 'yard';

        targetContainer.hidden = !needsTarget;
        targetSelect.disabled = !needsTarget;
        targetSelect.required = needsTarget;

        targetKindInput.disabled = !needsTarget;
        targetKindInput.value = needsTarget ? kind : '';

        targetSelect.setCustomValidity('');
        targetStatus.textContent = '';

        if (!needsTarget) {
            return;
        }

        let incompatibleSelection = false;

        Array.from(targetSelect.options).forEach(function (option) {
            if (option.value === '') {
                option.hidden = false;
                option.disabled = false;
                return;
            }

            const compatible = option.dataset.elementKind === kind;
            const unavailable = option.dataset.unavailable === '1';
            const retained = option.dataset.retained === '1';

            if (option.selected) {
                option.hidden = false;
                option.disabled = false;

                if (!compatible || (unavailable && !retained)) {
                    incompatibleSelection = true;
                }

                return;
            }

            const selectable = compatible &&
                (!unavailable || retained);

            option.hidden = !selectable;
            option.disabled = !selectable;
        });

        if (incompatibleSelection) {
            const message =
                'Выбранный элемент не соответствует виду измерения ' +
                'или больше недоступен. Выберите другой элемент.';

            targetSelect.setCustomValidity(message);
            targetStatus.textContent = message;
        }
    }

    /**
     * Release inactive options after the user selects another option.
     *
     * An inactive stored option may remain while selected. Once it is
     * released, the user cannot select it again in this row without
     * reloading the editor.
     *
     * The server independently checks the stored collection.
     *
     * @param {HTMLSelectElement} select
     * @returns {void}
     */
    function releaseUnselectedArchivedOptions(select) {
        Array.from(select.options).forEach(function (option) {
            if (
                option.dataset.unavailable === '1' &&
                !option.selected
            ) {
                option.dataset.retained = '0';
                option.disabled = true;
                option.hidden = true;
            }
        });
    }

    /**
     * Return actual additional rows, excluding template contents.
     *
     * @param {HTMLElement} rowsContainer
     * @returns {Element[]}
     */
    function getRows(rowsContainer) {
        return Array.from(rowsContainer.children).filter(
            function (element) {
                return element.matches(ROW_SELECTOR);
            }
        );
    }

    /**
     * Initialize one metabox.
     *
     * @param {HTMLElement} root
     * @returns {void}
     */
    function initializeMetabox(root) {
        if (root.dataset.gmInitialized === '1') {
            return;
        }

        const rowsContainer = root.querySelector(
            '[data-gm-rows]'
        );
        const template = root.querySelector(
            '[data-gm-row-template]'
        );
        const addButton = root.querySelector(
            '[data-gm-add-row]'
        );
        const announcement = root.querySelector(
            '[data-gm-announcement]'
        );
        const integrityContainer = root.querySelector(
            '[data-gm-form-integrity]'
        );
        const expectedRowsInput = root.querySelector(
            '[data-gm-expected-rows]'
        );
        const completeInput = root.querySelector(
            '[data-gm-form-complete]'
        );
        const form = root.closest('form');

        if (
            !rowsContainer ||
            !(template instanceof HTMLTemplateElement) ||
            !(addButton instanceof HTMLButtonElement) ||
            !announcement ||
            !integrityContainer ||
            !(expectedRowsInput instanceof HTMLInputElement) ||
            !(completeInput instanceof HTMLInputElement) ||
            !(form instanceof HTMLFormElement)
        ) {
            return;
        }

        /*
         * Missing or mismatched server-rendered controls must not
         * be repaired by creating replacement markers in JavaScript.
         */
        if (
            expectedRowsInput.type !== 'hidden' ||
            expectedRowsInput.name !==
            'gm_measurements[expected_rows]' ||
            completeInput.type !== 'hidden' ||
            completeInput.name !==
            'gm_measurements[complete]' ||
            !integrityContainer.contains(expectedRowsInput) ||
            !integrityContainer.contains(completeInput)
        ) {
            return;
        }

        root.dataset.gmInitialized = '1';

        let nextIndex = 0;

        /**
         * Update the row count and keep the completion marker last.
         *
         * These controls detect incomplete submissions. They do not
         * authenticate the request or replace server-side validation.
         *
         * @returns {void}
         */
        function synchronizeFormIntegrity() {
            expectedRowsInput.disabled = false;
            expectedRowsInput.value = String(
                getRows(rowsContainer).length
            );

            completeInput.disabled = false;
            completeInput.value = '1';

            integrityContainer.appendChild(expectedRowsInput);
            integrityContainer.appendChild(completeInput);

            root.appendChild(integrityContainer);
        }

        getRows(rowsContainer).forEach(function (row) {
            const index = Number(row.dataset.gmRowIndex);

            if (Number.isSafeInteger(index) && index >= 0) {
                nextIndex = Math.max(nextIndex, index + 1);
            }

            synchronizeTarget(row);
        });

        synchronizeFormIntegrity();

        /**
         * Create a row using the server-rendered inert template.
         *
         * Replace only the dedicated index token in known attributes.
         * No user-provided content is inserted as HTML.
         *
         * @param {number} index
         * @returns {Element|null}
         */
        function createRow(index) {
            const fragment = template.content.cloneNode(true);
            const row = fragment.querySelector(ROW_SELECTOR);

            if (!row) {
                return null;
            }

            row.dataset.gmRowIndex = String(index);

            const attributes = [
                'name',
                'id',
                'for',
                'aria-describedby'
            ];

            row.querySelectorAll(
                '[name], [id], [for], [aria-describedby]'
            ).forEach(function (element) {
                attributes.forEach(function (attribute) {
                    if (!element.hasAttribute(attribute)) {
                        return;
                    }

                    const value = element.getAttribute(attribute);

                    if (value === null) {
                        return;
                    }

                    element.setAttribute(
                        attribute,
                        value.split('__INDEX__').join(String(index))
                    );
                });
            });

            return row;
        }

        addButton.addEventListener('click', function () {
            if (
                !Number.isSafeInteger(nextIndex) ||
                !Number.isSafeInteger(nextIndex + 1)
            ) {
                announcement.textContent =
                    'Невозможно добавить ещё одну строку.';
                return;
            }

            const row = createRow(nextIndex);

            if (!row) {
                announcement.textContent =
                    'Не удалось создать строку измерения.';
                return;
            }

            nextIndex += 1;

            rowsContainer.appendChild(row);

            synchronizeTarget(row);
            synchronizeFormIntegrity();

            const definitionSelect = row.querySelector(
                '[data-gm-definition]'
            );

            if (definitionSelect instanceof HTMLSelectElement) {
                definitionSelect.focus();
            }

            announcement.textContent = 'Добавлена строка измерения.';
        });

        root.addEventListener('change', function (event) {
            const control = event.target;

            if (!(control instanceof HTMLSelectElement)) {
                return;
            }

            const row = control.closest(ROW_SELECTOR);

            if (!row || !rowsContainer.contains(row)) {
                return;
            }

            if (
                !control.matches('[data-gm-definition]') &&
                !control.matches('[data-gm-target]')
            ) {
                return;
            }

            releaseUnselectedArchivedOptions(control);
            synchronizeTarget(row);
        });

        root.addEventListener('click', function (event) {
            if (!(event.target instanceof Element)) {
                return;
            }

            const button = event.target.closest(
                '[data-gm-remove-row]'
            );

            if (
                !(button instanceof HTMLButtonElement) ||
                !rowsContainer.contains(button)
            ) {
                return;
            }

            const row = button.closest(ROW_SELECTOR);

            if (!row || !rowsContainer.contains(row)) {
                return;
            }

            const rows = getRows(rowsContainer);
            const position = rows.indexOf(row);
            const focusRow = rows[position + 1] ||
                rows[position - 1] ||
                null;

            row.remove();

            synchronizeFormIntegrity();

            const focusControl = focusRow
                ? focusRow.querySelector('[data-gm-definition]')
                : addButton;

            if (focusControl instanceof HTMLElement) {
                focusControl.focus();
            } else {
                addButton.focus();
            }

            announcement.textContent = 'Строка измерения удалена.';
        });

        /*
         * Updating after each row change also covers submission paths
         * that do not dispatch a submit event.
         */
        form.addEventListener(
            'submit',
            function () {
                synchronizeFormIntegrity();
            },
            true
        );
    }

    /**
     * Initialize all matching metaboxes on the current page.
     *
     * @returns {void}
     */
    function initialize() {
        document.querySelectorAll(ROOT_SELECTOR).forEach(
            initializeMetabox
        );
    }

    if (document.readyState === 'loading') {
        document.addEventListener(
            'DOMContentLoaded',
            initialize,
            { once: true }
        );
    } else {
        initialize();
    }
})();
