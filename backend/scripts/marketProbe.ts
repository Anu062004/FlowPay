import { getEthPrice } from "../src/services/priceService.js";

async function main() {
  const snapshot = await getEthPrice();
  const timestamp = new Date().toISOString();
  console.log(
    JSON.stringify(
      {
        asset: "ETH",
        price: snapshot.price,
        changePct: snapshot.changePct,
        source: snapshot.source,
        timestamp
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Market probe failed:", error?.message ?? error);
  process.exit(1);
});
