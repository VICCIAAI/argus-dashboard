"use client";

import { useState, type FormEvent } from "react";

const INPUT =
  "mt-1 w-full rounded border border-border bg-surface-raised px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-accent";
const LABEL =
  "block font-mono text-[11px] tracking-wider text-muted uppercase";

/**
 * Sign in to one node from its own panel. The password goes to this node
 * only, through /api/auth/login, and is dropped when the form unmounts.
 */
export function NodeSignIn({
  nodeId,
  nodeName,
  onSignedIn,
}: {
  nodeId: string;
  nodeName: string;
  onSignedIn: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node: nodeId, username, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "Sign-in failed");
        setSubmitting(false);
        return;
      }
      onSignedIn();
    } catch {
      setError(`Cannot reach ${nodeName}`);
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-4 p-6"
    >
      <p className="font-mono text-xs tracking-widest text-muted uppercase">
        Sign in to {nodeName}
      </p>

      <div>
        <label htmlFor={`${nodeId}-username`} className={LABEL}>
          Username
        </label>
        <input
          id={`${nodeId}-username`}
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className={INPUT}
        />
      </div>

      <div>
        <label htmlFor={`${nodeId}-password`} className={LABEL}>
          Password
        </label>
        <input
          id={`${nodeId}-password`}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT}
        />
      </div>

      {error && (
        <p className="rounded border border-danger/30 bg-danger/10 px-3 py-2 font-mono text-xs text-danger">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-accent py-2 font-mono text-xs font-semibold tracking-[0.2em] text-background uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Authenticating…" : "Authenticate"}
      </button>
    </form>
  );
}
