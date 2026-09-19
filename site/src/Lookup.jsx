import React, { useEffect, useMemo, useState } from "react";
import { AgencyCard } from "./Spotlight.jsx";
import { pageUrl, slug } from "./share.js";

// "What about where I live?" One box over agencies, counties and municipalities.
// The pick lives in App so a deep link (#agency=, #county=, #place=) can set it.

const fmt = (n) => (n == null ? "—" : n.toLocaleString("en-US"));
const title = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\b(Du|Of)\b/g, (w) => w.toLowerCase());
const EXAMPLES = [["place", "wausau"], ["county", "marathon"], ["place", "milwaukee"], ["place", "madison"], ["place", "green-bay"]];

export function buildIndex(agencies, counties, places) {
  const items = [];
  for (const c of counties) items.push({ type: "county", id: slug(c.name), label: c.name, sub: "County", county: c.name });
  for (const [p, county] of Object.entries(places)) items.push({ type: "place", id: slug(p), label: title(p), sub: county, county, place: p });
  for (const a of agencies) items.push({ type: "agency", id: slug(a.canonical), label: a.name, sub: a.county || "Statewide or unresolved", county: a.county, agency: a });
  return items;
}

function Stat({ num, label }) {
  return (
    <div className="cstat">
      <span className="cstat-num">{fmt(num)}</span>
      <span className="cstat-label">{label}</span>
    </div>
  );
}

// Communities policed by a department that does not carry their name. Hand-verified.
const SERVED_BY = {
  weston: ["mountain bay metro pd"],
  rothschild: ["mountain bay metro pd"],
  schofield: ["mountain bay metro pd"],
};

// Publishers first, then the agencies that walked away, then the silent ones.
const order = (a) => (a.portal ? 0 : a.status.value === "dropped" ? 1 : a.in_network ? 2 : 3);
const CAP = 6;

