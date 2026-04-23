import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const fySummary = v.object({
  payoutCount: v.number(),
  intervalLabel: v.string(),
  totalDividendPercent: v.number(),
  totalDividendPerShare: v.number(),
});

export default defineSchema({
  stocks: defineTable({
    symbol: v.string(),
    name: v.string(),
    latestPrice: v.number(),
    fiscalYearEndLabel: v.string(),
    fiscalYearEndMonth: v.number(),
    sourceAsOf: v.string(),
    companyUrl: v.string(),
    indexUrl: v.string(),
    faceValueAssumption: v.number(),
    summary: v.object({
      fy24: fySummary,
      fy25: fySummary,
      fy26: fySummary,
    }),
    payouts: v.array(
      v.object({
        announcedAt: v.string(),
        periodLabel: v.string(),
        periodEnd: v.string(),
        detail: v.string(),
        bookClosure: v.string(),
        fiscalYear: v.number(),
        dividendPercent: v.number(),
        dividendPerShare: v.number(),
      }),
    ),
  }).index("by_symbol", ["symbol"]),
});
