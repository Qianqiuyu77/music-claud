"use client";

import { RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";

type ProfileStatus = {
  exists: boolean;
  confidence: number | null;
  stale: boolean;
  lastRefreshedAt: string | null;
  summaryLength: number;
};

const emptyProfile: ProfileStatus = {
  exists: false,
  confidence: null,
  stale: true,
  lastRefreshedAt: null,
  summaryLength: 0
};

export function ProfileDiagnosticsPanel() {
  const [profile, setProfile] = useState<ProfileStatus>(emptyProfile);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refreshProfileStatus() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/profiles/status");
      const data = (await response.json()) as { profile?: ProfileStatus; error?: string };
      if (!response.ok || !data.profile) {
        setError(data.error ?? "Profile status could not be loaded.");
        return;
      }
      setProfile(data.profile);
    } catch {
      setError("Profile status could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshProfileStatus();
  }, []);

  return (
    <aside className="profile-diagnostics-panel">
      <div className="panel-header">
        <p className="eyebrow">Profile Diagnostics</p>
        <h2>User Profile</h2>
      </div>
      <div className="profile-metrics">
        <div>
          <span>state</span>
          <strong>{profile.exists ? (profile.stale ? "stale" : "fresh") : "missing"}</strong>
        </div>
        <div>
          <span>confidence</span>
          <strong>{profile.confidence === null ? "confidence none" : `confidence ${profile.confidence.toFixed(2)}`}</strong>
        </div>
        <div>
          <span>summary</span>
          <strong>{`summary length ${profile.summaryLength}`}</strong>
        </div>
        <div>
          <span>refreshed</span>
          <strong>{profile.lastRefreshedAt ?? "never"}</strong>
        </div>
      </div>
      <button type="button" className="secondary-button" onClick={() => void refreshProfileStatus()} disabled={loading} title="Refresh profile diagnostics">
        <RefreshCcw size={16} />
        {loading ? "refreshing" : "refresh"}
      </button>
      {error ? <p className="data-note">{error}</p> : null}
    </aside>
  );
}
