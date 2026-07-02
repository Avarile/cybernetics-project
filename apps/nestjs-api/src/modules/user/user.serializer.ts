import type { User } from "../../infra/database/schema";

/** Strip sensitive fields before returning a user over the wire. */
export function serializeUser(user: User): Omit<User, "password"> {
  const { password: _password, ...rest } = user;
  return rest;
}
