<?php
/**
 * Reading and normalization of measurement dictionaries.
 *
 * Includes validation of a proposed dictionary publication state.
 *
 * Dictionary CPTs and ACF fields are registered elsewhere.
 * This module does not register or modify them.
 *
 * Value fields are read from current WordPress post metadata.
 * ACF's value cache and formatting are deliberately not used.
 *
 * Published entries participate in the runtime dictionaries.
 * Inactive published entries remain available for resolving
 * previously stored measurements.
 *
 * This file does not register hooks or write data.
 *
 * @package GM_Model_Measurements
 */

namespace GlushkovModelling\ModelMeasurements;

defined('ABSPATH') || exit;

/**
 * Return value field names for a dictionary CPT.
 *
 * ACF underscore-prefixed field-reference metadata is excluded.
 *
 * @param string $post_type Dictionary CPT.
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
 * Read current raw dictionary value fields.
 *
 * Missing fields are represented as false.
 * Duplicate rows and recognizable noncanonical key aliases cause
 * an error instead of silently choosing a value.
 *
 * Alias detection covers case, trailing whitespace and Latin accents.
 * It is not an emulator for every possible database collation.
 *
 * No functions from dictionary-guards.php are required here.
 *
 * @param int    $post_id Existing dictionary post ID.
 * @param string $post_type Dictionary CPT.
 * @return array|\WP_Error
 */
function read_dictionary_value_fields($post_id, $post_type)
{
    $known_fields = dictionary_value_field_names($post_type);

    if ($known_fields === []) {
        return new \WP_Error(
            'gm_measurements_invalid_dictionary',
            'Неизвестный тип справочника измерений.'
        );
    }

    $canonical_by_folded = [];

    foreach ($known_fields as $name) {
        $canonical_by_folded[strtolower($name)] = $name;
    }

    $all_meta = get_post_meta($post_id);

    foreach ($all_meta as $stored_key => $values) {
        $folded = strtolower(rtrim(
            remove_accents((string) $stored_key),
            " \t\n\r\0\x0B"
        ));

        if (
            isset($canonical_by_folded[$folded])
            && $stored_key !== $canonical_by_folded[$folded]
        ) {
            return dictionary_entry_error(
                $post_id,
                'обнаружено неканоническое имя поля справочника; '
                . 'требуется отдельное исправление данных'
            );
        }
    }

    $fields = [];

    foreach ($known_fields as $name) {
        $values = get_post_meta($post_id, $name, false);

        if (count($values) > 1) {
            return dictionary_entry_error(
                $post_id,
                sprintf(
                    'поле %s имеет несколько метазаписей',
                    $name
                )
            );
        }

        $fields[$name] = $values === [] ? false : $values[0];
    }

    return $fields;
}

/**
 * Load both runtime dictionaries.
 *
 * Only published entries participate.
 * Inactive entries remain available for resolving saved references.
 *
 * @return array|\WP_Error
 */
