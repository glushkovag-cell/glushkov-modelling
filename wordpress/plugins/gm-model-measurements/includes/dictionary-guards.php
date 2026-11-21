<?php
/**
 * Dictionary integrity guards.
 *
 * Requires:
 * - dictionaries.php
 * - measurements.php
 *
 * Guards apply through the WordPress metadata and post APIs.
 * Direct SQL writes bypass these guards.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Register dictionary protection.
 *
 * Call once from the main plugin file.
 *
 * Model references are checked in canonical measurement metadata
 * for all registered statuses, including drafts and trash.
 *
 * @param string[] $model_post_types Model post types.
 * @return void
 */
function register_dictionary_guards(array $model_post_types)
{
    $model_post_types = array_values(array_unique(array_filter(
        $model_post_types,
        static function ($post_type) {
            return is_string($post_type) && $post_type !== '';
        }
    )));

    /*
     * Without configured model CPTs, usage detection would incorrectly
     * report that no model uses a dictionary entry.
     *
     * Refuse destructive changes instead of guessing.
     */
    $configuration_error = $model_post_types === [];

    $check_change = static function (
        $post_id,
        $meta_key,
        $value,
        $deleting = false
    ) use ($model_post_types, $configuration_error) {
        if ($configuration_error) {
            return dictionary_guard_error(
                'configuration_missing',
                'Не настроены типы записей моделей. '
                . 'Изменение защищённых полей справочника отменено.'
            );
        }

        return validate_dictionary_meta_change(
            $post_id,
            $meta_key,
            $value,
            $deleting,
            $model_post_types
        );
    };

    /*
     * ACF validation gives a field-level error before form saving.
     * Metadata filters below remain the final API-level guard.
     */
    $field_names = [
        'measurement_code',
        'measurement_group',
        'measurement_target_kind',
        'measurement_active',
        'element_code',
        'element_kind',
        'element_parent',
    ];

    foreach ($field_names as $field_name) {
        add_filter(
            'acf/validate_value/name=' . $field_name,
            static function ($valid, $value, $field, $input) use (
                $check_change
            ) {
                if ($valid !== true) {
                    return $valid;
                }

                $post_id = dictionary_acf_post_id();

                if ($post_id <= 0) {
                    return $valid;
                }

                $result = $check_change(
                    $post_id,
                    $field['name'],
                    $value
                );

                return is_wp_error($result)
                    ? $result->get_error_message()
                    : $valid;
            },
            10,
            4
        );
    }

    foreach (['add', 'update', 'delete'] as $operation) {
        add_filter(
            $operation . '_post_metadata',
            static function (
                $check,
                $post_id,
                $meta_key,
                $meta_value,
                $extra
            ) use ($operation, $check_change) {
                /*
                 * Respect an earlier filter's explicit decision.
                 */
                if ($check !== null) {
                    return $check;
                }

                if (!is_protected_dictionary_meta($post_id, $meta_key)) {
                    return null;
                }

                /*
                 * A delete-all metadata operation has no single
                 * dictionary entry against which to validate.
                 */
                if ($operation === 'delete' && $extra) {
                    dictionary_guard_notice(
                        'Массовое удаление защищённых полей '
                        . 'справочника запрещено.'
                    );
                    return false;
                }

                $existing_values = get_post_meta(
                    $post_id,
                    $meta_key,
                    false
                );

                if ($operation === 'add' && $existing_values !== []) {
                    dictionary_guard_notice(
                        'Защищённое поле справочника '
                        . 'не может иметь несколько метазаписей.'
                    );
                    return false;
                }

                if (count($existing_values) > 1) {
                    dictionary_guard_notice(
                        'Обнаружены дубликаты метаполя справочника. '
                        . 'Требуется отдельное исправление данных.'
                    );
                    return false;
                }

                /*
                 * update_metadata() unslashes input before invoking
                 * its filter; add_metadata() invokes its filter before
                 * unslashing. Normalize only the latter here.
                 */
                $value = $operation === 'add'
                    ? wp_unslash($meta_value)
                    : $meta_value;

                $result = $check_change(
                    (int) $post_id,
                    $meta_key,
                    $value,
                    $operation === 'delete'
                );

                if (is_wp_error($result)) {
                    dictionary_guard_notice(
                        $result->get_error_message()
                    );
                    return false;
                }

                return null;
            },
            10,
            5
        );
    }

    /*
     * Prevent trashing and permanent deletion of referenced entries.
     */
    foreach (['pre_trash_post', 'pre_delete_post'] as $hook) {
        add_filter(
            $hook,
            static function ($check, $post) use (
                $model_post_types,
                $configuration_error
            ) {
                if ($check !== null) {
                    return $check;
                }

                if (
                    !$post instanceof \WP_Post
                    || !is_measurement_dictionary_type($post->post_type)
                ) {
                    return null;
                }

                if ($configuration_error) {
                    dictionary_guard_notice(
                        'Удаление отменено: '
                        . 'не настроены типы записей моделей.'
                    );
                    return false;
                }

                $result = dictionary_entry_may_leave_publication(
                    $post->ID,
                    $model_post_types
                );

                if (is_wp_error($result)) {
                    dictionary_guard_notice(
                        $result->get_error_message()
                    );
                    return false;
                }

                return null;
            },
            10,
            2
        );
    }

    /*
     * A published entry must not disappear from the loaded dictionary
     * while referenced, including by changing its status to draft.
     */
    add_filter(
        'wp_insert_post_data',
        static function ($data, $postarr) use (
            $model_post_types,
            $configuration_error
        ) {
            $post_id = isset($postarr['ID'])
                ? absint($postarr['ID'])
                : 0;

            if (
                $post_id <= 0
                || !is_measurement_dictionary_type(
                    $data['post_type'] ?? ''
                )
            ) {
                return $data;
            }

            $previous_status = get_post_status($post_id);
            $new_status = $data['post_status'] ?? $previous_status;

            if (
                $previous_status !== 'publish'
                || $new_status === 'publish'
            ) {
                return $data;
            }

            $result = $configuration_error
                ? dictionary_guard_error(
                    'configuration_missing',
                    'Снятие с публикации отменено: '
                    . 'не настроены типы записей моделей.'
                )
                : dictionary_entry_may_leave_publication(
                    $post_id,
                    $model_post_types
                );

            if (is_wp_error($result)) {
                $data['post_status'] = $previous_status;

                dictionary_guard_notice(
                    $result->get_error_message()
                );
            }

            return $data;
        },
        20,
        2
    );

    add_action(
        'admin_notices',
        __NAMESPACE__ . '\\render_dictionary_guard_notices'
    );
}

