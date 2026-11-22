<?php
/**
 * Dictionary integrity and publication guards.
 *
 * Requires:
 * - dictionaries.php
 * - measurements.php
 *
 * Does not register dictionary CPTs or ACF fields.
 *
 * Supported writes:
 * - ordinary WordPress post Metadata API;
 * - ACF writes using that API;
 * - wp_insert_post()/wp_update_post().
 *
 * Policy:
 * - dictionary entries must first be saved as complete drafts;
 * - existing dictionary entries cannot change post type;
 * - protected value fields cannot be renamed or deleted individually;
 * - protected fields cannot be updated through metadata-by-ID APIs;
 * - permanent deletion of an unused entry may remove its metadata;
 * - referenced entries and overall_length cannot be removed;
 * - published/future entries must remain valid after each field write.
 *
 * Boundaries:
 * - direct SQL is outside these guards;
 * - direct wp_publish_post() is not intercepted before its status write;
 * - uniqueness checks are preflight checks, not database constraints;
 * - operations are not database transactions;
 * - trusted plugins must not override or remove these guards;
 * - key alias detection is not a complete database collation emulator.
 *
 * This file defines functions only. Register hooks through
 * register_dictionary_guards() from the plugin bootstrap.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Return protected dictionary value fields.
 *
 * ACF underscore-prefixed field-reference metadata is not included.
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
 * Normalize a key for conservative alias detection.
 *
 * This is not a replacement for checking the actual DB collation.
 *
 * @param mixed $key Metadata key.
 * @return string|null
 */
function dictionary_guard_fold_key($key)
{
    if (!is_string($key)) {
        return null;
    }

    return strtolower(rtrim(
        remove_accents($key),
        " \t\n\r\0\x0B"
    ));
}

/**
 * Resolve a protected key or an alias to its canonical spelling.
 *
 * @param mixed       $meta_key Metadata key.
 * @param string|null $post_type Optional dictionary CPT.
 * @return string|null
 */
function dictionary_guard_canonical_key(
    $meta_key,
    $post_type = null
) {
    $folded = dictionary_guard_fold_key($meta_key);

    if ($folded === null) {
        return null;
    }

    $map = protected_dictionary_meta_keys();

    if ($post_type !== null) {
        $map = isset($map[$post_type])
            ? [$post_type => $map[$post_type]]
            : [];
    }

    foreach ($map as $keys) {
        foreach ($keys as $key) {
            if ($folded === dictionary_guard_fold_key($key)) {
                return $key;
            }
        }
    }

    return null;
}

/**
 * Check a protected key without requiring a post ID.
 *
 * @param mixed $meta_key Metadata key.
 * @return bool
 */
function is_protected_dictionary_meta_key($meta_key)
{
    return dictionary_guard_canonical_key($meta_key) !== null;
}

/**
 * Identify dictionary CPTs.
 *
 * @param mixed $post_type CPT slug.
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
 * Identify protected value metadata on a dictionary post.
 *
 * Aliases are considered protected too.
 *
 * @param int   $post_id Post ID.
 * @param mixed $meta_key Metadata key.
 * @return bool
 */
function is_protected_dictionary_meta($post_id, $meta_key)
{
    return dictionary_guard_canonical_key(
        $meta_key,
        get_post_type($post_id)
    ) !== null;
}

/**
 * Statuses requiring complete dictionary fields.
 *
 * @param mixed $status Post status.
 * @return bool
 */
function dictionary_status_requires_integrity($status)
{
    return in_array($status, ['publish', 'future'], true);
}

/**
 * Build a dictionary guard error.
 *
 * @param string $code Error suffix.
 * @param string $message Message.
 * @return \WP_Error
 */
function dictionary_guard_error($code, $message)
{
    return new \WP_Error(
        'gm_dictionary_' . sanitize_key($code),
        $message
    );
}

/**
 * Track an allowed permanent deletion in the current request.
 *
 * Independent of publication-guards.php helpers.
 *
 * @param int       $post_id Post ID.
 * @param bool|null $active True to mark, false to clear, null to read.
 * @return bool
 */