function load_dictionaries()
{
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
 * Load one published dictionary indexed by stable codes.
 *
 * A candidate may be excluded when validating its proposed state.
 * No candidate data is written by this function.
 *
 * @param string $post_type Dictionary CPT.
 * @param int    $exclude_post_id Candidate ID to exclude.
 * @return array|\WP_Error
 */
function load_dictionary($post_type, $exclude_post_id = 0)
{
    if (
        !in_array(
            $post_type,
            ['measurement_defi', 'model_element'],
            true
        )
    ) {
        return new \WP_Error(
            'gm_measurements_invalid_dictionary',
            'Неизвестный тип справочника измерений.'
        );
    }

    if (!post_type_exists($post_type)) {
        return new \WP_Error(
            'gm_measurements_dictionary_unavailable',
            sprintf(
                'Тип записей %s не зарегистрирован.',
                $post_type
            )
        );
    }

    if (!is_int($exclude_post_id) || $exclude_post_id < 0) {
        return new \WP_Error(
            'gm_measurements_invalid_dictionary_exclusion',
            'Исключаемый ID справочной записи '
            . 'должен быть неотрицательным целым числом.'
        );
    }

    $args = [
        'post_type'        => $post_type,
        'post_status'      => 'publish',
        'posts_per_page'   => -1,
        'orderby'          => 'ID',
        'order'            => 'ASC',
        'no_found_rows'    => true,
        'suppress_filters' => true,
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

    uasort(
        $dictionary,
        static function ($left, $right) {
            $comparison = $left['sortOrder'] <=> $right['sortOrder'];

            return $comparison !== 0
                ? $comparison
                : strcmp($left['code'], $right['code']);
        }
    );

    return $dictionary;
}

/**
 * Normalize one dictionary entry.
 *
 * Overrides describe an unsaved proposed state:
 * - keys are canonical value field names, not ACF field keys;
 * - values are raw and unslashed.
 *
 * Stored fields are read directly from WordPress metadata.
 * The WP_Post object and metadata are never modified.
 *
 * @param \WP_Post $post Existing or cloned dictionary post.
 * @param string   $post_type Dictionary CPT.
 * @param array    $overrides Proposed field values.
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

    $stored = read_dictionary_value_fields(
        (int) $post->ID,
        $post_type
    );

    if (is_wp_error($stored)) {
        return $stored;
    }

    $fields = array_replace($stored, $overrides);
    $is_definition = $post_type === 'measurement_defi';
    $prefix = $is_definition ? 'measurement_' : 'element_';

    $read = static function ($suffix) use ($fields, $prefix) {
        return $fields[$prefix . $suffix];
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
            || !in_array(
                $target_kind,
                ['none', 'mast', 'yard'],
                true
            )
        ) {
            return dictionary_entry_error(
                $post->ID,
                'некорректный тип измеряемого элемента'
            );
        }

        $entry['group'] = $group;
        $entry['targetKind'] = $target_kind;

        if (
            $code === 'overall_length'
            && (
                $group !== 'overall'
                || $target_kind !== 'none'
                || $entry['active'] !== true
            )
        ) {
            return dictionary_entry_error(
                $post->ID,
                'системный вид overall_length должен иметь '
                . 'group=overall, target_kind=none и active=1'
            );
        }

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
                'ID родителя выходит за допустимый диапазон'
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
 * Validate the complete proposed publication state of a dictionary post.
 *
 * Caller supplies:
 * - an existing dictionary post ID;
 * - an optional unslashed proposed title;
 * - optional unslashed raw field overrides.
 *
 * Authorization and conversion from ACF field keys belong to the
 * request-handling layer.
 *
 * New records without an ID must first be saved as drafts.
 *
 * This function does not save fields, change status or register hooks.
 *
 * @param int         $post_id Existing dictionary post ID.
 * @param string|null $proposed_title Proposed title or null.
 * @param array       $overrides Proposed field values.
 * @return array|\WP_Error
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
     * Never modify a shared cached WP_Post instance.
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
     * Include drafts, trash and all other registered statuses.
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
        'suppress_filters' => true,
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
        return $candidate;
    }

    /*
     * Build a prospective published element dictionary.
     * Exclude the stored version and insert the candidate instead.
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
     * Resolves the complete prospective hierarchy, including:
     * - self references;
     * - cycles;
     * - missing or unpublished parents;
     * - broken ancestor chains;
     * - existing children referencing this candidate by database ID.
     */
    $validated = validate_element_hierarchy($elements);

    if (is_wp_error($validated)) {
        return $validated;
    }

    return $validated[$candidate['code']];
}

/**
 * Resolve parent references and reject hierarchy errors.
 *
 * Input entries must already be normalized and indexed by stable code.
 *
 * A parent may have a different kind: a yard may belong to a mast.
 * No implicit measurement inheritance is introduced.
 *
 * @param array $elements Normalized elements indexed by stable code.
 * @return array|\WP_Error
 */
function validate_element_hierarchy(array $elements)
{
    $codes_by_id = [];

    foreach ($elements as $code => $element) {
        $database_id = $element['databaseId'];

        if (isset($codes_by_id[$database_id])) {
            return dictionary_entry_error(
                $database_id,
                'одна запись элемента присутствует '
                . 'в справочнике несколько раз'
            );
        }

        $codes_by_id[$database_id] = $code;
    }

    foreach ($elements as $code => $element) {
        $parent_id = $element['parentDatabaseId'];

        /*
         * Recompute parentCode instead of trusting a previous result.
         */
        $elements[$code]['parentCode'] = null;

        if ($parent_id === null) {
            continue;
        }

        if (!isset($codes_by_id[$parent_id])) {
            return dictionary_entry_error(
                $element['databaseId'],
                sprintf(
                    'родитель %d отсутствует '
                    . 'среди опубликованных элементов',
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

        while (
            $current !== null
            && !isset($completed[$current])
        ) {
            if (isset($path[$current])) {
                return dictionary_entry_error(
                    $elements[$current]['databaseId'],
                    sprintf(
                        'обнаружен цикл родительских связей '
                        . 'у элемента %s',
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
 * @param int    $post_id Dictionary post ID.
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
