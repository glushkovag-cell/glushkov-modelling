<?php
/**
 * Dictionary-aware validation of model measurements.
 *
 * Requires dictionaries.php and measurements.php.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Validate a complete measurement collection before saving.
 *
 * Both incoming and previously stored collections are normalized.
 * No partial collection is returned when validation fails.
 *
 * Inactive definitions and elements may remain in an existing row
 * only when that row is completely unchanged.
 *
 * Dictionary structure must come from load_dictionaries().
 *
 * @param mixed $rows                   Proposed collection.
 * @param array $dictionaries           Loaded dictionaries.
 * @param mixed $existing_rows          Previously stored collection.
 * @param bool  $require_overall_length Require overall_length.
 * @return array|\WP_Error Normalized collection or validation errors.
 */
function validate_model_measurements(
    $rows,
    array $dictionaries,
    $existing_rows = [],
    $require_overall_length = false
) {
    if (!is_bool($require_overall_length)) {
        return measurement_data_error(
            'gm_measurements_invalid_validation_options',
            'Признак обязательности габаритной длины '
            . 'должен быть логическим значением.'
        );
    }

    if (
        !isset($dictionaries['definitions'])
        || !is_array($dictionaries['definitions'])
        || !isset($dictionaries['elements'])
        || !is_array($dictionaries['elements'])
    ) {
        return measurement_data_error(
            'gm_measurements_invalid_dictionaries',
            'Не переданы корректно загруженные справочники измерений.'
        );
    }

    $definitions = $dictionaries['definitions'];
    $elements = $dictionaries['elements'];

    $system_definition = validate_overall_length_definition($definitions);

    if (is_wp_error($system_definition)) {
        return $system_definition;
    }

    $measurements = normalize_measurements($rows);

    if (is_wp_error($measurements)) {
        return $measurements;
    }

    $existing = normalize_measurements($existing_rows);

    if (is_wp_error($existing)) {
        return measurement_data_error(
            'gm_measurements_invalid_existing_collection',
            'Сохранённый набор размеров повреждён. '
            . 'Автоматическая перезапись отменена.',
            [
                'causeCode'    => $existing->get_error_code(),
                'causeMessage' => $existing->get_error_message(),
                'causeData'    => $existing->get_error_data(),
            ]
        );
    }

    $errors = new \WP_Error();

    foreach ($measurements as $index => $measurement) {
        $position = $index + 1;

        $result = validate_measurement_against_dictionaries(
            $measurement,
            $definitions,
            $elements,
            $existing,
            $position
        );

        if (is_wp_error($result)) {
            $errors->merge_from($result);
        }
    }

    if (
        $require_overall_length
        && find_measurement($measurements, 'overall_length') === null
    ) {
        $errors->add(
            'gm_measurements_overall_length_required',
            'Для публикации модели укажите габаритную длину '
            . 'в миллиметрах.',
            ['definitionCode' => 'overall_length']
        );
    }

    return $errors->has_errors() ? $errors : $measurements;
}

/**
 * Validate the protected overall_length dictionary definition.
 *
 * Its group and target kind are part of the storage contract.
 *
 * @param array $definitions Definitions indexed by stable code.
 * @return true|\WP_Error
 */
function validate_overall_length_definition(array $definitions)
{
    if (!isset($definitions['overall_length'])) {
        return measurement_data_error(
            'gm_measurements_overall_length_definition_missing',
            'В справочнике отсутствует опубликованный вид измерения '
            . 'overall_length.'
        );
    }

    $definition = $definitions['overall_length'];

    if (
        ($definition['code'] ?? null) !== 'overall_length'
        || ($definition['group'] ?? null) !== 'overall'
        || ($definition['targetKind'] ?? null) !== 'none'
        || ($definition['active'] ?? null) !== true
    ) {
        return measurement_data_error(
            'gm_measurements_overall_length_definition_invalid',
            'Вид измерения overall_length должен быть активным, '
            . 'относиться к группе overall и иметь targetKind=none.'
        );
    }

    return true;
}

/**
 * Validate a normalized row against loaded dictionaries.
 *
 * Existing rows may preserve references to inactive entries,
 * but not to missing entries or incompatible element kinds.
 *
 * @param array $measurement Normalized proposed row.
 * @param array $definitions Definitions indexed by stable code.
 * @param array $elements    Elements indexed by stable code.
 * @param array $existing    Normalized previously stored collection.
 * @param int   $position    One-based row position.
 * @return true|\WP_Error
 */
