<?php
/**
 * Model measurements administration interface.
 *
 * Requires:
 * - dictionaries.php
 * - measurements.php
 * - validation.php
 *
 * Persistence and publication enforcement are separate modules.
 *
 * This module:
 * - registers the classic-editor measurements metabox;
 * - enqueues its administration assets;
 * - renders stored measurements and dictionary choices;
 * - renders form completeness controls.
 *
 * It does not:
 * - write measurement metadata;
 * - register CPTs or ACF fields;
 * - use an ACF Repeater;
 * - modify or synchronize legacy modellength;
 * - expose REST or MCP endpoints.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Register administration hooks once.
 *
 * $assets_url must point to the plugin's assets directory.
 *
 * @param string[] $post_types Configured model CPTs.
 * @param string   $assets_url Assets directory URL.
 * @param string   $version Asset version.
 * @return void
 */
function register_measurements_admin(
    array $post_types,
    $assets_url,
    $version
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

    add_action(
        'add_meta_boxes',
        static function ($post_type, $post) use ($post_types) {
            if (!in_array($post_type, $post_types, true)) {
                return;
            }

            if (
                !$post instanceof \WP_Post
                || !current_user_can('edit_post', $post->ID)
            ) {
                return;
            }

            add_meta_box(
                'gm-model-measurements',
                'Размеры модели',
                __NAMESPACE__ . '\\render_measurements_metabox',
                $post_type,
                'normal',
                'default',
                [
                    /*
                     * The supported form-save flow targets the
                     * classic editor. Do not advertise unverified
                     * block-editor compatibility.
                     */
                    '__block_editor_compatible_meta_box' => false,
                ]
            );
        },
        10,
        2
    );

    add_action(
        'admin_enqueue_scripts',
        static function ($hook_suffix) use (
            $post_types,
            $assets_url,
            $version
        ) {
            if (
                !in_array(
                    $hook_suffix,
                    ['post.php', 'post-new.php'],
                    true
                )
            ) {
                return;
            }

            $screen = get_current_screen();

            if (
                !$screen
                || !in_array($screen->post_type, $post_types, true)
            ) {
                return;
            }

            $base_url = trailingslashit($assets_url);

            wp_enqueue_style(
                'gm-model-measurements-admin',
                $base_url . 'admin.css',
                [],
                $version
            );

            wp_enqueue_script(
                'gm-model-measurements-admin',
                $base_url . 'admin.js',
                [],
                $version,
                true
            );
        }
    );
}

/**
 * Render the measurements metabox.
 *
 * Failed reads must not produce an empty editable form that could
 * overwrite existing measurements.
 *
 * @param \WP_Post $post Model post.
 * @return void
 */
function render_measurements_metabox($post)
{
    if (
        !$post instanceof \WP_Post
        || !current_user_can('edit_post', $post->ID)
    ) {
        return;
    }

    $dictionaries = load_dictionaries();

    if (is_wp_error($dictionaries)) {
        render_measurements_admin_error($dictionaries);
        return;
    }

    $measurements = get_model_measurements((int) $post->ID);

    if (is_wp_error($measurements)) {
        render_measurements_admin_error($measurements);
        return;
    }

    /*
     * Overall length is not required merely to render a draft.
     * Missing or incompatible dictionary references remain errors.
     * Inactive references may remain in unchanged stored rows.
     */
    $validated = validate_model_measurements(
        $measurements,
        $dictionaries,
        $measurements,
        false
    );

    if (is_wp_error($validated)) {
        render_measurements_admin_error($validated);
        return;
    }

    render_measurements_editor(
        $validated,
        $dictionaries,
        (int) $post->ID
    );
}

/**
 * Render an editor from normalized and validated data.
 *
 * @param array $measurements Normalized measurements.
 * @param array $dictionaries Loaded dictionaries.
 * @param int   $post_id Model ID.
 * @return void
 */
