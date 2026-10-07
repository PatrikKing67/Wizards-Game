// HTTP responses and live events can arrive out of order. Only advance state.
export function latestState(current, incoming) {
  if (current && current.code === incoming.code && incoming.revision < current.revision) return current;
  return incoming;
}
