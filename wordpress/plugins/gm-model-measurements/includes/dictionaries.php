<?php
/**
 * Reading and normalization of measurement dictionaries.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Load both dictionaries.
 *
 * Only published dictionary entries participate in the contract.
 * Inactive entries remain available for resolving saved measurements.
 *
 * @return array|\WP_Error
 */
function load_dictionaries()
{
    if (!function_exists('get_field')) {
        return new \WP_Error(
            'gm_measurements_acf_unavailable',
            'Для работы справочников измерений требуется активный ACF.'
        );
    }

    $definitions = load_dictionary('measurement_defi');

    if (is_wp_error($definitions)) {
        return $definitions;
    }

    $elements = load_dictionary('model_element');

    if (is_wp_error($elements)) {
        return $elements;
    }

    $hierarchy = validate_element_hierarchy($elements);

    if (is_wp_error($hierarchy)) {
        return $hierarchy;
    }

    return [
        'definitions' => $definitions,
        'elements'    => $hierarchy,
    ];
}

/**
 * Load a dictionary indexed by its stable codes.
 *
 * @param string $post_type Supported dictionary post type.
 * @return array|\WP_Error
 */
function load_dictionary($post_type)
{
    if (!in_array($post_type, ['measurement_defi', 'model_element'], true)) {
        return new \WP_Error(
            'gm_measurements_invalid_dictionary',
            'Неизвестный тип справочника измерений.'
        );
    }

    if (!post_type_exists($post_type)) {
        return new \WP_Error(
            'gm_measurements_dictionary_unavailable',
            sprintf('Тип записей %s не зарегистрирован.', $post_type)
        );
    }

    $posts = get_posts([
        'post_type'        => $post_type,
        'post_status'      => 'publish',
        'posts_per_page'   => -1,
        'orderby'          => 'ID',
        'order'            => 'ASC',
        'no_found_rows'    => true,
        'suppress_filters' => false,
    ]);

    $dictionary = [];

    foreach ($posts as $post) {
        $entry = normalize_dictionary_entry($post, $post_type);

        if (is_wp_error($entry)) {
            return $entry;
        }

        $code = $entry['code'];

        if (isset($dictionary[$code])) {
            return new \WP_Error(
                'gm_measurements_duplicate_dictionary_code',
                sprintf(
                    'Код %s повторяется в записях %d и %d.',
                    $code,
                    $dictionary[$code]['databaseId'],
                    $entry['databaseId']
                )
            );
        }

        $dictionary[$code] = $entry;
    }

    uasort($dictionary, static function ($left, $right) {
        $comparison = $left['sortOrder'] <=> $right['sortOrder'];

        return $comparison !== 0
            ? $comparison
            : strcmp($left['code'], $right['code']);
    });

    return $dictionary;
}

/**
 * Normalize a published ACF dictionary entry.
 *
 * Unformatted ACF values are used deliberately:
 * select fields are scalars and post_object is a stored post ID.
 *
 * @param \WP_Post $post      Dictionary entry.
 * @param string   $post_type Dictionary post type.
 * @return array|\WP_Error
 */
