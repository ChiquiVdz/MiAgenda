import type { Feed } from "./use-core-feed";
import type { CalendarView } from "./schedule-editor";
import type { PantrySnapshot } from "../../../reconstruction/core/src/pantry";
import type { RecipeSnapshot } from "../../../reconstruction/core/src/recipes";
import type { PlannerSnapshot } from "../../../reconstruction/core/src/planner";
import type { ShoppingSnapshot } from "../../../reconstruction/core/src/shopping";
import type { KitchenLedger } from "../../../reconstruction/core/src/local-kitchen-contract";

/** Bounded private snapshot. Local effects remain provisional until server acknowledgement. */
export type LocalCopy = {
  format: 1; ownerId: string; dataRevision: string; savedAt: string;
  today: string; start: string; end: string;
  inbox: Feed; agenda: Feed; highlighted: Feed;
  calendars: CalendarView[]; pantry: PantrySnapshot; recipes: RecipeSnapshot;
  planners: PlannerSnapshot[]; shopping: ShoppingSnapshot; kitchenLedger?: KitchenLedger;
  seriesFingerprints?: Record<string, string>;
};
