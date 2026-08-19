/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import Script from "next/script";

// styles
// oxlint-disable-next-line import/no-unassigned-import -- side-effect import: injects the global stylesheet
import "@/styles/globals.css";

import { SITE_DESCRIPTION, SITE_NAME } from "@plane/constants";

// helpers
import { cn } from "@plane/utils";

// assets
import appleTouchIcon from "@/app/assets/favicon/apple-touch-icon.png?url";
import favicon16 from "@/app/assets/favicon/favicon-16x16.png?url";
import favicon32 from "@/app/assets/favicon/favicon-32x32.png?url";
import favicon96 from "@/app/assets/favicon/favicon-96x96.png?url";
import faviconFlatSvg from "@/app/assets/favicon/favicon-flat.svg?url";
import faviconIco from "@/app/assets/favicon/favicon.ico?url";
import faviconSvg from "@/app/assets/favicon/favicon.svg?url";

// local
import { AppProvider } from "./provider";

export const meta = () => [
  { title: "Cybernetics | Simple, extensible, open-source project management tool." },
  { name: "description", content: SITE_DESCRIPTION },
  {
    name: "keywords",
    content:
      "software development, plan, ship, software, accelerate, code management, release management, project management, work item tracking, agile, scrum, kanban, collaboration",
  },
  {
    name: "viewport",
    content:
      "width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover",
  },
  { property: "og:title", content: "Cybernetics | Simple, extensible, open-source project management tool." },
  {
    property: "og:description",
    content: "Open-source project management tool to manage work items, cycles, and product roadmaps easily",
  },
  { property: "og:url", content: "https://app.plane.so/" },
  { property: "og:image", content: "https://app.plane.so/og-image.png" },
  { property: "og:image:width", content: "1200" },
  { property: "og:image:height", content: "630" },
  { property: "og:image:alt", content: "Cybernetics - Modern project management" },
  { name: "twitter:site", content: "@planepowers" },
  { name: "twitter:card", content: "summary_large_image" },
  { name: "twitter:image", content: "https://app.plane.so/og-image.png" },
  { name: "twitter:image:width", content: "1200" },
  { name: "twitter:image:height", content: "630" },
  { name: "twitter:image:alt", content: "Cybernetics - Modern project management" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const isSessionRecorderEnabled = parseInt(process.env.VITE_ENABLE_SESSION_RECORDER || "0");

  return (
    <html lang="en">
      <head>
        {/* Brand cream / ink, so the browser chrome matches the app rather than flashing white. */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#F4F2EC" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0E1116" />
        {/* Vector first — browsers that support it skip the raster fallbacks entirely. */}
        <link rel="icon" type="image/svg+xml" href={faviconSvg} />
        <link rel="icon" type="image/png" sizes="96x96" href={favicon96} />
        <link rel="icon" type="image/png" sizes="32x32" href={favicon32} />
        <link rel="icon" type="image/png" sizes="16x16" href={favicon16} />
        <link rel="manifest" href="/site.webmanifest.json" />
        <link rel="shortcut icon" href={faviconIco} />
        {/* Safari pinned tabs need a single-colour vector. */}
        <link rel="mask-icon" href={faviconFlatSvg} color="#B4763A" />
        {/* Meta info for PWA */}
        <meta name="application-name" content="Cybernetics" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content={SITE_NAME} />
        <meta name="format-detection" content="telephone=no" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="apple-touch-icon" sizes="180x180" href={appleTouchIcon} />
      </head>
      <body>
        <div id="context-menu-portal" />
        <div id="editor-portal" />
        <AppProvider>
          <div className={cn("relative flex h-screen w-full flex-col overflow-hidden", "app-container")}>
            <main className="relative h-full w-full overflow-hidden">{children}</main>
          </div>
        </AppProvider>
      </body>
      {!!isSessionRecorderEnabled && process.env.VITE_SESSION_RECORDER_KEY && (
        <Script id="clarity-tracking">
          {`(function(c,l,a,r,i,t,y){
              c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
              t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
              y=l.getElementsByTagName(r)[0];if(y){y.parentNode.insertBefore(t,y);}
          })(window, document, "clarity", "script", "${process.env.VITE_SESSION_RECORDER_KEY}");`}
        </Script>
      )}
    </html>
  );
}