function normalize_dictionary_entry($post, $post_type)
{
    $is_definition = $post_type === 'measurement_defi';
    $prefix = $is_definition ? 'measurement_' : 'element_';

    $read = static function ($suffix) use ($post, $prefix) {
        return get_field($prefix . $suffix, $post->ID, false);
    };

    $code = $read('code');
    $label = trim(wp_strip_all_tags($post->post_title));

    if (
        !is_string($code)
        || !preg_match('/^[a-z][a-z0-9_]*$/D', $code)
    ) {
        return dictionary_entry_error(
            $post->ID,
            'код должен начинаться с латинской буквы '
            . 'и содержать только a–z, 0–9 и подчёркивания'
        );
    }

    if ($label === '') {
        return dictionary_entry_error($post->ID, 'не указано название');
    }

    $description = $read('description');

    if (
        $description !== false
        && $description !== null
        && !is_string($description)
    ) {
        return dictionary_entry_error(
            $post->ID,
            'описание должно быть текстом'
        );
    }

    $description = is_string($description) ? trim($description) : '';

    if ($is_definition && $description === '') {
        return dictionary_entry_error(
            $post->ID,
            'не указано определение измерения'
        );
    }

    $active = $read('active');

    if (!in_array($active, [true, false, 1, 0, '1', '0'], true)) {
        return dictionary_entry_error(
            $post->ID,
            'некорректный признак активности'
        );
    }

    $sort_order = $read('sort_order');

    if (
        $sort_order === ''
        || $sort_order === null
        || $sort_order === false
    ) {
        $sort_order = 100;
    }

    if (
        !is_scalar($sort_order)
        || is_bool($sort_order)
        || !is_numeric($sort_order)
        || !is_finite((float) $sort_order)
    ) {
        return dictionary_entry_error(
            $post->ID,
            'порядок отображения должен быть конечным числом'
        );
    }

    $entry = [
        'databaseId'  => (int) $post->ID,
        'code'        => $code,
        'label'       => $label,
        'description' => $description,
        'sortOrder'   => (float) $sort_order,
        'active'      => in_array($active, [true, 1, '1'], true),
    ];

    if ($is_definition) {
        $group = $read('group');
        $target_kind = $read('target_kind');

        if (
            !is_string($group)
            || !in_array(
                $group,
                ['overall', 'hull', 'rig', 'armament', 'other'],
                true
            )
        ) {
            return dictionary_entry_error(
                $post->ID,
                'некорректная группа измерения'
            );
        }

        if (
            !is_string($target_kind)
            || !in_array($target_kind, ['none', 'mast', 'yard'], true)
        ) {
            return dictionary_entry_error(
                $post->ID,
                'некорректный тип измеряемого элемента'
            );
        }

        $entry['group'] = $group;
        $entry['targetKind'] = $target_kind;

        return $entry;
    }

    $kind = $read('kind');

    if (
        !is_string($kind)
        || !in_array($kind, ['mast', 'yard'], true)
    ) {
        return dictionary_entry_error(
            $post->ID,
            'некорректный тип элемента'
        );
    }

    $parent = $read('parent');

    if (in_array($parent, [false, null, '', 0, '0'], true)) {
        $parent_id = null;
    } elseif (
        (is_int($parent) && $parent > 0)
        || (is_string($parent) && preg_match('/^[1-9][0-9]*$/D', $parent))
    ) {
        $parent_id = filter_var(
            $parent,
            FILTER_VALIDATE_INT,
            ['options' => ['min_range' => 1]]
        );

        if ($parent_id === false) {
            return dictionary_entry_error(
                $post->ID,
                'некорректный ID родителя'
            );
        }
    } else {
        return dictionary_entry_error(
            $post->ID,
            'родитель должен быть одной ссылкой на элемент'
        );
    }

    $entry['kind'] = $kind;
    $entry['parentDatabaseId'] = $parent_id;
    $entry['parentCode'] = null;

    return $entry;
}

/**
 * Resolve parents and reject missing references and hierarchy cycles.
 *
 * A parent may have a different kind: for example, a yard may belong
 * to a mast. No implicit measurement inheritance is introduced.
 *
 * @param array $elements Elements indexed by stable code.
 * @return array|\WP_Error
 */
function validate_element_hierarchy(array $elements)
{
    $codes_by_id = [];

    foreach ($elements as $code => $element) {
        $codes_by_id[$element['databaseId']] = $code;
    }

    foreach ($elements as $code => $element) {
        $parent_id = $element['parentDatabaseId'];

        if ($parent_id === null) {
            continue;
        }

        if (!isset($codes_by_id[$parent_id])) {
            return dictionary_entry_error(
                $element['databaseId'],
                sprintf(
                    'родитель %d отсутствует среди опубликованных элементов',
                    $parent_id
                )
            );
        }

        $elements[$code]['parentCode'] = $codes_by_id[$parent_id];
    }

    $completed = [];

    foreach (array_keys($elements) as $start) {
        $path = [];
        $current = $start;

        while ($current !== null && !isset($completed[$current])) {
            if (isset($path[$current])) {
                return dictionary_entry_error(
                    $elements[$current]['databaseId'],
                    sprintf(
                        'обнаружен цикл родительских связей у элемента %s',
                        $current
                    )
                );
            }

            $path[$current] = true;
            $current = $elements[$current]['parentCode'];
        }

        foreach (array_keys($path) as $code) {
            $completed[$code] = true;
        }
    }

    return $elements;
}

/**
 * Build an actionable dictionary validation error.
 *
 * @param int    $post_id Entry ID.
 * @param string $reason Validation failure.
 * @return \WP_Error
 */
function dictionary_entry_error($post_id, $reason)
{
    return new \WP_Error(
        'gm_measurements_invalid_dictionary_entry',
        sprintf(
            'Ошибка справочника, запись %d: %s.',
            (int) $post_id,
            $reason
        ),
        ['postId' => (int) $post_id]
    );
}
