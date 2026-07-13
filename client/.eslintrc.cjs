module.exports = {
    root: true,
    env: {
        browser: true,
        es2022: true,
        node: true,
    },
    extends: ['eslint:recommended'],
    parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
    },
    plugins: ['react', 'react-hooks'],
    settings: {
        react: { version: 'detect' },
    },
    rules: {
        ...require('eslint-plugin-react-hooks').configs.recommended.rules,
        'react/jsx-uses-vars': 'error',
        'react/react-in-jsx-scope': 'off',
        'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
};
