/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { API_BASE_URL } from "@plane/constants";
import type {
  IWorkspaceAgent,
  TAgentContextPreview,
  TAgentPayload,
  TAgentRevision,
  TAgentWorkItem,
} from "@plane/types";
// services
import { APIService } from "@/services/api.service";

/** Client for ``/api/workspaces/<slug>/agents/`` (``agent`` is the agent id or handle). */
export class AgentService extends APIService {
  constructor() {
    super(API_BASE_URL);
  }

  private base(workspaceSlug: string, agent?: string, suffix = "") {
    const root = `/api/workspaces/${workspaceSlug}/agents/`;
    return agent ? `${root}${agent}/${suffix}` : root;
  }

  async list(workspaceSlug: string): Promise<IWorkspaceAgent[]> {
    return this.get(this.base(workspaceSlug))
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async retrieve(workspaceSlug: string, agent: string): Promise<IWorkspaceAgent> {
    return this.get(this.base(workspaceSlug, agent))
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async create(workspaceSlug: string, payload: TAgentPayload): Promise<IWorkspaceAgent> {
    return this.post(this.base(workspaceSlug), payload)
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async update(workspaceSlug: string, agent: string, payload: TAgentPayload): Promise<IWorkspaceAgent> {
    return this.patch(this.base(workspaceSlug, agent), payload)
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async remove(workspaceSlug: string, agent: string): Promise<void> {
    return this.delete(this.base(workspaceSlug, agent))
      .then(() => undefined)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async archive(workspaceSlug: string, agent: string): Promise<IWorkspaceAgent> {
    return this.post(this.base(workspaceSlug, agent, "archive/"))
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async restore(workspaceSlug: string, agent: string): Promise<IWorkspaceAgent> {
    return this.post(this.base(workspaceSlug, agent, "restore/"))
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async previewContext(workspaceSlug: string, agent: string, draft: TAgentPayload): Promise<TAgentContextPreview> {
    return this.post(this.base(workspaceSlug, agent, "context-preview/"), draft)
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async getContext(workspaceSlug: string, agent: string, version?: number): Promise<string> {
    return this.get(this.base(workspaceSlug, agent, "context/"), {
      params: { format: "markdown", version },
      responseType: "text",
    })
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async listRevisions(workspaceSlug: string, agent: string): Promise<TAgentRevision[]> {
    return this.get(this.base(workspaceSlug, agent, "revisions/"))
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async grantProjects(workspaceSlug: string, agent: string, projectIds: string[]): Promise<{ project_ids: string[] }> {
    return this.post(this.base(workspaceSlug, agent, "projects/"), { project_ids: projectIds })
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async revokeProject(workspaceSlug: string, agent: string, projectId: string): Promise<void> {
    return this.delete(this.base(workspaceSlug, agent, `projects/${projectId}/`))
      .then(() => undefined)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async listWorkItems(workspaceSlug: string, agent: string, stateGroup?: string): Promise<TAgentWorkItem[]> {
    return this.get(this.base(workspaceSlug, agent, "work-items/"), { params: { state_group: stateGroup } })
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }

  async getTaskBrief(workspaceSlug: string, agent: string, workItem: string): Promise<string> {
    return this.get(this.base(workspaceSlug, agent, `work-items/${workItem}/brief/`), {
      params: { format: "markdown" },
      responseType: "text",
    })
      .then((res) => res?.data)
      .catch((err) => {
        throw err?.response?.data;
      });
  }
}