/**
 * Identify dictionary post types.
 *
 * @param string $post_type Post type.
 * @return bool
 */
function is_measurement_dictionary_type($post_type)
{
    return in_array(
        $post_type,
        ['measurement_defi', 'model_element'],
        true
    );
}

/**
 * Identify protected value metadata, excluding ACF field-key metadata.
 *
 * @param int    $post_id  Dictionary entry ID.
 * @param string $meta_key Metadata name.
 * @return bool
 */
function is_protected_dictionary_meta($post_id, $meta_key)
{
    $post_type = get_post_type($post_id);

    $keys = [
        'measurement_defi' => [
            'measurement_code',
            'measurement_group',
            'measurement_target_kind',
            'measurement_active',
        ],
        'model_element' => [
            'element_code',
            'element_kind',
            'element_parent',
        ],
    ];

    return isset($keys[$post_type])
        && in_array($meta_key, $keys[$post_type], true);
}

/**
 * Validate one proposed protected metadata change.
 *
 * @param int      $post_id          Dictionary entry ID.
 * @param string   $meta_key         ACF field name.
 * @param mixed    $value            Proposed raw value.
 * @param bool     $deleting         Whether metadata is being deleted.
 * @param string[] $model_post_types Model post types.
 * @return true|\WP_Error
 */
