<?php
/**
 * Plugin Name: Glushkov Modelling — Model Measurements
 * Description: Model measurements in millimeters, dictionary validation,
 *              an administration metabox and dictionary integrity guards.
 * Version: 0.1.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: Glushkov Modelling
 * Text Domain: gm-model-measurements
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

const PLUGIN_VERSION = '0.1.0';

/**
 * Load modules without registering their hooks yet.
 *
 * Order matters: the UI and persistence modules use dictionary,
 * normalization and validation functions.
 */
require_once __DIR__ . '/includes/dictionaries.php';
require_once __DIR__ . '/includes/measurements.php';
require_once __DIR__ . '/includes/validation.php';
require_once __DIR__ . '/includes/admin.php';
require_once __DIR__ . '/includes/persistence.php';
require_once __DIR__ . '/includes/dictionary-guards.php';

/**
 * Initialize after normal CPT and ACF registration.
 *
 * No activation-time migration, metadata registration or content
 * modification is performed.
 */
add_action(
    'wp_loaded',
    __NAMESPACE__ . '\\bootstrap_model_measurements',
    20
);

/**
 * Validate configuration and register plugin hooks.
 *
 * @return void
 */
function bootstrap_model_measurements()
{
    static $initialized = false;

    if ($initialized) {
        return;
    }

    $initialized = true;

    if (
        !function_exists('get_field')
        || !function_exists('acf_get_field')
    ) {
        register_measurements_bootstrap_notice(
            'Модуль размеров не включён: '
            . 'требуется активный Advanced Custom Fields.'
        );
        return;
    }

    $configuration = get_measurements_plugin_configuration();

    if (is_wp_error($configuration)) {
        foreach ($configuration->get_error_messages() as $message) {
            register_measurements_bootstrap_notice($message);
        }

        return;
    }

    $post_types = $configuration['postTypes'];
    $require_length = $configuration['requireOverallLength'];

    $required_dictionary_types = [
        'measurement_defi',
        'model_element',
    ];

    foreach ($required_dictionary_types as $post_type) {
        if (!post_type_exists($post_type)) {
            register_measurements_bootstrap_notice(
                sprintf(
                    'Модуль размеров не включён: '
                    . 'не зарегистрирован справочный CPT %s.',
                    $post_type
                )
            );
            return;
        }
    }

    foreach ($post_types as $post_type) {
        if (!post_type_exists($post_type)) {
            register_measurements_bootstrap_notice(
                sprintf(
                    'Модуль размеров не включён: '
                    . 'настроенный CPT модели %s не зарегистрирован.',
                    $post_type
                )
            );
            return;
        }

        if (
            is_measurement_dictionary_type($post_type)
            || in_array(
                $post_type,
                ['revision', 'attachment', 'nav_menu_item'],
                true
            )
        ) {
            register_measurements_bootstrap_notice(
                sprintf(
                    'Модуль размеров не включён: '
                    . 'тип записи %s нельзя использовать как CPT модели.',
                    $post_type
                )
            );
            return;
        }
    }

    /*
     * Register on frontend requests too:
     * metadata guards and REST checks must not depend on is_admin().
     *
     * Individual modules restrict their own administration hooks.
     */
    register_dictionary_guards($post_types);

    register_measurements_persistence(
        $post_types,
        $require_length
    );

    register_measurements_admin(
        $post_types,
        plugin_dir_url(__FILE__) . 'assets/',
        PLUGIN_VERSION
    );

    if (!$require_length) {
        register_measurements_bootstrap_notice(
            'Модуль размеров работает в режиме подготовки: '
            . 'обязательность габаритной длины при публикации '
            . 'пока выключена.',
            'info'
        );
    }
}

/**
 * Read explicit plugin configuration.
 *
 * Configuration sources:
 *
 * 1. GM_MODEL_MEASUREMENTS_POST_TYPES constant:
 *    an array of actual model CPT slugs.
 *
 * 2. gm_model_measurements_post_types filter:
 *    receives and returns that array.
 *
 * 3. GM_MODEL_MEASUREMENTS_REQUIRE_OVERALL_LENGTH constant:
 *    boolean, false by default.
 *
 * 4. gm_model_measurements_require_overall_length filter:
 *    receives and returns that boolean.
 *
 * Filters must be registered before wp_loaded priority 20.
 *
 * @return array|\WP_Error
 */
function get_measurements_plugin_configuration()
{
    $post_types = defined('GM_MODEL_MEASUREMENTS_POST_TYPES')
        ? constant('GM_MODEL_MEASUREMENTS_POST_TYPES')
        : [];

    $post_types = apply_filters(
        'gm_model_measurements_post_types',
        $post_types
    );

    if (!is_array($post_types)) {
        return new \WP_Error(
            'gm_measurements_invalid_post_types_configuration',
            'Модуль размеров не включён: '
            . 'настройка типов моделей должна быть массивом CPT.'
        );
    }

    if ($post_types === []) {
        return new \WP_Error(
            'gm_measurements_missing_post_types_configuration',
            'Модуль размеров не включён: укажите фактический CPT '
            . 'модели через GM_MODEL_MEASUREMENTS_POST_TYPES '
            . 'или фильтр gm_model_measurements_post_types.'
        );
    }

    $normalized_post_types = [];

    foreach ($post_types as $post_type) {
        /*
         * Do not silently sanitize a wrong identifier into another CPT.
         */
        if (
            !is_string($post_type)
            || $post_type === ''
            || strlen($post_type) > 20
            || sanitize_key($post_type) !== $post_type
        ) {
            return new \WP_Error(
                'gm_measurements_invalid_post_type_slug',
                'Модуль размеров не включён: '
                . 'обнаружен некорректный идентификатор CPT модели.'
            );
        }

        $normalized_post_types[] = $post_type;
    }

    $normalized_post_types = array_values(
        array_unique($normalized_post_types)
    );

    $require_length = defined(
        'GM_MODEL_MEASUREMENTS_REQUIRE_OVERALL_LENGTH'
    )
        ? constant('GM_MODEL_MEASUREMENTS_REQUIRE_OVERALL_LENGTH')
        : false;

    $require_length = apply_filters(
        'gm_model_measurements_require_overall_length',
        $require_length
    );

    if (!is_bool($require_length)) {
        return new \WP_Error(
            'gm_measurements_invalid_length_requirement',
            'Модуль размеров не включён: '
            . 'настройка обязательности длины должна быть '
            . 'логическим значением true или false.'
        );
    }

    return [
        'postTypes'            => $normalized_post_types,
        'requireOverallLength' => $require_length,
    ];
}

/**
 * Queue an administration notice without writing to storage.
 *
 * @param string $message Notice text.
 * @param string $type    Notice type.
 * @return void
 */
function register_measurements_bootstrap_notice(
    $message,
    $type = 'error'
) {
    $allowed_types = ['error', 'warning', 'success', 'info'];

    if (!in_array($type, $allowed_types, true)) {
        $type = 'error';
    }

    add_action(
        'admin_notices',
        static function () use ($message, $type) {
            if (!current_user_can('manage_options')) {
                return;
            }

            echo '<div class="notice notice-';
            echo esc_attr($type);
            echo '"><p>';

            echo esc_html($message);

            echo '</p></div>';
        }
    );
}
