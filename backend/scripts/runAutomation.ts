import "dotenv/config";
import { runAutomationJob } from "../src/services/automationService.js";

type Job = "finance" | "backend" | "blockchain" | "monitoring" | "support" | "browser" | "all";

function parseArgs(argv: string[]) {
  const jobArg = (argv[2] ?? "all").toLowerCase();
  const companyId = argv[3];
  const validJobs: Job[] = ["finance", "backend", "blockchain", "monitoring", "support", "browser", "all"];
  const job: Job = validJobs.includes(jobArg as Job) ? (jobArg as Job) : "all";
  return { job, companyId };
}

async function main() {
  const { job, companyId } = parseArgs(process.argv);
  const result = await runAutomationJob(job, { companyId });
  console.log(JSON.stringify({ job, companyId: companyId ?? null, result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
