import React, { useEffect, useMemo, useState } from "react";

// Ask for the records yourself: a Wisconsin Open Records Law request for an agency's
// Flock audit logs and contract, filled in for the agency the reader picks, plus the
// newsroom's tip line. Nothing is sent from this page; the letter is copied or opened
// in the reader's own mail program.

const TIPS = "editor@wausaupilotandreview.com";

function letter(agency) {
  const name = agency || "[agency name]";
  return `To the records custodian, ${name}:

Under the Wisconsin Open Records Law, Wis. Stat. §§ 19.31 to 19.39, I request copies of the following records concerning the agency's automated license plate reader system (Flock Safety or any other vendor):

1. The Organization Audit and Network Audit logs exported from the vendor's system for the most recent 12 months, showing each search, its date and time, the stated reason, and the searching agency.
2. The current contract, order form or agreement with the vendor, with any amendments, renewals and invoices.
3. The agency's written policy on license plate reader use, data retention and data sharing.
4. The list of outside agencies currently granted access to this agency's camera data.

I ask for electronic copies by email. The law does not require me to state a purpose or identify myself (Wis. Stat. § 19.35(1)(i)), and it requires a response "as soon as practicable and without delay" (§ 19.35(4)(a)). If any part of this request is denied, please cite the specific statutory exemption in writing, as § 19.35(4)(b) requires, and release the remainder. Please tell me in advance if fees will exceed $25.

Thank you.`;
}

export default function TakeAction({ agencies, picked }) {
  const options = useMemo(
    () => agencies.map((a) => a.name).sort((x, y) => x.localeCompare(y)),
    [agencies]
  );
  const [agency, setAgency] = useState("");
  const [copied, setCopied] = useState(false);
  // Follow the community lookup: the agency a reader just looked up is the likely subject.
  useEffect(() => { if (picked) setAgency(picked); }, [picked]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  const text = letter(agency);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); } catch { /* clipboard blocked: the text is selectable */ }
  };
  const mailto = `mailto:?subject=${encodeURIComponent("Open records request: license plate reader records")}&body=${encodeURIComponent(text)}`;

  return (
    <section className="action" aria-label="Ask for the records yourself">
      <h2>Ask for the records yourself</h2>
      <p className="action-dek">
        Most agencies in this ledger publish nothing, but the audit logs behind USA TODAY's
        reporting are public records in Wisconsin. Anyone can request them. Pick an agency, copy
        the letter and send it to the agency's records custodian, whose address is usually on
        the department's website.
      </p>
      <ol className="action-steps" aria-label="How it works">
        <li className={agency ? "done" : undefined}><span>1</span>Pick the agency</li>
        <li className={copied ? "done" : undefined}><span>2</span>Copy the letter</li>
        <li><span>3</span>Send it to the records custodian</li>
      </ol>
      <div className="action-grid">
        <div className="action-letter">
          <label className="action-label" htmlFor="action-agency">Agency</label>
          <select id="action-agency" className="action-select" value={agency} onChange={(e) => setAgency(e.target.value)}>
            <option value="">Choose an agency…</option>
            {options.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <details className="action-preview">
            <summary>Read the letter</summary>
            <pre>{text}</pre>
          </details>
          <div className="action-buttons">
            <button type="button" className="dl dl-plate" onClick={copy}>{copied ? "Letter copied" : "Copy the letter"}</button>
            <a className="dl" href={mailto}>Open in your email</a>
          </div>
          <p className="action-fine">
            This is a template, not legal advice. Agencies may charge the actual cost of copies,
            and a fee to locate records only when that cost is $50 or more.
          </p>
        </div>
        <div className="action-tips">
          <p className="action-tips-title">Got something back? Know of a camera?</p>
          <p>
            Send the newsroom what you receive, a contract you have seen on a council agenda, or
            a camera that is not on the map. Records readers obtain can be added to this ledger.
          </p>
          <a className="dl" href={`mailto:${TIPS}?subject=${encodeURIComponent("Watch Ledger tip")}`}>Email the newsroom</a>
          <p className="action-fine">
            To put a camera on the map itself, report it to the volunteers at{" "}
            <a href="https://deflock.org/" target="_blank" rel="noreferrer">DeFlock</a>.
          </p>
        </div>
      </div>
    </section>
  );
}
