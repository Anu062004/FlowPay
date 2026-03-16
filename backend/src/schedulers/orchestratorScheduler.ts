import { runOrchestrator } from "../agents/orchestratorAgent.js";
import { env } from "../config/env.js";

async function orchestratorLoop() {
  const intervalMs = parseInt(env.ORCHESTRATOR_INTERVAL_MS, 10);
  console.log(`[Orchestrator] Starting autonomous loop (interval: ${intervalMs}ms)...`);
  
  while (true) {
    console.log(`[Orchestrator] Running cycle at ${new Date().toISOString()}`);
    try {
      await runOrchestrator();
    } catch (error) {
      console.error("[Orchestrator] Loop cycle error:", error);
    }
    
    // Sleep for interval
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
}

export function startOrchestratorScheduler() {
  // Start the loop in the background
  orchestratorLoop().catch(error => {
    console.error("[Orchestrator] Fatal loop error:", error);
  });
}
