const browserGlobals = {
    Blob: 'readonly',
    clearTimeout: 'readonly',
    console: 'readonly',
    document: 'readonly',
    FileReader: 'readonly',
    localStorage: 'readonly',
    MouseEvent: 'readonly',
    MutationObserver: 'readonly',
    navigator: 'readonly',
    requestAnimationFrame: 'readonly',
    setInterval: 'readonly',
    setTimeout: 'readonly',
    URL: 'readonly',
    window: 'readonly',
};

const userscriptGlobals = {
    GM_getValue: 'readonly',
    GM_setValue: 'readonly',
};

const baseRules = {
    'no-redeclare': 'error',
    'no-undef': 'error',
    'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
};

export default [
    {
        ignores: [
            '**/*.log',
            '**/*.{png,jpg,jpeg,gif,webp,svg,ico}',
        ],
    },
    {
        files: ['*.user.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: {
                ...browserGlobals,
                ...userscriptGlobals,
            },
        },
        rules: baseRules,
    },
    {
        files: ['tests/*.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
        },
        rules: baseRules,
    },
    {
        files: ['eslint.config.mjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
        },
        rules: baseRules,
    },
];
