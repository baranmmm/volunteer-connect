import {
  LayoutDashboard, CalendarDays, ListChecks, Users2, Image, GraduationCap, Contact, UserCheck, Users, UserCircle,
  Trash2, Inbox, Send, type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; testId: string; labelKey: string; icon: LucideIcon; managerOnly?: boolean; badge?: "requests" };

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", testId: "nav-dashboard", labelKey: "navigation.dashboard", icon: LayoutDashboard },
  { to: "/calendar", testId: "nav-calendar", labelKey: "navigation.calendar", icon: CalendarDays },
  { to: "/tasks", testId: "nav-tasks", labelKey: "navigation.tasks", icon: ListChecks },
  { to: "/meetings", testId: "nav-meetings", labelKey: "navigation.meetings", icon: Users2 },
  { to: "/media", testId: "nav-media", labelKey: "navigation.media", icon: Image },
  { to: "/training", testId: "nav-training", labelKey: "navigation.training", icon: GraduationCap },
  { to: "/contacts", testId: "nav-contacts", labelKey: "navigation.contacts", icon: Contact },
  { to: "/approvals", testId: "nav-approvals", labelKey: "navigation.approvals", icon: UserCheck, managerOnly: true },
  { to: "/my-requests", testId: "nav-my-requests", labelKey: "navigation.myRequests", icon: Send },
  { to: "/requests", testId: "nav-requests", labelKey: "navigation.requests", icon: Inbox, managerOnly: true, badge: "requests" },
  { to: "/users", testId: "nav-users", labelKey: "navigation.users", icon: Users, managerOnly: true },
  { to: "/recycle-bin", testId: "nav-recycle-bin", labelKey: "navigation.recycleBin", icon: Trash2, managerOnly: true },
  { to: "/profile", testId: "nav-profile", labelKey: "navigation.profile", icon: UserCircle },
];

export const MOBILE_PRIMARY = ["/dashboard", "/calendar", "/tasks", "/meetings"];
