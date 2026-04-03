import { useEffect, useMemo, useState } from "react";
import { fetchSolarQuote } from "./lib/api.js";

const monthLabels = [
  ["01", "Jan"],
  ["02", "Feb"],
  ["03", "Mar"],
  ["04", "Apr"],
  ["05", "May"],
  ["06", "Jun"],
  ["07", "Jul"],
  ["08", "Aug"],
  ["09", "Sep"],
  ["10", "Oct"],
  ["11", "Nov"],
  ["12", "Dec"],
];

function formatNumber(value, digits = 1) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value || 0);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDateTime(value) {
  if (!value) {
    return "Recently";
  }

  const nextDate = new Date(value);
  if (Number.isNaN(nextDate.getTime())) {
    return "Recently";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(nextDate);
}

function getMonthLabel(monthId) {
  return monthLabels.find(([candidate]) => candidate === monthId)?.[1] || monthId || "N/A";
}

function buildAddressLabel(address) {
  if (!address) {
    return "Property";
  }

  return [address.street, address.city, `${address.state} ${address.zip}`.trim(), address.country]
    .filter(Boolean)
    .join(", ");
}

function MonthlyProduction({ monthlyValues = {} }) {
  const maxValue = Math.max(...Object.values(monthlyValues), 1);

  return (
    <div className="month-grid">
      {monthLabels.map(([monthId, label]) => {
        const value = monthlyValues[monthId] || 0;
        const height = `${Math.max(16, (value / maxValue) * 100)}%`;

        return (
          <div className="month-card" key={monthId}>
            <span className="month-value">{formatNumber(value, 0)}</span>
            <div className="month-bar-track">
              <div className="month-bar-fill" style={{ height }} />
            </div>
            <strong>{label}</strong>
            <span>kWh</span>
          </div>
        );
      })}
    </div>
  );
}

export default function QuotePage() {
  const quoteId = useMemo(() => {
    const trimmedPath = window.location.pathname.replace(/^\/quote\//, "");
    return decodeURIComponent(trimmedPath.split("/")[0] || "");
  }, []);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let canceled = false;

    async function loadQuote() {
      if (!quoteId) {
        setError("Quote not found.");
        setLoading(false);
        return;
      }

      try {
        const nextPayload = await fetchSolarQuote(quoteId);
        if (!canceled) {
          setPayload(nextPayload);
          setError("");
        }
      } catch (nextError) {
        if (!canceled) {
          setError(nextError.message || "Unable to load the homeowner quote.");
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    loadQuote();

    return () => {
      canceled = true;
    };
  }, [quoteId]);

  if (loading) {
    return (
      <div className="page-shell quote-shell">
        <header className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Homeowner quote</p>
            <h1>Loading quote...</h1>
            <p className="hero-text">Pulling the saved roof-backed planning snapshot now.</p>
          </div>
        </header>
      </div>
    );
  }

  if (error || !payload?.quote || !payload?.report) {
    return (
      <div className="page-shell quote-shell">
        <header className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Homeowner quote</p>
            <h1>Quote unavailable</h1>
            <p className="hero-text">
              {error || "This share link does not point to an available homeowner quote."}
            </p>
            <div className="quote-actions">
              <a className="secondary-button" href="/">
                Open planning app
              </a>
            </div>
          </div>
        </header>
      </div>
    );
  }

  const { quote, report, address } = payload;

  return (
    <div className="page-shell quote-shell">
      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Homeowner quote</p>
          <h1>{quote.headline}</h1>
          <p className="hero-text">{quote.summary}</p>

          <div className="quote-hero-meta">
            <span className="soft-badge">{buildAddressLabel(address)}</span>
            <span className="soft-badge">{report.confidence?.label || "Planning"} confidence</span>
            <span className="soft-badge">Prepared {formatDateTime(quote.updated_at || quote.created_at)}</span>
          </div>

          <div className="quote-actions">
            <a className="secondary-button" href="/">
              Open planning app
            </a>
          </div>
        </div>
      </header>

      <main className="layout-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Quote summary</p>
              <h2>Planning numbers at a glance</h2>
            </div>
            <p className="panel-copy">
              This shareable view comes from a saved roof-backed report snapshot, not a fresh live
              recalculation.
            </p>
          </div>

          <div className="stats-grid">
            <article className="stat-card">
              <span className="stat-label">System size</span>
              <strong>{formatNumber(report.system_size_kw, 1)} kW</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">Annual production</span>
              <strong>{formatNumber(report.annual_production, 0)} kWh</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">Annual savings</span>
              <strong>{formatCurrency(report.annual_savings)}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">System cost</span>
              <strong>{formatCurrency(report.system_cost)}</strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">Payback</span>
              <strong>
                {report.payback_period ? `${formatNumber(report.payback_period, 1)} years` : "N/A"}
              </strong>
            </article>
            <article className="stat-card">
              <span className="stat-label">Specific yield</span>
              <strong>{formatNumber(report.specific_yield, 0)} kWh/kW-yr</strong>
            </article>
          </div>

          <div className="info-grid">
            <article className="info-card">
              <span>Address</span>
              <strong>{buildAddressLabel(address)}</strong>
            </article>
            <article className="info-card">
              <span>Roof area</span>
              <strong>{formatNumber(report.roof_area_square_feet, 0)} sq ft</strong>
            </article>
            <article className="info-card">
              <span>Peak month</span>
              <strong>{getMonthLabel(report.production_model?.peak_month?.month || report.peak_month?.month)}</strong>
            </article>
            <article className="info-card">
              <span>Data source</span>
              <strong>{report.data_source || "unknown"}</strong>
            </article>
          </div>

          <div className="status-card status-card-muted quote-disclaimer">
            <span className="status-label">Planning note</span>
            <strong>This is a shareable planning quote, not a final installer proposal.</strong>
            <p>{quote.disclaimer}</p>
          </div>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Monthly production</p>
              <h2>Seasonality snapshot</h2>
            </div>
            <p className="panel-copy">
              Production swings through the year, with the strongest month near{" "}
              {getMonthLabel(report.production_model?.peak_month?.month || report.peak_month?.month)}
              .
            </p>
          </div>

          <MonthlyProduction monthlyValues={report.monthly_production} />

          <div className="guidance-stack">
            <article className="guidance-card">
              <strong>Current assumptions</strong>
              <ul className="assumption-list">
                {(report.assumptions || []).map((assumption) => (
                  <li key={assumption}>{assumption}</li>
                ))}
              </ul>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
