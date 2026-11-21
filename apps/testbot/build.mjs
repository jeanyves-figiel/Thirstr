// Bundles the bot with the app's own MLS code (apps/mobile/src/chat/mls.ts, bytes.ts) so the
// wire format can never drift from the app. The app's device store (./kv, SQLCipher) is swapped
// for the bot's file store; npm packages resolve from this folder.
import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const chat = path.resolve(here, '../mobile/src/chat');

const opts = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  tsconfig: path.join(here, 'tsconfig.json'),
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  plugins: [
    {
      name: 'bot-kv',
      setup(b) {
        b.onResolve({ filter: /^\.\/kv$/ }, (a) => (path.resolve(a.resolveDir) === chat ? { path: path.join(here, 'src/kv.ts') } : undefined));
        // bare imports from the app's files resolve against this package's node_modules
        b.onResolve({ filter: /^(ts-mls|@noble\/hashes)/ }, async (a) => {
          if (a.pluginData === 'bot') return undefined;
          if (!path.resolve(a.resolveDir).startsWith(chat)) return undefined;
          return b.resolve(a.path, { kind: a.kind, resolveDir: here, pluginData: 'bot' });
        });
      },
    },
  ],
};

await build({ ...opts, entryPoints: [path.join(here, 'src/main.ts')], outfile: path.join(here, 'dist/bot.mjs') });
// test peer (a second client for the end-to-end test)
await build({ ...opts, entryPoints: [path.join(here, 'test/peer.ts')], outfile: path.join(here, 'dist/peer.mjs') });
console.log('built dist/bot.mjs, dist/peer.mjs');
