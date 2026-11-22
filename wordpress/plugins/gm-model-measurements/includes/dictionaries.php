<?php
/**
 * Reading and normalization of measurement dictionaries.
 *
 * Includes validation of a proposed dictionary publication state.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Return known value field names for one dictionary type.
 *
 * @param string $post_type Dictionary post type.
 * @return string[]
 */
function dictionary_value_field_names($post_type)
{
    if ($post_type === 'measurement_defi') {
        return [
            'measurement_code',
            'measurement_group',
            'measurement_target_kind',
            'measurement_description',
            'measurement_sort_order',
            'measurement_active',
        ];
    }

    if ($post_type === 'model_element') {
        return [
            'element_code',
            'element_kind',
            'element_parent',
            'element_description',
            'element_sort_order',
            'element_active',
        ];
    }

    return [];
}

/**
 * Load both dictionaries.
 *
 * Only published entries participate in the contract.
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
 * Load a published dictionary indexed by stable codes.
 *
 * A candidate entry may be excluded when validating its proposed
 * replacement. This permits validation without first writing changes.
 *
 * @param string $post_type       Dictionary post type.
 * @param int    $exclude_post_id Optional candidate ID to exclude.
 * @return array|\WP_Error
 */
function load_dictionary($post_type, $exclude_post_id = 0)
{
    if (!in_array($post_type, ['measurement_defi', 'model_element'], true)) {
        return new \WP_Error(
            'gm_measurements_invalid_dictionary',
            'Неизвестный тип справочника измерений.'
        );
    }

    if (!function_exists('get_field')) {
        return new \WP_Error(
            'gm_measurements_acf_unavailable',
            'Для работы справочников измерений требуется активный ACF.'
        );
    }

    if (!post_type_exists($post_type)) {
        return new \WP_Error(
            'gm_measurements_dictionary_unavailable',
            sprintf('Тип записей %s не зарегистрирован.', $post_type)
        );
    }

    if (!is_int($exclude_post_id) || $exclude_post_id < 0) {
        return new \WP_Error(
            'gm_measurements_invalid_dictionary_exclusion',
            'Исключаемый ID справочной записи должен быть целым числом.'
        );
    }

    $args = [
        'post_type'        => $post_type,
        'post_status'      => 'publish',
        'posts_per_page'   => -1,
        'orderby'          => 'ID',
        'order'            => 'ASC',
        'no_found_rows'    => true,
        'suppress_filters' => false,
    ];

    if ($exclude_post_id > 0) {
        $args['post__not_in'] = [$exclude_post_id];
    }

    $posts = get_posts($args);
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
 * Normalize one dictionary entry.
 *
 * Unformatted ACF values are used deliberately.
 *
 * Overrides contain unslashed raw values indexed by ACF field names.
 * They describe a proposed state and are never written by this function.
 *
 * @param \WP_Post $post       Existing or cloned dictionary post.
 * @param string   $post_type  Dictionary post type.
 * @param array    $overrides  Proposed raw field values.
 * @return array|\WP_Error
 */
function normalize_dictionary_entry(
    $post,
    $post_type,
    array $overrides = []
) {
    if (
        !$post instanceof \WP_Post
        || !in_array(
            $post_type,
            ['measurement_defi', 'model_element'],
            true
        )
        || $post->post_type !== $post_type
    ) {
        return new \WP_Error(
            'gm_measurements_invalid_dictionary_post',
            'Передана некорректная справочная запись.'
        );
    }

    $known_fields = dictionary_value_field_names($post_type);

    if (array_diff(array_keys($overrides), $known_fields) !== []) {
        return dictionary_entry_error(
            $post->ID,
            'предполагаемое состояние содержит неизвестные поля'
        );
    }

    if (!function_exists('get_field')) {
        return new \WP_Error(
            'gm_measurements_acf_unavailable',
            'Для работы справочников измерений требуется активный ACF.'
        );
    }

    $is_definition = $post_type === 'measurement_defi';
    $prefix = $is_definition ? 'measurement_' : 'element_';

    $read = static function ($suffix) use (
        $post,
        $prefix,
        $overrides
    ) {
        $name = $prefix . $suffix;

        if (array_key_exists($name, $overrides)) {
            return $overrides[$name];
        }

        return get_field($name, $post->ID, false);
    };

    $code = $read('code');
    $label = trim(wp_strip_all_tags($post->post_title));

    if (
        !is_string($code)
        || preg_match('/^[a-z][a-z0-9_]*$/D', $code) !== 1
    ) {
        return dictionary_entry_error(
            $post->ID,
            'код должен начинаться с латинской буквы '
            . 'и содержать только a–z, 0–9 и подчёркивания'
        );
    }

    if ($label === '') {
        return dictionary_entry_error(
            $post->ID,
            'не указано название'
        );
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

    $description = is_string($description)
        ? trim($description)
        : '';

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
        || (
            is_string($parent)
            && preg_match('/^[1-9][0-9]*$/D', $parent) === 1
        )
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
 * Validate the complete proposed state of an existing dictionary post.
 *
 * This function does not save data, change statuses or register hooks.
 *
 * The caller must supply:
 * - an existing dictionary post ID;
 * - an optional unslashed proposed title;
 * - optional unslashed raw field overrides.
 *
 * Overrides must use ACF field names, not ACF field keys.
 * Request authorization and conversion from ACF keys belong to
 * the request-handling layer.
 *
 * A new post without an ID must first exist as a draft/auto-draft.
 *
 * @param int         $post_id        Existing dictionary post ID.
 * @param string|null $proposed_title Proposed title or null to retain it.
 * @param array       $overrides      Proposed raw field values.
 * @return array|\WP_Error Normalized candidate or validation error.
 */
function validate_dictionary_publication_candidate(
    $post_id,
    $proposed_title = null,
    array $overrides = []
) {
    if (!is_int($post_id) || $post_id <= 0) {
        return new \WP_Error(
            'gm_measurements_invalid_dictionary_candidate_id',
            'Для проверки публикации требуется ID существующей '
            . 'справочной записи. Сначала сохраните черновик.'
        );
    }

    $post = get_post($post_id);

    if (
        !$post instanceof \WP_Post
        || !in_array(
            $post->post_type,
            ['measurement_defi', 'model_element'],
            true
        )
    ) {
        return new \WP_Error(
            'gm_measurements_dictionary_candidate_not_found',
            'Справочная запись для проверки публикации не найдена.'
        );
    }

    if (
        $proposed_title !== null
        && !is_string($proposed_title)
    ) {
        return dictionary_entry_error(
            $post_id,
            'предполагаемое название должно быть строкой'
        );
    }

    /*
     * Clone the post: never modify a shared cached WP_Post instance.
     */
    $candidate_post = clone $post;

    if ($proposed_title !== null) {
        $candidate_post->post_title = $proposed_title;
    }

    $candidate = normalize_dictionary_entry(
        $candidate_post,
        $post->post_type,
        $overrides
    );

    if (is_wp_error($candidate)) {
        return $candidate;
    }

    /*
     * Enforce uniqueness across drafts, trash and other statuses too.
     * This is a preflight check, not a database uniqueness constraint.
     */
    $code_key = $post->post_type === 'measurement_defi'
        ? 'measurement_code'
        : 'element_code';

    $duplicates = get_posts([
        'post_type'        => $post->post_type,
        'post_status'      => array_values(get_post_stati()),
        'posts_per_page'   => 1,
        'fields'           => 'ids',
        'post__not_in'     => [$post_id],
        'meta_key'         => $code_key,
        'meta_value'       => $candidate['code'],
        'no_found_rows'    => true,
        'suppress_filters' => false,
    ]);

    if ($duplicates !== []) {
        return dictionary_entry_error(
            $post_id,
            sprintf(
                'код %s уже занят записью %d, '
                . 'включая черновики и корзину',
                $candidate['code'],
                (int) reset($duplicates)
            )
        );
    }

    if ($post->post_type === 'measurement_defi') {
        if (
            $candidate['code'] === 'overall_length'
            && (
                $candidate['group'] !== 'overall'
                || $candidate['targetKind'] !== 'none'
                || $candidate['active'] !== true
            )
        ) {
            return dictionary_entry_error(
                $post_id,
                'системный вид overall_length должен иметь '
                . 'group=overall, target_kind=none и active=1'
            );
        }

        return $candidate;
    }

    /*
     * Replace the current entry with the candidate in a prospective
     * published element dictionary.
     *
     * Excluding the stored entry before loading also allows repair
     * of that entry when its old stored state is malformed.
     */
    $elements = load_dictionary('model_element', $post_id);

    if (is_wp_error($elements)) {
        return $elements;
    }

    if (isset($elements[$candidate['code']])) {
        return dictionary_entry_error(
            $post_id,
            'код элемента повторяется в опубликованном справочнике'
        );
    }

    $elements[$candidate['code']] = $candidate;

    /*
     * Resolve the complete prospective hierarchy.
     *
     * This rejects:
     * - self references;
     * - cycles;
     * - references to unpublished/missing parents;
     * - broken ancestor chains.
     *
     * Existing published child references to this candidate are
     * resolved using its unchanged database ID.
     */
    $validated = validate_element_hierarchy($elements);

    if (is_wp_error($validated)) {
        return $validated;
    }

    return $validated[$candidate['code']];
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
