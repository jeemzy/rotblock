export default {
  sourceDir: 'extension',
  artifactsDir: 'artifacts/extension',
  lint: { selfHosted: true },
  run: { firefox: process.env.ZEN_BINARY ?? 'G:\\apps2\\Zen Browser\\zen.exe' },
};
