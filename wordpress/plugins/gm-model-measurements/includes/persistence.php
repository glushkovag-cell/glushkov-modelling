<?php
/**
 * Model measurements persistence and publication checks.
 *
 * Requires:
 * - dictionaries.php
 * - measurements.php
 * - validation.php
 *
 * The metabox submission flow targets the classic post editor.
 * REST publication receives a separate stored-data guard.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Register persistence hooks.
 *
 * Call once from the main plugin file.
 *
 * Publication checks apply to publish and future statuses.
 * Drafts may omit overall_length.
 *
 * @param string[] $post_types             Model post types.
 * @param bool     $require_overall_length Enable publication requirement.
 * @return void
 */
function register_measurements_persistence(
    array $post_types,
    $require_overall_length = false
) {
    $post_types = array_values(array_unique(array_filter(
        $post_types,
        static function ($post_type) {
            return is_string($post_type) && $post_type !== '';
        }
    )));

    if ($post_types === []) {
        return;
    }

    $require_overall_length = (bool) $require_overall_length;

    /*
     * Request-local state bridges wp_insert_post_data and save_post.
     * Nothing is persisted here.
     */
    $pending = [];
    $busy = false;

    add_filter(
        'wp_insert_post_data',
        static function ($data, $postarr) use (
            $post_types,
            $require_overall_length,
            &$pending,
            &$busy
        ) {
            if (
                $busy
                || !is_admin()
                || wp_doing_cron()
                || !in_array(
                    $data['post_type'] ?? '',
                    $post_types,
                    true
                )
            ) {
                return $data;
            }

            if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
                return $data;
            }

            $post_id = isset($postarr['ID'])
                ? absint($postarr['ID'])
                : 0;

            /*
             * The classic editor normally uses an existing auto-draft.
             * Creation through other APIs is outside this form flow.
             */
            if (
                $post_id <= 0
                || wp_is_post_revision($post_id)
                || wp_is_post_autosave($post_id)
                || !current_user_can('edit_post', $post_id)
            ) {
                return $data;
            }

            $status = $data['post_status'] ?? 'draft';
            $needs_length = $require_overall_length
                && measurement_status_requires_length($status);

            $has_payload = array_key_exists(
                'gm_measurements',
                $_POST
            );

            /*
             * An absent metabox is not a request to clear measurements.
             * Publication can still require checking stored values.
             */
            if (!$has_payload && !$needs_length) {
                return $data;
            }

            $existing = get_model_measurements($post_id);
            $payload = null;
            $submitted = false;
            $error = null;
            $proposed = null;

            if ($has_payload) {
                $nonce = isset($_POST['gm_measurements_nonce'])
                    && is_string($_POST['gm_measurements_nonce'])
                    ? wp_unslash($_POST['gm_measurements_nonce'])
                    : '';

                if (
                    !wp_verify_nonce(
                        $nonce,
                        'gm_save_model_measurements_' . $post_id
                    )
                ) {
                    $error = measurement_data_error(
                        'gm_measurements_invalid_nonce',
                        'Размеры не сохранены: проверка безопасности '
                        . 'не пройдена. Обновите страницу редактора.'
                    );
                } else {
                    $payload = wp_unslash(
                        $_POST['gm_measurements']
                    );

                    if (
                        !is_array($payload)
                        || ($payload['present'] ?? null) !== '1'
                    ) {
                        $error = measurement_data_error(
                            'gm_measurements_invalid_form_marker',
                            'Размеры не сохранены: '
                            . 'неверный формат отправленной формы.'
                        );
                    } else {
                        $submitted = true;
                    }
                }
            }

            if ($error === null && is_wp_error($existing)) {
                $error = $existing;
            }

            $dictionaries = null;

            if ($error === null) {
                $dictionaries = load_dictionaries();

                if (is_wp_error($dictionaries)) {
                    $error = $dictionaries;
                }
            }

            if ($error === null) {
                $proposed = $submitted
                    ? measurement_collection_from_form($payload)
                    : $existing;

                if (is_wp_error($proposed)) {
                    $error = $proposed;
                }
            }

            if ($error === null) {
                $proposed = validate_model_measurements(
                    $proposed,
                    $dictionaries,
                    $existing,
                    $needs_length
                );

                if (is_wp_error($proposed)) {
                    $error = $proposed;
                }
            }

            if ($error !== null) {
                /*
                 * An invalid submission must never provide the basis
                 * for publishing a model.
                 *
                 * Keep an existing published/scheduled status only
                 * when the unchanged stored collection independently
                 * satisfies the enabled publication requirement.
                 */
                if (measurement_status_requires_length($status)) {
                    $data['post_status'] =
                        measurement_failure_status(
                            $post_id,
                            $require_overall_length
                        );
                }

                $pending[$post_id] = [
                    'error'     => $error,
                    'payload'   => $submitted ? $payload : null,
                    'submitted' => false,
                ];

                return $data;
            }

            $pending[$post_id] = [
                'error'        => null,
                'payload'      => $payload,
                'submitted'    => $submitted,
                'measurements' => $proposed,
            ];

            return $data;
        },
        20,
        2
    );

    add_action(
        'save_post',
        static function ($post_id, $post, $update) use (
            $post_types,
            $require_overall_length,
            &$pending,
            &$busy
        ) {
            if (
                $busy
                || !$post instanceof \WP_Post
                || !in_array($post->post_type, $post_types, true)
                || !isset($pending[$post_id])
            ) {
                return;
            }

            $state = $pending[$post_id];
            unset($pending[$post_id]);

            if (
                wp_is_post_revision($post_id)
                || wp_is_post_autosave($post_id)
                || !current_user_can('edit_post', $post_id)
            ) {
                return;
            }

            if (is_wp_error($state['error'])) {
                store_measurement_admin_feedback(
                    $post_id,
                    $state['error'],
                    $state['payload']
                );
                return;
            }

            /*
             * No form fields means no metadata write.
             */
            if (!$state['submitted']) {
                return;
            }

            $measurements = $state['measurements'];
            $current = get_model_measurements($post_id);

            /*
             * update_post_meta() also returns false when unchanged.
             * Compare before writing and verify after writing.
             */
            if (
                !is_wp_error($current)
                && $current === $measurements
            ) {
                clear_measurement_admin_feedback($post_id);
                return;
            }

            update_post_meta(
                $post_id,
                MEASUREMENTS_META_KEY,
                wp_slash($measurements)
            );

            $stored = get_model_measurements($post_id);

            if (
                !is_wp_error($stored)
                && $stored === $measurements
            ) {
                clear_measurement_admin_feedback($post_id);
                return;
            }

            $error = measurement_data_error(
                'gm_measurements_write_failed',
                'Не удалось подтвердить сохранение размеров. '
                . 'Проверьте данные и повторите сохранение.'
            );

            /*
             * A successful post update and a metadata write are not
             * one database transaction. If writing measurements fails,
             * prevent publication without the required stored length.
             */
            if (
                $require_overall_length
                && measurement_status_requires_length(
                    get_post_status($post_id)
                )
                && !stored_measurements_allow_publication($post_id)
            ) {
                $busy = true;

                try {
                    $result = wp_update_post(
                        [
                            'ID'          => $post_id,
                            'post_status' => 'draft',
                        ],
                        true
                    );

                    if (
                        is_wp_error($result)
                        || get_post_status($post_id) !== 'draft'
                    ) {
                        $error->add(
                            'gm_measurements_status_recovery_failed',
                            'Не удалось перевести модель в черновик '
                            . 'после ошибки записи размеров. '
                            . 'Проверьте статус модели вручную.'
                        );
                    } else {
                        $error->add(
                            'gm_measurements_reverted_to_draft',
                            'Модель переведена в черновик, поскольку '
                            . 'обязательная длина не была сохранена.'
                        );
                    }
                } finally {
                    $busy = false;
                }
            }

            store_measurement_admin_feedback(
                $post_id,
                $error,
                $state['payload']
            );
        },
        20,
        3
    );

    /*
     * This is not a REST measurements write endpoint.
     * It only prevents REST publication without valid stored data
     * when the overall length requirement is enabled.
     */
    foreach ($post_types as $post_type) {
        add_filter(
            'rest_pre_insert_' . $post_type,
            static function ($prepared_post, $request) use (
                $require_overall_length
            ) {
                if (
                    !$require_overall_length
                    || is_wp_error($prepared_post)
                ) {
                    return $prepared_post;
                }

                $post_id = absint($request->get_param('id'));

                $status = isset($prepared_post->post_status)
                    ? $prepared_post->post_status
                    : ($post_id > 0
                        ? get_post_status($post_id)
                        : 'draft');

                if (!measurement_status_requires_length($status)) {
                    return $prepared_post;
                }

                if (
                    $post_id <= 0
                    || !stored_measurements_allow_publication(
                        $post_id
                    )
                ) {
                    return new \WP_Error(
                        'gm_measurements_rest_publication_blocked',
                        'Публикация недоступна: сначала сохраните '
                        . 'корректные размеры с габаритной длиной '
                        . 'в поддерживаемом редакторе модели.',
                        ['status' => 400]
                    );
                }

                return $prepared_post;
            },
            10,
            2
        );
    }

    add_action(
        'admin_notices',
        __NAMESPACE__ . '\\render_measurement_admin_feedback'
    );
}

