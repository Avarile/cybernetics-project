/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Link from "next/link";
// plane packages
import type { TAdminAuthErrorInfo } from "@plane/constants";
import { SUPPORT_EMAIL, EAdminAuthErrorCodes } from "@plane/constants";

export enum EErrorAlertType {
  BANNER_ALERT = "BANNER_ALERT",
  INLINE_FIRST_NAME = "INLINE_FIRST_NAME",
  INLINE_EMAIL = "INLINE_EMAIL",
  INLINE_PASSWORD = "INLINE_PASSWORD",
  INLINE_EMAIL_CODE = "INLINE_EMAIL_CODE",
}

const errorCodeMessages: {
  [key in EAdminAuthErrorCodes]: { title: string; message: (email?: string) => React.ReactNode };
} = {
  // admin
  [EAdminAuthErrorCodes.ADMIN_ALREADY_EXIST]: {
    title: `Admin already exists`,
    message: () => `Admin already exists. Please try again.`,
  },
  [EAdminAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME]: {
    title: `Email, password and first name required`,
    message: () => `Email, password and first name required. Please try again.`,
  },
  [EAdminAuthErrorCodes.INVALID_ADMIN_EMAIL]: {
    title: `Invalid admin email`,
    message: () => `Invalid admin email. Please try again.`,
  },
  [EAdminAuthErrorCodes.INVALID_ADMIN_PASSWORD]: {
    title: `Invalid admin password`,
    message: () => `Invalid admin password. Please try again.`,
  },
  [EAdminAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD]: {
    title: `Email and password required`,
    message: () => `Email and password required. Please try again.`,
  },
  [EAdminAuthErrorCodes.ADMIN_AUTHENTICATION_FAILED]: {
    title: `Authentication failed`,
    message: () => `Authentication failed. Please try again.`,
  },
  [EAdminAuthErrorCodes.ADMIN_USER_ALREADY_EXIST]: {
    title: `Admin user already exists`,
    message: () => (
      <div>
        Admin user already exists.&nbsp;
        <Link className="font-medium underline underline-offset-4 transition-all hover:font-bold" href={`/admin`}>
          Sign In
        </Link>
        &nbsp;now.
      </div>
    ),
  },
  [EAdminAuthErrorCodes.ADMIN_USER_DOES_NOT_EXIST]: {
    title: `Admin user does not exist`,
    message: () => (
      <div>
        Admin user does not exist.&nbsp;
        <Link className="font-medium underline underline-offset-4 transition-all hover:font-bold" href={`/admin`}>
          Sign In
        </Link>
        &nbsp;now.
      </div>
    ),
  },
  [EAdminAuthErrorCodes.ADMIN_USER_DEACTIVATED]: {
    title: `User account deactivated`,
    message: () => `User account deactivated. Please contact ${SUPPORT_EMAIL ? SUPPORT_EMAIL : "administrator"}.`,
  },
  // two-factor authentication
  [EAdminAuthErrorCodes.TWO_FACTOR_REQUIRED]: {
    title: `Check your email`,
    message: () => `Enter the code we emailed you to finish signing in.`,
  },
  [EAdminAuthErrorCodes.INVALID_TWO_FACTOR_CODE]: {
    title: `Invalid code`,
    message: () => `That code isn't right. Please try again.`,
  },
  [EAdminAuthErrorCodes.EXPIRED_TWO_FACTOR_CODE]: {
    title: `Code expired`,
    message: () => `Your code expired. Please sign in again.`,
  },
  [EAdminAuthErrorCodes.TWO_FACTOR_ATTEMPTS_EXHAUSTED]: {
    title: `Too many attempts`,
    message: () => `Too many wrong codes. Sign in again to get a new code.`,
  },
  [EAdminAuthErrorCodes.TWO_FACTOR_LOCKED]: {
    title: `Too many attempts`,
    message: () => `Too many wrong codes. Please try again in 15 minutes.`,
  },
  [EAdminAuthErrorCodes.SMTP_NOT_CONFIGURED]: {
    title: `SMTP not configured`,
    message: () => `Your account uses two-factor authentication, but email isn't configured on this instance.`,
  },
  [EAdminAuthErrorCodes.RATE_LIMIT_EXCEEDED]: {
    title: `Too many requests`,
    message: () => `Please wait a moment and try again.`,
  },
};

/** Errors that keep the admin sign-in on the two-factor code step; the others restart sign-in. */
export const twoFactorCodeStepErrors: string[] = [
  EAdminAuthErrorCodes.TWO_FACTOR_REQUIRED,
  EAdminAuthErrorCodes.INVALID_TWO_FACTOR_CODE,
];

export const authErrorHandler = (errorCode: EAdminAuthErrorCodes, email?: string): TAdminAuthErrorInfo | undefined => {
  const bannerAlertErrorCodes = [
    EAdminAuthErrorCodes.ADMIN_ALREADY_EXIST,
    EAdminAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD_FIRST_NAME,
    EAdminAuthErrorCodes.INVALID_ADMIN_EMAIL,
    EAdminAuthErrorCodes.INVALID_ADMIN_PASSWORD,
    EAdminAuthErrorCodes.REQUIRED_ADMIN_EMAIL_PASSWORD,
    EAdminAuthErrorCodes.ADMIN_AUTHENTICATION_FAILED,
    EAdminAuthErrorCodes.ADMIN_USER_ALREADY_EXIST,
    EAdminAuthErrorCodes.ADMIN_USER_DOES_NOT_EXIST,
    EAdminAuthErrorCodes.ADMIN_USER_DEACTIVATED,
    EAdminAuthErrorCodes.INVALID_TWO_FACTOR_CODE,
    EAdminAuthErrorCodes.EXPIRED_TWO_FACTOR_CODE,
    EAdminAuthErrorCodes.TWO_FACTOR_ATTEMPTS_EXHAUSTED,
    EAdminAuthErrorCodes.TWO_FACTOR_LOCKED,
    EAdminAuthErrorCodes.SMTP_NOT_CONFIGURED,
    EAdminAuthErrorCodes.RATE_LIMIT_EXCEEDED,
  ];

  if (bannerAlertErrorCodes.includes(errorCode))
    return {
      type: EErrorAlertType.BANNER_ALERT,
      code: errorCode,
      title: errorCodeMessages[errorCode]?.title || "Error",
      message: errorCodeMessages[errorCode]?.message(email) || "Something went wrong. Please try again.",
    };

  return undefined;
};
