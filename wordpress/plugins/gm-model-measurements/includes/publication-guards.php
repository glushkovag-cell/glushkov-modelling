<?php
/**
 * Cross-context publication and measurement metadata guards.
 *
 * Requires:
 * - dictionaries.php
 * - measurements.php
 * - validation.php
 * - persistence.php
 * - dictionary-guards.php
 *
 * Supported publication paths:
 * - wp_insert_post()/wp_update_post();
 * - the standard publish_future_post cron callback;
 * - publish_model_with_measurements().
 *
 * Measurement metadata is guarded through:
 * - add/update/delete_post_metadata filters;
 * - update_post_metadata_by_mid and delete_post_metadata_by_mid
 *   filters for operations addressed by meta ID.
 *
 * Boundaries:
 * - direct SQL bypasses these guards;
 * - arbitrary direct wp_publish_post() calls cannot be vetoed
 *   before the status write using wp_insert_post_data;
 * - key matching covers case, trailing spaces and Latin accents, but
 *   cannot enumerate every database collation rule;
 * - other plugins must not override guard decisions or remove hooks.
 *
 * This file does not register hooks when included.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Register cross-context guards.
 *
 * Call once from the plugin bootstrap.
 *
 * @param string[] $post_types             Configured model post types.
 * @param bool     $require_overall_length Require length for publication.
 * @return void
 */
