"use client";

import { useQuery } from "convex/react";
import { useState, useEffect, useCallback } from "react";
import { api } from "../../convex/_generated/api";

type Holding = {
  symbol: string;
  buyPrice: number;
  shares: number;
};

const today = new Date().toISOString().slice(0, 10);

const REFERENCE_OPTIONS = [
  { date: today, label: `Today — ${today}` },
  { date: "2025-07-01", label: "FY26 start — 1 Jul 2025" },
  { date: "2024-07-01", label: "FY25 start — 1 Jul 2024" },
];

const HOLDINGS_KEY = "kmiallshr_holdings";

function formatCurrency(value: number, digits = 2) {
  return new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    maximumFractionDigits: digits,
  }).format(value);
}

function formatPercent(value: number, digits = 2) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

function toNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function loadHoldings(): Holding[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(HOLDINGS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveHoldings(holdings: Holding[]) {
  localStorage.setItem(HOLDINGS_KEY, JSON.stringify(holdings));
}

export function CapitalGainsDashboard() {
  const [refDateIndex, setRefDateIndex] = useState(0);
  const [wht, setWht] = useState("15");
  const [zakat, setZakat] = useState("0");
  const [search, setSearch] = useState("");

  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [newSymbol, setNewSymbol] = useState("");
  const [newBuyPrice, setNewBuyPrice] = useState("");
  const [newShares, setNewShares] = useState("");

  useEffect(() => {
    setHoldings(loadHoldings());
  }, []);

  const refDate = REFERENCE_OPTIONS[refDateIndex];
  const stocks = useQuery(api.stocks.list);
  const snapshots = useQuery(api.priceSnapshots.listByDate, { date: refDate.date });

  const snapshotMap = new Map(snapshots?.map((s) => [s.symbol, s.price]) ?? []);
  const stockMap = new Map(stocks?.map((s) => [s.symbol, s]) ?? []);

  const whtRate = Math.max(toNumber(wht), 0) / 100;
  const zakatRate = Math.max(toNumber(zakat), 0) / 100;
  const deduction = Math.min(whtRate + zakatRate, 1);

  // ── Universe rows ──
  const term = search.trim().toLowerCase();
  const universeRows = (stocks ?? [])
    .map((stock) => {
      const refPrice = snapshotMap.get(stock.symbol) ?? null;
      const currentPrice = stock.latestPrice;
      const capitalGainPct =
        refPrice !== null && refPrice > 0
          ? ((currentPrice - refPrice) / refPrice) * 100
          : null;
      const divPerShare = stock.summary.fy26.totalDividendPerShare;
      const netDivYield =
        currentPrice > 0
          ? (divPerShare / currentPrice) * (1 - deduction) * 100
          : 0;
      const totalReturn =
        capitalGainPct !== null ? capitalGainPct + netDivYield : null;

      return {
        id: stock._id,
        symbol: stock.symbol,
        name: stock.name,
        fiscalYearEndLabel: stock.fiscalYearEndLabel,
        companyUrl: stock.companyUrl,
        refPrice,
        currentPrice,
        capitalGainPct,
        netDivYield,
        totalReturn,
      };
    })
    .filter((row) => {
      if (!term) return true;
      return (
        row.symbol.toLowerCase().includes(term) ||
        row.name.toLowerCase().includes(term)
      );
    })
    .sort((a, b) => {
      if (a.totalReturn === null && b.totalReturn === null) return 0;
      if (a.totalReturn === null) return 1;
      if (b.totalReturn === null) return -1;
      return b.totalReturn - a.totalReturn;
    });

  // ── Holdings rows ──
  const holdingRows = holdings.map((h) => {
    const stock = stockMap.get(h.symbol);
    const found = stock !== undefined;
    const currentPrice = stock?.latestPrice ?? null;
    const divPerShare = stock?.summary.fy26.totalDividendPerShare ?? 0;
    const capitalGainRs =
      currentPrice !== null ? (currentPrice - h.buyPrice) * h.shares : null;
    const capitalGainPct =
      currentPrice !== null && h.buyPrice > 0
        ? ((currentPrice - h.buyPrice) / h.buyPrice) * 100
        : null;
    const divIncomeNet =
      currentPrice !== null ? divPerShare * h.shares * (1 - deduction) : null;
    const costBasis = h.buyPrice * h.shares;
    const totalPnL =
      capitalGainRs !== null && divIncomeNet !== null
        ? capitalGainRs + divIncomeNet
        : null;
    const totalPnLPct =
      totalPnL !== null && costBasis > 0 ? (totalPnL / costBasis) * 100 : null;

    return {
      ...h,
      found,
      stockName: stock?.name ?? h.symbol,
      fiscalYearEndLabel: stock?.fiscalYearEndLabel ?? "—",
      companyUrl: stock?.companyUrl ?? "#",
      currentPrice,
      capitalGainRs,
      capitalGainPct,
      divIncomeNet,
      totalPnL,
      costBasis,
      totalPnLPct,
    };
  });

  const foundRows = holdingRows.filter((r) => r.found);
  const totalInvested = foundRows.reduce((s, r) => s + r.costBasis, 0);
  const totalCapGain = foundRows.reduce((s, r) => s + (r.capitalGainRs ?? 0), 0);
  const totalDivIncome = foundRows.reduce((s, r) => s + (r.divIncomeNet ?? 0), 0);
  const totalPnL = foundRows.reduce((s, r) => s + (r.totalPnL ?? 0), 0);
  const totalPnLPct = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;
  const totalCapGainPct =
    totalInvested > 0 ? (totalCapGain / totalInvested) * 100 : 0;

  const addHolding = useCallback(() => {
    const sym = newSymbol.trim().toUpperCase();
    const bp = toNumber(newBuyPrice);
    const sh = toNumber(newShares);
    if (!sym || bp <= 0 || sh <= 0) return;
    const updated = [...holdings, { symbol: sym, buyPrice: bp, shares: sh }];
    setHoldings(updated);
    saveHoldings(updated);
    setNewSymbol("");
    setNewBuyPrice("");
    setNewShares("");
  }, [holdings, newSymbol, newBuyPrice, newShares]);

  const removeHolding = useCallback(
    (index: number) => {
      const updated = holdings.filter((_, i) => i !== index);
      setHoldings(updated);
      saveHoldings(updated);
    },
    [holdings],
  );

  if (!stocks) {
    return (
      <div className="shell">
        <div className="loading-panel market-surface">
          <p className="eyebrow">Loading dataset</p>
          <h1>Pulling KMIALLSHR data from Convex.</h1>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      {/* ── Page Header ── */}
      <header className="market-header">
        <div className="market-title">
          <p className="eyebrow text-xs">PSX · KMIALLSHR</p>
          <h1>Capital Gains Monitor</h1>
          <p className="lede text-sm">
            Track price appreciation alongside dividend income for every
            KMIALLSHR constituent. Enter your personal holdings below to see
            your actual P&amp;L.
          </p>
        </div>
        <div className="market-meta">
          <div>
            <span className="stat-label">Reference date</span>
            <strong>{refDate.date}</strong>
          </div>
          <div>
            <span className="stat-label">Universe</span>
            <strong>KMIALLSHR</strong>
          </div>
        </div>
      </header>

      {/* ── Section 1: My Holdings ── */}
      <section
        className="table-panel market-surface"
        style={{ marginTop: "0.85rem" }}
      >
        <div className="table-header">
          <div>
            <p className="eyebrow text-xs">Personal</p>
            <h2>My Holdings &amp; P&amp;L</h2>
          </div>
          <p className="methodology text-xs">
            Enter your buy price and share count. Saved locally in your
            browser — never sent to any server.
          </p>
        </div>

        {/* Add holding band */}
        <div className="add-holding-band">
          <div className="field">
            <span className="text-xs">Stock symbol</span>
            <input
              className="text-sm"
              placeholder="e.g. POL"
              value={newSymbol}
              onChange={(e) => setNewSymbol(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addHolding()}
            />
          </div>
          <div
            className="field"
            style={{
              padding: "0.65rem 0.82rem",
              borderRight: "1px solid var(--line)",
            }}
          >
            <span className="text-xs">Buy price (Rs)</span>
            <input
              className="text-sm"
              inputMode="decimal"
              placeholder="520.00"
              value={newBuyPrice}
              onChange={(e) => setNewBuyPrice(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addHolding()}
            />
          </div>
          <div
            className="field"
            style={{
              padding: "0.65rem 0.82rem",
              borderRight: "1px solid var(--line)",
            }}
          >
            <span className="text-xs">Shares held</span>
            <input
              className="text-sm"
              inputMode="numeric"
              placeholder="500"
              value={newShares}
              onChange={(e) => setNewShares(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addHolding()}
            />
          </div>
          <div className="add-btn-cell">
            <button
              type="button"
              className="add-btn"
              onClick={addHolding}
              disabled={
                !newSymbol.trim() ||
                toNumber(newBuyPrice) <= 0 ||
                toNumber(newShares) <= 0
              }
            >
              + Add holding
            </button>
          </div>
        </div>

        {holdings.length === 0 ? (
          <div
            style={{
              padding: "2rem 1rem",
              textAlign: "center",
              color: "var(--ink-muted)",
              fontSize: "0.86rem",
            }}
          >
            No holdings yet. Enter a symbol, buy price, and share count above.
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="text-sm capital-gains-table">
                <thead>
                  <tr>
                    <th>Stock</th>
                    <th>Shares</th>
                    <th>Buy price</th>
                    <th>Current price</th>
                    <th>Capital gain (Rs)</th>
                    <th>Capital gain %</th>
                    <th>Dividend income (net)</th>
                    <th>Total P&amp;L</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {holdingRows.map((row, i) => (
                    <tr key={`${row.symbol}-${i}`}>
                      <td>
                        <div className="stock-cell text-sm">
                          {row.found ? (
                            <a href={row.companyUrl} target="_blank" rel="noreferrer">
                              {row.symbol}
                            </a>
                          ) : (
                            <span style={{ color: "var(--warning)", fontFamily: "var(--font-mono)", fontWeight: 700 }}>
                              {row.symbol}
                            </span>
                          )}
                          <div className="text-xs">
                            <strong>{row.stockName}</strong>
                            {row.found ? (
                              <span>FY end: {row.fiscalYearEndLabel}</span>
                            ) : (
                              <span style={{ color: "var(--warning)" }}>Not in KMIALLSHR universe</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>{row.shares.toLocaleString("en-PK")}</td>
                      <td>{formatCurrency(row.buyPrice)}</td>
                      <td>{row.currentPrice !== null ? formatCurrency(row.currentPrice) : "—"}</td>
                      <td className={row.capitalGainRs !== null ? (row.capitalGainRs >= 0 ? "gain-pos" : "gain-neg") : ""}>
                        {row.capitalGainRs !== null ? formatCurrency(row.capitalGainRs, 0) : "—"}
                      </td>
                      <td className={row.capitalGainPct !== null ? (row.capitalGainPct > 0 ? "gain-pos" : row.capitalGainPct < 0 ? "gain-neg" : "") : ""}>
                        {row.capitalGainPct !== null ? formatPercent(row.capitalGainPct) : "—"}
                      </td>
                      <td>{row.divIncomeNet !== null ? formatCurrency(row.divIncomeNet, 0) : "—"}</td>
                      <td>
                        {row.totalPnL !== null ? (
                          <div className="metric-stack text-sm">
                            <strong className={row.totalPnL > 0 ? "gain-pos" : row.totalPnL < 0 ? "gain-neg" : ""}>
                              {formatCurrency(row.totalPnL, 0)}
                            </strong>
                            <span className="text-xs">
                              {row.totalPnLPct !== null ? `${formatPercent(row.totalPnLPct)} on cost` : ""}
                            </span>
                          </div>
                        ) : "—"}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="holding-delete"
                          onClick={() => removeHolding(i)}
                          aria-label={`Remove ${row.symbol}`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Holdings summary strip */}
            <div
              className="ticker-strip"
              style={{ borderTop: "1px solid var(--line-strong)" }}
            >
              <div className="ticker-item">
                <span className="stat-label">Total invested</span>
                <strong>{formatCurrency(totalInvested, 0)}</strong>
                <span className="text-xs">
                  {holdings.length} holding
                  {holdings.length !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="ticker-item">
                <span className="stat-label">Capital gain</span>
                <strong
                  style={{
                    color:
                      totalCapGain >= 0
                        ? "var(--positive)"
                        : "var(--negative)",
                  }}
                >
                  {formatCurrency(totalCapGain, 0)}
                </strong>
                <span className="text-xs">
                  {formatPercent(totalCapGainPct)} on cost
                </span>
              </div>
              <div className="ticker-item">
                <span className="stat-label">Dividend income (net)</span>
                <strong>{formatCurrency(totalDivIncome, 0)}</strong>
                <span className="text-xs">After WHT &amp; Zakat</span>
              </div>
              <div className={`ticker-item ${totalPnL >= 0 ? "is-primary" : "is-negative"}`}>
                <span className="stat-label">Total P&amp;L</span>
                <strong>{formatCurrency(totalPnL, 0)}</strong>
                <span className="text-xs">
                  {formatPercent(totalPnLPct)} on cost
                </span>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Section 2: Controls + Universe Table ── */}
      <div className="control-band">
        <div className="control-group fiscal-group">
          <div className="control-heading">
            <p className="eyebrow text-xs">Reference date</p>
            <h2>Price baseline</h2>
          </div>
          <div
            className="tab-row"
            role="tablist"
            aria-label="Reference date tabs"
            style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}
          >
            {REFERENCE_OPTIONS.map((opt, i) => (
              <button
                key={opt.date}
                type="button"
                role="tab"
                aria-selected={refDateIndex === i}
                className={
                  refDateIndex === i ? "tab text-sm is-active" : "tab text-sm"
                }
                onClick={() => setRefDateIndex(i)}
              >
                <span>{opt.date}</span>
                <small className="text-xs">{opt.label.split("—")[0].trim()}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="control-group search-group">
          <div className="control-heading">
            <p className="eyebrow text-xs">Search</p>
            <h2>Symbol or company</h2>
          </div>
          <label className="field">
            <span className="text-xs">Ticker lookup</span>
            <input
              className="text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="POL, MEBL, ENGRO…"
            />
          </label>
        </div>

        <div className="control-group assumption-group">
          <div className="control-heading">
            <p className="eyebrow text-xs">Deductions</p>
            <h2>WHT &amp; Zakat</h2>
          </div>
          <div className="field-grid">
            <label className="field">
              <span className="text-xs">WHT (%)</span>
              <input
                className="text-sm"
                inputMode="decimal"
                value={wht}
                onChange={(e) => setWht(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="text-xs">Zakat (%)</span>
              <input
                className="text-sm"
                inputMode="decimal"
                value={zakat}
                onChange={(e) => setZakat(e.target.value)}
              />
            </label>
          </div>
        </div>
      </div>

      <section className="table-panel market-surface">
        <div className="table-header">
          <div>
            <p className="eyebrow text-xs">
              Full universe · ranked by total return
            </p>
            <h2>KMIALLSHR — All constituents</h2>
          </div>
          <p className="methodology text-xs">
            Total return = capital gain % (vs {refDate.date}) + net dividend
            yield (FY26 YTD). Stocks without a price snapshot are ranked last
            and show — in gain columns.
          </p>
        </div>

        <div className="table-wrap">
          <table className="text-sm capital-gains-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Stock</th>
                <th>Ref price</th>
                <th>Current price</th>
                <th>Capital gain %</th>
                <th>Div yield (net)</th>
                <th>Total return %</th>
              </tr>
            </thead>
            <tbody>
              {universeRows.map((row, i) => (
                <tr key={row.id}>
                  <td style={{ color: "var(--ink-muted)" }}>{i + 1}</td>
                  <td>
                    <div className="stock-cell text-sm">
                      <a
                        href={row.companyUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.symbol}
                      </a>
                      <div className="text-xs">
                        <strong>{row.name}</strong>
                        <span>FY end: {row.fiscalYearEndLabel}</span>
                      </div>
                    </div>
                  </td>
                  <td>
                    {row.refPrice !== null
                      ? formatCurrency(row.refPrice)
                      : "—"}
                  </td>
                  <td>{formatCurrency(row.currentPrice)}</td>
                  <td>
                    {row.capitalGainPct !== null ? (
                      <span
                        className={
                          row.capitalGainPct > 0
                            ? "gain-pos"
                            : row.capitalGainPct < 0
                            ? "gain-neg"
                            : ""
                        }
                      >
                        {formatPercent(row.capitalGainPct)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--ink-muted)" }}>—</span>
                    )}
                  </td>
                  <td style={{ color: "var(--accent)", fontWeight: 600 }}>
                    {formatPercent(row.netDivYield)}
                  </td>
                  <td>
                    {row.totalReturn !== null ? (
                      <span className="total-ret-cell">
                        {formatPercent(row.totalReturn)}
                      </span>
                    ) : (
                      <span style={{ color: "var(--ink-muted)" }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
