import { defineConfig } from 'tsdown'

export default defineConfig([
  {
    entry: ['src/index.ts'], outDir: 'lib', format: 'esm', platform: 'node',
    target: 'node22', dts: false, clean: false, sourcemap: false, fixedExtension: false,
    external: [/^@deepseek-ai\//],
  },
  {
    entry: { client: 'src/client/index.ts' }, outDir: 'lib', format: 'cjs', platform: 'browser',
    target: 'es2022', dts: false, clean: false, sourcemap: false,
    external: ['react', 'react/jsx-runtime'],
    define: { 'process.env.NODE_ENV': '"production"' },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-native-audio", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
