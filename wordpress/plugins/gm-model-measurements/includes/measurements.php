<?php
/**
 * Reading and structural normalization of model measurements.
 *
 * Storage contract:
 * - definitionCode: stable measurement definition code;
 * - valueMm: positive finite number in millimeters;
 * - target: optional element reference with kind and stable code;
 * - note: optional text.
 *
 * Canonical representation:
 * - collection indexes are consecutive integers;
 * - valueMm is a float;
 * - target is omitted for measurements without an element;
 * - empty notes are omitted;
 * - object keys have a consistent order.
 *
 * This module does not:
 * - write metadata;
 * - register hooks, CPTs or ACF fields;
 * - read, modify or synchronize legacy modellength;
 * - validate references against dictionaries;
 * - decide whether a model may be published.
 *
 * Dictionary validation belongs to validation.php.
 * Persistence and publication enforcement are separate modules.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

const MEASUREMENTS_META_KEY = '_gm_model_measurements';

/**
 * Read the canonical measurement collection.
 *
 * Missing metadata means an empty collection.
 * Duplicate metadata rows cause an error.
 *
 * Legacy modellength is deliberately not read or converted here.
 *
 * @param int $post_id Model post ID.
 * @return array|\WP_Error
 */
function get_model_measurements($post_id)
{
    if (!is_int($post_id) || $post_id <= 0) {
        return measurement_data_error(
            'gm_measurements_invalid_post_id',
            'ID модели должен быть положительным целым числом.'
        );
    }

    $post = get_post($post_id);

    if (!$post instanceof \WP_Post) {
        return measurement_data_error(
            'gm_measurements_post_not_found',
            'Запись модели не найдена.'
        );
    }

    $values = get_post_meta(
        $post_id,
        MEASUREMENTS_META_KEY,
        false
    );

    if ($values === []) {
        return [];
    }

    if (count($values) !== 1) {
        return measurement_data_error(
            'gm_measurements_multiple_meta_values',
            'Обнаружено несколько наборов размеров у одной модели.',
            ['postId' => $post_id]
        );
    }

    return normalize_measurements($values[0]);
}

/**
 * Normalize a complete measurement collection.
 *
 * Input collection indexes are not significant and may contain gaps
 * after removing rows in the administration interface.
 *
 * Unknown fields, invalid rows and duplicate measurement identities
 * cause an error. Nothing is silently discarded and no partially
 * normalized collection is returned.
 *
 * A measurement identity consists of:
 * - definitionCode;
 * - target.kind, if present;
 * - target.id, if present.
 *
 * @param mixed $rows Measurement collection.
 * @return array|\WP_Error
 */
function normalize_measurements($rows)
{
    if (!is_array($rows)) {
        return measurement_data_error(
            'gm_measurements_invalid_collection',
            'Набор размеров должен быть массивом.'
        );
    }

    $normalized = [];
    $seen = [];
    $position = 0;

    foreach ($rows as $row) {
        ++$position;

        $entry = normalize_measurement_row($row, $position);

        if (is_wp_error($entry)) {
            return $entry;
        }

        $target = isset($entry['target'])
            ? [
                $entry['target']['kind'],
                $entry['target']['id'],
            ]
            : [null, null];

        $identity = wp_json_encode([
            $entry['definitionCode'],
            $target,
        ]);

        if (isset($seen[$identity])) {
            return measurement_data_error(
                'gm_measurements_duplicate',
                sprintf(
                    'Строки %d и %d содержат одинаковое измерение '
                    . 'для одного элемента.',
                    $seen[$identity],
                    $position
                ),
                [
                    'row'            => $position,
                    'duplicateOfRow' => $seen[$identity],
                ]
            );
        }

        $seen[$identity] = $position;
        $normalized[] = $entry;
    }

    return $normalized;
}

/**
 * Normalize one measurement row.
 *
 * Missing values are not converted to zero.
 * Empty notes are omitted from canonical storage.
 *
 * This function checks structure only. Whether a definition requires
 * a target, and whether its references exist, is checked separately
 * against the dictionaries.
 *
 * @param mixed $row Measurement row.
 * @param int   $position One-based row position for error messages.
 * @return array|\WP_Error
 */
