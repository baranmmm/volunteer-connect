import {
  LayoutDashboard, CalendarDays, ListChecks, Users2, Image, GraduationCap, Contact, UserCheck, Users, UserCircle,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { to: string; label: string; icon: LucideIcon; managerOnly?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/tasks", label: "Tasks", icon: ListChecks },
  { to: "/meetings", label: "Meetings", icon: Users2 },
  { to: "/media", label: "Media", icon: Image },
  { to: "/training", label: "Training", icon: GraduationCap },
  { to: "/contacts", label: "Contacts", icon: Contact },
  { to: "/approvals", label: "Approvals", icon: UserCheck, managerOnly: true },
  { to: "/users", label: "Users", icon: Users, managerOnly: true },
  { to: "/profile", label: "Profile", icon: UserCircle },
];

export const MOBILE_PRIMARY = ["/dashboard", "/calendar", "/tasks", "/meetings"];
