import { getTopMarketCap } from "../src/services/priceService.js";

async function main() {
  const assets = await getTopMarketCap(10);
  console.log(
    JSON.stringify(
      {
        count: assets.length,
        assets
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Market top probe failed:", error?.message ?? error);
  process.exit(1);
});
