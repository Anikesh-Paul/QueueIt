import { useEffect, useState } from "react";
import { fetchOrganizations } from "@/api";

/** Public organization list (one fetch per mount). Empty on error. */
export function useOrganizations() {
  const [orgs, setOrgs] = useState([]);
  useEffect(() => {
    let cancelled = false;
    fetchOrganizations()
      .then((data) => {
        if (!cancelled) setOrgs(Array.isArray(data?.organizations) ? data.organizations : []);
      })
      .catch(() => {
        if (!cancelled) setOrgs([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return orgs;
}