function dictionary_guard_deletion_state($post_id, $active = null)
{
    static $deleting = [];

    $post_id = (int) $post_id;

    if ($active === true) {
        $deleting[$post_id] = true;
    } elseif ($active === false) {
        unset($deleting[$post_id]);
    }

    return isset($deleting[$post_id]);
}

/**
 * Read raw value fields without using ACF's value cache.
 *
 * Reject duplicate value rows and noncanonical key aliases.
 * Missing fields are represented as false for draft validation.
 *
 * @param int $post_id Dictionary post ID.
 * @return array|\WP_Error
 */
function dictionary_guard_raw_fields($post_id)
{
    $post_type = get_post_type($post_id);

    if (!is_measurement_dictionary_type($post_type)) {
        return dictionary_guard_error(
            'invalid_post',
            'Справочная запись не найдена.'
        );
    }

    $all_meta = get_post_meta($post_id);
    $fields = [];

    foreach ($all_meta as $stored_key => $values) {
        $canonical = dictionary_guard_canonical_key(
            $stored_key,
            $post_type
        );

        if ($canonical === null) {
            continue;
        }

        if ($stored_key !== $canonical) {
            return dictionary_guard_error(
                'noncanonical_stored_key',
                'У справочной записи найдено поле '
                . 'с неканоническим именем. '
                . 'Требуется отдельное исправление данных.'
            );
        }
    }

    foreach (dictionary_value_field_names($post_type) as $key) {
        $values = get_post_meta($post_id, $key, false);

        if (count($values) > 1) {
            return dictionary_guard_error(
                'duplicate_meta',
                'У справочной записи обнаружены '
                . 'дубликаты защищённого метаполя.'
            );
        }

        $fields[$key] = $values === [] ? false : $values[0];
    }

    return $fields;
}

/**
 * Validate a complete candidate using current raw value fields.
 *
 * @param int         $post_id Existing post ID.
 * @param string|null $title Proposed unslashed title.
 * @param array       $overrides Proposed unslashed field values.
 * @return array|\WP_Error
 */
function dictionary_guard_validate_candidate(
    $post_id,
    $title = null,
    array $overrides = []
) {
    $fields = dictionary_guard_raw_fields($post_id);

    if (is_wp_error($fields)) {
        return $fields;
    }

    if (array_diff(array_keys($overrides), array_keys($fields)) !== []) {
        return dictionary_guard_error(
            'unknown_override',
            'Передано неизвестное поле справочника.'
        );
    }

    return validate_dictionary_publication_candidate(
        (int) $post_id,
        $title,
        array_replace($fields, $overrides)
    );
}

/**
 * Invalidate ACF value cache after actual metadata changes.
 *
 * ACF field-reference metadata changes also invalidate the related
 * value cache. This does not change the fields or their registration.
 *
 * @param mixed $meta_ids Metadata ID or IDs.
 * @param int   $post_id Post ID.
 * @param mixed $meta_key Metadata key.
 * @param mixed $meta_value Value.
 * @return void
 */
function dictionary_guard_flush_acf_cache(
    $meta_ids,
    $post_id,
    $meta_key,
    $meta_value
) {
    if (
        !is_measurement_dictionary_type(get_post_type($post_id))
        || !function_exists('acf_flush_value_cache')
        || !is_string($meta_key)
    ) {
        return;
    }

    $candidate_key = $meta_key;

    if (
        isset($candidate_key[0])
        && $candidate_key[0] === '_'
    ) {
        $candidate_key = substr($candidate_key, 1);
    }

    $canonical = dictionary_guard_canonical_key(
        $candidate_key,
        get_post_type($post_id)
    );

    if ($canonical !== null) {
        acf_flush_value_cache((int) $post_id, $canonical);
    }
}

/**
 * Register dictionary guards once.
 *
 * @param string[] $model_post_types Actual model CPT slugs.
 * @return void
 */
