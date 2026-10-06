/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { set } from "lodash-es";
import { action, makeObservable, observable, runInAction } from "mobx";
import { computedFn } from "mobx-utils";
import type { IWorkspaceAgent, TAgentPayload } from "@plane/types";
// services
import { AgentService } from "@/services/agent.service";

export interface IAgentStore {
  // observables
  loader: boolean;
  agentMap: Record<string, IWorkspaceAgent>; // agentId -> agent
  workspaceAgentIds: Record<string, string[]>; // workspaceSlug -> agentIds
  // computed helpers
  getWorkspaceAgentIds: (workspaceSlug: string) => string[] | undefined;
  getAgentById: (agentId: string) => IWorkspaceAgent | undefined;
  getAgentByBotUserId: (userId: string) => IWorkspaceAgent | undefined;
  isAgentUser: (userId: string) => boolean;
  // actions
  fetchAgents: (workspaceSlug: string) => Promise<IWorkspaceAgent[]>;
  fetchAgent: (workspaceSlug: string, agentId: string) => Promise<IWorkspaceAgent>;
  createAgent: (workspaceSlug: string, payload: TAgentPayload) => Promise<IWorkspaceAgent>;
  updateAgent: (workspaceSlug: string, agentId: string, payload: TAgentPayload) => Promise<IWorkspaceAgent>;
  archiveAgent: (workspaceSlug: string, agentId: string) => Promise<IWorkspaceAgent>;
  restoreAgent: (workspaceSlug: string, agentId: string) => Promise<IWorkspaceAgent>;
  deleteAgent: (workspaceSlug: string, agentId: string) => Promise<void>;
  grantProjects: (workspaceSlug: string, agentId: string, projectIds: string[]) => Promise<void>;
  revokeProject: (workspaceSlug: string, agentId: string, projectId: string) => Promise<void>;
}

export class AgentStore implements IAgentStore {
  loader = false;
  agentMap: Record<string, IWorkspaceAgent> = {};
  workspaceAgentIds: Record<string, string[]> = {};
  // services
  agentService;

  constructor() {
    makeObservable(this, {
      loader: observable.ref,
      agentMap: observable,
      workspaceAgentIds: observable,
      fetchAgents: action,
      fetchAgent: action,
      createAgent: action,
      updateAgent: action,
      archiveAgent: action,
      restoreAgent: action,
      deleteAgent: action,
      grantProjects: action,
      revokeProject: action,
    });
    this.agentService = new AgentService();
  }

  getWorkspaceAgentIds = computedFn((workspaceSlug: string) => this.workspaceAgentIds[workspaceSlug]);

  getAgentById = computedFn((agentId: string) => this.agentMap[agentId]);

  getAgentByBotUserId = computedFn((userId: string) =>
    Object.values(this.agentMap).find((agent) => agent.bot_user_id === userId)
  );

  isAgentUser = computedFn((userId: string) => !!this.getAgentByBotUserId(userId));

  private upsert = (workspaceSlug: string, agent: IWorkspaceAgent) => {
    set(this.agentMap, [agent.id], agent);
    const ids = this.workspaceAgentIds[workspaceSlug] ?? [];
    if (!ids.includes(agent.id)) set(this.workspaceAgentIds, [workspaceSlug], [...ids, agent.id]);
  };

  fetchAgents = async (workspaceSlug: string) => {
    this.loader = true;
    try {
      const agents = await this.agentService.list(workspaceSlug);
      runInAction(() => {
        agents.forEach((agent) => set(this.agentMap, [agent.id], agent));
        set(
          this.workspaceAgentIds,
          [workspaceSlug],
          agents.map((agent) => agent.id)
        );
      });
      return agents;
    } finally {
      runInAction(() => {
        this.loader = false;
      });
    }
  };

  fetchAgent = async (workspaceSlug: string, agentId: string) => {
    const agent = await this.agentService.retrieve(workspaceSlug, agentId);
    runInAction(() => this.upsert(workspaceSlug, agent));
    return agent;
  };

  createAgent = async (workspaceSlug: string, payload: TAgentPayload) => {
    const agent = await this.agentService.create(workspaceSlug, payload);
    runInAction(() => this.upsert(workspaceSlug, agent));
    return agent;
  };

  updateAgent = async (workspaceSlug: string, agentId: string, payload: TAgentPayload) => {
    const agent = await this.agentService.update(workspaceSlug, agentId, payload);
    runInAction(() => this.upsert(workspaceSlug, agent));
    return agent;
  };

  archiveAgent = async (workspaceSlug: string, agentId: string) => {
    const agent = await this.agentService.archive(workspaceSlug, agentId);
    runInAction(() => this.upsert(workspaceSlug, agent));
    return agent;
  };

  restoreAgent = async (workspaceSlug: string, agentId: string) => {
    const agent = await this.agentService.restore(workspaceSlug, agentId);
    runInAction(() => this.upsert(workspaceSlug, agent));
    return agent;
  };

  deleteAgent = async (workspaceSlug: string, agentId: string) => {
    await this.agentService.remove(workspaceSlug, agentId);
    runInAction(() => {
      delete this.agentMap[agentId];
      set(
        this.workspaceAgentIds,
        [workspaceSlug],
        (this.workspaceAgentIds[workspaceSlug] ?? []).filter((id) => id !== agentId)
      );
    });
  };

  grantProjects = async (workspaceSlug: string, agentId: string, projectIds: string[]) => {
    const { project_ids } = await this.agentService.grantProjects(workspaceSlug, agentId, projectIds);
    runInAction(() => {
      if (this.agentMap[agentId]) set(this.agentMap, [agentId, "project_ids"], project_ids);
    });
  };

  revokeProject = async (workspaceSlug: string, agentId: string, projectId: string) => {
    await this.agentService.revokeProject(workspaceSlug, agentId, projectId);
    runInAction(() => {
      const agent = this.agentMap[agentId];
      if (agent)
        set(
          this.agentMap,
          [agentId, "project_ids"],
          agent.project_ids.filter((id) => id !== projectId)
        );
    });
  };
}
