<?php
/**
 * Standalone unit tests for includes/graphql.php.
 *
 * Run in a separate PHP CLI process without WordPress.
 *
 * External dependencies are replaced with minimal test doubles.
 * These tests do not validate WordPress authorization, dictionary
 * validation, GraphQL execution, or the installed WPGraphQL version.
 *
 * @package GM_Model_Measurements
 */

namespace {
    if (PHP_SAPI !== 'cli') {
        http_response_code(403);
        exit;
    }

    if (
        defined('ABSPATH')
        || class_exists('WP_Error', false)
        || class_exists('WPGraphQL\\AppContext', false)
    ) {
        fwrite(
            STDERR,
            "Run this test in a separate PHP process without WordPress.\n"
        );
        exit(1);
    }

    define('ABSPATH', __DIR__ . '/');

    error_reporting(E_ALL);

    set_error_handler(
        static function ($severity, $message, $file, $line) {
            if (!(error_reporting() & $severity)) {
                return false;
            }

            throw new \ErrorException(
                $message,
                0,
                $severity,
                $file,
                $line
            );
        }
    );

    /*
     * Conditional declarations are executed only after the
     * environment check above.
     */
    if (!class_exists('WP_Error', false)) {
        /**
         * Minimal error double for configuration and cache tests.
         */
        class WP_Error
        {
            private $code;
            private $message;
            private $data;

            public function __construct(
                $code = '',
                $message = '',
                $data = null
            ) {
                $this->code = $code;
                $this->message = $message;
                $this->data = $data;
            }

            public function get_error_code()
            {
                return $this->code;
            }

            public function get_error_message()
            {
                return $this->message;
            }

            public function get_error_data()
            {
                return $this->data;
            }
        }
    }

    function is_wp_error($value)
    {
        return $value instanceof WP_Error;
    }

    function get_current_blog_id()
    {
        return $GLOBALS['gm_graphql_unit']['blogId'];
    }

    function get_current_user_id()
    {
        return $GLOBALS['gm_graphql_unit']['userId'];
    }

    function add_action($hook, $callback, $priority = 10, $args = 1)
    {
        $GLOBALS['gm_graphql_unit']['hooks'][] = [
            $hook,
            $callback,
            $priority,
            $args,
        ];
    }

    function register_graphql_object_type($name, $configuration)
    {
        $GLOBALS['gm_graphql_unit']['types'][$name] = $configuration;
    }

    function register_graphql_field($type, $name, $configuration)
    {
        $GLOBALS['gm_graphql_unit']['fields'][$type][$name] =
            $configuration;
    }
}

namespace WPGraphQL {
    if (!class_exists(AppContext::class, false)) {
        /**
         * Identity-only double, not a compatibility simulation.
         */
        class AppContext
        {
        }
    }
}

namespace GlushkovModelling\ModelMeasurements {
    /**
     * Configuration dependency double.
     */
    function get_measurements_plugin_configuration()
    {
        return $GLOBALS['gm_graphql_unit']['configuration'];
    }

    /**
     * Dictionary loader double with a call counter.
     */
    function load_dictionaries()
    {
        ++$GLOBALS['gm_graphql_unit']['dictionaryCalls'];

        return $GLOBALS['gm_graphql_unit']['dictionaryResult'];
    }

    function measurement_data_error(
        $code,
        $message,
        array $data = []
    ) {
        return new \WP_Error($code, $message, $data);
    }
}

namespace GlushkovModelling\ModelMeasurements\Tests {
    use WPGraphQL\AppContext;

    use function GlushkovModelling\ModelMeasurements\compare_graphql_measurements;
    use function GlushkovModelling\ModelMeasurements\load_graphql_measurement_dictionaries;
    use function GlushkovModelling\ModelMeasurements\present_graphql_measurements;
    use function GlushkovModelling\ModelMeasurements\register_measurements_graphql_types;
    use function GlushkovModelling\ModelMeasurements\validate_graphql_measurements_configuration;