/**
 * Convert the metabox payload into the storage contract.
 *
 * This function does not sanitize away malformed rows.
 * Structural normalization and dictionary validation follow later.
 *
 * @param array $payload Unslashed form payload.
 * @return array|\WP_Error
 */
function measurement_collection_from_form(array $payload)
{
    $allowed_keys = ['present', 'overall_length', 'rows'];

    if (array_diff(array_keys($payload), $allowed_keys) !== []) {
        return measurement_data_error(
            'gm_measurements_unknown_form_fields',
            'Форма размеров содержит неизвестные поля.'
        );
    }

    if (
        !array_key_exists('overall_length', $payload)
        || !is_array($payload['overall_length'])
    ) {
        return measurement_data_error(
            'gm_measurements_missing_overall_form',
            'В форме отсутствует блок габаритной длины.'
        );
    }

    $overall = $payload['overall_length'];

    if (
        array_diff(
            array_keys($overall),
            ['valueMm', 'note']
        ) !== []
        || !array_key_exists('valueMm', $overall)
        || !is_string($overall['valueMm'])
        || (
            array_key_exists('note', $overall)
            && !is_string($overall['note'])
        )
    ) {
        return measurement_data_error(
            'gm_measurements_invalid_overall_form',
            'Некорректный формат блока габаритной длины.'
        );
    }

    $rows = $payload['rows'] ?? [];

    if (!is_array($rows)) {
        return measurement_data_error(
            'gm_measurements_invalid_form_rows',
            'Дополнительные измерения должны быть массивом строк.'
        );
    }

    /*
     * overall_length has exactly one dedicated form location.
     * Do not allow it to be injected into additional rows.
     */
    foreach ($rows as $row) {
        if (
            is_array($row)
            && ($row['definitionCode'] ?? null) === 'overall_length'
        ) {
            return measurement_data_error(
                'gm_measurements_overall_in_additional_rows',
                'Габаритную длину указывают только '
                . 'в отдельном поле, а не в дополнительных строках.'
            );
        }
    }

    $collection = [];
    $overall_value = trim($overall['valueMm']);
    $overall_note = $overall['note'] ?? '';

    if ($overall_value !== '') {
        $collection[] = [
            'definitionCode' => 'overall_length',
            'valueMm'        => $overall_value,
            'note'           => $overall_note,
        ];
    } elseif (trim($overall_note) !== '') {
        return measurement_data_error(
            'gm_measurements_overall_note_without_value',
            'У габаритной длины есть примечание, но нет значения. '
            . 'Укажите длину или очистите примечание.'
        );
    }

    foreach ($rows as $row) {
        $collection[] = $row;
    }

    return $collection;
}

