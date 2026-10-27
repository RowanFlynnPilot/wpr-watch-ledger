import React from "react";
import { slug } from "./share.js";
import { apDate } from "./dates.js";
import { statusLabel } from "./status.js";

// What's next: pending legal action that could change how every agency on the ledger uses
// plate-reader data. HAND-WRITTEN editorial copy, like the overlay: update AS_OF and the text
// when the Supreme Court accepts or declines the petition, or rules.
const AS_OF = "2026-10-26";
const SOURCE = "https://wausaupilotandreview.com/2026/10/19/aclu-wisconsin-sues-over-warrantless-use-of-flock-cameras/";
const RESPONDENTS = ["milwaukee pd", "green bay pd", "racine pd", "kenosha pd"];

export default function WhatsNext({ agencies, onPick }) {
  const named = RESPONDENTS.map((k) => agencies.find((a) => a.canonical === k)).filter(Boolean);
  return (
    <section className="whats-next" aria-label="What's next: the courts">
      <p className="whats-next-kicker">What's next · the courts</p>
      <h2>A warrant fight at the state Supreme Court</h2>
      <p>
        On Oct. 14, the ACLU of Wisconsin, on behalf of the Wisconsin Council of Churches, asked
        the Wisconsin Supreme Court to take up a case directly against four cities. It argues that
        under Article I, Section 11 of the state constitution, police need a judge's warrant to
        search a driver's location history in plate-reader databases, unless there is an
        emergency. The petition does not seek to ban the cameras. The court has not said whether
        it will hear the case.
      </p>
      <ul className="whats-next-cities" aria-label="The four cities named, and where they stand in this ledger">
        {named.map((a) => (
          <li key={a.canonical}>
            <button type="button" className="decision-name" onClick={() => onPick({ type: "agency", id: slug(a.canonical) })}>
              {a.name.replace(/ Police Department$/, "")}
            </button>
            <span className={`badge badge-${a.status.value}`}>{statusLabel(a.status.value)}</span>
          </li>
        ))}
      </ul>
      <p className="whats-next-small">
        Two of the four have already left Flock; the petition is about how police search
        plate-reader data, not about which company collects it. A separate suit filed in Waukesha County in September by the
        Wisconsin Institute for Law and Liberty argues that warrantless searches violate the U.S.
        Constitution. Current as of {apDate(AS_OF)}.{" "}
        <a href={SOURCE} target="_blank" rel="noreferrer">Reporting ↗</a>
      </p>
    </section>
  );
}
