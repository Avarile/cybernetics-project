// Mirrors plane/app/permissions/base.py ROLE.
export enum ROLE {
  ADMIN = 20,
  MEMBER = 15,
  GUEST = 5,
}

export const ALL_ROLES = [ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST];
