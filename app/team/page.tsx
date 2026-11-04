import { redirect } from "next/navigation";

// Team leave now lives with the review team's week offs in one Admin tab.
export default function TeamPage() {
  redirect("/admin?tab=weekoffs");
}
