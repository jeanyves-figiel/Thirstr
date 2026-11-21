/* global __dirname, test, expect */
// #248: no vertical scroll indicator anywhere in the app (iOS + Android).
// It overlapped sheet buttons and was judged not useful. Guard against regressions.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

test('vertical scroll views hide the scroll indicator', () => {
  const bad = [];
  for (const f of files(SRC)) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /<(ScrollView|FlatList|SectionList)\b([^>]*?)(\/?>)/gs;
    for (let m = re.exec(src); m; m = re.exec(src)) {
      if (/[\w.]/.test(src[m.index - 1] ?? '')) continue; // generic type like useRef<FlatList>, not JSX
      const props = m[2];
      if (/\bhorizontal\b/.test(props)) continue;
      if (!/showsVerticalScrollIndicator=\{false\}/.test(props)) {
        bad.push(`${path.relative(SRC, f)}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
  }
  expect(bad).toEqual([]);
});
