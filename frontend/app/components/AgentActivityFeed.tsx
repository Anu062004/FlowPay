"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { fetchAgentLogs, type AgentLog } from "../lib/api";
import { loadCompanyContext } from "../lib/companyContext";

const STAGE_LABELS: Record<string, string> = {
  workflow: "Workflow",
  decision: "Decision",
  policy_validation: "Policy",
  wdk_execution: "WDK",
  guardrail: "Guardrail"
};

const POLICY_STYLES: Record<string, string> = {
  allow: "bg-emerald-100 text-emerald-800",
  review: "bg-amber-100 text-amber-800",
  block: "bg-rose-100 text-rose-800"
};

export function AgentActivityFeed() {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchLogs() {
      try {
        const company = loadCompanyContext();
        const data = await fetchAgentLogs(company?.id);
        setLogs(data.logs);
      } catch (error) {
        console.error("Failed to fetch agent logs:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchLogs();
    const interval = setInterval(fetchLogs, 10000); // Poll every 10s
    return () => clearInterval(interval);
  }, []);

  if (loading) return <div className="p-4">Loading agent activity...</div>;

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-4 py-5 sm:px-6 bg-gray-50 border-b">
        <h3 className="text-lg leading-6 font-medium text-gray-900">Autonomous Agent Activity</h3>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">Real-time decisions from the FlowPay agent layer.</p>
      </div>
      <div className="divide-y divide-gray-200 max-h-96 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="p-4 text-center text-gray-500">No agent activity logged yet.</div>
        ) : (
          logs.map((log) => (
            <div key={log.id} className="p-4 hover:bg-gray-50 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                    {log.agent_name}
                  </span>
                  {log.stage ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-700">
                      {STAGE_LABELS[log.stage] ?? log.stage}
                    </span>
                  ) : null}
                  {log.policy_result?.status ? (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${POLICY_STYLES[log.policy_result.status] ?? "bg-slate-100 text-slate-700"}`}>
                      {log.policy_result.status.toUpperCase()}
                    </span>
                  ) : null}
                </div>
                <span className="text-xs text-gray-400">
                  {format(new Date(log.timestamp), "MMM d, HH:mm:ss")}
                </span>
              </div>
              <p className="text-sm font-semibold text-gray-900">{log.action_taken}</p>
              <div className="mt-1 flex items-center gap-3 text-[11px] text-gray-500 flex-wrap">
                {log.workflow_name ? <span>{log.workflow_name}</span> : null}
                {log.source ? <span>{log.source}</span> : null}
                {log.execution_status ? <span>{log.execution_status}</span> : null}
              </div>
              {log.decision && (
                <div className="mt-1 text-xs text-gray-400 bg-gray-50 p-1 rounded font-mono">
                  {JSON.stringify(log.decision)}
                </div>
              )}
              {log.policy_result?.reasons?.length ? (
                <div className="mt-1 text-xs text-amber-700">
                  {log.policy_result.reasons[0]}
                </div>
              ) : null}
              <p className="text-xs text-gray-500 mt-1 italic">"{log.rationale}"</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