function register_dictionary_guards(array $model_post_types)
{
    static $registered = false;

    if ($registered) {
        return;
    }

    $registered = true;

    $model_post_types = array_values(array_unique(array_filter(
        $model_post_types,
        static function ($post_type) {
            return is_string($post_type) && $post_type !== '';
        }
    )));

    foreach (
        ['added_post_meta', 'updated_post_meta', 'deleted_post_meta']
        as $hook
    ) {
        add_action(
            $hook,
            __NAMESPACE__ . '\\dictionary_guard_flush_acf_cache',
            1,
            4
        );
    }

    add_action(
        'before_delete_post',
        static function ($post_id) {
            if (
                is_measurement_dictionary_type(
                    get_post_type($post_id)
                )
            ) {
                dictionary_guard_deletion_state($post_id, true);
            }
        },
        1,
        1
    );

    add_action(
        'deleted_post',
        static function ($post_id) {
            dictionary_guard_deletion_state($post_id, false);
        },
        99,
        1
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
            ) use ($operation, $model_post_types) {
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

                $canonical = dictionary_guard_canonical_key(
                    $meta_key,
                    get_post_type($post_id)
                );

                if ($canonical === null) {
                    return null;
                }

                if ($meta_key !== $canonical) {
                    dictionary_guard_notice(
                        'Имя защищённого поля должно совпадать '
                        . 'с каноническим именем, включая регистр.'
                    );

                    return false;
                }

                if (
                    $operation === 'delete'
                    && dictionary_guard_deletion_state($post_id)
                ) {
                    return null;
                }

                $fields = dictionary_guard_raw_fields($post_id);

                if (is_wp_error($fields)) {
                    dictionary_guard_notice(
                        $fields->get_error_message()
                    );

                    return false;
                }

                if (
                    $operation === 'add'
                    && get_post_meta($post_id, $canonical, false) !== []
                ) {
                    dictionary_guard_notice(
                        'Защищённое поле справочника '
                        . 'может иметь только одну метазапись.'
                    );

                    return false;
                }

                $result = validate_dictionary_meta_change(
                    (int) $post_id,
                    $canonical,
                    $meta_value,
                    $operation === 'delete',
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
            100,
            5
        );
    }

    /*
     * Deliberately do not support protected value updates by meta ID.
     * This also rejects renaming another row into a protected field.
     */
    add_filter(
        'update_post_metadata_by_mid',
        static function (
            $check,
            $meta_id,
            $meta_value,
            $meta_key
        ) {
            if ($check !== null) {
                return $check;
            }

            $meta = get_metadata_by_mid('post', $meta_id);

            if (
                !is_object($meta)
                || !isset($meta->post_id, $meta->meta_key)
            ) {
                return null;
            }

            $post_type = get_post_type((int) $meta->post_id);

            if (!is_measurement_dictionary_type($post_type)) {
                return null;
            }

            $old_key = dictionary_guard_canonical_key(
                $meta->meta_key,
                $post_type
            );

            $new_key = dictionary_guard_canonical_key(
                $meta_key,
                $post_type
            );

            if ($old_key === null && $new_key === null) {
                return null;
            }

            dictionary_guard_notice(
                'Изменение или переименование защищённого поля '
                . 'через meta_id запрещено. Используйте Metadata API '
                . 'по ID справочной записи с каноническим именем поля.'
            );

            return false;
        },
        100,
        4
    );

    add_filter(
        'delete_post_metadata_by_mid',
        static function ($check, $meta_id) {
            if ($check !== null) {
                return $check;
            }

            $meta = get_metadata_by_mid('post', $meta_id);

            if (
                !is_object($meta)
                || !isset($meta->post_id, $meta->meta_key)
                || !is_protected_dictionary_meta(
                    (int) $meta->post_id,
                    $meta->meta_key
                )
            ) {
                return null;
            }

            if (
                dictionary_guard_deletion_state(
                    (int) $meta->post_id
                )
            ) {
                return null;
            }

            dictionary_guard_notice(
                'Отдельное удаление защищённого поля '
                . 'справочника через meta_id запрещено.'
            );

            return false;
        },
        100,
        2
    );

    foreach (['pre_trash_post', 'pre_delete_post'] as $hook) {
        add_filter(
            $hook,
            static function ($check, $post) use ($model_post_types) {
                if ($check !== null) {
                    return $check;
                }

                if (
                    !$post instanceof \WP_Post
                    || !is_measurement_dictionary_type(
                        $post->post_type
                    )
                ) {
                    return null;
                }

                $result = dictionary_entry_may_leave_publication(
                    (int) $post->ID,
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
            100,
            2
        );
    }

    add_filter(
        'wp_insert_post_data',
        static function ($data, $postarr) use ($model_post_types) {
            $post_id = isset($postarr['ID'])
                ? absint($postarr['ID'])
                : 0;

            $post = $post_id > 0 ? get_post($post_id) : null;
            $new_type = $data['post_type'] ?? '';

            /*
             * Inspect the OLD type before any early return.
             * Conversion of dictionary entries is a separate migration,
             * not a supported ordinary post update.
             */
            if (
                $post instanceof \WP_Post
                && is_measurement_dictionary_type($post->post_type)
                && $new_type !== $post->post_type
            ) {
                $data['post_type'] = $post->post_type;
                $data['post_status'] = $post->post_status;
                $data['post_title'] = wp_slash($post->post_title);

                dictionary_guard_notice(
                    'Смена типа справочной записи запрещена. '
                    . 'Создайте новую запись нужного типа; '
                    . 'старую можно удалить только после '
                    . 'проверки зависимостей.'
                );

                return $data;
            }

            if (!is_measurement_dictionary_type($new_type)) {
                return $data;
            }

            $new_status = $data['post_status'] ?? 'draft';

            if (
                !$post instanceof \WP_Post
                || $post->post_type !== $new_type
            ) {
                if (dictionary_status_requires_integrity($new_status)) {
                    $data['post_status'] = 'draft';

                    dictionary_guard_notice(
                        'Справочная запись оставлена черновиком. '
                        . 'Сначала сохраните заполненные поля, '
                        . 'затем повторите публикацию.'
                    );
                }

                return $data;
            }

            if (
                $post->post_status === 'publish'
                && $new_status !== 'publish'
            ) {
                $removal = dictionary_entry_may_leave_publication(
                    (int) $post->ID,
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

            $title = isset($data['post_title'])
                && is_string($data['post_title'])
                ? wp_unslash($data['post_title'])
                : $post->post_title;

            $result = $model_post_types === []
                ? dictionary_guard_error(
                    'configuration_missing',
                    'Не настроены типы записей моделей.'
                )
                : dictionary_guard_validate_candidate(
                    (int) $post->ID,
                    $title
                );

            if (!is_wp_error($result)) {
                $overrides = dictionary_postarr_field_overrides(
                    $new_type,
                    $postarr
                );

                if (is_wp_error($overrides)) {
                    $result = $overrides;
                } else {
                    foreach ($overrides as $key => $value) {
                        $field_result = validate_dictionary_meta_change(
                            (int) $post->ID,
                            $key,
                            $value,
                            false,
                            $model_post_types
                        );

                        if (is_wp_error($field_result)) {
                            $result = $field_result;
                            break;
                        }
                    }

                    if (!is_wp_error($result)) {
                        $result = dictionary_guard_validate_candidate(
                            (int) $post->ID,
                            $title,
                            $overrides
                        );
                    }
                }
            }

            if (!is_wp_error($result)) {
                return $data;
            }

            $previous = dictionary_guard_validate_candidate(
                (int) $post->ID,
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
                $result->get_error_message()
                . ' Публикация или изменение справочной записи '
                . 'отклонено. Сначала сохраните корректный черновик.'
            );

            return $data;
        },
        90,
        2
    );

    $field_names = array_values(array_unique(array_merge(
        dictionary_value_field_names('measurement_defi'),
        dictionary_value_field_names('model_element')
    )));

    foreach ($field_names as $field_name) {
        add_filter(
            'acf/validate_value/name=' . $field_name,
            static function ($valid, $value, $field, $input) use (
                $model_post_types
            ) {
                if ($valid !== true) {
                    return $valid;
                }

                $post_id = dictionary_acf_post_id();

                if ($post_id <= 0) {
                    return $valid;
                }

                $result = validate_dictionary_meta_change(
                    $post_id,
                    $field['name'],
                    $value,
                    false,
                    $model_post_types
                );

                return is_wp_error($result)
                    ? $result->get_error_message()
                    : $valid;
            },
            10,
            4
        );
    }

    add_action(
        'acf/validate_save_post',
        static function () {
            if (!function_exists('acf_add_validation_error')) {
                return;
            }

            $post_id = dictionary_acf_post_id();
            $post = $post_id > 0 ? get_post($post_id) : null;

            if (
                !$post instanceof \WP_Post
                || !is_measurement_dictionary_type($post->post_type)
            ) {
                return;
            }

            $status = isset($_POST['post_status'])
                && is_string($_POST['post_status'])
                ? wp_unslash($_POST['post_status'])
                : $post->post_status;

            if (!dictionary_status_requires_integrity($status)) {
                return;
            }

            $title = isset($_POST['post_title'])
                && is_string($_POST['post_title'])
                ? wp_unslash($_POST['post_title'])
                : $post->post_title;

            $result = dictionary_guard_validate_candidate(
                $post_id,
                $title
            );

            if (is_wp_error($result)) {
                acf_add_validation_error(
                    '',
                    $result->get_error_message()
                    . ' Сначала сохраните заполненный черновик.'
                );

                return;
            }

            $overrides = dictionary_submitted_field_overrides(
                $post->post_type
            );

            $result = is_wp_error($overrides)
                ? $overrides
                : dictionary_guard_validate_candidate(
                    $post_id,
                    $title,
                    $overrides
                );

            if (is_wp_error($result)) {
                acf_add_validation_error(
                    '',
                    $result->get_error_message()
                );
            }
        },
        20
    );

    add_action(
        'admin_notices',
        __NAMESPACE__ . '\\render_dictionary_guard_notices'
    );
}

/**
 * Validate an individual protected field change.
 *
 * Ordinary Metadata API filters receive unslashed values.
 *
 * @param int      $post_id Dictionary post ID.
 * @param string   $meta_key Field name.
 * @param mixed    $value Proposed unslashed value.
 * @param bool     $deleting Whether the field is being deleted.
 * @param string[] $model_post_types Model CPTs.
 * @return true|\WP_Error
 */
function validate_dictionary_meta_change(
    $post_id,
    $meta_key,
    $value,
    $deleting,
    array $model_post_types
) {
    $post_type = get_post_type($post_id);
    $canonical = dictionary_guard_canonical_key(
        $meta_key,
        $post_type
    );

    if ($canonical === null) {
        return true;
    }

    if ($meta_key !== $canonical) {
        return dictionary_guard_error(
            'noncanonical_key',
            'Используйте каноническое имя поля справочника.'
        );
    }

    if ($model_post_types === []) {
        return dictionary_guard_error(
            'configuration_missing',
            'Не настроены типы записей моделей.'
        );
    }

    if ($deleting) {
        return dictionary_guard_error(
            'field_deletion_forbidden',
            'Удаление отдельного защищённого поля запрещено. '
            . 'Неиспользуемую запись можно удалить целиком.'
        );
    }

    $fields = dictionary_guard_raw_fields($post_id);

    if (is_wp_error($fields)) {
        return $fields;
    }

    $is_definition = $post_type === 'measurement_defi';
    $code_key = $is_definition
        ? 'measurement_code'
        : 'element_code';

    $current_code = $fields[$code_key];

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
            'suppress_filters' => true,
        ]);

        if ($duplicates !== []) {
            return dictionary_guard_error(
                'duplicate_code',
                'Код уже занят другой справочной записью, '
                . 'включая черновики и корзину.'
            );
        }
    }

    $enums = [
        'measurement_group' => [
            'overall', 'hull', 'rig', 'armament', 'other',
        ],
        'measurement_target_kind' => ['none', 'mast', 'yard'],
        'element_kind' => ['mast', 'yard'],
    ];

    if (
        isset($enums[$meta_key])
        && (
            !is_string($value)
            || !in_array($value, $enums[$meta_key], true)
        )
    ) {
        return dictionary_guard_error(
            'invalid_enum',
            'Некорректное значение группы или типа элемента.'
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
            'Описание должно быть текстом.'
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

    if (
        $is_definition
        && (
            $current_code === 'overall_length'
            || (
                $meta_key === 'measurement_code'
                && $value === 'overall_length'
            )
        )
    ) {
        $prospective = array_replace(
            $fields,
            [$meta_key => $value]
        );

        if (
            $prospective['measurement_code'] !== 'overall_length'
            || $prospective['measurement_group'] !== 'overall'
            || $prospective['measurement_target_kind'] !== 'none'
            || !in_array(
                $prospective['measurement_active'],
                [true, 1, '1'],
                true
            )
        ) {
            return dictionary_guard_error(
                'system_definition_protected',
                'Для overall_length обязательны code=overall_length, '
                . 'group=overall, target_kind=none и active=1. '
                . 'При создании сначала сохраните остальные поля, '
                . 'затем назначьте системный код.'
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

    if (
        in_array(
            $meta_key,
            [
                'measurement_code',
                'measurement_target_kind',
                'element_code',
                'element_kind',
            ],
            true
        )
        && $fields[$meta_key] !== $value
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
                . 'Создайте новую запись.'
            );
        }
    }

    if (
        dictionary_status_requires_integrity(
            get_post_status($post_id)
        )
    ) {
        $candidate = dictionary_guard_validate_candidate(
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
 * Parse a raw optional parent ID.
 *
 * @param mixed $value Raw field value.
 * @return int|\WP_Error Zero means no parent.
 */
function dictionary_guard_parent_id($value)
{
    if (in_array($value, [false, null, '', 0, '0'], true)) {
        return 0;
    }

    if (
        !(is_int($value) && $value > 0)
        && !(
            is_string($value)
            && preg_match('/^[1-9][0-9]*$/D', $value) === 1
        )
    ) {
        return dictionary_guard_error(
            'invalid_parent',
            'Родитель должен быть одной ссылкой на элемент.'
        );
    }

    $parent_id = filter_var(
        $value,
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1]]
    );

    return $parent_id === false
        ? dictionary_guard_error(
            'invalid_parent_range',
            'ID родителя выходит за допустимый диапазон.'
        )
        : $parent_id;
}

/**
 * Validate a proposed parent against current raw ancestor links.
 *
 * Draft parents are permitted while editing drafts. Complete
 * publication validation requires published parent chains.
 *
 * @param int   $post_id Element ID.
 * @param mixed $value Proposed raw parent.
 * @return true|\WP_Error
 */
function validate_dictionary_parent_change($post_id, $value)
{
    $parent_id = dictionary_guard_parent_id($value);

    if (is_wp_error($parent_id)) {
        return $parent_id;
    }

    $visited = [(int) $post_id => true];

    while ($parent_id > 0) {
        if (isset($visited[$parent_id])) {
            return dictionary_guard_error(
                'parent_cycle',
                'Родительская связь создаёт цикл.'
            );
        }

        $visited[$parent_id] = true;
        $parent = get_post($parent_id);

        if (
            !$parent instanceof \WP_Post
            || $parent->post_type !== 'model_element'
            || in_array(
                $parent->post_status,
                ['trash', 'auto-draft'],
                true
            )
        ) {
            return dictionary_guard_error(
                'parent_not_found',
                'Родительский элемент недоступен.'
            );
        }

        $fields = dictionary_guard_raw_fields($parent_id);

        if (is_wp_error($fields)) {
            return $fields;
        }

        $parent_id = dictionary_guard_parent_id(
            $fields['element_parent']
        );

        if (is_wp_error($parent_id)) {
            return $parent_id;
        }
    }

    return true;
}

/**
 * Check child-element dependencies across all registered statuses.
 *
 * @param int $post_id Element ID.
 * @return bool
 */
function dictionary_guard_has_children($post_id)
{
    $children = get_posts([
        'post_type'        => 'model_element',
        'post_status'      => array_values(get_post_stati()),
        'posts_per_page'   => 1,
        'fields'           => 'ids',
        'post__not_in'     => [(int) $post_id],
        'meta_key'         => 'element_parent',
        'meta_value'       => (string) (int) $post_id,
        'no_found_rows'    => true,
        'suppress_filters' => true,
    ]);

    return $children !== [];
}

/**
 * Check model measurement references using stable dictionary codes.
 *
 * Includes draft, private, scheduled and trashed models.
 * Invalid stored collections cause a fail-closed result.
 *
 * No SQL LIKE search is used on serialized measurement arrays.
 *
 * @param int      $post_id Dictionary ID.
 * @param string[] $model_post_types Model CPTs.
 * @return bool|\WP_Error
 */
function dictionary_entry_is_used(
    $post_id,
    array $model_post_types
) {
    if ($model_post_types === []) {
        return dictionary_guard_error(
            'configuration_missing',
            'Нельзя проверить зависимости: не настроены CPT моделей.'
        );
    }

    $post_type = get_post_type($post_id);

    if (!is_measurement_dictionary_type($post_type)) {
        return dictionary_guard_error(
            'invalid_post',
            'Справочная запись не найдена.'
        );
    }

    if (
        $post_type === 'model_element'
        && dictionary_guard_has_children($post_id)
    ) {
        return true;
    }

    $fields = dictionary_guard_raw_fields($post_id);

    if (is_wp_error($fields)) {
        return $fields;
    }

    $code = $post_type === 'measurement_defi'
        ? $fields['measurement_code']
        : $fields['element_code'];

    if (in_array($code, [false, null, ''], true)) {
        return false;
    }

    if (!is_measurement_code($code)) {
        return dictionary_guard_error(
            'invalid_stored_code',
            'Нельзя проверить зависимости: сохранён некорректный код.'
        );
    }

    $page = 1;
    $batch_size = 100;

    do {
        $ids = get_posts([
            'post_type'        => $model_post_types,
            'post_status'      => array_values(get_post_stati()),
            'posts_per_page'   => $batch_size,
            'paged'            => $page,
            'orderby'          => 'ID',
            'order'            => 'ASC',
            'fields'           => 'ids',
            'no_found_rows'    => true,
            'suppress_filters' => true,
        ]);

        foreach ($ids as $model_id) {
            $measurements = get_model_measurements((int) $model_id);

            if (is_wp_error($measurements)) {
                return dictionary_guard_error(
                    'unreadable_model_measurements',
                    sprintf(
                        'Нельзя завершить проверку зависимостей: '
                        . 'некорректные размеры у модели %d.',
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

        $page++;
    } while (count($ids) === $batch_size);

    return false;
}

/**
 * Decide whether a dictionary entry may be unpublished or deleted.
 *
 * @param int      $post_id Dictionary ID.
 * @param string[] $model_post_types Model CPTs.
 * @return true|\WP_Error
 */
function dictionary_entry_may_leave_publication(
    $post_id,
    array $model_post_types
) {
    $fields = dictionary_guard_raw_fields($post_id);

    if (is_wp_error($fields)) {
        return $fields;
    }

    if (
        get_post_type($post_id) === 'measurement_defi'
        && $fields['measurement_code'] === 'overall_length'
    ) {
        return dictionary_guard_error(
            'system_removal_forbidden',
            'Системный вид overall_length нельзя снять '
            . 'с публикации или удалить.'
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
            'used_entry_removal_forbidden',
            'Справочная запись используется моделями '
            . 'или дочерними элементами. '
            . 'Удаление и снятие с публикации запрещены. '
            . 'При необходимости отключите её активность.'
        );
    }

    return true;
}

/**
 * Extract the post ID from a supported ACF/classic request.
 *
 * This identifies validation input only, not authorization.
 *
 * @return int
 */
function dictionary_acf_post_id()
{
    foreach (['_acf_post_id', 'post_ID', 'post_id'] as $key) {
        if (!isset($_POST[$key]) || !is_scalar($_POST[$key])) {
            continue;
        }

        $value = (string) wp_unslash($_POST[$key]);

        if (preg_match('/^[1-9][0-9]*$/D', $value) !== 1) {
            continue;
        }

        $id = filter_var(
            $value,
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 1]]
        );

        if ($id !== false) {
            return $id;
        }
    }

    return 0;
}

/**
 * Read proposed ACF fields by field key without writing them.
 *
 * @param string $post_type Dictionary CPT.
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
 * Collect protected meta_input and matching classic ACF form values.
 *
 * wp_insert_post_data receives slashed post arguments.
 *
 * @param string $post_type Dictionary CPT.
 * @param array  $postarr Slashed post arguments.
 * @return array|\WP_Error
 */
function dictionary_postarr_field_overrides(
    $post_type,
    array $postarr
) {
    $overrides = [];

    if (array_key_exists('meta_input', $postarr)) {
        if (!is_array($postarr['meta_input'])) {
            return dictionary_guard_error(
                'invalid_meta_input',
                'Некорректный формат meta_input.'
            );
        }

        foreach ($postarr['meta_input'] as $key => $value) {
            $canonical = dictionary_guard_canonical_key(
                $key,
                $post_type
            );

            if ($canonical === null) {
                continue;
            }

            if ($key !== $canonical) {
                return dictionary_guard_error(
                    'noncanonical_meta_input_key',
                    'meta_input содержит неканоническое '
                    . 'имя защищённого поля.'
                );
            }

            $overrides[$canonical] = wp_unslash($value);
        }
    }

    $post_id = isset($postarr['ID'])
        ? absint($postarr['ID'])
        : 0;

    if (
        $post_id <= 0
        || dictionary_acf_post_id() !== $post_id
    ) {
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
                . 'одного поля.'
            );
        }

        $overrides[$key] = $value;
    }

    return $overrides;
}

/**
 * Persist dictionary guard notices for the current user.
 *
 * @param string $message Notice text.
 * @return void
 */
function dictionary_guard_notice($message)
{
    $message = (string) $message;

    if ($message === '') {
        return;
    }

    error_log('[gm-model-measurements] dictionary: ' . $message);

    $user_id = get_current_user_id();

    if ($user_id <= 0) {
        return;
    }

    $key = 'gm_mm_dict_notices_' . $user_id;
    $messages = get_transient($key);

    if (!is_array($messages)) {
        $messages = [];
    }

    $messages[] = $message;
    $messages = array_values(array_unique($messages));

    set_transient(
        $key,
        $messages,
        HOUR_IN_SECONDS
    );
}

/**
 * Render dictionary notices once on a relevant post screen.
 *
 * @return void
 */
function render_dictionary_guard_notices()
{
    if (!function_exists('get_current_screen')) {
        return;
    }

    $screen = get_current_screen();
    $user_id = get_current_user_id();

    if (
        !$screen
        || $user_id <= 0
        || !in_array($screen->base, ['post', 'edit'], true)
        || !is_measurement_dictionary_type($screen->post_type)
    ) {
        return;
    }

    $key = 'gm_mm_dict_notices_' . $user_id;
    $messages = get_transient($key);

    if (!is_array($messages) || $messages === []) {
        return;
    }

    delete_transient($key);

    echo '<div class="notice notice-error">';
    echo '<p>';
    echo esc_html(
        'Некоторые операции со справочником отклонены. '
        . 'Проверьте фактически сохранённые поля и статус записи.'
    );
    echo '</p><ul>';

    foreach ($messages as $message) {
        if (is_string($message)) {
            echo '<li>' . esc_html($message) . '</li>';
        }
    }

    echo '</ul></div>';
}