    function reset_environment()
    {
        $GLOBALS['gm_graphql_unit'] = [
            'blogId' => 1,
            'userId' => 0,
            'configuration' => [
                'postTypes' => ['model'],
                'requireOverallLength' => false,
            ],
            'dictionaryCalls' => 0,
            'dictionaryResult' => [
                'definitions' => [],
                'elements' => [],
            ],
            'hooks' => [],
            'types' => [],
            'fields' => [],
        ];
    }

    function same($expected, $actual)
    {
        if ($expected !== $actual) {
            throw new \RuntimeException(
                "Values differ.\nExpected: "
                . var_export($expected, true)
                . "\nActual: "
                . var_export($actual, true)
            );
        }
    }

    function check($condition, $message)
    {
        if (!$condition) {
            throw new \RuntimeException($message);
        }
    }

    function definition($code, $group, $order)
    {
        return [
            'code' => $code,
            'label' => 'Label ' . $code,
            'description' => 'Description ' . $code,
            'group' => $group,
            'sortOrder' => $order,
        ];
    }

    function comparison_row(array $overrides = [])
    {
        return array_replace(
            [
                'group' => 'rig',
                '_definitionOrder' => 10.0,
                '_elementOrder' => 20.0,
                'code' => 'mast_height',
                'target' => [
                    'kind' => 'mast',
                    'id' => 'main_mast',
                ],
            ],
            $overrides
        );
    }

    reset_environment();

    require dirname(__DIR__) . '/includes/graphql.php';

    $tests = [];

    $tests['registration callback is attached'] = static function () {
        same(
            [
                [
                    'graphql_register_types',
                    'GlushkovModelling\\ModelMeasurements'
                        . '\\register_measurements_graphql_types',
                    10,
                    1,
                ],
            ],
            $GLOBALS['gm_graphql_unit']['hooks']
        );
    };

    $tests['registration declares the intended field types'] =
        static function () {
            register_measurements_graphql_types();

            $state = $GLOBALS['gm_graphql_unit'];

            $measurement = $state['types']['GmModelMeasurement']['fields'];
            $target = $state['types']['GmModelMeasurementTarget']['fields'];

            same(
                ['list_of' => ['non_null' => 'GmModelMeasurement']],
                $state['fields']['Model']['measurements']['type']
            );

            foreach (
                ['code', 'label', 'description', 'group']
                as $name
            ) {
                same(
                    ['non_null' => 'String'],
                    $measurement[$name]['type']
                );
            }

            same(
                ['non_null' => 'Float'],
                $measurement['valueMm']['type']
            );

            same(
                'GmModelMeasurementTarget',
                $measurement['target']['type']
            );

            same('String', $measurement['note']['type']);

            foreach (['kind', 'id', 'label'] as $name) {
                same(
                    ['non_null' => 'String'],
                    $target[$name]['type']
                );
            }

            check(
                is_callable(
                    $state['fields']['Model']['measurements']['resolve']
                ),
                'Registered resolver is not callable.'
            );
        };

    $tests['empty presentation is an empty list'] = static function () {
        same(
            [],
            present_graphql_measurements(
                [],
                ['definitions' => [], 'elements' => []]
            )
        );
    };

    $tests['presentation maps saved codes and preserves numeric precision'] =
        static function () {
            $value = 123.4567890123;

            $dictionaries = [
                'definitions' => [
                    'hull_width' => definition(
                        'hull_width',
                        'hull',
                        10.5
                    ),
                ],
                'elements' => [],
            ];

            $rows = [
                [
                    'definitionCode' => 'hull_width',
                    'valueMm' => $value,
                ],
            ];

            $original_rows = $rows;
            $original_dictionaries = $dictionaries;

            same(
                [
                    [
                        'code' => 'hull_width',
                        'label' => 'Label hull_width',
                        'description' => 'Description hull_width',
                        'group' => 'hull',
                        'valueMm' => $value,
                        'target' => null,
                        'note' => null,
                    ],
                ],
                present_graphql_measurements($rows, $dictionaries)
            );

            same($original_rows, $rows);
            same($original_dictionaries, $dictionaries);
        };

