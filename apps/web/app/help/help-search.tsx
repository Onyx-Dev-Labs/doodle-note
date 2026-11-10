"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  helpSearchSnippet,
  searchHelp,
  type HelpSearchEntry,
} from "../../lib/help-search";

export function SearchIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </svg>
  );
}

export function HelpSearch() {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const cache = useRef<HelpSearchEntry[] | null>(null);
  const pending = useRef(false);
  const [entries, setEntries] = useState<HelpSearchEntry[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = searchHelp(entries, query);

  async function loadIndex() {
    if (pending.current) return;
    if (cache.current) {
      setStatus("ready");
      return;
    }
    pending.current = true;
    setStatus("loading");
    try {
      const response = await fetch("/help/search-index", {
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Search unavailable");
      const data: unknown = await response.json();
      if (
        !Array.isArray(data) ||
        !data.every(
          (item) =>
            item &&
            typeof item.href === "string" &&
            item.href.startsWith("/help/") &&
            [item.title, item.section, item.category, item.text].every(
              (field) => typeof field === "string",
            ),
        )
      )
        throw new Error("Invalid search index");
      cache.current = data;
      setEntries(data);
      setStatus("ready");
    } catch {
      setStatus("error");
    } finally {
      pending.current = false;
    }
  }

  function openSearch() {
    dialog.current?.showModal();
    input.current?.focus();
    void loadIndex();
  }

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        if (document.querySelector("dialog[open]") && !dialog.current?.open)
          return;
        event.preventDefault();
        trigger.current?.click();
      }
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);

  useEffect(() => {
    if (dialog.current?.open)
      document
        .getElementById(`help-result-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, query]);

  return (
    <>
      <button
        className="help-search-trigger"
        ref={trigger}
        onClick={openSearch}
        aria-haspopup="dialog"
      >
        <SearchIcon />
        <span>Search the guides…</span>
        <kbd>⌘ K</kbd>
      </button>
      <dialog
        className="help-search-dialog"
        ref={dialog}
        aria-labelledby="help-search-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
      >
        <div className="help-search-panel">
          <div className="help-search-input-row">
            <SearchIcon />
            <label
              id="help-search-title"
              htmlFor="help-search-input"
              className="sr-only"
            >
              Search help and guides
            </label>
            <input
              ref={input}
              id="help-search-input"
              placeholder="What would you like help with?"
              value={query}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={status === "ready" && results.length > 0}
              aria-controls="help-search-results"
              aria-activedescendant={
                results[active] ? `help-result-${active}` : undefined
              }
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setActive((current) =>
                    results.length
                      ? (current +
                          (event.key === "ArrowDown" ? 1 : -1) +
                          results.length) %
                        results.length
                      : 0,
                  );
                }
                if (event.key === "Enter" && results[active]) {
                  event.preventDefault();
                  document.getElementById(`help-result-${active}`)?.click();
                }
              }}
            />
            <button
              className="help-close"
              aria-label="Close search"
              onClick={() => dialog.current?.close()}
            >
              Esc
            </button>
          </div>
          <div className="help-search-body">
            {status === "loading" && (
              <p role="status" className="help-search-message">
                Loading the guides…
              </p>
            )}
            {status === "error" && (
              <div className="help-search-message" role="alert">
                <strong>Search couldn’t load.</strong>
                <p>
                  Check your connection and try again. You can still browse the
                  guide navigation.
                </p>
                <button
                  className="help-button"
                  onClick={() => void loadIndex()}
                >
                  Try again
                </button>
              </div>
            )}
            {status === "ready" && !query.trim() && (
              <div className="help-search-message">
                <p>Try “microphone”, “Bark”, or “share a meeting”.</p>
                <p className="help-muted">
                  Search covers these public guides, never your meetings or
                  account.
                </p>
              </div>
            )}
            {status === "ready" && query.trim() && (
              <p role="status" className="help-result-count">
                {results.length
                  ? `${results.length} ${results.length === 1 ? "result" : "results"}`
                  : "No guides found. Try fewer words or a feature name."}
              </p>
            )}
            <div
              id="help-search-results"
              role="listbox"
              aria-label="Search results"
            >
              {status === "ready" &&
                results.map((entry, index) => (
                  <Link
                    id={`help-result-${index}`}
                    key={entry.href}
                    href={entry.href}
                    role="option"
                    aria-selected={active === index}
                    tabIndex={-1}
                    className="help-search-result"
                    onMouseMove={() => setActive(index)}
                    onClick={() => dialog.current?.close()}
                  >
                    <span className="help-result-category">
                      {entry.category}
                    </span>
                    <strong>{entry.title}</strong>
                    {entry.section !== "Overview" && (
                      <span className="help-result-section">
                        {entry.section}
                      </span>
                    )}
                    <span>{helpSearchSnippet(entry.text, query)}</span>
                  </Link>
                ))}
            </div>
          </div>
          <div className="help-search-footer">
            <span>↑ ↓ to navigate · Enter to open</span>
            <Link href="/contact" onClick={() => dialog.current?.close()}>
              Still need a hand?
            </Link>
          </div>
        </div>
      </dialog>
    </>
  );
}