/**
 * Check whether a status represents publication or scheduled publication.
 *
 * @param string|false $status Post status.
 * @return bool
 */
function measurement_status_requires_length($status)
{
    return in_array($status, ['publish', 'future'], true);
}

/**
 * Check the actual stored collection against publication requirements.
 *
 * @param int $post_id Model post ID.
 * @return bool
 */
function stored_measurements_allow_publication($post_id)
{
    $measurements = get_model_measurements((int) $post_id);

    if (is_wp_error($measurements)) {
        return false;
    }

    $dictionaries = load_dictionaries();

    if (is_wp_error($dictionaries)) {
        return false;
    }

    $result = validate_model_measurements(
        $measurements,
        $dictionaries,
        $measurements,
        true
    );

    return !is_wp_error($result);
}

/**
 * Choose a safe status after rejecting a proposed collection.
 *
 * Previously published content is not unnecessarily unpublished if
 * its unchanged stored collection satisfies enabled requirements.
 *
 * @param int  $post_id        Existing post ID.
 * @param bool $require_length Whether length is mandatory.
 * @return string
 */
function measurement_failure_status($post_id, $require_length)
{
    $previous_status = get_post_status($post_id);

    if (measurement_status_requires_length($previous_status)) {
        if (
            !$require_length
            || stored_measurements_allow_publication($post_id)
        ) {
            return $previous_status;
        }

        return 'draft';
    }

    if (
        in_array(
            $previous_status,
            ['draft', 'pending', 'private'],
            true
        )
    ) {
        return $previous_status;
    }

    return 'draft';
}

