<?php
/**
 * Read-only GraphQL presentation of model measurements.
 *
 * Requires dictionaries.php, measurements.php, validation.php
 * and get_measurements_plugin_configuration() from the entrypoint.
 *
 * Does not write metadata, register dictionaries, or modify
 * legacy modellength.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Register measurement types and the Model.measurements field.
 *
 * Schema registration remains independent of runtime configuration.
 * The resolver validates configuration before reading measurements.
 *
 * @return void
 */
function register_measurements_graphql_types()
{
    register_graphql_object_type(
        'GmModelMeasurementTarget',
        [
            'description' => 'An element identified by its stable code.',
            'fields'      => [
                'kind' => [
                    'type'        => ['non_null' => 'String'],
                    'description' => 'Element kind: mast or yard.',
                ],
                'id' => [
                    'type'        => ['non_null' => 'String'],
                    'description' => 'Stable element code, not a database ID.',
                ],
                'label' => [
                    'type'        => ['non_null' => 'String'],
                    'description' => 'Current dictionary label.',
                ],
            ],
        ]
    );

    register_graphql_object_type(
        'GmModelMeasurement',
        [
            'description' => 'A saved model measurement in millimeters.',
            'fields'      => [
                'code' => [
                    'type'        => ['non_null' => 'String'],
                    'description' => 'Saved measurement definition code.',
                ],
                'label' => [
                    'type'        => ['non_null' => 'String'],
                    'description' => 'Current measurement dictionary label.',
                ],
                'description' => [
                    'type'        => ['non_null' => 'String'],
                    'description' => 'Current measurement definition.',
                ],
                'group' => [
                    'type'        => ['non_null' => 'String'],
                    'description' => 'Stable measurement group code.',
                ],
                'valueMm' => [
                    'type'        => ['non_null' => 'Float'],
                    'description' => 'Value in millimeters without rounding.',
                ],
                'target' => [
                    'type'        => 'GmModelMeasurementTarget',
                    'description' => 'Measured element, or null.',
                ],
                'note' => [
                    'type'        => 'String',
                    'description' => 'Saved note, or null.',
                ],
            ],
        ]
    );

    register_graphql_field(
        'Model',
        'measurements',
        [
            'type' => [
                'list_of' => [
                    'non_null' => 'GmModelMeasurement',
                ],
            ],
            'description' =>
                'Saved measurements ordered by group, definition order, '
                . 'element order and stable codes. Empty collections '
                . 'return []; inaccessible data returns null.',
            'resolve' => __NAMESPACE__ . '\\resolve_graphql_measurements',
        ]
    );
}

/**
 * Resolve measurements only after checking access and configuration.
 *
 * Invalid configuration or stored data produces a field error,
 * never an empty fallback.
 *
 * @param mixed $source WPGraphQL post model.
 * @param mixed $args GraphQL field arguments; unused.
 * @param mixed $context WPGraphQL application context.
 * @return array|null
 * @throws \GraphQL\Error\UserError When configuration or data is invalid.
 */
function resolve_graphql_measurements(
    $source,
    $args = [],
    $context = null
) {
    if (!$source instanceof \WPGraphQL\Model\Post) {
        return null;
    }

    if ($source->isRestricted) {
        return null;
    }

    $post_id = (int) $source->databaseId;

    if ($post_id <= 0) {
        return null;
    }

    $post = get_post($post_id);

    if (!graphql_measurements_can_read_post($post)) {
        return null;
    }

    $configuration = validate_graphql_measurements_configuration();

    if (is_wp_error($configuration)) {
        throw_graphql_measurements_error($configuration);
    }

    $rows = get_model_measurements($post_id);

    if (is_wp_error($rows)) {
        throw_graphql_measurements_error($rows);
    }

    /*
     * An empty collection still requires valid plugin configuration,
     * but does not require dictionary lookup.
     */
    if ($rows === []) {
        return [];
    }

    $dictionaries = load_graphql_measurement_dictionaries($context);

    if (is_wp_error($dictionaries)) {
        throw_graphql_measurements_error($dictionaries);
    }

    /*
     * The saved collection is also the existing collection.
     * This permits unchanged references to inactive published entries.
     * Missing or incompatible references still produce an error.
     */
    $validated = validate_model_measurements(
        $rows,
        $dictionaries,
        $rows,
        false
    );

    if (is_wp_error($validated)) {
        throw_graphql_measurements_error($validated);
    }

    return present_graphql_measurements($validated, $dictionaries);
}

/**
 * Require valid plugin configuration containing the supported CPT.
 *
 * This integration intentionally supports the confirmed mapping:
 * WordPress CPT model -> GraphQL type Model.
 *
 * No fallback CPT is guessed and no configuration is changed.
 *
 * @return true|\WP_Error
 */
function validate_graphql_measurements_configuration()
{
    $configuration = get_measurements_plugin_configuration();

    if (is_wp_error($configuration)) {
        return $configuration;
    }

    if (
        !in_array(
            'model',
            $configuration['postTypes'],
            true
        )
    ) {
        return measurement_data_error(
            'gm_measurements_graphql_model_not_configured',
            'Чтение размеров через GraphQL недоступно: '
            . 'CPT model не включён в конфигурацию модуля размеров.'
        );
    }

    return true;
}

