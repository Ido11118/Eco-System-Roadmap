// מבנה התחומים והצוותים של הארגון — נתוני אתחול.
// תחומים: קבועים כאן (שם וסדר מתעדכנים מהקוד בכל הרצת seed). המזהים (id) קבועים ואסור לשנותם לאחר הפריסה.
// צוותים: נוצרים מכאן רק בהתקנה ראשונה. אחר כך הם מנוהלים במסך "מבנה הגאנט" (ניהול מערכת), ושינוי כאן לא ישפיע.
export type OrgTeam = { id: number; key: string; name: string };
export type OrgDomain = { id: number; key: string; name: string; teams: OrgTeam[] };

export const ORG_STRUCTURE: OrgDomain[] = [
  { id: 1, key: "platform", name: "פלטפורמה", teams: [{ id: 101, key: "platform", name: "פלטפורמה" }] },
  { id: 2, key: "agam", name: 'אג"ם', teams: [
    { id: 201, key: "azarim-1", name: "עזרים 1" },
    { id: 202, key: "azarim-2", name: "עזרים 2" },
    { id: 203, key: "sysadmin", name: "ניהול מערכת" },
    { id: 204, key: "team-204", name: "אלביט" },
  ] },
  { id: 3, key: "rokak", name: "רוקק", teams: [{ id: 301, key: "rokak", name: "רוקק" }] },
  { id: 4, key: "esh", name: "אש", teams: [
    { id: 401, key: "attack-exposure", name: "חשיפת תקיפה" },
    { id: 402, key: "air-fire", name: "אש אוויר" },
    { id: 403, key: "land", name: "יבשה" },
  ] },
  { id: 5, key: "tikshuv", name: "תקשוב", teams: [
    { id: 501, key: "control", name: "שליטה" },
    { id: 502, key: "monitoring", name: "ניטור" },
    { id: 503, key: "planning", name: "תכנון" },
  ] },
  { id: 6, key: "malka", name: 'מלכ"א', teams: [{ id: 601, key: "malka", name: 'מלכ"א' }] },
  { id: 7, key: "tahkur", name: "תחקור", teams: [
    { id: 701, key: "laso-ops", name: "לאסו מבצעי" },
    { id: 702, key: "laso-gs", name: 'לאסו מטכ"ל' },
    { id: 703, key: "arazim", name: "ארזים" },
  ] },
  { id: 8, key: "bina", name: "בינה", teams: [{ id: 801, key: "bina", name: "בינה" }] },
  { id: 9, key: "masoa", name: "משואה", teams: [
    { id: 901, key: "fast-releases", name: "גרסאות מהירות" },
    { id: 902, key: "major-releases", name: "גרסאות מג'וריות" },
  ] },
  { id: 10, key: "design", name: "עיצוב", teams: [{ id: 1001, key: "design", name: "עיצוב" }] },
];

export const DEFAULT_ROWS_PER_TEAM = 2;
