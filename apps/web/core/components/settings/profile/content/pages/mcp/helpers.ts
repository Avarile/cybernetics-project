/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

// plane imports
import { API_BASE_URL, MCP_ENDPOINT_PATH } from "@plane/constants";

/** Shown in the snippets until the user has generated or pasted a token. */
export const TOKEN_PLACEHOLDER = "<YOUR_TOKEN>";

/** Name the server is registered under in the client's config. */
const SERVER_NAME = "plane";

const PROTOCOL_VERSION = "2026-07-28";

export type TMCPClientKey = "claude-code" | "cursor" | "vscode" | "claude-desktop" | "other";

export const MCP_CLIENTS: TMCPClientKey[] = ["claude-code", "cursor", "vscode", "claude-desktop", "other"];

export type TMCPClientConfig = {
  /** Terminal command, for clients configured from a CLI. */
  command?: string;
  /** Config file the JSON below belongs in. */
  file?: string;
  json?: string;
  /** One-click install link; only built once a real token is available. */
  deepLink?: string;
};

/** The MCP endpoint, on the same host the app talks to the API on. */
export const buildEndpointUrl = (): string => {
  const base = API_BASE_URL || (typeof window === "undefined" ? "" : window.location.origin);
  return `${base.replace(/\/$/, "")}${MCP_ENDPOINT_PATH}`;
};

/**
 * The endpoint bypasses Django's middleware and so sends no CORS headers: the
 * browser can only reach it when it is same-origin (i.e. through the proxy).
 */
export const isSameOriginEndpoint = (endpoint: string): boolean => {
  if (typeof window === "undefined") return false;
  try {
    return new URL(endpoint, window.location.origin).origin === window.location.origin;
  } catch {
    return false;
  }
};

const toBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
};

export const buildClientConfigs = (
  endpoint: string,
  token: string | undefined
): Record<TMCPClientKey, TMCPClientConfig> => {
  const secret = token || TOKEN_PLACEHOLDER;
  const headers = { Authorization: `Bearer ${secret}` };
  const httpServer = { type: "http", url: endpoint, headers };

  return {
    "claude-code": {
      command: `claude mcp add --transport http ${SERVER_NAME} ${endpoint} --header "Authorization: Bearer ${secret}"`,
    },
    cursor: {
      file: "~/.cursor/mcp.json",
      json: JSON.stringify({ mcpServers: { [SERVER_NAME]: httpServer } }, null, 2),
      deepLink: token
        ? `cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(
            toBase64(JSON.stringify(httpServer))
          )}`
        : undefined,
    },
    vscode: {
      file: ".vscode/mcp.json",
      json: JSON.stringify({ servers: { [SERVER_NAME]: httpServer } }, null, 2),
      deepLink: token
        ? `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: SERVER_NAME, ...httpServer }))}`
        : undefined,
    },
    // Claude Desktop's own connectors need OAuth, so it goes through the mcp-remote bridge
    "claude-desktop": {
      file: "claude_desktop_config.json",
      json: JSON.stringify(
        {
          mcpServers: {
            [SERVER_NAME]: {
              command: "npx",
              args: ["-y", "mcp-remote", endpoint, "--header", `Authorization: Bearer ${secret}`],
            },
          },
        },
        null,
        2
      ),
    },
    other: {
      json: JSON.stringify({ url: endpoint, headers }, null, 2),
    },
  };
};

export type TMCPConnectionResult =
  | { status: "connected"; toolCount: number }
  | { status: "unauthorized" }
  | { status: "unreachable" };

/** Best-effort probe: a tools/list call with the token the user just supplied. */
export const testMCPConnection = async (endpoint: string, token: string): Promise<TMCPConnectionResult> => {
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
        "io.modelcontextprotocol/clientCapabilities": {},
      },
    },
  };

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
        "MCP-Protocol-Version": PROTOCOL_VERSION,
        "Mcp-Method": "tools/list",
      },
      body: JSON.stringify(body),
    });
    if (response.status === 401) return { status: "unauthorized" };
    if (!response.ok) return { status: "unreachable" };
    const data = await response.json();
    return { status: "connected", toolCount: data?.result?.tools?.length ?? 0 };
  } catch {
    return { status: "unreachable" };
  }
};
