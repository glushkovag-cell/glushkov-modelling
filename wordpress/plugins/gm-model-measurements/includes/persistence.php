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
 *
 * Cross-context publication and metadata guards are registered
 * separately by publication-guards.php.
 *
 * This module:
 * - validates the classic metabox payload;
 * - binds the submitted form to its specific post ID;
 * - detects incomplete form submissions;
 * - preserves rejected input for administration feedback;
 * - writes canonical measurements through the ordinary Metadata API;
 * - checks REST publication against already stored measurements.
 *
 * It does not:
 * - register ACF fields or use an ACF Repeater;
 * - change or synchronize modellength;
 * - expose a REST measurements-write endpoint;
 * - register a new MCP tool;
 * - perform activation-time migrations.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Register persistence hooks once.
 *
 * Drafts may omit overall_length.
 * When enabled, publication requires valid stored overall_length.
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

    /*
     * Request-local state bridges wp_insert_post_data and save_post.
     * No measurements are written from the post-data filter.
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
             * The classic editor uses an existing auto-draft.
             * New records created without an ID are outside this
             * metabox persistence flow.
             */
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
             * Never apply the current editor's measurements to an
             * unrelated nested wp_update_post() call.
             *
             * Identity is not authorization: capability and nonce
             * checks are still required below.
             */
            $has_payload = array_key_exists(
                'gm_measurements',
                $_POST
            )
                && measurement_submitted_post_id() === $post_id;

            /*
             * An absent metabox is not a request to clear metadata.
             * Publication may still require validating stored values.
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
                        /*
                         * Retain nonce-verified input even when the
                         * completeness or value checks reject it.
                         */
                        $submitted = true;

                        $integrity =
                            validate_measurement_form_integrity(
                                $payload
                            );

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

            if ($error !== null) {
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
             * Publication checks without a submitted metabox must
             * not write or clear measurements.
             */
            if (!$state['submitted']) {
                return;
            }

            $measurements = $state['measurements'];
            $current = get_model_measurements($post_id);

            if (
                !is_wp_error($current)
                && $current === $measurements
            ) {
                clear_measurement_admin_feedback($post_id);
                return;
            }

            /*
             * Ordinary Metadata API expects slashed input.
             * The metadata guards receive the unslashed collection.
             *
             * Do not use the return value alone: false also means
             * "unchanged". Confirm the actual stored collection.
             */
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
             * Post and metadata writes are not a transaction.
             * Recover to draft if a failed write leaves a published
             * or scheduled model without valid required measurements.
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
                            . 'обязательные размеры не подтверждены.'
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
     * This does not expose measurement writes through REST.
     * It rejects publication without valid already stored values.
     *
     * The cross-context publication guard remains an additional
     * enforcement layer.
     */
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

                $post = $post_id > 0
                    ? get_post($post_id)
                    : null;

                if (
                    !$post instanceof \WP_Post
                    || $post->post_type !== $post_type
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
 * Read the classic editor's submitted post ID.
 *
 * No fallback to a GET parameter or current global post is used.
 * This function identifies a form; it does not authorize a write.
 *
 * @return int Positive post ID or zero.
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
 * The completion marker must follow the measurement fields.
 * The expected row count is maintained by the administration UI.
 *
 * These checks detect incomplete submissions. They do not
 * authenticate input or replace structural validation.
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
 * Structural normalization and dictionary validation follow later.
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

    /*
     * overall_length has one dedicated form location.
     * Do not permit another copy in the additional rows.
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
 * Identify publication or scheduled-publication statuses.
 *
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
 * @param int $post_id Existing model ID.
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
 * Existing publication is retained only when its unchanged stored
 * measurements meet the enabled publication requirement.
 *
 * @param int  $post_id Existing model ID.
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
 * Build a per-user, per-model feedback key.
 *
 * Publication-rejection notices use a different key in
 * publication-guards.php and are not cleared here.
 *
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
 * Preserve errors and rejected form input across editor redirects.
 *
 * Payload remains unslashed and may contain invalid input.
 * It must only be rendered with appropriate output escaping.
 *
 * Transients are temporary, not durable measurement revisions.
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
 * Clear form feedback after a successful explicit form submission.
 *
 * Does not clear the separate publication-rejection notice.
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
 * Form feedback remains available until a successful explicit
 * submission, transient expiry or cache eviction.
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
                'Это полученные сервером значения, включая ошибочные. '
                . 'При усечении формы здесь может быть только часть '
                . 'отправленного ввода. Метабокс ниже показывает '
                . 'сохранённые размеры, а не эту отклонённую форму. '
                . 'Скопируйте нужные значения перед повторным сохранением.'
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
