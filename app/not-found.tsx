// Unknown addresses, and tasks outside the signed-in person's properties.
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page narrow">
      <div className="card empty">
        <b>Not found</b>
        <span>This page or task doesn&apos;t exist, or it isn&apos;t at one of your properties.</span>
        <div className="row2" style={{ justifyContent: "center", marginTop: 8 }}><Link href="/" className="btn">Go to start</Link></div>
      </div>
    </div>
  );
}
