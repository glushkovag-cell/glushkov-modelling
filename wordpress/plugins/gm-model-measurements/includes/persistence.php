<?php
/**
 * Model measurements persistence and administration feedback.
 *
 * Requires:
 * - dictionaries.php
 * - measurements.php
 * - validation.php
 *
 * The metabox submission flow targets the classic post editor.
 * Cross-context guards are registered by publication-guards.php.
 *
 * For a validated form targeting publish/future with mandatory length,
 * measurements are written and read back before the later publication
 * guard checks stored metadata.
 *
 * Other form submissions write measurements from save_post.
 *
 * Post and metadata writes are not a transaction. A successful early
 * metadata write is not rolled back if the subsequent post write fails.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Register persistence hooks once.
 *
 * @param string[] $post_types Configured model CPTs.
 * @param bool     $require_overall_length Enable length requirement.
 * @return void
 */
function register_measurements_persistence(
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

            if (
                $post_id <= 0
                || wp_is_post_revision($post_id)
                || wp_is_post_autosave($post_id)
                || !current_user_can('edit_post', $post_id)
            ) {
                return $data;
            }

            $post = get_post($post_id);

            if (
                !$post instanceof \WP_Post
                || $post->post_type !== $data['post_type']
            ) {
                return $data;
            }

            $status = $data['post_status'] ?? 'draft';
            $needs_length = $require_overall_length
                && measurement_status_requires_length($status);

            /*
             * Bind the metabox to its own model, including during
             * nested updates made by other components.
             */
            $has_payload = array_key_exists(
                'gm_measurements',
                $_POST
            ) && measurement_submitted_post_id() === $post_id;

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
                    $payload = wp_unslash($_POST['gm_measurements']);

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

                        $integrity =
                            validate_measurement_form_integrity($payload);

                        if (is_wp_error($integrity)) {
                            $error = $integrity;
                        }
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

            /*
             * The publication guard runs later, at priority 100.
             * It deliberately checks stored metadata only.
             *
             * Persist a fully validated publication payload now so
             * that the guard sees the current collection.
             *
             * No guard is disabled and no request payload is treated
             * as proof that a database write succeeded.
             */
            if (
                $error === null
                && $submitted
                && $needs_length
            ) {
                $busy = true;

                try {
                    $write_result =
                        persist_and_confirm_model_measurements(
                            $post_id,
                            $proposed
                        );

                    if (is_wp_error($write_result)) {
                        $error = $write_result;
                    } elseif (
                        !stored_measurements_allow_publication($post_id)
                    ) {
                        $error = measurement_data_error(
                            'gm_measurements_publication_readback_failed',
                            'Размеры записаны, но проверка сохранённого '
                            . 'набора для публикации не пройдена. '
                            . 'Проверьте размеры и статус модели.'
                        );
                    }
                } finally {
                    $busy = false;
                }
            }

            if ($error !== null) {
                if (measurement_status_requires_length($status)) {
                    $data['post_status'] = measurement_failure_status(
                        $post_id,
                        $require_overall_length
                    );
                }

                $pending[$post_id] = [
                    'error'     => $error,
                    'payload'   => $submitted ? $payload : null,
                    'submitted' => false,
                ];

                /*
                 * Report immediately as well: the subsequent post
                 * write may fail before save_post is reached.
                 */
                store_measurement_admin_feedback(
                    $post_id,
                    $error,
                    $submitted ? $payload : null
                );

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
             * A request without a submitted metabox must not write
             * or clear measurements.
             */
            if (!$state['submitted']) {
                return;
            }

            /*
             * Publication submissions normally match the early write.
             * Draft submissions are written here.
             *
             * Re-read even after an early write: another callback may
             * have changed metadata in the meantime.
             */
            $busy = true;

            try {
                $result = persist_and_confirm_model_measurements(
                    $post_id,
                    $state['measurements']
                );

                if (!is_wp_error($result)) {
                    clear_measurement_admin_feedback($post_id);
                    return;
                }

                $error = $result;

                if (
                    $require_overall_length
                    && measurement_status_requires_length(
                        get_post_status($post_id)
                    )
                    && !stored_measurements_allow_publication($post_id)
                ) {
                    $recovery = wp_update_post(
                        [
                            'ID'          => $post_id,
                            'post_status' => 'draft',
                        ],
                        true
                    );

                    if (
                        is_wp_error($recovery)
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
                            . 'обязательные размеры не подтверждены.'
                        );
                    }
                }

                store_measurement_admin_feedback(
                    $post_id,
                    $error,
                    $state['payload']
                );
            } finally {
                $busy = false;
            }
        },
        20,
        3
    );

    foreach ($post_types as $post_type) {
        add_filter(
            'rest_pre_insert_' . $post_type,
            static function ($prepared_post, $request) use (
                $require_overall_length,
                $post_type
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

                $post = $post_id > 0 ? get_post($post_id) : null;

                if (
                    !$post instanceof \WP_Post
                    || $post->post_type !== $post_type
                    || !stored_measurements_allow_publication($post_id)
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
 * Write an already validated canonical collection and confirm storage.
 *
 * Uses the ordinary Metadata API; publication and metadata guards
 * remain active. A false update_post_meta() result alone is not enough
 * to identify failure because it also means "unchanged".
 *
 * @param int   $post_id Model ID.
 * @param array $measurements Validated canonical collection.
 * @return true|\WP_Error
 */
function persist_and_confirm_model_measurements(
    $post_id,
    array $measurements
) {
    $post_id = (int) $post_id;
    $current = get_model_measurements($post_id);

    if (
        !is_wp_error($current)
        && $current === $measurements
    ) {
        return true;
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
        return true;
    }

    $error = measurement_data_error(
        'gm_measurements_write_failed',
        'Не удалось подтвердить сохранение размеров. '
        . 'Проверьте данные и повторите сохранение.'
    );

    if (is_wp_error($stored)) {
        foreach ($stored->get_error_messages() as $message) {
            $error->add(
                'gm_measurements_readback_error',
                $message
            );
        }
    }

    return $error;
}

/**
 * Identify the classic editor's submitted model.
 *
 * This identifies a form; it does not authorize a write.
 *
 * @return int
 */
function measurement_submitted_post_id()
{
    if (
        !isset($_POST['post_ID'])
        || !is_string($_POST['post_ID'])
    ) {
        return 0;
    }

    $value = wp_unslash($_POST['post_ID']);

    if (preg_match('/^[1-9][0-9]*$/D', $value) !== 1) {
        return 0;
    }

    $post_id = filter_var(
        $value,
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 1]]
    );

    return $post_id === false ? 0 : $post_id;
}

/**
 * Validate measurement form completeness.
 *
 * @param array $payload Unslashed form payload.
 * @return true|\WP_Error
 */
function validate_measurement_form_integrity(array $payload)
{
    if (($payload['present'] ?? null) !== '1') {
        return measurement_data_error(
            'gm_measurements_invalid_form_marker',
            'Размеры не сохранены: '
            . 'неверный маркер присутствия формы.'
        );
    }

    if (($payload['complete'] ?? null) !== '1') {
        return measurement_data_error(
            'gm_measurements_incomplete_form',
            'Размеры не сохранены: форма получена не полностью '
            . 'или была открыта до обновления модуля. '
            . 'Сохранённые размеры оставлены без изменений. '
            . 'Скопируйте доступный несохранённый ввод, '
            . 'затем обновите страницу редактора.'
        );
    }

    if (
        !array_key_exists('expected_rows', $payload)
        || !is_string($payload['expected_rows'])
        || preg_match(
            '/^(?:0|[1-9][0-9]*)$/D',
            $payload['expected_rows']
        ) !== 1
    ) {
        return measurement_data_error(
            'gm_measurements_invalid_expected_rows',
            'Размеры не сохранены: '
            . 'отсутствует корректный счётчик строк формы.'
        );
    }

    $expected_rows = filter_var(
        $payload['expected_rows'],
        FILTER_VALIDATE_INT,
        ['options' => ['min_range' => 0]]
    );

    if ($expected_rows === false) {
        return measurement_data_error(
            'gm_measurements_expected_rows_out_of_range',
            'Размеры не сохранены: '
            . 'счётчик строк выходит за допустимый диапазон.'
        );
    }

    if (array_key_exists('rows', $payload)) {
        if (!is_array($payload['rows'])) {
            return measurement_data_error(
                'gm_measurements_invalid_form_rows',
                'Дополнительные измерения должны быть массивом строк.'
            );
        }

        $actual_rows = count($payload['rows']);
    } else {
        $actual_rows = 0;
    }

    if ($actual_rows !== $expected_rows) {
        return measurement_data_error(
            'gm_measurements_form_row_count_mismatch',
            sprintf(
                'Размеры не сохранены: ожидалось строк — %d, '
                . 'получено — %d. Форма могла быть усечена. '
                . 'Сохранённые размеры оставлены без изменений.',
                $expected_rows,
                $actual_rows
            ),
            [
                'expectedRows' => $expected_rows,
                'actualRows'   => $actual_rows,
            ]
        );
    }

    return true;
}

/**
 * Convert the metabox payload into the measurements contract.
 *
 * @param array $payload Unslashed form payload.
 * @return array|\WP_Error
 */
function measurement_collection_from_form(array $payload)
{
    $integrity = validate_measurement_form_integrity($payload);

    if (is_wp_error($integrity)) {
        return $integrity;
    }

    $allowed_keys = [
        'present',
        'overall_length',
        'rows',
        'expected_rows',
        'complete',
    ];

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

    $rows = array_key_exists('rows', $payload)
        ? $payload['rows']
        : [];

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
 * @param string|false $status Post status.
 * @return bool
 */
function measurement_status_requires_length($status)
{
    return in_array($status, ['publish', 'future'], true);
}

/**
 * Check stored measurements against publication requirements.
 *
 * @param int $post_id Model ID.
 * @return bool
 */
function stored_measurements_allow_publication($post_id)
{
    $post_id = (int) $post_id;

    if ($post_id <= 0 || !get_post($post_id)) {
        return false;
    }

    $measurements = get_model_measurements($post_id);

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
 * Choose a safe status after rejecting proposed measurements.
 *
 * Existing publication is retained when its unchanged stored
 * measurements satisfy the enabled publication requirement.
 *
 * @param int  $post_id Model ID.
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
 * @param int $post_id Model ID.
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
 * Preserve errors and rejected form input across redirects.
 *
 * @param int       $post_id Model ID.
 * @param \WP_Error $error Validation or persistence error.
 * @param mixed     $payload Rejected payload or null.
 * @return void
 */
function store_measurement_admin_feedback(
    $post_id,
    \WP_Error $error,
    $payload = null
) {
    $post_id = (int) $post_id;

    if ($post_id <= 0 || get_current_user_id() <= 0) {
        return;
    }

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
 * Clear form feedback, but not separate publication notices.
 *
 * @param int $post_id Model ID.
 * @return void
 */
function clear_measurement_admin_feedback($post_id)
{
    $post_id = (int) $post_id;

    if ($post_id <= 0 || get_current_user_id() <= 0) {
        return;
    }

    delete_transient(
        measurement_admin_feedback_key($post_id)
    );
}

/**
 * Display errors and copyable rejected form input.
 *
 * @return void
 */
function render_measurement_admin_feedback()
{
    if (!function_exists('get_current_screen')) {
        return;
    }

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
        'Обнаружена ошибка проверки или сохранения размеров. '
        . 'Другие поля записи могли сохраниться; '
        . 'проверьте сохранённые размеры и статус модели.'
    );
    echo '</p><ul>';

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

            echo '<details><summary>';
            echo esc_html('Показать отправленные данные формы');
            echo '</summary><p>';
            echo esc_html(
                'Это полученные сервером значения, включая ошибочные. '
                . 'При усечении формы здесь может быть только часть '
                . 'отправленного ввода. Метабокс ниже показывает '
                . 'сохранённые размеры. Скопируйте нужные значения '
                . 'перед повторным сохранением.'
            );
            echo '</p><p>';

            echo '<label class="screen-reader-text" for="';
            echo esc_attr($field_id);
            echo '">';
            echo esc_html('Отправленные данные размеров в JSON');
            echo '</label>';

            echo '<textarea readonly rows="12" class="large-text code" ';
            echo 'id="' . esc_attr($field_id) . '">';
            echo esc_textarea($json);
            echo '</textarea></p>';

            echo '<p class="description">';
            echo esc_html(
                'JSON приведён только для восстановления ввода. '
                . 'Исправляйте размеры в полях метабокса, '
                . 'а не в этом текстовом поле.'
            );
            echo '</p></details>';
        }
    }

    echo '</div>';
}