function render_measurements_editor(
    array $measurements,
    array $dictionaries,
    $post_id
) {
    $overall = find_measurement(
        $measurements,
        'overall_length'
    );

    $rows = array_values(array_filter(
        $measurements,
        static function ($measurement) {
            return $measurement['definitionCode'] !== 'overall_length';
        }
    ));

    $prefix = 'gm-measurements-' . (int) $post_id;

    echo '<div class="gm-measurements" data-gm-measurements>';

    echo '<p class="description">';
    echo esc_html(
        'Все значения указываются в миллиметрах. '
        . 'Дробную часть можно вводить через точку или запятую. '
        . 'Отсутствие размера означает «не указано», а не ноль.'
    );
    echo '</p>';

    echo '<noscript><p>';
    echo esc_html(
        'Для добавления и удаления строк, смены вида измерения '
        . 'и выбора соответствующего элемента требуется JavaScript. '
        . 'Без него изменяйте только значения и примечания '
        . 'уже показанных измерений.'
    );
    echo '</p></noscript>';

    wp_nonce_field(
        'gm_save_model_measurements_' . (int) $post_id,
        'gm_measurements_nonce'
    );

    echo '<input type="hidden" ';
    echo 'name="gm_measurements[present]" value="1">';

    render_overall_length_fields($overall, $prefix);

    echo '<h4>';
    echo esc_html('Дополнительные измерения');
    echo '</h4>';

    echo '<p class="description">';
    echo esc_html(
        'Выберите вид измерения, при необходимости — элемент модели, '
        . 'затем введите значение. Полностью удаляйте ненужные строки.'
    );
    echo '</p>';

    echo '<div class="gm-measurements__rows" data-gm-rows>';

    foreach ($rows as $index => $measurement) {
        render_measurement_admin_row(
            $measurement,
            $dictionaries,
            (string) $index,
            $prefix
        );
    }

    echo '</div>';

    echo '<p>';
    echo '<button type="button" class="button" data-gm-add-row>';
    echo esc_html('Добавить измерение');
    echo '</button>';
    echo '</p>';

    echo '<template data-gm-row-template>';

    render_measurement_admin_row(
        null,
        $dictionaries,
        '__INDEX__',
        $prefix
    );

    echo '</template>';

    echo '<p class="screen-reader-text" ';
    echo 'aria-live="polite" aria-atomic="true" ';
    echo 'data-gm-announcement></p>';

    /*
     * Keep these controls after all submitted measurement fields.
     *
     * JavaScript maintains the expected row count after changes.
     * Template contents are inert and are not submitted.
     *
     * These fields detect incomplete form submission. They do not
     * replace the nonce, authorization or server-side validation.
     */
    echo '<div hidden data-gm-form-integrity>';

    echo '<input type="hidden" data-gm-expected-rows ';
    echo 'name="gm_measurements[expected_rows]" ';
    echo 'value="' . esc_attr((string) count($rows)) . '">';

    echo '<input type="hidden" data-gm-form-complete ';
    echo 'name="gm_measurements[complete]" value="1">';

    echo '</div>';

    echo '</div>';
}

/**
 * Render the dedicated overall_length fields.
 *
 * The value is not marked required in HTML because drafts must be
 * saveable without it. Publication requirements are checked by
 * the server.
 *
 * @param array|null $measurement Existing normalized measurement.
 * @param string     $prefix Unique DOM ID prefix.
 * @return void
 */
