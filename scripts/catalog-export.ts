// ייצוא הגדרות הסטטוסים והתיעדוף מבסיס הנתונים לקובץ config/catalog.json (בדרך כלל נכתב אוטומטית בכל שינוי בפיתוח).
// הרצה: npm run catalog:export — ואז לדחוף את הקובץ לגיט. בעליית השרת בפרודקשן ההגדרות יוחלו.
import { db, pool } from "../src/db";
import { writeCatalogFile, CATALOG_FILE } from "../src/server/catalogSync";

process.env.CATALOG_FILE_SYNC = "true";
writeCatalogFile(db).then((ok) => {
  console.log(ok ? `✓ catalog exported to ${CATALOG_FILE}` : "✗ export failed");
  return pool.end();
}).catch((e) => { console.error(e); process.exit(1); });
