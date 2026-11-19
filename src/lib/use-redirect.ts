import { useEffect } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";

/** Redirect once when `when` is true; never navigates to the page already shown. */
export function useRedirect(when: boolean, to: "/auth" | "/dashboard") {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    if (when && pathname !== to) navigate({ to, replace: true });
  }, [when, to, pathname, navigate]);
}