function validate_measurement_against_dictionaries(
    array $measurement,
    array $definitions,
    array $elements,
    array $existing,
    $position
) {
    $definition_code = $measurement['definitionCode'];

    if (!isset($definitions[$definition_code])) {
        return measurement_validation_row_error(
            'definition_missing',
            $position,
            sprintf(
                'вид измерения %s отсутствует '
                . 'среди опубликованных записей справочника',
                $definition_code
            ),
            ['definitionCode' => $definition_code]
        );
    }

    $definition = $definitions[$definition_code];
    $target = $measurement['target'] ?? null;
    $element = null;

    if ($definition['targetKind'] === 'none') {
        if ($target !== null) {
            return measurement_validation_row_error(
                'unexpected_target',
                $position,
                sprintf(
                    'для измерения %s нельзя указывать элемент',
                    $definition_code
                ),
                ['definitionCode' => $definition_code]
            );
        }
    } else {
        if ($target === null) {
            return measurement_validation_row_error(
                'target_required',
                $position,
                sprintf(
                    'для измерения %s необходимо выбрать элемент типа %s',
                    $definition_code,
                    $definition['targetKind']
                ),
                ['definitionCode' => $definition_code]
            );
        }

        if ($target['kind'] !== $definition['targetKind']) {
            return measurement_validation_row_error(
                'target_kind_mismatch',
                $position,
                sprintf(
                    'измерение %s требует элемент типа %s, а не %s',
                    $definition_code,
                    $definition['targetKind'],
                    $target['kind']
                ),
                [
                    'definitionCode' => $definition_code,
                    'targetCode'     => $target['id'],
                ]
            );
        }

        if (!isset($elements[$target['id']])) {
            return measurement_validation_row_error(
                'element_missing',
                $position,
                sprintf(
                    'элемент %s отсутствует '
                    . 'среди опубликованных записей справочника',
                    $target['id']
                ),
                [
                    'definitionCode' => $definition_code,
                    'targetCode'     => $target['id'],
                ]
            );
        }

        $element = $elements[$target['id']];

        if ($element['kind'] !== $target['kind']) {
            return measurement_validation_row_error(
                'element_kind_mismatch',
                $position,
                sprintf(
                    'тип элемента %s в справочнике не совпадает '
                    . 'с типом, указанным в измерении',
                    $target['id']
                ),
                [
                    'definitionCode' => $definition_code,
                    'targetCode'     => $target['id'],
                ]
            );
        }
    }

    $definition_inactive = !$definition['active'];
    $element_inactive = $element !== null && !$element['active'];

    if ($definition_inactive || $element_inactive) {
        if (!measurement_row_is_unchanged($measurement, $existing)) {
            return measurement_validation_row_error(
                'inactive_reference',
                $position,
                'неактивный вид измерения или элемент можно '
                . 'сохранить только в ранее существовавшей строке '
                . 'без изменения её значения и примечания',
                [
                    'definitionCode' => $definition_code,
                    'targetCode'     => $target['id'] ?? null,
                ]
            );
        }
    }

    return true;
}

/**
 * Check whether a normalized row exactly matches a stored row.
 *
 * Normalization makes numeric input formats and object key ordering
 * irrelevant before this comparison.
 *
 * @param array $measurement Normalized proposed row.
 * @param array $existing    Normalized stored collection.
 * @return bool
 */
function measurement_row_is_unchanged(
    array $measurement,
    array $existing
) {
    $target = $measurement['target'] ?? null;

    $previous = find_measurement(
        $existing,
        $measurement['definitionCode'],
        $target['kind'] ?? null,
        $target['id'] ?? null
    );

    return $previous !== null && $previous === $measurement;
}

/**
 * Build a dictionary-aware row validation error.
 *
 * Row-specific error codes preserve context when errors are collected.
 *
 * @param string $reason_code Stable reason code.
 * @param int    $position    One-based row position.
 * @param string $reason      Human-readable failure description.
 * @param array  $context     Additional error context.
 * @return \WP_Error
 */
function measurement_validation_row_error(
    $reason_code,
    $position,
    $reason,
    array $context = []
) {
    $context['row'] = (int) $position;

    return measurement_data_error(
        sprintf(
            'gm_measurements_%s_row_%d',
            $reason_code,
            (int) $position
        ),
        sprintf('Строка %d: %s.', $position, $reason),
        $context
    );
}
