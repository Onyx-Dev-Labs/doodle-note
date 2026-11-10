"use client";

import { useEffect, useState } from "react";

const cacheKey = "doodle-note:github-stars:v1";
const validCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

async function readStars(signal: AbortSignal): Promise<number> {
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || "null");
    if (cached && validCount(cached.count) &&
        typeof cached.time === "number" &&
        Date.now() - cached.time >= 0 && Date.now() - cached.time < 300000) {
      return cached.count;
    }
  } catch { /* Storage may be unavailable. Fetch the public count instead. */ }

  const response = await fetch("https://api.github.com/repos/Onyx-Dev-Labs/doodle-note", {
    credentials: "omit", signal,
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) throw new Error("Star count unavailable");
  const repo = await response.json();
  if (!validCount(repo.stargazers_count)) throw new Error("Invalid star count");
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ count: repo.stargazers_count, time: Date.now() }));
  } catch { /* A denied cache does not prevent displaying the count. */ }
  return repo.stargazers_count;
}

export function GitHubStars() {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    readStars(controller.signal)
      .then(count => { if (!controller.signal.aborted) setStars(count); })
      .catch(() => { /* Keep the working GitHub link when the API is unavailable. */ })
      .finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, []);

  return (
    <a className="doodle-github-link"
      href="https://github.com/Onyx-Dev-Labs/doodle-note"
      target="_blank" rel="noopener noreferrer"
      aria-label={stars === null ? "View Doodle Note on GitHub" : `Doodle Note on GitHub, ${stars.toLocaleString("en-US")} stars`}>
      <svg viewBox="0 0 17 16" fill="none" aria-hidden="true">
        <path fillRule="evenodd" clipRule="evenodd" fill="currentColor" d="M8.5 2.22168C5.23312 2.22168 2.58496 4.87398 2.58496 8.14677C2.58496 10.7642 4.27962 12.9853 6.63026 13.7684C6.92601 13.8228 7.03366 13.6401 7.03366 13.4827C7.03366 13.3425 7.02893 12.9693 7.02597 12.4754C5.38041 12.8333 5.0332 11.681 5.0332 11.681C4.76465 10.996 4.37663 10.8139 4.37663 10.8139C3.83954 10.4471 4.41744 10.4542 4.41744 10.4542C5.01072 10.4956 5.32303 11.0647 5.32303 11.0647C5.85065 11.9697 6.70774 11.7082 7.04431 11.5568C7.09873 11.1741 7.25134 10.9132 7.42051 10.7654C6.10737 10.6157 4.72621 10.107 4.72621 7.83683C4.72621 7.19031 4.95689 6.66092 5.33486 6.24686C5.27394 6.09721 5.07105 5.49447 5.39283 4.67938C5.39283 4.67938 5.88969 4.51967 7.01947 5.28626C7.502 5.15466 7.99985 5.08763 8.5 5.08692C9.00278 5.08929 9.50851 5.15495 9.98113 5.28626C11.1103 4.51967 11.606 4.67879 11.606 4.67879C11.9289 5.49447 11.7255 6.09721 11.6651 6.24686C12.0437 6.66092 12.2732 7.19031 12.2732 7.83683C12.2732 10.1129 10.8897 10.6139 9.5724 10.7606C9.78475 10.9434 9.97344 11.3048 9.97344 11.8579C9.97344 12.6493 9.96634 13.2887 9.96634 13.4827C9.96634 13.6413 10.0728 13.8258 10.3733 13.7678C11.5512 13.3728 12.5751 12.6175 13.3003 11.6089C14.0256 10.6002 14.4155 9.38912 14.415 8.14677C14.415 4.87398 11.7663 2.22168 8.5 2.22168Z"/>
      </svg>
      <span data-repo-stars>{stars === null ? "GitHub" : new Intl.NumberFormat("en-US", {
        notation: "compact", maximumFractionDigits: 1,
      }).format(stars)}</span>
    </a>
  );
}
