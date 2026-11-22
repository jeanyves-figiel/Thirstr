// R8 keep rules for Android release builds (minify is on in the Expo template).
// Room builds each database through its generated `<Name>_Impl` no-arg constructor by reflection;
// R8 strips it, and the app crashes at startup in WorkManager's InitializationProvider
// (NoSuchMethodException: androidx.work.impl.WorkDatabase_Impl.<init>, found by the device matrix, #175).
// WorkManager comes in through expo-background-task.
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const MARK = '# thirstr: with-proguard-rules';
const RULES = `${MARK}
-keep class * extends androidx.room.RoomDatabase { <init>(); }
-keep class androidx.work.impl.WorkDatabase_Impl { *; }
`;

module.exports = function withProguardRules(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const file = path.join(cfg.modRequest.platformProjectRoot, 'app', 'proguard-rules.pro');
      const cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (!cur.includes(MARK)) fs.writeFileSync(file, `${cur.trimEnd()}\n\n${RULES}`);
      return cfg;
    },
  ]);
};
module.exports.RULES = RULES;
