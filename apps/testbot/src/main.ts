// Thirstr chat test bots (testing.md › Chat test bots, #109, #200). Staging only.
// Runs the whole cast in one process; BOTS=luca,remi limits it (tests, debugging).
import { Bot, log, API } from './bot';
import { PERSONAS } from './personas';

const only = (process.env.BOTS ?? '').split(',').filter(Boolean);
const cast = PERSONAS.filter((p) => !only.length || only.includes(p.handle));

async function main() {
  // One after the other: the first boot creates accounts and key packages.
  for (const p of cast) {
    const b = new Bot(p);
    for (let i = 0; ; i++) {
      try {
        await b.start();
        break;
      } catch (e) {
        log(`[${p.handle}] start failed`, (e as Error).message);
        if (i >= 5) throw e;
        await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
      }
    }
  }
  log('test bots up:', cast.map((p) => p.handle).join(', '), 'on', API);
}

main().catch((e) => {
  log('fatal', e);
  process.exit(1);
});