function normalize_measurement_row($row, $position)
{
    if (!is_array($row)) {
        return measurement_row_error(
            $position,
            'ожидается объект измерения'
        );
    }

    $allowed_keys = [
        'definitionCode',
        'valueMm',
        'target',
        'note',
    ];

    if (array_diff(array_keys($row), $allowed_keys) !== []) {
        return measurement_row_error(
            $position,
            'обнаружены неизвестные поля'
        );
    }

    if (
        !array_key_exists('definitionCode', $row)
        || !is_measurement_code($row['definitionCode'])
    ) {
        return measurement_row_error(
            $position,
            'не указан корректный код вида измерения'
        );
    }

    if (!array_key_exists('valueMm', $row)) {
        return measurement_row_error(
            $position,
            'не указано значение в миллиметрах'
        );
    }

    $value = normalize_measurement_value($row['valueMm']);

    if (is_wp_error($value)) {
        return measurement_row_error(
            $position,
            $value->get_error_message()
        );
    }

    $entry = [
        'definitionCode' => $row['definitionCode'],
        'valueMm'        => $value,
    ];

    if (array_key_exists('target', $row)) {
        $target = $row['target'];

        if (
            !is_array($target)
            || count($target) !== 2
            || !array_key_exists('kind', $target)
            || !array_key_exists('id', $target)
            || !is_string($target['kind'])
            || !in_array($target['kind'], ['mast', 'yard'], true)
            || !is_measurement_code($target['id'])
        ) {
            return measurement_row_error(
                $position,
                'элемент должен содержать kind (mast или yard) '
                . 'и id со стабильным кодом элемента'
            );
        }

        $entry['target'] = [
            'kind' => $target['kind'],
            'id'   => $target['id'],
        ];
    }

    if (array_key_exists('note', $row)) {
        if (!is_string($row['note'])) {
            return measurement_row_error(
                $position,
                'примечание должно быть текстом'
            );
        }

        $note = trim(sanitize_textarea_field($row['note']));

        if ($note !== '') {
            $entry['note'] = $note;
        }
    }

    return $entry;
}

/**
 * Normalize a positive finite value in millimeters.
 *
 * String input accepts a decimal dot or comma, without:
 * - thousands separators;
 * - measurement units;
 * - exponent notation;
 * - internal whitespace;
 * - explicit plus or minus signs.
 *
 * Integer and float input are accepted directly, provided the final
 * value is finite and greater than zero.
 *
 * @param mixed $value Raw value.
 * @return float|\WP_Error
 */
function normalize_measurement_value($value)
{
    if (is_string($value)) {
        $value = trim($value);

        if (
            preg_match(
                '/^[0-9]+(?:[.,][0-9]+)?$/D',
                $value
            ) !== 1
        ) {
            return measurement_data_error(
                'gm_measurements_invalid_number',
                'значение должно быть числом без единиц измерения '
                . 'и разделителей тысяч'
            );
        }

        $value = str_replace(',', '.', $value);
    } elseif (!is_int($value) && !is_float($value)) {
        return measurement_data_error(
            'gm_measurements_invalid_number',
            'значение должно быть числом'
        );
    }

    $number = (float) $value;

    if (!is_finite($number) || $number <= 0) {
        return measurement_data_error(
            'gm_measurements_invalid_number',
            'значение должно быть конечным числом больше нуля'
        );
    }

    return $number;
}

/**
 * Check a stable dictionary code without changing it.
 *
 * Codes must not be silently trimmed, lowercased or sanitized into
 * another identifier.
 *
 * @param mixed $value Candidate code.
 * @return bool
 */
function is_measurement_code($value)
{
    return is_string($value)
        && preg_match('/^[a-z][a-z0-9_]*$/D', $value) === 1;
}

/**
 * Find a measurement in an already normalized collection.
 *
 * For measurements without a target, pass only the definition code.
 * For targeted measurements, provide both kind and stable element code.
 *
 * This helper assumes the collection has already passed structural
 * normalization. It does not normalize or validate its input again.
 *
 * @param array       $measurements Normalized collection.
 * @param string      $definition_code Measurement definition code.
 * @param string|null $target_kind Element kind or null.
 * @param string|null $target_id Stable element code or null.
 * @return array|null
 */
function find_measurement(
    array $measurements,
    $definition_code,
    $target_kind = null,
    $target_id = null
) {
    foreach ($measurements as $measurement) {
        if ($measurement['definitionCode'] !== $definition_code) {
            continue;
        }

        $target = $measurement['target'] ?? null;

        if ($target === null) {
            if ($target_kind === null && $target_id === null) {
                return $measurement;
            }

            continue;
        }

        if (
            $target['kind'] === $target_kind
            && $target['id'] === $target_id
        ) {
            return $measurement;
        }
    }

    return null;
}

/**
 * Build a structural validation error for a measurement row.
 *
 * @param int    $position One-based row position.
 * @param string $reason Validation failure.
 * @return \WP_Error
 */
function measurement_row_error($position, $reason)
{
    return measurement_data_error(
        'gm_measurements_invalid_row',
        sprintf('Строка %d: %s.', $position, $reason),
        ['row' => (int) $position]
    );
}

/**
 * Build a measurement data error.
 *
 * @param string $code Error code.
 * @param string $message Human-readable message.
 * @param array  $data Additional error context.
 * @return \WP_Error
 */
function measurement_data_error($code, $message, array $data = [])
{
    return new \WP_Error($code, $message, $data);
}