function validate_dictionary_meta_change(
    $post_id,
    $meta_key,
    $value,
    $deleting,
    array $model_post_types
) {
    if (!is_protected_dictionary_meta($post_id, $meta_key)) {
        return true;
    }

    $post_type = get_post_type($post_id);
    $is_definition = $post_type === 'measurement_defi';
    $code_key = $is_definition
        ? 'measurement_code'
        : 'element_code';

    $current_code = get_post_meta($post_id, $code_key, true);
    $is_system = $is_definition
        && $current_code === 'overall_length';

    if ($deleting) {
        /*
         * Remove unused entries as posts, not by stripping individual
         * protected fields from otherwise existing entries.
         */
        return dictionary_guard_error(
            'field_deletion_forbidden',
            'Удаление защищённого поля справочника запрещено. '
            . 'Неиспользуемую запись можно удалить целиком.'
        );
    }

    if ($meta_key === $code_key) {
        if (!is_measurement_code($value)) {
            return dictionary_guard_error(
                'invalid_code',
                'Код должен начинаться с латинской буквы '
                . 'и содержать только a–z, 0–9 и подчёркивания.'
            );
        }

        $duplicates = get_posts([
            'post_type'        => $post_type,
            'post_status'      => array_values(get_post_stati()),
            'posts_per_page'   => -1,
            'fields'           => 'ids',
            'post__not_in'     => [(int) $post_id],
            'meta_key'         => $code_key,
            'meta_value'       => $value,
            'no_found_rows'    => true,
            'suppress_filters' => false,
        ]);

        if ($duplicates !== []) {
            return dictionary_guard_error(
                'duplicate_code',
                sprintf(
                    'Код %s уже занят другой записью справочника, '
                    . 'включая черновики и корзину.',
                    $value
                )
            );
        }
    }

    if ($meta_key === 'measurement_group') {
        if (
            !is_string($value)
            || !in_array(
                $value,
                ['overall', 'hull', 'rig', 'armament', 'other'],
                true
            )
        ) {
            return dictionary_guard_error(
                'invalid_group',
                'Некорректная группа измерения.'
            );
        }
    }

    if ($meta_key === 'measurement_target_kind') {
        if (
            !is_string($value)
            || !in_array($value, ['none', 'mast', 'yard'], true)
        ) {
            return dictionary_guard_error(
                'invalid_target_kind',
                'Некорректный тип измеряемого элемента.'
            );
        }
    }

    if ($meta_key === 'element_kind') {
        if (
            !is_string($value)
            || !in_array($value, ['mast', 'yard'], true)
        ) {
            return dictionary_guard_error(
                'invalid_element_kind',
                'Некорректный тип элемента.'
            );
        }
    }

    if ($meta_key === 'measurement_active') {
        if (!in_array($value, [true, false, 1, 0, '1', '0'], true)) {
            return dictionary_guard_error(
                'invalid_active',
                'Некорректный признак активности измерения.'
            );
        }
    }

    /*
     * Protect overall_length both when editing it and when assigning
     * that reserved code to a previously unused definition.
     *
     * Full simultaneous ACF field validation is still completed by
     * subsequent field guards and dictionary loading.
     */
    if ($is_system) {
        $system_value_valid = true;

        if ($meta_key === 'measurement_code') {
            $system_value_valid = $value === 'overall_length';
        } elseif ($meta_key === 'measurement_group') {
            $system_value_valid = $value === 'overall';
        } elseif ($meta_key === 'measurement_target_kind') {
            $system_value_valid = $value === 'none';
        } elseif ($meta_key === 'measurement_active') {
            $system_value_valid = in_array(
                $value,
                [true, 1, '1'],
                true
            );
        }

        if (!$system_value_valid) {
            return dictionary_guard_error(
                'system_definition_protected',
                'Системный вид overall_length нельзя переименовать, '
                . 'отключить, перевести в другую группу '
                . 'или связать с элементом.'
            );
        }
    }

    if (
        $is_definition
        && $meta_key === 'measurement_code'
        && $value === 'overall_length'
        && $current_code !== 'overall_length'
    ) {
        if (
            get_post_meta(
                $post_id,
                'measurement_group',
                true
            ) !== 'overall'
            || get_post_meta(
                $post_id,
                'measurement_target_kind',
                true
            ) !== 'none'
            || !in_array(
                get_post_meta(
                    $post_id,
                    'measurement_active',
                    true
                ),
                [true, 1, '1'],
                true
            )
        ) {
            return dictionary_guard_error(
                'system_definition_not_ready',
                'Перед назначением кода overall_length сохраните '
                . 'group=overall, target_kind=none и active=1.'
            );
        }
    }

    if ($meta_key === 'element_parent') {
        return validate_dictionary_parent_change(
            $post_id,
            $value
        );
    }

    /*
     * Changes to these fields can invalidate stable references or
     * the meaning of existing target links.
     */
    $usage_sensitive_keys = [
        'measurement_code',
        'measurement_target_kind',
        'element_code',
        'element_kind',
    ];

    if (
        in_array($meta_key, $usage_sensitive_keys, true)
        && get_post_meta($post_id, $meta_key, true) !== $value
    ) {
        $used = dictionary_entry_is_used(
            $post_id,
            $model_post_types
        );

        if (is_wp_error($used)) {
            return $used;
        }

        if ($used) {
            return dictionary_guard_error(
                'used_field_protected',
                'Нельзя изменить код или типовую совместимость '
                . 'используемой справочной записи. '
                . 'Создайте новую запись, а старую при необходимости '
                . 'сделайте неактивной.'
            );
        }
    }

    return true;
}