/**
 * Load dictionaries once for the current GraphQL application context.
 *
 * Both successful results and WP_Error results are cached.
 * A different context, site or user replaces the cached result.
 *
 * Only the most recent context is retained. No persistent cache,
 * metadata, options or transients are used.
 *
 * Without a recognized AppContext, load directly rather than sharing
 * a cache whose request boundary cannot be identified.
 *
 * This is a read-only snapshot for the current context. It must not
 * be reused as validation of a proposed dictionary write.
 *
 * @param mixed $context WPGraphQL application context.
 * @return array|\WP_Error
 */
function load_graphql_measurement_dictionaries($context)
{
    static $cached_context = null;
    static $cached_blog_id = null;
    static $cached_user_id = null;
    static $cached_result = null;

    if (!$context instanceof \WPGraphQL\AppContext) {
        return load_dictionaries();
    }

    $blog_id = get_current_blog_id();
    $user_id = get_current_user_id();

    if (
        $cached_context !== $context
        || $cached_blog_id !== $blog_id
        || $cached_user_id !== $user_id
    ) {
        $cached_context = null;
        $cached_blog_id = null;
        $cached_user_id = null;
        $cached_result = null;

        $result = load_dictionaries();

        $cached_context = $context;
        $cached_blog_id = $blog_id;
        $cached_user_id = $user_id;
        $cached_result = $result;
    }

    return $cached_result;
}

/**
 * Apply an additional read gate before accessing measurement metadata.
 *
 * WPGraphQL source restrictions are checked by the caller.
 * Drafts and other non-public statuses require edit permission.
 * Private posts require read permission.
 * Password-protected posts require edit permission.
 *
 * @param mixed $post Candidate WordPress post.
 * @return bool
 */
function graphql_measurements_can_read_post($post)
{
    if (
        !$post instanceof \WP_Post
        || $post->post_type !== 'model'
        || in_array($post->post_status, ['trash', 'auto-draft'], true)
    ) {
        return false;
    }

    $post_id = (int) $post->ID;

    if (
        $post->post_password !== ''
        && !current_user_can('edit_post', $post_id)
    ) {
        return false;
    }

    if (is_post_publicly_viewable($post)) {
        return true;
    }

    if ($post->post_status === 'private') {
        return current_user_can('read_post', $post_id);
    }

    return current_user_can('edit_post', $post_id);
}

/**
 * Enrich validated saved rows and apply the agreed ordering.
 *
 * Internal sort keys are removed before returning the collection.
 *
 * @param array $rows Validated saved measurements.
 * @param array $dictionaries Normalized runtime dictionaries.
 * @return array
 */
function present_graphql_measurements(
    array $rows,
    array $dictionaries
) {
    $presented = [];

    foreach ($rows as $row) {
        $definition = $dictionaries['definitions'][
            $row['definitionCode']
        ];

        $target = null;
        $element_order = 0.0;

        if (isset($row['target'])) {
            $element = $dictionaries['elements'][
                $row['target']['id']
            ];

            $target = [
                'kind'  => $row['target']['kind'],
                'id'    => $row['target']['id'],
                'label' => $element['label'],
            ];

            $element_order = $element['sortOrder'];
        }

        $presented[] = [
            'code'             => $row['definitionCode'],
            'label'            => $definition['label'],
            'description'      => $definition['description'],
            'group'            => $definition['group'],
            'valueMm'          => $row['valueMm'],
            'target'           => $target,
            'note'             => $row['note'] ?? null,
            '_definitionOrder' => $definition['sortOrder'],
            '_elementOrder'    => $element_order,
        ];
    }

    usort(
        $presented,
        __NAMESPACE__ . '\\compare_graphql_measurements'
    );

    foreach ($presented as &$measurement) {
        unset(
            $measurement['_definitionOrder'],
            $measurement['_elementOrder']
        );
    }

    unset($measurement);

    return $presented;
}

/**
 * Compare presentation rows using stable, locale-independent codes.
 *
 * @param array $left Left row.
 * @param array $right Right row.
 * @return int
 */
function compare_graphql_measurements(array $left, array $right)
{
    $comparison = strcmp($left['group'], $right['group']);

    if ($comparison !== 0) {
        return $comparison;
    }

    foreach (['_definitionOrder', '_elementOrder'] as $key) {
        $comparison = $left[$key] <=> $right[$key];

        if ($comparison !== 0) {
            return $comparison;
        }
    }

    $comparison = strcmp($left['code'], $right['code']);

    if ($comparison !== 0) {
        return $comparison;
    }

    foreach (['kind', 'id'] as $key) {
        $comparison = strcmp(
            $left['target'][$key] ?? '',
            $right['target'][$key] ?? ''
        );

        if ($comparison !== 0) {
            return $comparison;
        }
    }

    return 0;
}

/**
 * Report a failure without exposing internal configuration or data.
 *
 * The original error code remains available for troubleshooting.
 *
 * @param \WP_Error $error Configuration, data or dictionary error.
 * @return void
 * @throws \GraphQL\Error\UserError Always.
 */
function throw_graphql_measurements_error(\WP_Error $error)
{
    throw new \GraphQL\Error\UserError(
        sprintf(
            'Не удалось прочитать размеры модели. Код ошибки: %s.',
            $error->get_error_code()
        )
    );
}

add_action(
    'graphql_register_types',
    __NAMESPACE__ . '\\register_measurements_graphql_types'
);
