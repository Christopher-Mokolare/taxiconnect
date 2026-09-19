const ROUTES = {
  SUN_CITY:   { label: "Sun City",   sub: "Sun Village", icon: "🏘" },
  RUSTENBURG: { label: "Rustenburg", sub: "Town",        icon: "🏙" },
};

function routeLabel(route) {
  const r = ROUTES[route];
  return r ? r.icon + " " + r.label + " (" + r.sub + ")" : route;
}

function timeAgo(ts) {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  return Math.floor(mins / 60) + "h ago";
}

module.exports = { ROUTES, routeLabel, timeAgo };
