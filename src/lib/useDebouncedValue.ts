import { useEffect, useState } from "react";

// Keep the URL and visible controls current; only defer the data request.
// A different workspace must never inherit another workspace's pending query.
export function useDebouncedValue(value: string, scope: string, delay = 250) {
  const [settled, setSettled] = useState({ value, scope });
  useEffect(() => {
    const timer = setTimeout(() => setSettled({ value, scope }), delay);
    return () => clearTimeout(timer);
  }, [value, scope, delay]);
  return settled.scope === scope ? settled.value : value;
}
