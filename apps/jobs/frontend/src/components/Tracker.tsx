import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Application } from "../lib/types";
import { ApplicationDetail } from "./ApplicationDetail";

export function Tracker({ statuses }: { statuses: string[] }) {
  const [apps, setApps] = useState<Application[]>([]);
  const [stats, setStats] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setApps(await api.listApplications(filter || undefined));
    setStats(await api.stats());
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const sel = apps.find((a) => a.id === selected) ?? null;

  return (
    <div>
      <div className="stats">
        {Object.entries(stats).map(([s, c]) => (
          <div className="stat" key={s}>{s} <b>{c}</b></div>
        ))}
        {Object.keys(stats).length === 0 && <span className="hint">No applications yet — add one from “Add Job”.</span>}
      </div>

      <div className="row" style={{ marginBottom: 10 }}>
        <select className="btn" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="tracker">
        <div className="applist">
          {apps.map((a) => (
            <div
              key={a.id}
              className={`appcard ${a.id === selected ? "sel" : ""}`}
              onClick={() => setSelected(a.id)}
            >
              <div className="row" style={{ justifyContent: "space-between" }}>
                <b>{a.title || "(untitled)"}</b>
                <span className="status">{a.status}</span>
              </div>
              <div className="co">{a.company || ""}</div>
            </div>
          ))}
        </div>
        <div>
          {sel ? (
            <ApplicationDetail
              key={sel.id}
              app={sel}
              statuses={statuses}
              onChanged={refresh}
              onDeleted={() => {
                setSelected(null);
                void refresh();
              }}
            />
          ) : (
            <div className="detail hint">Select an application to view details and run AI actions.</div>
          )}
        </div>
      </div>
    </div>
  );
}
