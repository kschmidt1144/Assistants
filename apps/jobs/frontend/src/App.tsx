import { useEffect, useState } from "react";
import { AddJob } from "./components/AddJob";
import { ProfilePanel } from "./components/ProfilePanel";
import { Tracker } from "./components/Tracker";
import { api } from "./lib/api";

type View = "tracker" | "add" | "profile";

const FALLBACK_STATUSES = ["New", "Interested", "Applied", "Interviewing", "Offer", "Rejected", "Withdrawn"];

export function App() {
  const [view, setView] = useState<View>("tracker");
  const [statuses, setStatuses] = useState<string[]>(FALLBACK_STATUSES);
  const [trackerKey, setTrackerKey] = useState(0);

  useEffect(() => {
    void api.statuses().then(setStatuses).catch(() => setStatuses(FALLBACK_STATUSES));
  }, []);

  return (
    <div className="app">
      <nav className="nav">
        <span className="title">💼 Job Application Assistant</span>
        <button className={`btn ${view === "tracker" ? "active" : ""}`} onClick={() => setView("tracker")}>Tracker</button>
        <button className={`btn ${view === "add" ? "active" : ""}`} onClick={() => setView("add")}>Add Job</button>
        <button className={`btn ${view === "profile" ? "active" : ""}`} onClick={() => setView("profile")}>Profile</button>
        <div className="spacer" />
        <span className="hint">no scraping · manual intake</span>
      </nav>
      <div className="content">
        {view === "profile" && <ProfilePanel />}
        {view === "add" && <AddJob onTracked={() => { setTrackerKey((k) => k + 1); setView("tracker"); }} />}
        {view === "tracker" && <Tracker key={trackerKey} statuses={statuses} />}
      </div>
    </div>
  );
}
