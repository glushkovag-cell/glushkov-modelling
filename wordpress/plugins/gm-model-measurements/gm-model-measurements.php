<?php
/**
 * Plugin Name: Glushkov Modelling — Model Measurements
 * Description: Model measurements in millimeters, dictionary validation,
 *              an administration metabox and publication integrity guards.
 * Version: 0.1.2
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: Glushkov Modelling
 * Text Domain: gm-model-measurements
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

const PLUGIN_VERSION = '0.1.2';

/*
 * Load definitions before registering hooks.
 *
 * Order:
 * - dictionary reading and normalization;
 * - measurement reading and structural normalization;
 * - dictionary-aware measurement validation;
 * - administration rendering;
 * - classic-editor persistence and feedback;
 * - dictionary integrity guards;
 * - cross-context publication and measurement metadata guards.
 *
 * Function calls made by registered callbacks run after all modules
 * have been included.
 *
 * No activation-time migration, dictionary registration, metadata
 * registration or content modification is performed.
 */
require_once __DIR__ . '/includes/dictionaries.php';
require_once __DIR__ . '/includes/measurements.php';
require_once __DIR__ . '/includes/validation.php';
require_once __DIR__ . '/includes/admin.php';
require_once __DIR__ . '/includes/persistence.php';
require_once __DIR__ . '/includes/dictionary-guards.php';
require_once __DIR__ . '/includes/publication-guards.php';

/*
 * Initialize after normal CPT and ACF registration.
 *
 * Configuration filters must be registered before this callback.
 */
add_action(
    'wp_loaded',
    __NAMESPACE__ . '\\bootstrap_model_measurements',
    20
);

/**
 * Validate installation configuration and register plugin hooks.
 *
 * Initialization failure is reported explicitly. If prerequisites
 * fail, the plugin's administration and integrity hooks are not
 * registered.
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

    /*
     * Dictionaries are managed through the existing ACF setup.
     * Raw dictionary value reads do not require get_field(), but the
     * supported installation still requires active ACF.
     */
    if (
        !function_exists('get_field')
        || !function_exists('acf_get_field')
    ) {
        register_measurements_bootstrap_notice(
            'Модуль размеров не инициализирован: '
            . 'требуется активный Advanced Custom Fields. '
            . 'Редактор размеров и проверки целостности '
            . 'не зарегистрированы.'
        );

        return;
    }

    $configuration = get_measurements_plugin_configuration();

    if (is_wp_error($configuration)) {
        foreach ($configuration->get_error_messages() as $message) {
            register_measurements_bootstrap_notice($message);
        }

        register_measurements_bootstrap_notice(
            'До исправления конфигурации редактор размеров '
            . 'и проверки целостности не зарегистрированы.'
        );

        return;
    }

    $post_types = $configuration['postTypes'];
    $require_length = $configuration['requireOverallLength'];

    foreach (
        ['measurement_defi', 'model_element']
        as $dictionary_type
    ) {
        if (!post_type_exists($dictionary_type)) {
            register_measurements_bootstrap_notice(
                sprintf(
                    'Модуль размеров не инициализирован: '
                    . 'не зарегистрирован справочный CPT %s. '
                    . 'Редактор размеров и проверки целостности '
                    . 'не зарегистрированы.',
                    $dictionary_type
                )
            );

            return;
        }
    }

    foreach ($post_types as $post_type) {
        if (!post_type_exists($post_type)) {
            register_measurements_bootstrap_notice(
                sprintf(
                    'Модуль размеров не инициализирован: '
                    . 'настроенный CPT модели %s не зарегистрирован. '
                    . 'Редактор размеров и проверки целостности '
                    . 'не зарегистрированы.',
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
                    'Модуль размеров не инициализирован: '
                    . 'тип записи %s нельзя использовать '
                    . 'как CPT модели. '
                    . 'Редактор размеров и проверки целостности '
                    . 'не зарегистрированы.',
                    $post_type
                )
            );

            return;
        }
    }

    /*
     * Register guards in all normally bootstrapped contexts.
     *
     * Do not restrict these registrations to is_admin().
     * Individual handlers restrict their own supported operations.
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

    /*
     * The cross-context publication filter runs after the classic
     * form handler and validates already stored measurements.
     *
     * The publication module also:
     * - guards ordinary measurement metadata operations;
     * - guards measurement metadata operations by meta ID;
     * - wraps the standard scheduled-publication callback;
     * - registers separate publication-rejection notices.
     */
    register_measurements_publication_guards(
        $post_types,
        $require_length
    );

    if (!$require_length) {
        register_measurements_bootstrap_notice(
            'Модуль размеров работает в режиме подготовки: '
            . 'обязательность габаритной длины при публикации '
            . 'выключена. Отсутствие длины само по себе '
            . 'не блокирует публикацию. '
            . 'Проверки структуры записываемых размеров '
            . 'и целостности справочников зарегистрированы.',
            'info'
        );
    }
}

/**
 * Read explicit plugin configuration.
 *
 * Sources:
 *
 * 1. GM_MODEL_MEASUREMENTS_POST_TYPES:
 *    array of actual model CPT slugs.
 *
 * 2. gm_model_measurements_post_types filter:
 *    receives and returns that array.
 *
 * 3. GM_MODEL_MEASUREMENTS_REQUIRE_OVERALL_LENGTH:
 *    boolean, false by default for preparation mode.
 *
 * 4. gm_model_measurements_require_overall_length filter:
 *    receives and returns that boolean.
 *
 * Filters must be registered before wp_loaded priority 20.
 * Configuration must remain stable during the request.
 *
 * No default model CPT is guessed.
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
            'Модуль размеров не инициализирован: '
            . 'настройка типов моделей должна быть массивом CPT.'
        );
    }

    if ($post_types === []) {
        return new \WP_Error(
            'gm_measurements_missing_post_types_configuration',
            'Модуль размеров не инициализирован: укажите '
            . 'фактический CPT модели через '
            . 'GM_MODEL_MEASUREMENTS_POST_TYPES '
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
                'Модуль размеров не инициализирован: '
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
            'Модуль размеров не инициализирован: '
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
 * @param string $type WordPress notice type.
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

    $message = (string) $message;

    if ($message === '') {
        return;
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
