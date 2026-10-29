// Saved filters for one screen.
import { all } from "./db";

export type SavedView = { id: number; name: string; def: boolean; f: Record<string, unknown> };

export async function viewsFor(userId: number, page: string): Promise<SavedView[]> {
  return (await all<{ id: number; name: string; filters: string; is_default: number }>(
    "SELECT id, name, filters, is_default FROM saved_views WHERE user_id=? AND page=? ORDER BY id", userId, page))
    .map((v) => ({ id: v.id, name: v.name, def: !!v.is_default, f: JSON.parse(v.filters) }));
}