/**
 * Validate one proposed parent and its ancestor chain.
 *
 * Parent kinds are not forced to match child kinds.
 * No measurement inheritance is introduced.
 *
 * @param int   $post_id Element ID.
 * @param mixed $value   Proposed raw parent value.
 * @return true|\WP_Error
 */
function validate_dictionary_parent_change($post_id, $value)
{
    $parent_id = dictionary_parent_id($value);

    if (is_wp_error($parent_id)) {
        return $parent_id;
    }

    $visited = [(int) $post_id => true];

    while ($parent_id !== null) {
        if (isset($visited[$parent_id])) {
            return dictionary_guard_error(
                'parent_cycle',
                'Родительская связь создаёт цикл.'
            );
        }

        $visited[$parent_id] = true;

        if (get_post_type($parent_id) !== 'model_element') {
            return dictionary_guard_error(
                'invalid_parent_post',
                'Родитель должен ссылаться на существующую '
                . 'запись справочника элементов.'
            );
        }

        if (
            get_post_status($post_id) === 'publish'
            && get_post_status($parent_id) !== 'publish'
        ) {
            return dictionary_guard_error(
                'unpublished_parent',
                'Опубликованный элемент должен ссылаться '
                . 'на опубликованного родителя.'
            );
        }

        $values = get_post_meta(
            $parent_id,
            'element_parent',
            false
        );

        if (count($values) > 1) {
            return dictionary_guard_error(
                'multiple_parent_meta',
                'У элемента в родительской цепочке '
                . 'обнаружено несколько метазаписей родителя.'
            );
        }

        $parent_id = dictionary_parent_id(
            $values === [] ? null : $values[0]
        );

        if (is_wp_error($parent_id)) {
            return $parent_id;
        }
    }

    return true;
}

/**
 * Normalize a raw single-parent reference.
 *
 * Arrays are rejected, including arrays with a single item.
 *
 * @param mixed $value Raw ACF parent value.
 * @return int|null|\WP_Error
 */
function dictionary_parent_id($value)
{
    if (in_array($value, [false, null, '', 0, '0'], true)) {
        return null;
    }

    if (
        !(is_int($value) && $value > 0)
        && !(
            is_string($value)
            && preg_match('/^[1-9][0-9]*$/D', $value)
        )
    ) {
        return dictionary_guard_error(
            'invalid_parent_value',
            'Родитель должен быть одной ссылкой на элемент, '
            . 'а не списком.'
        );
    }

    $parent_id = filter_var(
        $value,
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1]]
    );

    if ($parent_id === false) {
        return dictionary_guard_error(
            'invalid_parent_id',
            'Некорректный ID родительского элемента.'
        );
    }

    return $parent_id;
}

/**
 * Determine whether models or child elements reference an entry.
 *
 * A malformed model collection prevents a reliable usage check.
 * Fail closed instead of assuming that the entry is unused.
 *
 * @param int      $post_id          Dictionary entry ID.
 * @param string[] $model_post_types Model post types.
 * @return bool|\WP_Error
 */