function render_overall_length_fields($measurement, $prefix)
{
    $value_id = $prefix . '-overall-value';
    $note_id = $prefix . '-overall-note';

    $value = $measurement !== null
        ? measurement_admin_number($measurement['valueMm'])
        : '';

    $note = $measurement['note'] ?? '';

    echo '<fieldset class="gm-measurements__overall">';

    echo '<legend>';
    echo esc_html('Габаритная длина');
    echo '</legend>';

    echo '<p>';
    echo '<label for="' . esc_attr($value_id) . '">';
    echo esc_html('Значение, мм');
    echo '</label><br>';

    echo '<input type="text" inputmode="decimal" ';
    echo 'class="regular-text" ';
    echo 'id="' . esc_attr($value_id) . '" ';
    echo 'name="gm_measurements[overall_length][valueMm]" ';
    echo 'value="' . esc_attr($value) . '" ';
    echo 'autocomplete="off">';
    echo '</p>';

    echo '<p class="description">';
    echo esc_html(
        'Обязательна для публикации после включения проверки длины. '
        . 'Черновик можно сохранить без этого значения.'
    );
    echo '</p>';

    echo '<p>';
    echo '<label for="' . esc_attr($note_id) . '">';
    echo esc_html('Примечание к габаритной длине');
    echo '</label><br>';

    echo '<textarea rows="2" class="large-text" ';
    echo 'id="' . esc_attr($note_id) . '" ';
    echo 'name="gm_measurements[overall_length][note]">';
    echo esc_textarea($note);
    echo '</textarea>';
    echo '</p>';

    echo '</fieldset>';
}

/**
 * Render one additional row or the blank row template.
 *
 * @param array|null $measurement Normalized measurement or null.
 * @param array      $dictionaries Loaded dictionaries.
 * @param string     $index Numeric index or template token.
 * @param string     $prefix Unique DOM ID prefix.
 * @return void
 */
