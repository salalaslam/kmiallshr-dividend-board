import { query } from "./_generated/server";

export const list = query({
  handler: async (ctx) => {
    const stocks = await ctx.db.query("stocks").collect();

    return stocks.sort((a, b) => a.symbol.localeCompare(b.symbol));
  },
});
