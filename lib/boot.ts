import { requireUser } from "./auth";
import { sweep } from "./engine";

/** Every page: bring task states up to date, then resolve the signed-in user. */
export async function boot() {
  sweep();
  return requireUser();
}