function CountyCard({ county, row, agencies, place, mapped, onPick }) {
  const [all, setAll] = useState(false);
  useEffect(() => setAll(false), [county, place]);
  const here = agencies.filter((a) => a.county === county).sort((x, y) => order(x) - order(y) || x.name.localeCompare(y.name));
  const local = place
    ? here.filter((a) => a.name.toLowerCase().includes(place) || (SERVED_BY[place] || []).includes(a.canonical))
    : [];
  const rest = here.filter((a) => !local.includes(a));
  const chip = (a) => (
    <li key={a.canonical}>
      <button
        type="button"
        className={`lk-agency${a.portal ? " has-portal" : ""}${a.status.value === "dropped" ? " is-dropped" : ""}`}
        onClick={() => onPick({ type: "agency", id: slug(a.canonical) })}
      >
        <span className="lk-dot" aria-hidden="true" />
        <span className="lk-agency-name">{a.name}</span>
        <span className="lk-agency-fact">
          {a.status.value === "dropped" ? "dropped Flock" : a.portal ? "publishes a portal" : a.in_network ? "no portal" : "documented use"}
        </span>
      </button>
    </li>
  );
  return (
    <article className="card card-spot lk-county">
      <header className="card-head">
        <h3>{place ? `${title(place)}, ${county}` : county}</h3>
        {row && <p className="card-status"><span className="asof">{fmt(row.population)} residents countywide</span></p>}
      </header>
      {row && (
        <div className="cstats">
          <Stat num={row.in_network} label="agencies in the Flock network" />
          <Stat num={row.portals} label="publish a transparency portal" />
          <Stat num={mapped?.dots ?? 0} label="cameras mapped by volunteers" />
          <Stat num={row.wisdot_cameras} label="highway cameras permitted" />
          <Stat num={row.usat_searches} label="searches on record, USA TODAY" />
          {row.ice_287g > 0 && <Stat num={row.ice_287g} label="ICE 287(g) agreements" />}
        </div>
      )}
      {local.length > 0 && (
        <>
          <p className="lk-list-title">Agencies serving {title(place)}</p>
          <ul className="lk-agencies">{local.map(chip)}</ul>
        </>
      )}
      {rest.length > 0 && (
        <>
          <p className="lk-list-title">
            {local.length ? `Elsewhere in ${county}` : `Agencies in ${county}`}
            <span className="lk-list-count">{rest.length}</span>
          </p>
          <ul className="lk-agencies">{(all ? rest : rest.slice(0, CAP)).map(chip)}</ul>
          {rest.length > CAP && (
            <button type="button" className="lk-more" onClick={() => setAll(!all)} aria-expanded={all}>
              {all ? "Show fewer" : `Show all ${rest.length} agencies`}
            </button>
          )}
        </>
      )}
      {here.length === 0 && <p className="card-note">No agency in this county appears in any of the ledger's sources.</p>}
      {place && (
        <p className="lk-fine">
          Figures above are for the whole county. The sheriff and neighboring departments can
          search cameras here too; pick an agency to see what it publishes and who it shares with.
        </p>
      )}
    </article>
  );
}

export default function Lookup({ index, agencies, counties, countyCounts, usat, pick, onPick, onShowCounty, onFindInRoster }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [copied, setCopied] = useState(false);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (t.length < 2) return [];
    const rank = (it) => {
      const l = it.label.toLowerCase();
      return (l.startsWith(t) ? 0 : l.includes(` ${t}`) ? 1 : 2) + (it.type === "place" ? 0 : it.type === "county" ? 0.2 : 0.4);
    };
    return index
      .filter((it) => it.label.toLowerCase().includes(t))
      .sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label))
      .slice(0, 8);
  }, [q, index]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(t);
  }, [copied]);

  const choose = (it) => { onPick({ type: it.type, id: it.id }); setQ(""); setOpen(false); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, matches.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && matches[active]) { e.preventDefault(); choose(matches[active]); }
    else if (e.key === "Escape") setOpen(false);
  };

  const item = pick ? index.find((it) => it.type === pick.type && it.id === pick.id) : null;
  const county = item?.county && counties.some((c) => c.name === item.county) ? item.county : null;
  const copy = async () => {
    try { await navigator.clipboard.writeText(pageUrl(`#${pick.type}=${pick.id}`)); setCopied(true); } catch { /* clipboard blocked */ }
  };

  return (
    <section className="lookup" aria-label="Look up your community">
      <div className="lookup-head">
        <h2>Look up your community</h2>
        <p className="lookup-dek">Type a city, village, county or agency to see what the ledger holds on it.</p>
      </div>
      <div className="lookup-box">
        <input
          type="search"
          className="lookup-input"
          role="combobox"
          aria-expanded={open && matches.length > 0}
          aria-controls="lookup-list"
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `lk-${active}` : undefined}
          aria-label="City, village, county or agency"
          placeholder="Wausau, Marathon County, Green Bay Police…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKey}
        />
        {open && q.trim().length >= 2 && (
          <ul className="lookup-list" id="lookup-list" role="listbox">
            {matches.length === 0 && <li className="lookup-none">Nothing in the ledger matches “{q.trim()}”. Try the county.</li>}
            {matches.map((it, i) => (
              <li
                key={`${it.type}-${it.id}`}
                id={`lk-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "active" : undefined}
                onMouseDown={(e) => { e.preventDefault(); choose(it); }}
                onMouseEnter={() => setActive(i)}
              >
                <span className="lookup-label">{it.label}</span>
                <span className="lookup-sub">
                  {it.type === "county" ? "County" : it.type === "place" ? `Community · ${it.sub}` : `Agency · ${it.sub}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!item && (
        <p className="lookup-try">
          Try{" "}
          {EXAMPLES.map(([type, id], i) => {
            const it = index.find((x) => x.type === type && x.id === id);
            return it ? (
              <React.Fragment key={id}>
                {i > 0 && " · "}
                <button type="button" className="lookup-ex" onClick={() => onPick({ type, id })}>{it.label}</button>
              </React.Fragment>
            ) : null;
          })}
        </p>
      )}
      {item && (
        <div className="lookup-result" aria-live="polite">
          <p className="lookup-kind">
            {item.type === "agency" ? "Agency" : item.type === "county" ? "County" : "Community"}
            {item.type !== "county" && item.county ? ` · ${item.county}` : ""}
          </p>
          {item.type === "agency" ? (
            <AgencyCard a={item.agency} usat={usat} />
          ) : (
            <CountyCard
              county={item.county}
              row={counties.find((c) => c.name === item.county)}
              agencies={agencies}
              place={item.place}
              mapped={countyCounts[item.county]}
              onPick={onPick}
            />
          )}
          <div className="lookup-actions">
            {county && <button type="button" className="dl" onClick={() => onShowCounty(county)}>Show {county} on the map</button>}
            {item.type === "agency" && <button type="button" className="dl" onClick={() => onFindInRoster(item.agency)}>Find in the roster</button>}
            {item.type === "agency" && county && (
              <button type="button" className="dl dl-quiet" onClick={() => onPick({ type: "county", id: slug(county) })}>All of {county}</button>
            )}
            <button type="button" className="dl dl-quiet" onClick={copy}>{copied ? "Link copied" : "Copy link to this"}</button>
            <button type="button" className="dl dl-quiet" onClick={() => onPick(null)}>Clear</button>
          </div>
        </div>
      )}
    </section>
  );
}
