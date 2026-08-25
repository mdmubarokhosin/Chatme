"use client";

/**
 * Private-repo media resolver.
 *
 * When the GitHub uploads repository is PRIVATE, raw.githubusercontent.com
 * links return 404 in the browser (no Authorization header is sent). This
 * module re-fetches those files through the GitHub Contents API using the
 * admin-configured token (settings/githubStorage) and hands back an
 * in-memory blob URL that <img>/<audio>/<video> can render normally.
 *
 * Public-repo URLs, data: URIs and foreign URLs pass through untouched, so
 * behaviour is identical when the repo is public.
 *
 * Components don't need to change: `installPrivateMediaInterceptor()` hooks a
 * capture-phase "error" listener on document, so ANY <img> that fails to load
 * from the uploads repo is automatically re-fetched with the token and
 * swapped to its blob URL — avatars, covers, chat images, admin previews,
 * everything. Audio/video/download sites use `resolveMediaUrl()` directly.
 */
import { useCallback, useEffect, useState } from "react";

import { db } from "@/lib/firebase";

type GithubSettings = { token: string; repo: string; branch: string };

let settingsCache: GithubSettings | null = null;
let settingsPromise: Promise<GithubSettings | null> | null = null;

/** Module-level blob URL cache — same file resolves instantly after first fetch. */
const blobUrlCache = new Map<string, string>();
/** De-duplicates concurrent fetches of the same URL. */
const inFlight = new Map<string, Promise<string>>();

async function loadSettings(): Promise<GithubSettings | null> {
  if (settingsCache) return settingsCache;
  if (settingsPromise) return settingsPromise;
  settingsPromise = (async () => {
    try {
      const snap = await db.ref("settings/githubStorage").once("value");
      const v = (snap.val() || {}) as Partial<GithubSettings>;
      settingsCache = { token: v.token || "", repo: v.repo || "", branch: v.branch || "main" };
    } catch {
      return null;
    }
    return settingsCache;
  })();
  return settingsPromise;
}

/** Re-read settings once (e.g. after admin changes the storage config). */
export function resetMediaSettingsCache() {
  settingsCache = null;
  settingsPromise = null;
}

type RepoTarget = { owner: string; repo: string; path: string; branch: string; token: string };

/** Extract owner/repo/branch/path when `url` points into the configured repo. */
async function repoTargetFor(url: string): Promise<RepoTarget | null> {
  if (!url || !/^https?:\/\//.test(url)) return null;
  const s = await loadSettings();
  if (!s || !s.token || !s.repo) return null;
  const [owner, repoName] = s.repo.split("/");
  if (!owner || !repoName) return null;
  const branch = s.branch || "main";
  // raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
  const rawPrefix = `https://raw.githubusercontent.com/${owner}/${repoName}/`;
  if (url.startsWith(rawPrefix)) {
    const rest = url.slice(rawPrefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    return { owner, repo: repoName, branch: rest.slice(0, slash), path: rest.slice(slash + 1), token: s.token };
  }
  // github.com/{owner}/{repo}/raw/{branch}/{path}
  const ghPrefix = `https://github.com/${owner}/${repoName}/raw/`;
  if (url.startsWith(ghPrefix)) {
    const rest = url.slice(ghPrefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) return null;
    return { owner, repo: repoName, branch: rest.slice(0, slash), path: rest.slice(slash + 1), token: s.token };
  }
  return null;
}

/** Cheap sync pre-check — is this URL worth resolving (looks like our repo)? */
function looksLikeRepoUrl(url: string): boolean {
  return (
    url.startsWith("https://raw.githubusercontent.com/") ||
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/raw\//.test(url)
  );
}

/**
 * Resolve any media URL to something renderable.
 * - data:/blob: and foreign URLs → returned as-is
 * - uploads-repo URLs → fetched via the GitHub Contents API with the admin
 *   token (Accept: application/vnd.github.raw) and converted to a blob URL
 * - on any failure → the original URL (public repos still work directly)
 */
export async function resolveMediaUrl(url: string): Promise<string> {
  if (!url) return url;
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  if (!looksLikeRepoUrl(url)) return url;

  const cached = blobUrlCache.get(url);
  if (cached) return cached;
  const existing = inFlight.get(url);
  if (existing) return existing;

  const task = (async () => {
    const target = await repoTargetFor(url);
    if (!target) return url; // not our repo / no token → try as-is
    try {
      const resp = await fetch(
        `https://api.github.com/repos/${target.owner}/${target.repo}/contents/${target.path}?ref=${target.branch}`,
        {
          headers: {
            Authorization: `token ${target.token}`,
            Accept: "application/vnd.github.raw",
          },
        },
      );
      if (!resp.ok) return url;
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      blobUrlCache.set(url, blobUrl);
      return blobUrl;
    } catch {
      return url;
    }
  })();

  inFlight.set(url, task);
  try {
    return await task;
  } finally {
    inFlight.delete(url);
  }
}

/* ==================== GLOBAL <img> INTERCEPTOR ==================== */

let interceptorInstalled = false;

/**
 * Capture-phase document "error" listener: every <img> that fails to load
 * from the uploads repo (private repo → 404) is re-fetched through the API
 * with the token and its src is swapped to the blob URL. Works app-wide —
 * chat avatars, covers, attachments, admin panel previews — with zero
 * component changes. Safe to call multiple times.
 */
export function installPrivateMediaInterceptor() {
  if (interceptorInstalled || typeof document === "undefined") return;
  interceptorInstalled = true;

  document.addEventListener(
    "error",
    async (event) => {
      const el = event.target as EventTarget | null;
      if (!(el instanceof HTMLImageElement)) return;
      const src = el.getAttribute("src") || "";
      if (!src || el.dataset.mediaResolved === "1") return;
      if (!looksLikeRepoUrl(src)) return;
      el.dataset.mediaResolved = "1";
      try {
        const resolved = await resolveMediaUrl(src);
        if (resolved && resolved !== src) {
          el.dataset.mediaResolved = "0";
          el.src = resolved;
        }
      } catch {
        /* leave the original src */
      }
    },
    true,
  );
}

/* ==================== AUDIO / VIDEO / DOWNLOAD HOOK ==================== */

/**
 * For <audio>/<video> elements: renders the original src first (public repo
 * case), and on load error transparently swaps to the token-fetched blob URL
 * (private repo case). Attach the returned onError to the element.
 */
export function useMediaSrc(src?: string | null): { src: string | undefined; onError: () => void } {
  const [current, setCurrent] = useState<string | null>(src ?? null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    setCurrent(src ?? null);
    setRetrying(false);
  }, [src]);

  const onError = useCallback(() => {
    if (!src || retrying) return;
    setRetrying(true);
    resolveMediaUrl(src)
      .then((r) => {
        if (r && r !== src) setCurrent(r);
      })
      .catch(() => {})
      .finally(() => setRetrying(false));
  }, [src, retrying]);

  return { src: current ?? undefined, onError };
}