function render_measurement_admin_row(
    $measurement,
    array $dictionaries,
    $index,
    $prefix
) {
    $base_name = 'gm_measurements[rows][' . $index . ']';
    $base_id = $prefix . '-row-' . $index;

    $definition_code = $measurement['definitionCode'] ?? '';
    $target = $measurement['target'] ?? null;
    $target_id = $target['id'] ?? '';

    $definition = $definition_code !== ''
        ? ($dictionaries['definitions'][$definition_code] ?? null)
        : null;

    $target_kind = $definition['targetKind'] ?? 'none';
    $needs_target = in_array(
        $target_kind,
        ['mast', 'yard'],
        true
    );

    $value = $measurement !== null
        ? measurement_admin_number($measurement['valueMm'])
        : '';

    $note = $measurement['note'] ?? '';

    echo '<fieldset class="gm-measurements__row" ';
    echo 'data-gm-measurement-row ';
    echo 'data-gm-row-index="' . esc_attr($index) . '">';

    echo '<legend class="screen-reader-text">';
    echo esc_html('Дополнительное измерение');
    echo '</legend>';

    echo '<p class="gm-measurements__field">';
    echo '<label for="' . esc_attr($base_id . '-definition') . '">';
    echo esc_html('Измерение');
    echo '</label><br>';

    echo '<select required data-gm-definition ';
    echo 'id="' . esc_attr($base_id . '-definition') . '" ';
    echo 'name="' . esc_attr($base_name . '[definitionCode]') . '">';

    echo '<option value="">';
    echo esc_html('Выберите измерение');
    echo '</option>';

    foreach ($dictionaries['definitions'] as $code => $entry) {
        if ($code === 'overall_length') {
            continue;
        }

        $selected = $code === $definition_code;
        $inactive = !$entry['active'];
        $label = $entry['label'];

        if ($inactive) {
            $label .= ' — неактивно';
        }

        echo '<option value="' . esc_attr($code) . '" ';
        echo 'data-target-kind="';
        echo esc_attr($entry['targetKind']);
        echo '" ';
        echo 'data-unavailable="' . ($inactive ? '1' : '0') . '" ';
        echo 'data-retained="';
        echo ($inactive && $selected) ? '1' : '0';
        echo '"';

        if ($selected) {
            echo ' selected';
        }

        if ($inactive && !$selected) {
            echo ' disabled hidden';
        }

        echo '>';
        echo esc_html($label);
        echo '</option>';
    }

    echo '</select>';
    echo '</p>';

    echo '<div class="gm-measurements__field" ';
    echo 'data-gm-target-container';

    if (!$needs_target) {
        echo ' hidden';
    }

    echo '>';

    echo '<p>';
    echo '<label for="' . esc_attr($base_id . '-target') . '">';
    echo esc_html('Элемент модели');
    echo '</label><br>';

    echo '<select data-gm-target ';
    echo 'id="' . esc_attr($base_id . '-target') . '" ';
    echo 'aria-describedby="';
    echo esc_attr($base_id . '-target-status');
    echo '" ';
    echo 'name="' . esc_attr($base_name . '[target][id]') . '"';

    echo $needs_target ? ' required' : ' disabled';
    echo '>';

    echo '<option value="">';
    echo esc_html('Выберите элемент');
    echo '</option>';

    foreach ($dictionaries['elements'] as $code => $entry) {
        $selected = $code === $target_id;
        $inactive = !$entry['active'];
        $compatible = $entry['kind'] === $target_kind;
        $label = $entry['label'];

        if ($inactive) {
            $label .= ' — неактивен';
        }

        echo '<option value="' . esc_attr($code) . '" ';
        echo 'data-element-kind="' . esc_attr($entry['kind']) . '" ';
        echo 'data-unavailable="' . ($inactive ? '1' : '0') . '" ';
        echo 'data-retained="';
        echo ($inactive && $selected) ? '1' : '0';
        echo '"';

        if ($selected) {
            echo ' selected';
        }

        if (
            !$selected
            && (!$compatible || $inactive)
        ) {
            echo ' disabled hidden';
        }

        echo '>';
        echo esc_html($label);
        echo '</option>';
    }

    echo '</select>';

    echo '<input type="hidden" data-gm-target-kind ';
    echo 'name="' . esc_attr($base_name . '[target][kind]') . '" ';
    echo 'value="' . esc_attr($needs_target ? $target_kind : '') . '"';

    if (!$needs_target) {
        echo ' disabled';
    }

    echo '>';

    echo '</p>';

    echo '<p class="description gm-measurements__target-status" ';
    echo 'id="' . esc_attr($base_id . '-target-status') . '" ';
    echo 'data-gm-target-status aria-live="polite"></p>';

    echo '</div>';

    echo '<p class="gm-measurements__field">';
    echo '<label for="' . esc_attr($base_id . '-value') . '">';
    echo esc_html('Значение, мм');
    echo '</label><br>';

    echo '<input type="text" required inputmode="decimal" ';
    echo 'id="' . esc_attr($base_id . '-value') . '" ';
    echo 'name="' . esc_attr($base_name . '[valueMm]') . '" ';
    echo 'value="' . esc_attr($value) . '" ';
    echo 'autocomplete="off">';
    echo '</p>';

    echo '<p class="gm-measurements__field gm-measurements__note">';
    echo '<label for="' . esc_attr($base_id . '-note') . '">';
    echo esc_html('Примечание');
    echo '</label><br>';

    echo '<textarea rows="2" ';
    echo 'id="' . esc_attr($base_id . '-note') . '" ';
    echo 'name="' . esc_attr($base_name . '[note]') . '">';
    echo esc_textarea($note);
    echo '</textarea>';
    echo '</p>';

    render_measurement_archived_warning(
        $measurement,
        $dictionaries
    );

    echo '<p class="gm-measurements__actions">';
    echo '<button type="button" class="button-link-delete" ';
    echo 'data-gm-remove-row>';
    echo esc_html('Удалить измерение');
    echo '</button>';
    echo '</p>';

    echo '</fieldset>';
}

/**
 * Explain the unchanged-only rule for inactive stored references.
 *
 * @param array|null $measurement Existing measurement or null.
 * @param array      $dictionaries Loaded dictionaries.
 * @return void
 */
