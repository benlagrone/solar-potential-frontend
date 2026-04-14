import { useEffect, useMemo, useState } from "react";
import { fetchSolarQuote, submitSolarQuoteLead } from "./lib/api.js";

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

const initialLeadForm = {
  full_name: "",
  email: "",
  phone: "",
  preferred_contact: "phone",
  monthly_bill_range: "100-200",
  install_timeline: "1-3-months",
  notes: "",
  consent_to_contact: false,
};

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
  const [leadForm, setLeadForm] = useState(initialLeadForm);
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadSuccess, setLeadSuccess] = useState("");
  const [leadError, setLeadError] = useState("");

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

  async function handleLeadSubmit(event) {
    event.preventDefault();
    if (!payload?.quote?.id) {
      return;
    }

    setLeadSubmitting(true);
    setLeadSuccess("");
    setLeadError("");

    try {
      const nextPayload = await submitSolarQuoteLead(payload.quote.id, leadForm);
      setPayload((current) =>
        current
          ? {
              ...current,
              quote: nextPayload.quote || current.quote,
              report: nextPayload.report || current.report,
            }
          : current,
      );
      setLeadSuccess("Installer follow-up request queued.");
      setLeadForm((current) => ({
        ...current,
        notes: "",
        consent_to_contact: false,
      }));
    } catch (submissionError) {
      setLeadError(submissionError.message || "Unable to submit installer follow-up request.");
    } finally {
      setLeadSubmitting(false);
    }
  }

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

          <div className="guidance-stack">
            <article className="guidance-card">
              <div className="insight-heading">
                <strong>Request installer follow-up</strong>
                <span className="soft-badge">
                  {quote.lead_capture?.route?.route_label || "Installer review queue"}
                </span>
              </div>
              <p>
                Submit contact details and a couple of qualifier fields to queue this quote for
                installer follow-up.
              </p>

              <div className="status-list">
                <div className="status-row">
                  <strong>Queue status</strong>
                  <p>{quote.lead_capture?.summary || "Lead capture is ready on this quote."}</p>
                </div>
                <div className="status-row">
                  <strong>Requests on this quote</strong>
                  <p>{quote.lead_capture?.lead_count || 0}</p>
                </div>
              </div>

              <form className="solar-form quote-lead-form" onSubmit={handleLeadSubmit}>
                <div className="field-row">
                  <label>
                    Full name
                    <input
                      required
                      value={leadForm.full_name}
                      onChange={(event) =>
                        setLeadForm((current) => ({ ...current, full_name: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Email
                    <input
                      type="email"
                      required
                      value={leadForm.email}
                      onChange={(event) =>
                        setLeadForm((current) => ({ ...current, email: event.target.value }))
                      }
                    />
                  </label>
                </div>

                <div className="field-row">
                  <label>
                    Phone
                    <input
                      type="tel"
                      required
                      value={leadForm.phone}
                      onChange={(event) =>
                        setLeadForm((current) => ({ ...current, phone: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Preferred contact
                    <select
                      value={leadForm.preferred_contact}
                      onChange={(event) =>
                        setLeadForm((current) => ({
                          ...current,
                          preferred_contact: event.target.value,
                        }))
                      }
                    >
                      <option value="phone">Phone</option>
                      <option value="text">Text</option>
                      <option value="email">Email</option>
                    </select>
                  </label>
                </div>

                <div className="field-row">
                  <label>
                    Monthly bill range
                    <select
                      value={leadForm.monthly_bill_range}
                      onChange={(event) =>
                        setLeadForm((current) => ({
                          ...current,
                          monthly_bill_range: event.target.value,
                        }))
                      }
                    >
                      <option value="under-100">Under $100</option>
                      <option value="100-200">$100-$200</option>
                      <option value="200-plus">$200+</option>
                      <option value="unknown">Not sure yet</option>
                    </select>
                  </label>
                  <label>
                    Install timeline
                    <select
                      value={leadForm.install_timeline}
                      onChange={(event) =>
                        setLeadForm((current) => ({
                          ...current,
                          install_timeline: event.target.value,
                        }))
                      }
                    >
                      <option value="asap">ASAP</option>
                      <option value="1-3-months">1-3 months</option>
                      <option value="3-6-months">3-6 months</option>
                      <option value="researching">Researching</option>
                    </select>
                  </label>
                </div>

                <label>
                  Project notes
                  <textarea
                    rows="4"
                    value={leadForm.notes}
                    onChange={(event) =>
                      setLeadForm((current) => ({ ...current, notes: event.target.value }))
                    }
                  />
                </label>

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={leadForm.consent_to_contact}
                    onChange={(event) =>
                      setLeadForm((current) => ({
                        ...current,
                        consent_to_contact: event.target.checked,
                      }))
                    }
                  />
                  <span>I agree to be contacted about this solar quote.</span>
                </label>

                <div className="quote-actions">
                  <button className="primary-button" type="submit" disabled={leadSubmitting}>
                    {leadSubmitting ? "Queueing..." : "Request installer follow-up"}
                  </button>
                </div>

                {leadSuccess ? <p className="quote-lead-success">{leadSuccess}</p> : null}
                {leadError ? <p className="error-banner">{leadError}</p> : null}
              </form>
            </article>
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