/**
 * Build a per-user, per-post feedback key.
 *
 * @param int $post_id Model post ID.
 * @return string
 */
function measurement_admin_feedback_key($post_id)
{
    return sprintf(
        'gm_mm_feedback_%d_%d',
        get_current_user_id(),
        (int) $post_id
    );
}

/**
 * Keep errors and rejected form data across the editor redirect.
 *
 * The payload is unslashed but not normalized: preserving invalid input
 * is intentional. It must only be displayed with output escaping.
 *
 * Transients are temporary, not a durable revision mechanism.
 *
 * @param int       $post_id Model post ID.
 * @param \WP_Error $error   Validation or persistence error.
 * @param mixed     $payload Rejected payload or null.
 * @return void
 */
function store_measurement_admin_feedback(
    $post_id,
    \WP_Error $error,
    $payload = null
) {
    set_transient(
        measurement_admin_feedback_key($post_id),
        [
            'messages' => $error->get_error_messages(),
            'payload'  => $payload,
        ],
        DAY_IN_SECONDS
    );
}

/**
 * Clear rejected input after successful explicit form submission.
 *
 * @param int $post_id Model post ID.
 * @return void
 */
function clear_measurement_admin_feedback($post_id)
{
    delete_transient(
        measurement_admin_feedback_key($post_id)
    );
}

/**
 * Display errors and a copyable representation of rejected input.
 *
 * Feedback remains available on reload until a successful explicit
 * measurements submission, expiry or transient eviction.
 *
 * @return void
 */
function render_measurement_admin_feedback()
{
    $screen = get_current_screen();

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

    $feedback = get_transient(
        measurement_admin_feedback_key($post_id)
    );

    if (
        !is_array($feedback)
        || !isset($feedback['messages'])
        || !is_array($feedback['messages'])
    ) {
        return;
    }

    echo '<div class="notice notice-error">';

    echo '<p>';
    echo esc_html(
        'Изменения размеров не сохранены. '
        . 'Другие поля записи могли сохраниться; '
        . 'проверьте также статус модели.'
    );
    echo '</p>';

    echo '<ul>';

    foreach ($feedback['messages'] as $message) {
        if (is_string($message)) {
            echo '<li>' . esc_html($message) . '</li>';
        }
    }

    echo '</ul>';

    if (
        array_key_exists('payload', $feedback)
        && $feedback['payload'] !== null
    ) {
        $json = wp_json_encode(
            $feedback['payload'],
            JSON_PRETTY_PRINT
                | JSON_UNESCAPED_UNICODE
                | JSON_UNESCAPED_SLASHES
                | JSON_INVALID_UTF8_SUBSTITUTE
        );

        if (is_string($json)) {
            $field_id = 'gm-measurements-rejected-' . $post_id;

            echo '<details>';
            echo '<summary>';
            echo esc_html('Показать несохранённые данные формы');
            echo '</summary>';

            echo '<p>';
            echo esc_html(
                'Это отправленные значения, включая ошибочные. '
                . 'Метабокс ниже показывает ранее сохранённые размеры, '
                . 'а не эти данные. Скопируйте нужные значения '
                . 'перед повторным сохранением.'
            );
            echo '</p>';

            echo '<p>';
            echo '<label class="screen-reader-text" for="';
            echo esc_attr($field_id);
            echo '">';
            echo esc_html('Несохранённые данные размеров в JSON');
            echo '</label>';

            echo '<textarea readonly rows="12" class="large-text code" ';
            echo 'id="' . esc_attr($field_id) . '">';
            echo esc_textarea($json);
            echo '</textarea>';
            echo '</p>';

            echo '<p class="description">';
            echo esc_html(
                'Временная копия хранится не более суток '
                . 'и может быть удалена системой кеширования раньше. '
                . 'Это не резервная копия и не ревизия модели.'
            );
            echo '</p>';

            echo '</details>';
        }
    }

    echo '</div>';
}
