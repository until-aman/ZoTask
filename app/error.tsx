"use client";
// Shown in place of a screen that failed to load, with a way to try again instead of a blank page.
import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="page narrow">
      <div className="card empty" role="alert">
        <b>Something went wrong loading this screen</b>
        <span>Your work is saved up to the last thing you submitted. Try again, or go back to the start.</span>
        {error.digest && <span className="small muted">Reference: {error.digest}</span>}
        <div className="row2" style={{ justifyContent: "center", marginTop: 8 }}>
          <button type="button" className="btn primary" onClick={reset}>Try again</button>
          <Link href="/" className="btn">Go to start</Link>
        </div>
      </div>
    </div>
  );
}
