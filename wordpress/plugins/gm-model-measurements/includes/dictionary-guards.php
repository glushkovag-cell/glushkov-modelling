<?php
/**
 * Dictionary integrity and publication guards.
 *
 * Requires:
 * - dictionaries.php
 * - measurements.php
 *
 * New dictionary entries must first be saved as complete drafts.
 *
 * Guards cover the registered WordPress metadata filters and
 * publication through wp_insert_post()/wp_update_post().
 *
 * Direct SQL, metadata-by-ID APIs and direct wp_publish_post()
 * require separate consideration.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Return protected dictionary value metadata.
 *
 * ACF field-key metadata is deliberately excluded.
 *
 * @return array
 */
function protected_dictionary_meta_keys()
{
    return [
        'measurement_defi' =>
            dictionary_value_field_names('measurement_defi'),
        'model_element' =>
            dictionary_value_field_names('model_element'),
    ];
}

/**
 * Check a protected key without requiring an object ID.
 *
 * @param mixed $meta_key Metadata name.
 * @return bool
 */
function is_protected_dictionary_meta_key($meta_key)
{
    if (!is_string($meta_key)) {
        return false;
    }

    foreach (protected_dictionary_meta_keys() as $keys) {
        if (in_array($meta_key, $keys, true)) {
            return true;
        }
    }

    return false;
}

/**
 * Check whether a dictionary status requires complete valid fields.
 *
 * Scheduled entries must already be valid before their future
 * publication.
 *
 * @param string|false $status Post status.
 * @return bool
 */
function dictionary_status_requires_integrity($status)
{
    return in_array($status, ['publish', 'future'], true);
}

