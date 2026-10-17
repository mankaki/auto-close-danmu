const browserGlobals = {
    Blob: 'readonly',
    console: 'readonly',
    CustomEvent: 'readonly',
    document: 'readonly',
    Element: 'readonly',
    Event: 'readonly',
    fetch: 'readonly',
    FileReader: 'readonly',
    HTMLElement: 'readonly',
    Image: 'readonly',
    IntersectionObserver: 'readonly',
    KeyboardEvent: 'readonly',
    localStorage: 'readonly',
    location: 'readonly',
    MutationObserver: 'readonly',
    MouseEvent: 'readonly',
    navigator: 'readonly',
    Node: 'readonly',
    requestAnimationFrame: 'readonly',
    ResizeObserver: 'readonly',
    sessionStorage: 'readonly',
    setInterval: 'readonly',
    setTimeout: 'readonly',
    clearInterval: 'readonly',
    clearTimeout: 'readonly',
    URL: 'readonly',
    URLSearchParams: 'readonly',
    window: 'readonly',
};

const userscriptGlobals = {
    GM: 'readonly',
    GM_getValue: 'readonly',
    GM_setValue: 'readonly',
    unsafeWindow: 'readonly',
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
            globals: {
                __dirname: 'readonly',
                __filename: 'readonly',
                Buffer: 'readonly',
                console: 'readonly',
                exports: 'writable',
                global: 'readonly',
                module: 'writable',
                process: 'readonly',
                require: 'readonly',
                setImmediate: 'readonly',
                setInterval: 'readonly',
                setTimeout: 'readonly',
                clearImmediate: 'readonly',
                clearInterval: 'readonly',
                clearTimeout: 'readonly',
            },
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