function dictionary_entry_is_used(
    $post_id,
    array $model_post_types
) {
    $post_type = get_post_type($post_id);

    if (!is_measurement_dictionary_type($post_type)) {
        return false;
    }

    if ($post_type === 'model_element') {
        $children = get_posts([
            'post_type'        => 'model_element',
            'post_status'      => array_values(get_post_stati()),
            'posts_per_page'   => 1,
            'fields'           => 'ids',
            'meta_key'         => 'element_parent',
            'meta_value'       => (string) $post_id,
            'no_found_rows'    => true,
            'suppress_filters' => false,
        ]);

        if ($children !== []) {
            return true;
        }
    }

    $code_key = $post_type === 'measurement_defi'
        ? 'measurement_code'
        : 'element_code';

    $code = get_post_meta($post_id, $code_key, true);

    /*
     * An entry without a stable code cannot be referenced by
     * a structurally valid canonical model collection.
     */
    if (!is_measurement_code($code)) {
        return false;
    }

    $model_ids = get_posts([
        'post_type'        => $model_post_types,
        'post_status'      => array_values(get_post_stati()),
        'posts_per_page'   => -1,
        'fields'           => 'ids',
        'meta_query'       => [
            [
                'key'     => MEASUREMENTS_META_KEY,
                'compare' => 'EXISTS',
            ],
        ],
        'no_found_rows'    => true,
        'suppress_filters' => false,
    ]);

    foreach ($model_ids as $model_id) {
        $measurements = get_model_measurements((int) $model_id);

        if (is_wp_error($measurements)) {
            return dictionary_guard_error(
                'usage_check_failed',
                sprintf(
                    'Невозможно проверить использование справочника: '
                    . 'у модели %d повреждён набор размеров.',
                    (int) $model_id
                )
            );
        }

        foreach ($measurements as $measurement) {
            if (
                $post_type === 'measurement_defi'
                && $measurement['definitionCode'] === $code
            ) {
                return true;
            }

            if (
                $post_type === 'model_element'
                && isset($measurement['target'])
                && $measurement['target']['id'] === $code
            ) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Decide whether an entry may be deleted or unpublished.
 *
 * @param int      $post_id          Dictionary entry ID.
 * @param string[] $model_post_types Model post types.
 * @return true|\WP_Error
 */
function dictionary_entry_may_leave_publication(
    $post_id,
    array $model_post_types
) {
    if (
        get_post_type($post_id) === 'measurement_defi'
        && get_post_meta(
            $post_id,
            'measurement_code',
            true
        ) === 'overall_length'
    ) {
        return dictionary_guard_error(
            'system_definition_removal',
            'Системный вид overall_length нельзя удалить '
            . 'или снять с публикации.'
        );
    }

    $used = dictionary_entry_is_used(
        $post_id,
        $model_post_types
    );

    if (is_wp_error($used)) {
        return $used;
    }

    if ($used) {
        return dictionary_guard_error(
            'used_entry_removal',
            'Запись используется моделью или дочерним элементом. '
            . 'Удаление и снятие с публикации запрещены. '
            . 'Для архивирования используйте признак активности.'
        );
    }

    return true;
}

/**
 * Resolve the current ACF post context without assuming a CPT.
 *
 * @return int
 */
function dictionary_acf_post_id()
{
    if (!function_exists('acf_get_form_data')) {
        return 0;
    }

    $value = acf_get_form_data('post_id');

    if (
        is_string($value)
        && preg_match('/^post_([1-9][0-9]*)$/D', $value, $matches)
    ) {
        return absint($matches[1]);
    }

    if (
        is_int($value)
        || (
            is_string($value)
            && preg_match('/^[1-9][0-9]*$/D', $value)
        )
    ) {
        return absint($value);
    }

    return 0;
}

/**
 * Build a dictionary protection error.
 *
 * @param string $code    Stable reason code.
 * @param string $message Error description.
 * @return \WP_Error
 */
function dictionary_guard_error($code, $message)
{
    return new \WP_Error(
        'gm_dictionary_' . $code,
        $message
    );
}

/**
 * Retain a protection notice across an admin redirect.
 *
 * @param string $message Notice text.
 * @return void
 */
function dictionary_guard_notice($message)
{
    $user_id = get_current_user_id();

    if ($user_id <= 0) {
        return;
    }

    $key = 'gm_dictionary_notices_' . $user_id;
    $messages = get_transient($key);

    if (!is_array($messages)) {
        $messages = [];
    }

    if (!in_array($message, $messages, true)) {
        $messages[] = $message;
    }

    set_transient(
        $key,
        $messages,
        10 * MINUTE_IN_SECONDS
    );
}

/**
 * Display and consume dictionary protection notices.
 *
 * @return void
 */
function render_dictionary_guard_notices()
{
    $user_id = get_current_user_id();

    if ($user_id <= 0) {
        return;
    }

    $key = 'gm_dictionary_notices_' . $user_id;
    $messages = get_transient($key);

    if (!is_array($messages) || $messages === []) {
        return;
    }

    delete_transient($key);

    echo '<div class="notice notice-error">';
    echo '<p>';
    echo esc_html(
        'Некоторые изменения справочника были отклонены. '
        . 'Проверьте сохранённые значения.'
    );
    echo '</p><ul>';

    foreach ($messages as $message) {
        if (is_string($message)) {
            echo '<li>' . esc_html($message) . '</li>';
        }
    }

    echo '</ul></div>';
}
