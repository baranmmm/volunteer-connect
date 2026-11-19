import {
  LayoutDashboard, CalendarDays, ListChecks, Users2, Image, GraduationCap, Contact, UserCheck, Users, UserCircle,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; labelKey: string; icon: LucideIcon; managerOnly?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", labelKey: "navigation.dashboard", icon: LayoutDashboard },
  { to: "/calendar", labelKey: "navigation.calendar", icon: CalendarDays },
  { to: "/tasks", labelKey: "navigation.tasks", icon: ListChecks },
  { to: "/meetings", labelKey: "navigation.meetings", icon: Users2 },
  { to: "/media", labelKey: "navigation.media", icon: Image },
  { to: "/training", labelKey: "navigation.training", icon: GraduationCap },
  { to: "/contacts", labelKey: "navigation.contacts", icon: Contact },
  { to: "/approvals", labelKey: "navigation.approvals", icon: UserCheck, managerOnly: true },
  { to: "/users", labelKey: "navigation.users", icon: Users, managerOnly: true },
  { to: "/profile", labelKey: "navigation.profile", icon: UserCircle },
];

export const MOBILE_PRIMARY = ["/dashboard", "/calendar", "/tasks", "/meetings"];
