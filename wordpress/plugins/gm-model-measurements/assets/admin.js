/**
 * Model measurements metabox.
 *
 * No AJAX, persistence or publication rules are implemented here.
 * Server-side validation remains authoritative.
 */
(function () {
    'use strict';

    const ROOT_SELECTOR = '[data-gm-measurements]';
    const ROW_SELECTOR = '[data-gm-measurement-row]';

    /**
     * Read the target kind from a definition option.
     *
     * null means that no usable definition is selected.
     */
    function getTargetKind(definitionSelect) {
        const option = definitionSelect.selectedOptions[0];

        if (!option || option.value === '') {
            return null;
        }

        const kind = option.dataset.targetKind;

        return ['none', 'mast', 'yard'].includes(kind) ? kind : null;
    }

    /**
     * Synchronize the element selector with the chosen definition.
     *
     * An incompatible selected element is retained visibly as an error,
     * rather than silently replaced with a different element.
     */
    function synchronizeTarget(row) {
        const definitionSelect = row.querySelector(
            '[data-gm-definition]'
        );
        const targetSelect = row.querySelector('[data-gm-target]');
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
            !definitionSelect ||
            !targetSelect ||
            !targetKindInput ||
            !targetContainer ||
            !targetStatus
        ) {
            return;
        }

        const kind = getTargetKind(definitionSelect);
        const needsTarget = kind === 'mast' || kind === 'yard';

        targetContainer.hidden = !needsTarget;
        targetSelect.disabled = !needsTarget;
        targetKindInput.disabled = !needsTarget;
        targetSelect.required = needsTarget;
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

            option.hidden = !compatible || (unavailable && !retained);
            option.disabled = !compatible || (unavailable && !retained);
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
     * An archived option may be retained while it remains selected.
     *
     * After choosing a different option, it cannot be selected again.
     * The server independently checks the saved collection.
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
     * Initialize one independently addressable metabox.
     */
    function initializeMetabox(root) {
        if (root.dataset.gmInitialized === '1') {
            return;
        }

        const rowsContainer = root.querySelector('[data-gm-rows]');
        const template = root.querySelector('[data-gm-row-template]');
        const addButton = root.querySelector('[data-gm-add-row]');
        const announcement = root.querySelector(
            '[data-gm-announcement]'
        );

        if (
            !rowsContainer ||
            !(template instanceof HTMLTemplateElement) ||
            !addButton ||
            !announcement
        ) {
            return;
        }

        root.dataset.gmInitialized = '1';

        let nextIndex = 0;

        rowsContainer.querySelectorAll(ROW_SELECTOR).forEach(
            function (row) {
                const index = Number(row.dataset.gmRowIndex);

                if (Number.isSafeInteger(index) && index >= 0) {
                    nextIndex = Math.max(nextIndex, index + 1);
                }

                synchronizeTarget(row);
            }
        );

        /**
         * Replace only the dedicated template index token.
         *
         * No user-provided content is inserted as HTML.
         */
        function createRow(index) {
            const fragment = template.content.cloneNode(true);
            const row = fragment.querySelector(ROW_SELECTOR);

            if (!row) {
                return null;
            }

            row.dataset.gmRowIndex = String(index);

            row.querySelectorAll('[name], [id], [for]').forEach(
                function (element) {
                    ['name', 'id', 'for'].forEach(function (attribute) {
                        if (!element.hasAttribute(attribute)) {
                            return;
                        }

                        const value = element.getAttribute(attribute);

                        element.setAttribute(
                            attribute,
                            value.split('__INDEX__').join(String(index))
                        );
                    });
                }
            );

            return row;
        }

        addButton.addEventListener('click', function () {
            if (!Number.isSafeInteger(nextIndex + 1)) {
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

            const definitionSelect = row.querySelector(
                '[data-gm-definition]'
            );

            if (definitionSelect) {
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
                control.matches('[data-gm-definition]') ||
                control.matches('[data-gm-target]')
            ) {
                releaseUnselectedArchivedOptions(control);
                synchronizeTarget(row);
            }
        });

        root.addEventListener('click', function (event) {
            if (!(event.target instanceof Element)) {
                return;
            }

            const button = event.target.closest(
                '[data-gm-remove-row]'
            );

            if (!button || !rowsContainer.contains(button)) {
                return;
            }

            const row = button.closest(ROW_SELECTOR);

            if (!row) {
                return;
            }

            const nextRow = row.nextElementSibling;
            const previousRow = row.previousElementSibling;

            row.remove();

            const focusRow = nextRow || previousRow;
            const focusControl = focusRow
                ? focusRow.querySelector('[data-gm-definition]')
                : addButton;

            if (focusControl) {
                focusControl.focus();
            }

            announcement.textContent = 'Строка измерения удалена.';
        });
    }

    function initialize() {
        document.querySelectorAll(ROOT_SELECTOR).forEach(
            initializeMetabox
        );
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, {
            once: true
        });
    } else {
        initialize();
    }
})();