/*
 * 中文导读：业务线索的前端接口封装，将页面调用连接到后端资源。
 */
import { apiClient, unwrap } from "../client";
export interface BusinessLead {
  companyName: string;
  phone: string;
  industry: string;
  address: string;
  business: string;
  sourceUrl: string;
}
export interface BusinessContact extends BusinessLead {
  crmCompanyId?: string | null;
  id: string;
  ownerId: string;
  ownerName: string;
  status: string;
  notes: string;
  nextFollowUp: string | null;
  wecomStatus: string;
  handoffStatus: string;
  handoffReason: string;
  updatedAt: string;
}
export interface LeadJob {
  id: string;
  industry: string;
  region: string;
  target: number;
  status: string;
  message: string;
  results: BusinessLead[];
  updatedAt: string;
  sourceCount: number;
  visitedCount: number;
  companyCount: number;
  phoneCount: number;
  nextSearchAt: string | null;
  diagnostics: {
    since?: string; historicalAttempts?: number; attempted?: number; fetchedPages?: number;
    accepted?: number; irrelevant?: number; region?: number; noCompany?: number; noPhone?: number;
    unavailable?: number; duplicates?: number; searchCandidates?: number; searchFiltered?: number;
    searchFailures?: number; provider?: string; query?: string;
  };
}
export type ContactUpdate = Pick<
  BusinessContact,
  | "status"
  | "notes"
  | "nextFollowUp"
  | "wecomStatus"
  | "handoffStatus"
  | "handoffReason"
>;
const base = "/business";
export const businessApi = {
  contacts: (org: string, view: "mine" | "company" = "mine") =>
    unwrap<BusinessContact[]>(
      apiClient.get(`${base}/contacts`, {
        params: { view },
        headers: { "x-workspace-id": org },
      }),
    ),
  assign: (org: string, id: string, ownerId: string) =>
    unwrap(
      apiClient.post(
        `${base}/contacts/${id}/assign`,
        { ownerId },
        { headers: { "x-workspace-id": org } },
      ),
    ),
  delete: (org: string, ids: string[]) =>
    unwrap<{ deleted: number }>(
      apiClient.post(
        `${base}/contacts/delete`,
        { ids },
        { headers: { "x-workspace-id": org } },
      ),
    ),
  history: (org: string, id: string, view: "mine" | "company") =>
    unwrap<
      {
        id: string;
        createdAt: string;
        actorName: string;
        previousOwnerName: string;
        ownerName: string;
      }[]
    >(
      apiClient.get(`${base}/contacts/${id}/history`, {
        params: { view },
        headers: { "x-workspace-id": org },
      }),
    ),
  jobs: (org: string) =>
    unwrap<LeadJob[]>(
      apiClient.get(`${base}/jobs`, { headers: { "x-workspace-id": org } }),
    ),
  createJob: (org: string, industry: string, region: string, target: number) =>
    unwrap<LeadJob>(
      apiClient.post(
        `${base}/jobs`,
        { industry, region, target },
        { headers: { "x-workspace-id": org } },
      ),
    ),
  action: (
    org: string,
    id: string,
    action: "pause" | "resume",
    sources: string[] = [],
  ) =>
    unwrap<LeadJob>(
      apiClient.post(
        `${base}/jobs/${id}/action`,
        { action, sources },
        { headers: { "x-workspace-id": org } },
      ),
    ),
  save: (org: string, lead: BusinessLead) =>
    unwrap<BusinessContact>(
      apiClient.post(`${base}/contacts`, lead, {
        headers: { "x-workspace-id": org },
      }),
    ),
  update: (
    org: string,
    id: string,
    data: ContactUpdate,
    view: "mine" | "company",
  ) =>
    unwrap<BusinessContact>(
      apiClient.patch(`${base}/contacts/${id}`, data, {
        params: { view },
        headers: { "x-workspace-id": org },
      }),
    ),
  download: async (org: string, path: string, name: string) => {
    const response = await apiClient.get(`${base}/${path}`, {
      responseType: "blob",
      headers: { "x-workspace-id": org },
    });
    const url = URL.createObjectURL(response.data);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