    $tests['target label comes from dictionary and id stays a stable code'] =
        static function () {
            $dictionaries = [
                'definitions' => [
                    'mast_height' => definition(
                        'mast_height',
                        'rig',
                        10.0
                    ),
                ],
                'elements' => [
                    'main_mast' => [
                        'databaseId' => 987,
                        'code' => 'main_mast',
                        'label' => 'Main mast',
                        'sortOrder' => 30.0,
                    ],
                ],
            ];

            $result = present_graphql_measurements(
                [
                    [
                        'definitionCode' => 'mast_height',
                        'valueMm' => 456.125,
                        'target' => [
                            'kind' => 'mast',
                            'id' => 'main_mast',
                        ],
                        'note' => "First line\nSecond line",
                    ],
                ],
                $dictionaries
            );

            same(
                [
                    'kind' => 'mast',
                    'id' => 'main_mast',
                    'label' => 'Main mast',
                ],
                $result[0]['target']
            );

            same("First line\nSecond line", $result[0]['note']);

            same(
                [
                    'code',
                    'label',
                    'description',
                    'group',
                    'valueMm',
                    'target',
                    'note',
                ],
                array_keys($result[0])
            );
        };

    $tests['groups are alphabetic without overall_length priority'] =
        static function () {
            $dictionaries = [
                'definitions' => [],
                'elements' => [],
            ];
            $rows = [];

            foreach (
                [
                    'rig' => 'rig_length',
                    'overall' => 'overall_length',
                    'other' => 'other_length',
                    'hull' => 'hull_length',
                    'armament' => 'armament_length',
                ]
                as $group => $code
            ) {
                $dictionaries['definitions'][$code] =
                    definition($code, $group, 10.0);

                $rows[] = [
                    'definitionCode' => $code,
                    'valueMm' => 100.0,
                ];
            }

            $result = present_graphql_measurements(
                $rows,
                $dictionaries
            );

            same(
                ['armament', 'hull', 'other', 'overall', 'rig'],
                array_column($result, 'group')
            );

            same('overall_length', $result[3]['code']);
        };

    $tests['presentation sorts definitions and elements before codes'] =
        static function () {
            $dictionaries = [
                'definitions' => [
                    'z_height' => definition(
                        'z_height',
                        'rig',
                        1.5
                    ),
                    'a_height' => definition(
                        'a_height',
                        'rig',
                        2.5
                    ),
                ],
                'elements' => [
                    'a_mast' => [
                        'label' => 'A mast',
                        'sortOrder' => 20.0,
                    ],
                    'z_mast' => [
                        'label' => 'Z mast',
                        'sortOrder' => 10.0,
                    ],
                ],
            ];

            $rows = [];

            foreach (
                [
                    ['a_height', 'z_mast'],
                    ['z_height', 'a_mast'],
                    ['z_height', 'z_mast'],
                ]
                as $identity
            ) {
                $rows[] = [
                    'definitionCode' => $identity[0],
                    'valueMm' => 10.25,
                    'target' => [
                        'kind' => 'mast',
                        'id' => $identity[1],
                    ],
                ];
            }

            $result = present_graphql_measurements(
                $rows,
                $dictionaries
            );

            same(
                [
                    ['z_height', 'z_mast'],
                    ['z_height', 'a_mast'],
                    ['a_height', 'z_mast'],
                ],
                array_map(
                    static function ($row) {
                        return [
                            $row['code'],
                            $row['target']['id'],
                        ];
                    },
                    $result
                )
            );
        };

