import { createRouter, publicQuery } from "./middleware";
import { getTodaySuggestions } from "./queries/suggestions";

export const appRouter = createRouter({
  suggestions: {
    today: publicQuery.query(() => getTodaySuggestions()),
  },
});

export type AppRouter = typeof appRouter;
