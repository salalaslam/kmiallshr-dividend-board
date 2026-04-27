import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const listByDate = query({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    return ctx.db
      .query("priceSnapshots")
      .withIndex("by_date", (q) => q.eq("date", date))
      .collect();
  },
});

export const upsert = mutation({
  args: {
    symbol: v.string(),
    date: v.string(),
    label: v.string(),
    price: v.number(),
    sourceAsOf: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("priceSnapshots")
      .withIndex("by_symbol", (q) => q.eq("symbol", args.symbol))
      .filter((q) => q.eq(q.field("date"), args.date))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { price: args.price, sourceAsOf: args.sourceAsOf });
    } else {
      await ctx.db.insert("priceSnapshots", args);
    }
  },
});