    $sort_cases = [
        'group precedes all remaining keys' => [
            [
                'group' => 'hull',
                '_definitionOrder' => 999.0,
            ],
            [
                'group' => 'rig',
                '_definitionOrder' => -999.0,
            ],
        ],
        'definition order precedes element order' => [
            [
                '_definitionOrder' => 1.25,
                '_elementOrder' => 999.0,
            ],
            [
                '_definitionOrder' => 1.5,
                '_elementOrder' => -999.0,
            ],
        ],
        'element order precedes measurement code' => [
            [
                '_elementOrder' => 1.25,
                'code' => 'z_code',
            ],
            [
                '_elementOrder' => 1.5,
                'code' => 'a_code',
            ],
        ],
        'measurement code breaks numeric ties' => [
            [
                'code' => 'a_code',
                'target' => [
                    'kind' => 'yard',
                    'id' => 'z_element',
                ],
            ],
            [
                'code' => 'z_code',
                'target' => [
                    'kind' => 'mast',
                    'id' => 'a_element',
                ],
            ],
        ],
        'target kind precedes target id' => [
            [
                'target' => [
                    'kind' => 'mast',
                    'id' => 'z_element',
                ],
            ],
            [
                'target' => [
                    'kind' => 'yard',
                    'id' => 'a_element',
                ],
            ],
        ],
        'target id breaks remaining ties' => [
            [
                'target' => [
                    'kind' => 'mast',
                    'id' => 'a_mast',
                ],
            ],
            [
                'target' => [
                    'kind' => 'mast',
                    'id' => 'z_mast',
                ],
            ],
        ],
        'missing target compares as empty codes' => [
            ['target' => null],
            [
                'target' => [
                    'kind' => 'mast',
                    'id' => 'main_mast',
                ],
            ],
        ],
    ];

    foreach ($sort_cases as $name => $pair) {
        $tests[$name] = static function () use ($pair) {
            $left = comparison_row($pair[0]);
            $right = comparison_row($pair[1]);

            check(
                compare_graphql_measurements($left, $right) < 0,
                'Forward comparison must be negative.'
            );

            check(
                compare_graphql_measurements($right, $left) > 0,
                'Reverse comparison must be positive.'
            );
        };
    }

    $tests['identical sort keys compare equally'] = static function () {
        $row = comparison_row();

        same(0, compare_graphql_measurements($row, $row));
    };

    $tests['configured model is accepted'] = static function () {
        same(true, validate_graphql_measurements_configuration());
    };

    $tests['model among multiple configured CPTs is accepted'] =
        static function () {
            $GLOBALS['gm_graphql_unit']['configuration']['postTypes'] =
                ['other_model', 'model'];

            same(
                true,
                validate_graphql_measurements_configuration()
            );
        };

    $tests['missing model configuration is rejected'] =
        static function () {
            $GLOBALS['gm_graphql_unit']['configuration']['postTypes'] =
                ['other_model'];

            $result = validate_graphql_measurements_configuration();

            check(
                is_wp_error($result),
                'Expected configuration error.'
            );

            same(
                'gm_measurements_graphql_model_not_configured',
                $result->get_error_code()
            );

            same(
                0,
                $GLOBALS['gm_graphql_unit']['dictionaryCalls']
            );
        };

    $tests['configuration error is preserved'] = static function () {
        $error = new \WP_Error(
            'invalid_configuration',
            'Test failure'
        );

        $GLOBALS['gm_graphql_unit']['configuration'] = $error;

        same(
            $error,
            validate_graphql_measurements_configuration()
        );

        same(0, $GLOBALS['gm_graphql_unit']['dictionaryCalls']);
    };

    $tests['same context reuses successful dictionary result'] =
        static function () {
            $context = new AppContext();
            $expected = [
                'definitions' => ['first'],
                'elements' => [],
            ];

            $GLOBALS['gm_graphql_unit']['dictionaryResult'] =
                $expected;

            same(
                $expected,
                load_graphql_measurement_dictionaries($context)
            );

            $GLOBALS['gm_graphql_unit']['dictionaryResult'] = [
                'definitions' => ['changed'],
                'elements' => [],
            ];

            same(
                $expected,
                load_graphql_measurement_dictionaries($context)
            );

            same(
                1,
                $GLOBALS['gm_graphql_unit']['dictionaryCalls']
            );
        };

