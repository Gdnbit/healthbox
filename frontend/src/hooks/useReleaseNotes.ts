// Modified for the HealthBox distribution; differs from MediKeep v0.68.0. See NOTICE and MODIFICATIONS.md.
import { useState, useEffect, useCallback } from 'react';

import { useAuth } from '../contexts/AuthContext';
import { getReleaseNotes, getVersionInfo } from '../services/systemService';
import type { Release } from '../types/releaseNotes';
import { compareVersions } from '../utils/releaseNoteHelpers';

interface UseReleaseNotesReturn {
  showModal: boolean;
  dismissModal: () => void;
  releases: Release[];
  unseenReleases: Release[];
  currentVersion: string;
  loading: boolean;
  error: string | null;
}

function getStorageKey(userId: string | number): string {
  return `medikeep_last_seen_version_${userId}`;
}

function getLastSeenVersion(userId: string | number): string | null {
  try {
    return localStorage.getItem(getStorageKey(userId));
  } catch {
    return null;
  }
}

function setLastSeenVersion(userId: string | number, version: string): void {
  try {
    localStorage.setItem(getStorageKey(userId), version);
  } catch {
    // localStorage unavailable - silently ignore
  }
}

export function useReleaseNotes(): UseReleaseNotesReturn {
  const { user, isAuthenticated } = useAuth() as {
    user: { id: string | number } | null;
    isAuthenticated: boolean;
  };

  const [showModal, setShowModal] = useState(false);
  const [releases, setReleases] = useState<Release[]>([]);
  const [unseenReleases, setUnseenReleases] = useState<Release[]>([]);
  const [currentVersion, setCurrentVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        const [versionData, releaseData] = await Promise.all([
          getVersionInfo(),
          getReleaseNotes(20),
        ]);

        if (cancelled) return;

        const version =
          'version' in versionData && typeof versionData.version === 'string'
            ? versionData.version
            : '';
        const allReleases =
          'releases' in releaseData && Array.isArray(releaseData.releases)
            ? (releaseData.releases as Release[])
            : [];

        setCurrentVersion(version);
        setReleases(allReleases);

        const lastSeen = getLastSeenVersion(user.id);

        let unseen: Release[];
        if (!lastSeen) {
          // First-time user: show only the current release
          unseen = allReleases.filter(
            r => compareVersions(r.tag_name, version) === 0
          );
          if (unseen.length === 0 && allReleases.length > 0) {
            const atOrBelow = allReleases
              .filter(r => compareVersions(r.tag_name, version) <= 0)
              .sort((a, b) => compareVersions(b.tag_name, a.tag_name));
            unseen = atOrBelow.length > 0 ? [atOrBelow[0]] : [];
          }
        } else {
          // Returning user: show releases between lastSeen and currentVersion
          unseen = allReleases.filter(
            r =>
              compareVersions(r.tag_name, lastSeen) > 0 &&
              compareVersions(r.tag_name, version) <= 0
          );
        }

        // Sort newest first
        unseen.sort((a, b) => compareVersions(b.tag_name, a.tag_name));

        setUnseenReleases(unseen);

        if (unseen.length > 0) {
          setShowModal(true);
        }
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error ? err.message : 'Failed to fetch release notes'
        );
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user?.id]);

  const dismissModal = useCallback(() => {
    setShowModal(false);
    if (user?.id && currentVersion) {
      setLastSeenVersion(user.id, currentVersion);
    }
  }, [user?.id, currentVersion]);

  return {
    showModal,
    dismissModal,
    releases,
    unseenReleases,
    currentVersion,
    loading,
    error,
  };
}
