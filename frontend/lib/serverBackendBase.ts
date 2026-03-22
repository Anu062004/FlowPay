export function getServerBackendBase() {
  const direct = process.env.FLOWPAY_BACKEND_ORIGIN?.trim();
  if (direct) {
    return direct.replace(/\/+$/, "");
  }

  const publicBase = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
  if (publicBase && /^https?:\/\//i.test(publicBase)) {
    return publicBase.replace(/\/+$/, "");
  }

  return "http://localhost:4000";
}
