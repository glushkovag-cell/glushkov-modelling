<?php
/**
 * Read-only GraphQL presentation of model measurements.
 *
 * Requires dictionaries.php, measurements.php and validation.php.
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
 * Resolve measurements only after checking access.
 *
 * Invalid stored data produces a field error, never an empty fallback.
 *
 * @param mixed $source WPGraphQL post model.
 * @return array|null
 * @throws \GraphQL\Error\UserError When measurement data is invalid.
 */
function resolve_graphql_measurements($source)
{
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

    $rows = get_model_measurements($post_id);

    if (is_wp_error($rows)) {
        throw_graphql_measurements_error($rows);
    }

    /*
     * A genuinely empty collection does not require dictionary lookup.
     * This is a read operation, not publication validation.
     */
    if ($rows === []) {
        return [];
    }

    $dictionaries = load_dictionaries();

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
            'code'        => $row['definitionCode'],
            'label'       => $definition['label'],
            'description' => $definition['description'],
            'group'       => $definition['group'],
            'valueMm'     => $row['valueMm'],
            'target'      => $target,
            'note'        => $row['note'] ?? null,
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
 * Report a data failure without exposing internal dictionary details.
 *
 * The original error code remains available for troubleshooting.
 *
 * @param \WP_Error $error Data or dictionary error.
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
