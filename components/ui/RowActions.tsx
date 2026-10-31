"use client";
// Edit and delete as icons on a table row. Delete asks on the row itself (browser pop-ups are blocked in some viewers).
import { useState } from "react";

const Pencil = () => <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3L5.6 12.5 2.5 13.5l1-3.1z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>;
const Bin = () => <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h11M6 4.5V3h4v1.5M4 4.5l.7 9h6.6l.7-9M6.7 7v4.5M9.3 7v4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;

export function RowActions({ name, onEdit, onDelete, deleteLabel = "Delete" }: { name: string; onEdit?: () => void; onDelete?: () => unknown; deleteLabel?: string }) {
  const [ask, setAsk] = useState(false);
  if (ask) return (
    <span className="rowact ask">
      <span className="small">{deleteLabel}?</span>
      <button type="button" className="btn sm danger" onClick={() => { setAsk(false); void onDelete?.(); }}>Yes</button>
      <button type="button" className="btn sm" onClick={() => setAsk(false)}>No</button>
    </span>
  );
  return (
    <span className="rowact">
      {onEdit && <button type="button" className="iconbtn" title={`Edit ${name}`} aria-label={`Edit ${name}`} onClick={onEdit}><Pencil /></button>}
      {onDelete && <button type="button" className="iconbtn del" title={`${deleteLabel} ${name}`} aria-label={`${deleteLabel} ${name}`} onClick={() => setAsk(true)}><Bin /></button>}
    </span>
  );
}