function render_measurement_archived_warning(
    $measurement,
    array $dictionaries
) {
    if ($measurement === null) {
        return;
    }

    $definition = $dictionaries['definitions'][
        $measurement['definitionCode']
    ] ?? null;

    $target = $measurement['target'] ?? null;

    $element = $target !== null
        ? ($dictionaries['elements'][$target['id']] ?? null)
        : null;

    $inactive = (
        $definition !== null
        && !$definition['active']
    ) || (
        $element !== null
        && !$element['active']
    );

    if (!$inactive) {
        return;
    }

    echo '<p class="description gm-measurements__archived-warning">';
    echo esc_html(
        'Используется неактивная справочная запись. '
        . 'Можно сохранить строку без изменений, удалить её '
        . 'или заменить неактивные ссылки активными. '
        . 'Изменение значения или примечания при сохранении '
        . 'неактивной ссылки будет отклонено.'
    );
    echo '</p>';
}

/**
 * Format a normalized number for an editable text input.
 *
 * Avoid localized thousands separators and fixed decimal rounding.
 * Expand exponent notation because the form parser accepts ordinary
 * decimal notation only.
 *
 * Prefer JSON's compact representation. If the configured JSON
 * precision changes the float on round-trip, use a 17-digit fallback.
 *
 * @param float|int $value Positive finite normalized number.
 * @return string
 */
function measurement_admin_number($value)
{
    if (
        (!is_int($value) && !is_float($value))
        || !is_finite((float) $value)
        || (float) $value <= 0
    ) {
        return '';
    }

    $number = (float) $value;
    $encoded = wp_json_encode($number);

    if (
        !is_string($encoded)
        || !is_numeric($encoded)
        || (float) $encoded !== $number
    ) {
        $encoded = sprintf('%.17g', $number);

        $locale = localeconv();
        $decimal_point = $locale['decimal_point'] ?? '.';

        if (
            is_string($decimal_point)
            && $decimal_point !== ''
            && $decimal_point !== '.'
        ) {
            $encoded = str_replace(
                $decimal_point,
                '.',
                $encoded
            );
        }
    }

    if (
        !is_numeric($encoded)
        || (float) $encoded !== $number
    ) {
        return '';
    }

    if (stripos($encoded, 'e') === false) {
        return $encoded;
    }

    $parts = preg_split('/e/i', $encoded);

    if (!is_array($parts) || count($parts) !== 2) {
        return '';
    }

    $mantissa = $parts[0];
    $exponent = (int) $parts[1];
    $decimal_position = strpos($mantissa, '.');

    if ($decimal_position === false) {
        $decimal_position = strlen($mantissa);
    }

    $digits = str_replace('.', '', $mantissa);
    $new_position = $decimal_position + $exponent;

    if ($new_position <= 0) {
        return '0.'
            . str_repeat('0', -$new_position)
            . $digits;
    }

    if ($new_position >= strlen($digits)) {
        return $digits
            . str_repeat('0', $new_position - strlen($digits));
    }

    return substr($digits, 0, $new_position)
        . '.'
        . substr($digits, $new_position);
}

/**
 * Render a blocking read/validation error.
 *
 * No measurements form marker or nonce is emitted on this path.
 * Saving other post fields must not clear stored measurements.
 *
 * @param \WP_Error $error Read or validation error.
 * @return void
 */
function render_measurements_admin_error(\WP_Error $error)
{
    echo '<div class="notice notice-error inline">';

    echo '<p>';
    echo esc_html(
        'Редактор размеров недоступен. '
        . 'Сохранённые значения не должны перезаписываться '
        . 'до устранения ошибки.'
    );
    echo '</p>';

    echo '<ul>';

    foreach ($error->get_error_messages() as $message) {
        if (is_string($message)) {
            echo '<li>' . esc_html($message) . '</li>';
        }
    }

    echo '</ul>';
    echo '</div>';
}