/**
 * Register dictionary protection.
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
     * Field-level ACF feedback.
     *
     * Published entries also pass complete candidate validation
     * inside validate_dictionary_meta_change().
     */
    $field_names = array_values(array_unique(array_merge(
        dictionary_value_field_names('measurement_defi'),
        dictionary_value_field_names('model_element')
    )));

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

    /*
     * Validate an ACF publication form as a complete candidate.
     * This improves feedback; it is not the only enforcement layer.
     */
    add_action(
        'acf/validate_save_post',
        static function () {
            if (!function_exists('acf_add_validation_error')) {
                return;
            }

            $post_id = dictionary_acf_post_id();

            if ($post_id <= 0) {
                return;
            }

            $post = get_post($post_id);

            if (
                !$post instanceof \WP_Post
                || !is_measurement_dictionary_type($post->post_type)
            ) {
                return;
            }

            $status = $post->post_status;

            if (
                isset($_POST['post_status'])
                && is_string($_POST['post_status'])
            ) {
                $status = wp_unslash($_POST['post_status']);
            }

            if (!dictionary_status_requires_integrity($status)) {
                return;
            }

            $title = $post->post_title;

            if (
                isset($_POST['post_title'])
                && is_string($_POST['post_title'])
            ) {
                $title = wp_unslash($_POST['post_title']);
            }

            $overrides = dictionary_submitted_field_overrides(
                $post->post_type
            );

            if (is_wp_error($overrides)) {
                acf_add_validation_error(
                    '',
                    $overrides->get_error_message()
                );
                return;
            }

            /*
             * Require complete stored fields first.
             * Do not publish a new/incomplete record while relying
             * on later ACF writes to supply missing required fields.
             */
            $stored = validate_dictionary_publication_candidate(
                (int) $post_id,
                $title
            );

            if (is_wp_error($stored)) {
                acf_add_validation_error(
                    '',
                    $stored->get_error_message()
                    . ' Сначала сохраните заполненный черновик, '
                    . 'затем повторите публикацию.'
                );
                return;
            }

            $candidate = validate_dictionary_publication_candidate(
                (int) $post_id,
                $title,
                $overrides
            );

            if (is_wp_error($candidate)) {
                acf_add_validation_error(
                    '',
                    $candidate->get_error_message()
                );
            }
        },
        20
    );

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
                 * Global deletes may have object ID zero.
                 * Check them before attempting post-type resolution.
                 */
                if (
                    $operation === 'delete'
                    && $extra
                    && is_protected_dictionary_meta_key($meta_key)
                ) {
                    dictionary_guard_notice(
                        'Массовое удаление защищённых полей '
                        . 'справочника запрещено.'
                    );
                    return false;
                }

                if ($check !== null) {
                    return $check;
                }

                if (!is_protected_dictionary_meta($post_id, $meta_key)) {
                    return null;
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
                 * WordPress already unslashes values before these
                 * add/update metadata filters.
                 */
                $result = $check_change(
                    (int) $post_id,
                    $meta_key,
                    $meta_value,
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
     * Check status and title before WordPress writes post data.
     *
     * Incoming metadata is checked here as a proposed complete state
     * and subsequently by the individual metadata guards.
     */
    add_filter(
        'wp_insert_post_data',
        static function ($data, $postarr) use (
            $model_post_types,
            $configuration_error
        ) {
            $post_type = $data['post_type'] ?? '';

            if (!is_measurement_dictionary_type($post_type)) {
                return $data;
            }

            $post_id = isset($postarr['ID'])
                ? absint($postarr['ID'])
                : 0;

            $post = $post_id > 0 ? get_post($post_id) : null;
            $new_status = $data['post_status'] ?? 'draft';

            /*
             * Creation and post-type conversion must not create an
             * immediately published dictionary entry.
             */
            if (
                !$post instanceof \WP_Post
                || $post->post_type !== $post_type
            ) {
                if (dictionary_status_requires_integrity($new_status)) {
                    $data['post_status'] = 'draft';

                    dictionary_guard_notice(
                        'Справочная запись оставлена черновиком. '
                        . 'Сначала сохраните её поля, '
                        . 'затем выполните публикацию.'
                    );
                }

                return $data;
            }

            /*
             * Do not remove a referenced published entry from the
             * dictionary by changing its status.
             */
            if (
                $post->post_status === 'publish'
                && $new_status !== 'publish'
            ) {
                $removal = $configuration_error
                    ? dictionary_guard_error(
                        'configuration_missing',
                        'Снятие с публикации отменено: '
                        . 'не настроены типы записей моделей.'
                    )
                    : dictionary_entry_may_leave_publication(
                        $post_id,
                        $model_post_types
                    );

                if (is_wp_error($removal)) {
                    $data['post_status'] = 'publish';
                    $new_status = 'publish';

                    dictionary_guard_notice(
                        $removal->get_error_message()
                    );
                }
            }

            if (!dictionary_status_requires_integrity($new_status)) {
                return $data;
            }

            /*
             * wp_insert_post_data receives slashed post data.
             */
            $title = isset($data['post_title'])
                && is_string($data['post_title'])
                ? wp_unslash($data['post_title'])
                : $post->post_title;

            $error = null;

            if ($configuration_error) {
                $error = dictionary_guard_error(
                    'configuration_missing',
                    'Публикация отменена: '
                    . 'не настроены типы записей моделей.'
                );
            }

            if ($error === null) {
                $stored = validate_dictionary_publication_candidate(
                    (int) $post_id,
                    $title
                );

                if (is_wp_error($stored)) {
                    $error = $stored;
                }
            }

            $overrides = [];

            if ($error === null) {
                $overrides = dictionary_postarr_field_overrides(
                    $post_type,
                    $postarr
                );

                if (is_wp_error($overrides)) {
                    $error = $overrides;
                }
            }

            if ($error === null) {
                $candidate = validate_dictionary_publication_candidate(
                    (int) $post_id,
                    $title,
                    $overrides
                );

                if (is_wp_error($candidate)) {
                    $error = $candidate;
                }
            }

            if ($error === null) {
                return $data;
            }

            /*
             * Reject the proposed title/status.
             *
             * Preserve an existing publication only when its old
             * stored state independently passes complete validation.
             * Individual metadata guards reject invalid field writes.
             */
            $previous = validate_dictionary_publication_candidate(
                (int) $post_id,
                $post->post_title
            );

            if (
                dictionary_status_requires_integrity($post->post_status)
                && !is_wp_error($previous)
            ) {
                $data['post_status'] = $post->post_status;
                $data['post_title'] = wp_slash($post->post_title);
            } else {
                $data['post_status'] = 'draft';
            }

            dictionary_guard_notice(
                $error->get_error_message()
                . ' Публикация или изменение опубликованной '
                . 'справочной записи отклонено. '
                . 'Проверьте сохранённые значения.'
            );

            return $data;
        },
        90,
        2
    );

    add_action(
        'admin_notices',
        __NAMESPACE__ . '\\render_dictionary_guard_notices'
    );
}

/**
 * Read submitted ACF dictionary values without writing them.
 *
 * Values are keyed by ACF field names in the returned array.
 * Other ACF fields are ignored.
 *
 * This is validation input, not an authorization mechanism.
 *
 * @param string $post_type Dictionary type.
 * @return array|\WP_Error
 */
function dictionary_submitted_field_overrides($post_type)
{
    if (!array_key_exists('acf', $_POST)) {
        return [];
    }

    if (
        !is_array($_POST['acf'])
        || !function_exists('acf_get_field')
    ) {
        return dictionary_guard_error(
            'invalid_acf_payload',
            'Некорректный формат полей ACF.'
        );
    }

    $allowed = dictionary_value_field_names($post_type);
    $overrides = [];

    foreach ($_POST['acf'] as $field_key => $value) {
        if (!is_string($field_key)) {
            return dictionary_guard_error(
                'invalid_acf_field_key',
                'Некорректный ключ поля ACF.'
            );
        }

        $field = acf_get_field($field_key);

        if (
            !is_array($field)
            || !isset($field['name'])
            || !in_array($field['name'], $allowed, true)
        ) {
            continue;
        }

        $name = $field['name'];

        if (array_key_exists($name, $overrides)) {
            return dictionary_guard_error(
                'duplicate_acf_field_name',
                'В форме повторяется поле справочника.'
            );
        }

        $overrides[$name] = wp_unslash($value);
    }

    return $overrides;
}

/**
 * Collect proposed metadata from wp_insert_post_data arguments.
 *
 * The received post array is slashed.
 * Conflicting ACF and meta_input values are rejected.
 *
 * @param string $post_type Dictionary type.
 * @param array  $postarr   Slashed post array.
 * @return array|\WP_Error
 */
function dictionary_postarr_field_overrides(
    $post_type,
    array $postarr
) {
    $overrides = [];
    $allowed = dictionary_value_field_names($post_type);

    if (array_key_exists('meta_input', $postarr)) {
        if (!is_array($postarr['meta_input'])) {
            return dictionary_guard_error(
                'invalid_meta_input',
                'Некорректный формат meta_input справочной записи.'
            );
        }

        foreach ($postarr['meta_input'] as $key => $value) {
            if (in_array($key, $allowed, true)) {
                $overrides[$key] = wp_unslash($value);
            }
        }
    }

    /*
     * Use classic-editor ACF input only for the post being edited.
     * Do not apply that form to unrelated nested post updates.
     */
    $post_id = isset($postarr['ID']) ? absint($postarr['ID']) : 0;
    $form_post_id = dictionary_acf_post_id();

    if ($post_id <= 0 || $form_post_id !== $post_id) {
        return $overrides;
    }

    $acf_values = dictionary_submitted_field_overrides($post_type);

    if (is_wp_error($acf_values)) {
        return $acf_values;
    }

    foreach ($acf_values as $key => $value) {
        if (
            array_key_exists($key, $overrides)
            && $overrides[$key] !== $value
        ) {
            return dictionary_guard_error(
                'conflicting_field_sources',
                'ACF и meta_input передают разные значения '
                . 'одного поля справочника.'
            );
        }

        $overrides[$key] = $value;
    }

    return $overrides;
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
 * Identify protected metadata on one dictionary entry.
 *
 * @param int    $post_id  Dictionary entry ID.
 * @param string $meta_key Metadata name.
 * @return bool
 */
function is_protected_dictionary_meta($post_id, $meta_key)
{
    $post_type = get_post_type($post_id);
    $keys = protected_dictionary_meta_keys();

    return isset($keys[$post_type])
        && in_array($meta_key, $keys[$post_type], true);
}

/**
 * Validate one proposed protected metadata change.
 *
 * @param int      $post_id          Dictionary entry ID.
 * @param string   $meta_key         ACF field name.
 * @param mixed    $value            Unslashed raw value.
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
            'posts_per_page'   => 1,
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

    if (
        $meta_key === 'measurement_group'
        && (
            !is_string($value)
            || !in_array(
                $value,
                ['overall', 'hull', 'rig', 'armament', 'other'],
                true
            )
        )
    ) {
        return dictionary_guard_error(
            'invalid_group',
            'Некорректная группа измерения.'
        );
    }

    if (
        $meta_key === 'measurement_target_kind'
        && (
            !is_string($value)
            || !in_array($value, ['none', 'mast', 'yard'], true)
        )
    ) {
        return dictionary_guard_error(
            'invalid_target_kind',
            'Некорректный тип измеряемого элемента.'
        );
    }

    if (
        $meta_key === 'element_kind'
        && (
            !is_string($value)
            || !in_array($value, ['mast', 'yard'], true)
        )
    ) {
        return dictionary_guard_error(
            'invalid_element_kind',
            'Некорректный тип элемента.'
        );
    }

    if (
        in_array(
            $meta_key,
            ['measurement_active', 'element_active'],
            true
        )
        && !in_array($value, [true, false, 1, 0, '1', '0'], true)
    ) {
        return dictionary_guard_error(
            'invalid_active',
            'Некорректный признак активности.'
        );
    }

    if (
        in_array(
            $meta_key,
            ['measurement_description', 'element_description'],
            true
        )
        && !is_string($value)
    ) {
        return dictionary_guard_error(
            'invalid_description',
            'Описание справочной записи должно быть текстом.'
        );
    }

    if (
        in_array(
            $meta_key,
            ['measurement_sort_order', 'element_sort_order'],
            true
        )
        && !in_array($value, ['', null, false], true)
        && (
            !is_scalar($value)
            || is_bool($value)
            || !is_numeric($value)
            || !is_finite((float) $value)
        )
    ) {
        return dictionary_guard_error(
            'invalid_sort_order',
            'Порядок отображения должен быть конечным числом.'
        );
    }

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
        $parent_result = validate_dictionary_parent_change(
            $post_id,
            $value
        );

        if (is_wp_error($parent_result)) {
            return $parent_result;
        }
    }

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

    /*
     * Preserve complete validity after each individual metadata write.
     *
     * Multi-field changes that need an invalid intermediate state
     * are intentionally not supported for published entries.
     */
    if (
        dictionary_status_requires_integrity(
            get_post_status($post_id)
        )
    ) {
        $candidate = validate_dictionary_publication_candidate(
            (int) $post_id,
            null,
            [$meta_key => $value]
        );

        if (is_wp_error($candidate)) {
            return $candidate;
        }
    }

    return true;
}

/**
 * Validate one proposed parent and its ancestor chain.
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
            dictionary_status_requires_integrity(
                get_post_status($post_id)
            )
            && get_post_status($parent_id) !== 'publish'
        ) {
            return dictionary_guard_error(
                'unpublished_parent',
                'Опубликованный или запланированный элемент '
                . 'должен ссылаться на опубликованного родителя.'
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
 * @param mixed $value Raw parent value.
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
            && preg_match('/^[1-9][0-9]*$/D', $value) === 1
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

    if ($model_post_types === []) {
        return dictionary_guard_error(
            'configuration_missing',
            'Невозможно проверить использование: '
            . 'не настроены типы записей моделей.'
        );
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
 * Resolve the current ACF post context.
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
