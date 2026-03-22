"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ChevronDown } from "lucide-react";
import { fetchAgentLogs, type AgentLog } from "../lib/api";
import { loadCompanyContext } from "../lib/companyContext";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

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

function sameLogs(current: AgentLog[], next: AgentLog[]) {
  if (current.length !== next.length) {
    return false;
  }

  return current.every((log, index) => {
    const nextLog = next[index];
    return (
      log.id === nextLog?.id &&
      log.timestamp === nextLog?.timestamp &&
      log.action_taken === nextLog?.action_taken &&
      log.execution_status === nextLog?.execution_status
    );
  });
}

export function AgentActivityFeed() {
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    async function fetchLogs() {
      try {
        const company = loadCompanyContext();
        const data = await fetchAgentLogs(company?.id);
        setLogs((current) => (sameLogs(current, data.logs) ? current : data.logs));
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

  const latestTimestamp = logs[0]?.timestamp
    ? format(new Date(logs[0].timestamp), "MMM d, HH:mm:ss")
    : null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="bg-white rounded-lg shadow overflow-hidden"
    >
      <div className="px-4 py-5 sm:px-6 bg-gray-50 border-b">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-lg leading-6 font-medium text-gray-900">Autonomous Agent Activity</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">Real-time decisions from the FlowPay agent layer.</p>
          </div>

          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-100"
            >
              <span>{open ? "Hide activity" : "Show activity"}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {logs.length}
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap text-xs text-slate-500">
          <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
            {loading ? "Syncing activity..." : `${logs.length} events loaded`}
          </span>
          {latestTimestamp ? (
            <span className="inline-flex items-center rounded-full bg-white px-2.5 py-1 font-medium text-slate-500 ring-1 ring-slate-200">
              Latest {latestTimestamp}
            </span>
          ) : null}
        </div>
      </div>
      <CollapsibleContent>
        <div className="h-96 overflow-y-auto divide-y divide-gray-200" style={{ overflowAnchor: "none" }}>
          {loading ? (
            <div className="h-full flex items-center justify-center p-4 text-sm text-gray-500">
              Loading agent activity...
            </div>
          ) : logs.length === 0 ? (
            <div className="h-full flex items-center justify-center p-4 text-center text-gray-500">
              No agent activity logged yet.
            </div>
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
      </CollapsibleContent>
    </Collapsible>
  );
}