    $tests['dictionary error is cached and retried for a new context'] =
        static function () {
            $context = new AppContext();
            $error = new \WP_Error(
                'broken_dictionary',
                'Test failure'
            );

            $GLOBALS['gm_graphql_unit']['dictionaryResult'] =
                $error;

            same(
                $error,
                load_graphql_measurement_dictionaries($context)
            );

            $repaired = [
                'definitions' => [],
                'elements' => [],
            ];

            $GLOBALS['gm_graphql_unit']['dictionaryResult'] =
                $repaired;

            same(
                $error,
                load_graphql_measurement_dictionaries($context)
            );

            same(
                1,
                $GLOBALS['gm_graphql_unit']['dictionaryCalls']
            );

            same(
                $repaired,
                load_graphql_measurement_dictionaries(
                    new AppContext()
                )
            );

            same(
                2,
                $GLOBALS['gm_graphql_unit']['dictionaryCalls']
            );
        };

    $tests['new context reloads successful dictionaries'] =
        static function () {
            $first = new AppContext();
            $second = new AppContext();

            load_graphql_measurement_dictionaries($first);
            load_graphql_measurement_dictionaries($second);

            same(
                2,
                $GLOBALS['gm_graphql_unit']['dictionaryCalls']
            );
        };

    $tests['site change reloads dictionaries'] = static function () {
        $context = new AppContext();

        load_graphql_measurement_dictionaries($context);

        $GLOBALS['gm_graphql_unit']['blogId'] = 2;

        $expected = [
            'definitions' => ['site_two'],
            'elements' => [],
        ];

        $GLOBALS['gm_graphql_unit']['dictionaryResult'] =
            $expected;

        same(
            $expected,
            load_graphql_measurement_dictionaries($context)
        );

        same(2, $GLOBALS['gm_graphql_unit']['dictionaryCalls']);
    };

    $tests['user change reloads dictionaries'] = static function () {
        $context = new AppContext();

        load_graphql_measurement_dictionaries($context);

        $GLOBALS['gm_graphql_unit']['userId'] = 42;

        $expected = [
            'definitions' => ['user_changed'],
            'elements' => [],
        ];

        $GLOBALS['gm_graphql_unit']['dictionaryResult'] =
            $expected;

        same(
            $expected,
            load_graphql_measurement_dictionaries($context)
        );

        same(2, $GLOBALS['gm_graphql_unit']['dictionaryCalls']);
    };

    $tests['unrecognized context bypasses the cache'] =
        static function () {
            $context = new \stdClass();

            load_graphql_measurement_dictionaries($context);

            $expected = [
                'definitions' => ['fresh'],
                'elements' => [],
            ];

            $GLOBALS['gm_graphql_unit']['dictionaryResult'] =
                $expected;

            same(
                $expected,
                load_graphql_measurement_dictionaries($context)
            );

            same(
                2,
                $GLOBALS['gm_graphql_unit']['dictionaryCalls']
            );
        };

    $tests['missing context bypasses the cache'] = static function () {
        load_graphql_measurement_dictionaries(null);
        load_graphql_measurement_dictionaries(null);

        same(2, $GLOBALS['gm_graphql_unit']['dictionaryCalls']);
    };

    $failed = 0;
    $number = 0;

    foreach ($tests as $name => $test) {
        /*
         * Preserve the hook captured while requiring graphql.php
         * for the first test only.
         *
         * Cache tests use a fresh AppContext, or bypass caching,
         * so resetting globals does not require resetting production
         * function-static cache variables.
         */
        if ($number > 0) {
            reset_environment();
        }

        ++$number;

        try {
            $test();

            fwrite(
                STDOUT,
                "ok {$number} - {$name}\n"
            );
        } catch (\Throwable $error) {
            ++$failed;

            fwrite(
                STDERR,
                "not ok {$number} - {$name}\n"
            );

            fwrite(
                STDERR,
                $error->getMessage() . "\n"
            );
        }
    }

    fwrite(
        STDOUT,
        sprintf(
            "\nTests: %d; passed: %d; failed: %d\n",
            count($tests),
            count($tests) - $failed,
            $failed
        )
    );

    exit($failed === 0 ? 0 : 1);
}