function register_measurements_publication_guards(
    array $post_types,
    $require_overall_length = false
) {
    static $registered = false;

    if ($registered) {
        return;
    }

    $post_types = array_values(array_unique(array_filter(
        $post_types,
        static function ($post_type) {
            return is_string($post_type) && $post_type !== '';
        }
    )));

    if ($post_types === []) {
        return;
    }

    $registered = true;
    $require_overall_length = (bool) $require_overall_length;

    /*
     * Register independently of is_admin(), REST, CLI or cron.
     *
     * Publication requires already stored valid measurements.
     * The form persistence handler may save measurements later,
     * but those later writes must not justify earlier publication.
     */
    add_filter(
        'wp_insert_post_data',
        static function ($data, $postarr) use (
            $post_types,
            $require_overall_length
        ) {
            if (
                !$require_overall_length
                || !in_array(
                    $data['post_type'] ?? '',
                    $post_types,
                    true
                )
                || !measurement_status_requires_length(
                    $data['post_status'] ?? ''
                )
            ) {
                return $data;
            }

            $post_id = isset($postarr['ID'])
                ? absint($postarr['ID'])
                : 0;

            $post = $post_id > 0 ? get_post($post_id) : null;

            if (
                !$post instanceof \WP_Post
                || $post->post_type !== $data['post_type']
            ) {
                $data['post_status'] = 'draft';

                report_measurement_guard_rejection(
                    $post_id,
                    measurement_data_error(
                        'gm_measurements_save_draft_before_publication',
                        'Модель оставлена черновиком. '
                        . 'Сначала сохраните её и размеры, '
                        . 'затем повторите публикацию.'
                    ),
                    'post_publication'
                );

                return $data;
            }

            $validation = validate_stored_model_for_publication(
                (int) $post_id,
                $post_types
            );

            if (!is_wp_error($validation)) {
                return $data;
            }

            /*
             * Do not retain an invalid published/future status.
             * Other existing unpublished statuses may be preserved.
             */
            $data['post_status'] = in_array(
                $post->post_status,
                ['draft', 'pending', 'private'],
                true
            )
                ? $post->post_status
                : 'draft';

            report_measurement_guard_rejection(
                $post_id,
                $validation,
                'post_publication'
            );

            return $data;
        },
        100,
        2
    );

    /*
     * Permanent deletion removes metadata through the by-ID API.
     * Mark the post before core begins that cleanup, otherwise the
     * by-ID delete guard would block legitimate post deletion.
     */
    add_action(
        'before_delete_post',
        static function ($post_id) {
            track_measurements_post_deletion($post_id, true);
        },
        1,
        1
    );

    add_action(
        'deleted_post',
        static function ($post_id) {
            track_measurements_post_deletion($post_id, false);
        },
        99,
        1
    );

    /*
     * Guard ordinary metadata operations.
     *
     * Values reaching add/update filters have already been
     * unslashed by WordPress.
     */
    foreach (['add', 'update', 'delete'] as $operation) {
        add_filter(
            $operation . '_post_metadata',
            static function (
                $check,
                $post_id,
                $meta_key,
                $meta_value,
                $extra
            ) use (
                $operation,
                $post_types,
                $require_overall_length
            ) {
                if (!is_measurements_meta_key_variant($meta_key)) {
                    return $check;
                }

                /*
                 * A global delete has no individual post context.
                 * Refuse it before attempting to resolve the post.
                 */
                if ($operation === 'delete' && $extra) {
                    report_measurement_guard_rejection(
                        0,
                        measurement_data_error(
                            'gm_measurements_global_delete_forbidden',
                            'Массовое удаление метаполя размеров '
                            . 'запрещено. Изменяйте модели по отдельности.'
                        ),
                        'metadata_delete'
                    );

                    return false;
                }

                if ($check !== null) {
                    return $check;
                }

                $post = get_post($post_id);

                if (
                    !$post instanceof \WP_Post
                    || !in_array($post->post_type, $post_types, true)
                ) {
                    return null;
                }

                if ($meta_key !== MEASUREMENTS_META_KEY) {
                    report_measurement_guard_rejection(
                        (int) $post->ID,
                        measurement_data_error(
                            'gm_measurements_noncanonical_meta_key',
                            'Имя метаполя размеров должно совпадать '
                            . 'с каноническим ключом, включая регистр.'
                        ),
                        'metadata_' . $operation
                    );

                    return false;
                }

                $result = check_measurements_metadata_operation(
                    $post,
                    $operation,
                    $meta_value,
                    $require_overall_length
                );

                if (is_wp_error($result)) {
                    report_measurement_guard_rejection(
                        (int) $post->ID,
                        $result,
                        'metadata_' . $operation
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
     * Guard updates addressed by meta ID.
     *
     * This path can change both the value and the key. It does not
     * call update_post_metadata. Its value is already unslashed.
     */
    add_filter(
        'update_post_metadata_by_mid',
        static function (
            $check,
            $meta_id,
            $meta_value,
            $meta_key
        ) use (
            $post_types,
            $require_overall_length
        ) {
            if ($check !== null) {
                return $check;
            }

            $meta = get_metadata_by_mid('post', $meta_id);

            if (!is_object($meta) || !isset($meta->post_id)) {
                return null;
            }

            $existing_is_target = is_measurements_meta_key_variant(
                $meta->meta_key
            );
            $new_is_target = is_measurements_meta_key_variant($meta_key);

            if (!$existing_is_target && !$new_is_target) {
                return null;
            }

            $post = get_post((int) $meta->post_id);

            if (
                !$post instanceof \WP_Post
                || !in_array($post->post_type, $post_types, true)
            ) {
                return null;
            }

            $error = null;

            if (!$existing_is_target) {
                $error = measurement_data_error(
                    'gm_measurements_rename_into_forbidden',
                    'Нельзя превратить другую метазапись в набор '
                    . 'размеров. Используйте нормализованную запись '
                    . 'через Metadata API по ID модели.'
                );
            } elseif ($meta->meta_key !== MEASUREMENTS_META_KEY) {
                $error = measurement_data_error(
                    'gm_measurements_noncanonical_stored_key',
                    'Найдено метаполе размеров с неканоническим '
                    . 'ключом. Требуется отдельное исправление данных.'
                );
            } elseif (
                $meta_key !== false
                && $meta_key !== MEASUREMENTS_META_KEY
            ) {
                $error = measurement_data_error(
                    'gm_measurements_rename_forbidden',
                    'Нельзя переименовать метаполе размеров. '
                    . 'Для удаления используйте явную операцию '
                    . 'удаления.'
                );
            } else {
                $result = check_measurements_metadata_operation(
                    $post,
                    'update',
                    $meta_value,
                    $require_overall_length
                );

                if (is_wp_error($result)) {
                    $error = $result;
                }
            }

            if ($error !== null) {
                report_measurement_guard_rejection(
                    (int) $post->ID,
                    $error,
                    'metadata_update_by_mid'
                );

                return false;
            }

            return null;
        },
        100,
        4
    );

    /*
     * Guard deletion addressed by meta ID.
     *
     * Permanent deletion of the whole post is allowed through the
     * request-local marker set on before_delete_post.
     */
    add_filter(
        'delete_post_metadata_by_mid',
        static function ($check, $meta_id) use (
            $post_types,
            $require_overall_length
        ) {
            if ($check !== null) {
                return $check;
            }

            $meta = get_metadata_by_mid('post', $meta_id);

            if (
                !is_object($meta)
                || !isset($meta->post_id)
                || !is_measurements_meta_key_variant($meta->meta_key)
            ) {
                return null;
            }

            $post_id = (int) $meta->post_id;

            if (track_measurements_post_deletion($post_id)) {
                return null;
            }

            $post = get_post($post_id);

            if (
                !$post instanceof \WP_Post
                || !in_array($post->post_type, $post_types, true)
            ) {
                return null;
            }

            $result = check_measurements_metadata_operation(
                $post,
                'delete',
                null,
                $require_overall_length
            );

            if (is_wp_error($result)) {
                report_measurement_guard_rejection(
                    $post_id,
                    $result,
                    'metadata_delete_by_mid'
                );

                return false;
            }

            return null;
        },
        100,
        2
    );

    add_action(
        'admin_notices',
        __NAMESPACE__ . '\\render_measurement_publication_notice'
    );

    register_measurements_future_publication_guard(
        $post_types,
        $require_overall_length
    );
}

/**
 * Match the protected measurements key independently of simple
 * database collation differences.
 *
 * Case, trailing spaces and Latin accents are ignored. This does not
 * enumerate every collation rule; verify the postmeta collation
 * during acceptance testing.
 *
 * @param mixed $meta_key Metadata key.
 * @return bool
 */
function is_measurements_meta_key_variant($meta_key)
{
    if (!is_string($meta_key)) {
        return false;
    }

    $normalized = rtrim(remove_accents($meta_key), " \t\n\r\0\x0B");

    return strcasecmp($normalized, MEASUREMENTS_META_KEY) === 0;
}

/**
 * Track posts that are being permanently deleted in this request.
 *
 * @param int       $post_id Post ID.
 * @param bool|null $active  True to mark, false to clear, null to read.
 * @return bool
 */
function track_measurements_post_deletion($post_id, $active = null)
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
 * Validate one operation on the stored measurements of a model.
 *
 * @param \WP_Post $post                  Model post.
 * @param string   $operation             add, update or delete.
 * @param mixed    $meta_value            Unslashed proposed value.
 * @param bool     $require_overall_length Whether length is mandatory.
 * @return true|\WP_Error
 */
function check_measurements_metadata_operation(
    \WP_Post $post,
    $operation,
    $meta_value,
    $require_overall_length
) {
    $existing_values = get_post_meta(
        $post->ID,
        MEASUREMENTS_META_KEY,
        false
    );

    if (count($existing_values) > 1) {
        return measurement_data_error(
            'gm_measurements_multiple_meta_values',
            'Обнаружено несколько наборов размеров. '
            . 'Операция отменена; требуется отдельное '
            . 'исправление данных.'
        );
    }

    if ($operation === 'add' && $existing_values !== []) {
        return measurement_data_error(
            'gm_measurements_duplicate_meta_forbidden',
            'У модели может быть только одна '
            . 'метазапись с набором размеров.'
        );
    }

    $needs_length = $require_overall_length
        && measurement_status_requires_length($post->post_status);

    /*
     * Removing metadata from an unpublished model is an explicit
     * deletion. Published and scheduled models must retain length
     * when publication requirements are enabled.
     */
    if ($operation === 'delete') {
        if ($needs_length) {
            return measurement_data_error(
                'gm_measurements_required_meta_deletion',
                'Нельзя удалить набор размеров '
                . 'опубликованной или запланированной '
                . 'модели при обязательной длине. '
                . 'Сначала переведите модель в черновик.'
            );
        }

        return true;
    }

    $existing = $existing_values === []
        ? []
        : normalize_measurements($existing_values[0]);

    if (is_wp_error($existing)) {
        return $existing;
    }

    $dictionaries = load_dictionaries();

    if (is_wp_error($dictionaries)) {
        return $dictionaries;
    }

    $validated = validate_model_measurements(
        $meta_value,
        $dictionaries,
        $existing,
        $needs_length
    );

    if (is_wp_error($validated)) {
        return $validated;
    }

    /*
     * Metadata filters cannot replace the value core will write.
     * Require canonical input so validation and storage cannot
     * silently diverge. Callers normalize first, then pass
     * wp_slash($normalized) to the ordinary Metadata API.
     */
    if ($validated !== $meta_value) {
        return measurement_data_error(
            'gm_measurements_noncanonical_metadata',
            'Размеры не записаны: Metadata API должен '
            . 'получать нормализованный набор. '
            . 'Сначала выполните normalize_measurements(), '
            . 'затем передайте wp_slash($normalized).'
        );
    }

    return true;
}

/**
 * Validate actual stored model measurements for publication.
 *
 * @param int      $post_id    Existing model ID.
 * @param string[] $post_types Allowed model post types.
 * @return array|\WP_Error Normalized measurements or error.
 */
function validate_stored_model_for_publication(
    $post_id,
    array $post_types
) {
    if (!is_int($post_id) || $post_id <= 0) {
        return measurement_data_error(
            'gm_measurements_invalid_publication_id',
            'Для публикации требуется ID существующей модели.'
        );
    }

    $post = get_post($post_id);

    if (
        !$post instanceof \WP_Post
        || !in_array($post->post_type, $post_types, true)
    ) {
        return measurement_data_error(
            'gm_measurements_invalid_publication_post',
            'Модель не найдена или её CPT не настроен '
            . 'для модуля размеров.'
        );
    }

    $measurements = get_model_measurements($post_id);

    if (is_wp_error($measurements)) {
        return $measurements;
    }

    $dictionaries = load_dictionaries();

    if (is_wp_error($dictionaries)) {
        return $dictionaries;
    }

    return validate_model_measurements(
        $measurements,
        $dictionaries,
        $measurements,
        true
    );
}

/**
 * Guard the standard scheduled-publication callback.
 *
 * The wrapper preserves the core callback for unrelated post types.
 * Core still handles posts whose scheduled date has not arrived.
 *
 * Dictionary candidates are checked as well, including when the
 * model length requirement is disabled.
 *
 * @param string[] $post_types             Model post types.
 * @param bool     $require_overall_length Require model length.
 * @return void
 */
function register_measurements_future_publication_guard(
    array $post_types,
    $require_overall_length
) {
    $core_callback = 'check_and_publish_future_post';
    $priority = has_action('publish_future_post', $core_callback);

    /*
     * Do not invent a replacement publication mechanism if another
     * component has already removed the standard callback.
     */
    if ($priority === false) {
        register_measurements_bootstrap_notice(
            'Модуль размеров: стандартный обработчик '
            . 'отложенной публикации отсутствует. '
            . 'Другой механизм фоновой публикации '
            . 'нужно проверить отдельно.',
            'warning'
        );

        return;
    }

    $removed = remove_action(
        'publish_future_post',
        $core_callback,
        $priority
    );

    if (!$removed) {
        register_measurements_bootstrap_notice(
            'Модуль размеров: не удалось установить проверку '
            . 'стандартной отложенной публикации.',
            'error'
        );

        return;
    }

    add_action(
        'publish_future_post',
        static function ($post_id) use (
            $post_types,
            $require_overall_length,
            $core_callback
        ) {
            $post = get_post($post_id);

            if (
                !$post instanceof \WP_Post
                || $post->post_status !== 'future'
            ) {
                return;
            }

            /*
             * Preserve core rescheduling behavior before the due time.
             * No publication happens in that branch of the core callback.
             */
            $scheduled_time = strtotime(
                $post->post_date_gmt . ' GMT'
            );

            if (
                $scheduled_time !== false
                && $scheduled_time > time()
            ) {
                call_user_func($core_callback, $post->ID);
                return;
            }

            $error = null;

            if (
                $require_overall_length
                && in_array($post->post_type, $post_types, true)
            ) {
                $result = validate_stored_model_for_publication(
                    (int) $post->ID,
                    $post_types
                );

                if (is_wp_error($result)) {
                    $error = $result;
                }
            } elseif (
                is_measurement_dictionary_type($post->post_type)
            ) {
                $result = validate_dictionary_publication_candidate(
                    (int) $post->ID
                );

                if (is_wp_error($result)) {
                    $error = $result;
                }
            }

            if ($error !== null) {
                /*
                 * Do not call the publishing callback.
                 *
                 * The post stays scheduled for diagnosis. This event
                 * is not retried automatically: after correcting the
                 * data, schedule the publication again.
                 */
                report_measurement_guard_rejection(
                    $post->ID,
                    $error,
                    'scheduled_publication'
                );

                return;
            }

            call_user_func($core_callback, $post->ID);
        },
        $priority,
        1
    );
}

/**
 * Publish a model through an explicit checked application API.
 *
 * This helper always requires valid stored overall_length, even when
 * the installation is still in preparation mode.
 *
 * This is not a REST endpoint. Authorization remains the caller's
 * responsibility; background jobs do not have an interactive user.
 *
 * A future post_date may cause WordPress to retain/switch to future.
 * The helper verifies the resulting status and reports that outcome
 * instead of claiming an immediate publication succeeded.
 *
 * @param int $post_id Existing model ID.
 * @return int|\WP_Error Published model ID or error.
 */
function publish_model_with_measurements($post_id)
{
    $post_id = absint($post_id);

    $configuration = get_measurements_plugin_configuration();

    if (is_wp_error($configuration)) {
        return $configuration;
    }

    $validated = validate_stored_model_for_publication(
        $post_id,
        $configuration['postTypes']
    );

    if (is_wp_error($validated)) {
        return $validated;
    }

    $result = wp_update_post(
        [
            'ID'          => $post_id,
            'post_status' => 'publish',
        ],
        true
    );

    if (is_wp_error($result)) {
        return $result;
    }

    if (!$result || get_post_status($post_id) !== 'publish') {
        return measurement_data_error(
            'gm_measurements_publication_not_confirmed',
            'Публикация модели не подтверждена. '
            . 'Проверьте её фактический статус и дату публикации.',
            [
                'postId' => $post_id,
                'status' => get_post_status($post_id),
            ]
        );
    }

    return (int) $result;
}

/**
 * Build a per-user, per-post publication notice key.
 *
 * @param int $post_id Model post ID.
 * @return string
 */
function measurement_publication_notice_key($post_id)
{
    return sprintf(
        'gm_mm_pubnotice_%d_%d',
        get_current_user_id(),
        (int) $post_id
    );
}

/**
 * Keep a publication rejection separate from form feedback.
 *
 * A later successful measurements save must not erase the reason
 * why publication was refused.
 *
 * @param int       $post_id Model post ID.
 * @param \WP_Error $error   Rejection reason.
 * @return void
 */
function store_measurement_publication_notice(
    $post_id,
    \WP_Error $error
) {
    if ((int) $post_id <= 0 || get_current_user_id() <= 0) {
        return;
    }

    $key = measurement_publication_notice_key($post_id);
    $messages = get_transient($key);

    if (!is_array($messages)) {
        $messages = [];
    }

    $messages = array_values(array_unique(array_merge(
        $messages,
        $error->get_error_messages()
    )));

    set_transient($key, $messages, HOUR_IN_SECONDS);
}

/**
 * Display and clear the publication rejection notice once.
 *
 * @return void
 */
function render_measurement_publication_notice()
{
    $screen = function_exists('get_current_screen')
        ? get_current_screen()
        : null;

    if (!$screen || $screen->base !== 'post') {
        return;
    }

    $post_id = isset($_GET['post']) && is_scalar($_GET['post'])
        ? absint($_GET['post'])
        : 0;

    if (
        $post_id <= 0
        || !current_user_can('edit_post', $post_id)
    ) {
        return;
    }

    $key = measurement_publication_notice_key($post_id);
    $messages = get_transient($key);

    if (!is_array($messages) || $messages === []) {
        return;
    }

    delete_transient($key);

    echo '<div class="notice notice-warning"><p>';
    echo esc_html('Публикация отклонена. Статус модели не изменён на опубликованный.');
    echo '</p><ul>';

    foreach ($messages as $message) {
        if (is_string($message)) {
            echo '<li>' . esc_html($message) . '</li>';
        }
    }

    echo '</ul></div>';
}

/**
 * Report a rejected guard operation.
 *
 * Logged data excludes measurement values and notes.
 * The application action lets trusted integrations collect errors.
 *
 * @param int       $post_id Existing post ID or zero.
 * @param \WP_Error $error   Rejection reason.
 * @param string    $context Operation context.
 * @return void
 */
function report_measurement_guard_rejection(
    $post_id,
    \WP_Error $error,
    $context
) {
    $post_id = (int) $post_id;

    if ($post_id > 0 && get_current_user_id() > 0) {
        $post = get_post($post_id);

        if (
            $post instanceof \WP_Post
            && is_measurement_dictionary_type($post->post_type)
        ) {
            dictionary_guard_notice(
                $error->get_error_message()
            );
        } elseif (
            in_array(
                $context,
                ['post_publication', 'scheduled_publication'],
                true
            )
        ) {
            store_measurement_publication_notice($post_id, $error);
        } else {
            /*
             * Do not overwrite rejected form payload already retained
             * by the classic persistence handler.
             */
            $key = measurement_admin_feedback_key($post_id);
            $feedback = get_transient($key);

            if (
                is_array($feedback)
                && isset($feedback['messages'])
                && is_array($feedback['messages'])
            ) {
                $feedback['messages'] = array_values(array_unique(
                    array_merge(
                        $feedback['messages'],
                        $error->get_error_messages()
                    )
                ));

                set_transient($key, $feedback, DAY_IN_SECONDS);
            } else {
                store_measurement_admin_feedback(
                    $post_id,
                    $error
                );
            }
        }
    } elseif ($post_id === 0 && get_current_user_id() > 0) {
        register_measurements_bootstrap_notice(
            $error->get_error_message()
        );
    }

    error_log(sprintf(
        '[gm-model-measurements] context=%s post_id=%d code=%s',
        sanitize_key($context),
        $post_id,
        sanitize_key((string) $error->get_error_code())
    ));

    do_action(
        'gm_model_measurements_guard_rejected',
        $post_id,
        $error,
        $context
    );
}
