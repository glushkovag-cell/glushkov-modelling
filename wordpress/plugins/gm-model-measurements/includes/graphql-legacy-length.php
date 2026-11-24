<?php
/**
 * Legacy GraphQL length backed by canonical model measurements.
 *
 * Requires includes/graphql.php.
 *
 * Preserves the existing ACF GraphQL field registration and type.
 * Does not read, write, delete or synchronize legacy metadata.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Replace only the resolver for Modelinfo.modellength.
 *
 * WPGraphQL for ACF passes the owning content node in $root['node'].
 * Leave field type, description and other configuration unchanged.
 *
 * @param mixed $field_config GraphQL field configuration.
 * @param mixed $instance WPGraphQL for ACF FieldConfig.
 * @return mixed
 */
function configure_legacy_model_length_graphql(
    $field_config,
    $instance
) {
    if (
        !is_array($field_config)
        || !is_object($instance)
        || !is_callable([
            $instance,
            'get_graphql_field_group_type_name',
        ])
        || !is_callable([
            $instance,
            'get_graphql_field_name',
        ])
    ) {
        return $field_config;
    }

    if (
        $instance->get_graphql_field_group_type_name()
            !== 'Modelinfo'
        || $instance->get_graphql_field_name()
            !== 'modellength'
    ) {
        return $field_config;
    }

    $field_config['resolve'] =
        __NAMESPACE__ . '\\resolve_legacy_model_length_graphql';

    return $field_config;
}

/**
 * Resolve the legacy string from the canonical measurement collection.
 *
 * Access control, configuration checks, dictionary resolution and
 * stored-data validation are delegated to the measurements resolver.
 *
 * Missing length or inaccessible data returns null.
 * Invalid stored data produces a nullable GraphQL field error,
 * consistently with Model.measurements.
 *
 * @param mixed $root ACF field-group source.
 * @param mixed $args GraphQL arguments.
 * @param mixed $context WPGraphQL application context.
 * @param mixed $info GraphQL resolve information; unused.
 * @return string|null
 * @throws \GraphQL\Error\UserError On invalid configuration or data.
 */
function resolve_legacy_model_length_graphql(
    $root,
    $args = [],
    $context = null,
    $info = null
) {
    $node = is_array($root)
        ? ($root['node'] ?? null)
        : null;

    if (!$node instanceof \WPGraphQL\Model\Post) {
        return null;
    }

    $measurements = resolve_graphql_measurements(
        $node,
        $args,
        $context
    );

    if ($measurements === null) {
        return null;
    }

    return legacy_length_string_from_graphql_measurements(
        $measurements
    );
}

/**
 * Extract exactly one model-wide overall_length.
 *
 * JSON numeric encoding avoids locale-dependent decimal separators
 * and does not impose a fixed number of decimal places.
 *
 * @param array $measurements Validated presentation rows.
 * @return string|null
 */
function legacy_length_string_from_graphql_measurements(
    array $measurements
) {
    $matches = [];

    foreach ($measurements as $measurement) {
        if (
            !is_array($measurement)
            || ($measurement['code'] ?? null) !== 'overall_length'
            || ($measurement['target'] ?? null) !== null
        ) {
            continue;
        }

        $matches[] = $measurement['valueMm'] ?? null;
    }

    if (count($matches) !== 1) {
        return null;
    }

    $value = $matches[0];

    if (
        (!is_int($value) && !is_float($value))
        || !is_finite((float) $value)
        || $value <= 0
    ) {
        return null;
    }

    $encoded = json_encode($value);

    return is_string($encoded) ? $encoded : null;
}

add_filter(
    'wpgraphql/acf/get_graphql_field_config',
    __NAMESPACE__ . '\\configure_legacy_model_length_graphql',
    20,
    2
);
