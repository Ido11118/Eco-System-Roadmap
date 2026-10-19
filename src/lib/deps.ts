// תלויות של תכולה — עזרים משותפים לגאנט, לטבלה ולחלונית הפרטים
import type { Dependency, ItemDTO } from "./types";

/** רשימת התלויות (תמונות מצב ישנות נשמרו בלי השדה) */
export const depsOf = (i: Pick<ItemDTO, "dependencies">): Dependency[] => i.dependencies ?? [];
/** תלויות שעדיין דורשות טיפול — אלה מסומנות בגאנט ובטבלה */
export const openDeps = (i: Pick<ItemDTO, "dependencies">) => depsOf(i).filter((d) => !d.done);
export const newDepId = () => Math.random().toString(36).slice(2, 10);
