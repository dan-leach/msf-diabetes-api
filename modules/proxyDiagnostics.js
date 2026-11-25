/**
 * Temporary, opt-in proxy observations. Never changes responses or logs bodies,
 * cookies, credentials, query strings or arbitrary request headers.
 */
function createProxyDiagnostics({ enabled = false, logger = console.log } = {}) {
  let logged = 0;
  const maxEntries = 50;

  return (req, res, next) => {
    if (!enabled || req.method !== "GET" || req.path !== "/config" ||
      req.headers["x-proxy-diagnostic"] !== "1" || logged >= maxEntries) {
      return next();
    }

    let truncated = false;
    const clip = (value) => {
      if (value === undefined || value === null) return null;
      const text = String(value);
      if (text.length > 1024) truncated = true;
      return text.slice(0, 1024);
    };
    const rawForwardingHeaders = [];
    const raw = req.rawHeaders || [];
    for (let i = 0; i < raw.length; i += 2) {
      const name = raw[i].toLowerCase();
      if (name !== "x-forwarded-for" && name !== "x-forwarded-proto") continue;
      if (rawForwardingHeaders.length >= 8) {
        truncated = true;
        continue;
      }
      rawForwardingHeaders.push({ name, value: clip(raw[i + 1]) });
    }
    const ips = req.ips || [];
    if (ips.length > 8) truncated = true;
    const observation = {
      timestamp: new Date().toISOString(),
      trustProxy: req.app.get("trust proxy"),
      socketRemoteAddress: clip(req.socket.remoteAddress),
      socketRemoteFamily: clip(req.socket.remoteFamily),
      xForwardedFor: clip(req.headers["x-forwarded-for"]),
      xForwardedProto: clip(req.headers["x-forwarded-proto"]),
      rawForwardingHeaders,
      ip: clip(req.ip),
      ips: ips.slice(0, 8).map(clip),
      protocol: clip(req.protocol),
      truncated,
    };
    logged++;
    // JSON encoding keeps caller-controlled headers on a single escaped line.
    logger(`[proxy-diagnostic] ${JSON.stringify(observation)}`);
    return next();
  };
}

module.exports = { createProxyDiagnostics };
