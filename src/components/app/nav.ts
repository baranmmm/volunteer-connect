import {
  LayoutDashboard,
  CalendarDays,
  ListChecks,
  Users2,
  Image,
  GraduationCap,
  Contact,
  UserCheck,
  Users,
  UserCircle,
  Trash2,
  Inbox,
  Network,
  HeartHandshake,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/lib/auth";
import { DONATE_URL } from "@/lib/config";

export type NavItem = {
  to: string;
  testId: string;
  labelKey: string;
  icon: LucideIcon;
  /** Roles that see the item (and may open the page); every role when absent. */
  roles?: AppRole[];
  badge?: "requests";
  /** An external link (opens in a new tab). */
  href?: string;
};

const MEMBERS: AppRole[] = ["volunteer", "branch_manager", "regional_director", "national_coordinator"];
const MANAGERS: AppRole[] = ["branch_manager", "regional_director"];

export const NAV_ITEMS: NavItem[] = [
  { to: "/dashboard", testId: "nav-dashboard", labelKey: "navigation.dashboard", icon: LayoutDashboard },
  { to: "/calendar", testId: "nav-calendar", labelKey: "navigation.calendar", icon: CalendarDays },
  { to: "/tasks", testId: "nav-tasks", labelKey: "navigation.tasks", icon: ListChecks, roles: MEMBERS },
  { to: "/meetings", testId: "nav-meetings", labelKey: "navigation.meetings", icon: Users2, roles: MEMBERS },
  { to: "/media", testId: "nav-media", labelKey: "navigation.media", icon: Image, roles: MEMBERS },
  { to: "/training", testId: "nav-training", labelKey: "navigation.training", icon: GraduationCap, roles: MEMBERS },
  { to: "/contacts", testId: "nav-contacts", labelKey: "navigation.contacts", icon: Contact, roles: MEMBERS },
  { to: "/approvals", testId: "nav-approvals", labelKey: "navigation.approvals", icon: UserCheck, roles: MANAGERS },
  {
    to: "/requests",
    testId: "nav-requests",
    labelKey: "navigation.requests",
    icon: Inbox,
    badge: "requests",
    roles: ["follower", "volunteer", "branch_manager", "regional_director"],
  },
  { to: "/users", testId: "nav-users", labelKey: "navigation.users", icon: Users, roles: [...MANAGERS, "national_coordinator"] },
  { to: "/regions", testId: "nav-regions", labelKey: "navigation.regions", icon: Network, roles: ["national_coordinator"] },
  { to: "/recycle-bin", testId: "nav-recycle-bin", labelKey: "navigation.recycleBin", icon: Trash2, roles: [...MANAGERS, "national_coordinator"] },
  { to: "/profile", testId: "nav-profile", labelKey: "navigation.profile", icon: UserCircle },
  { to: "/donate", testId: "nav-donate", labelKey: "navigation.donate", icon: HeartHandshake, href: DONATE_URL },
];

/** The menu for a role (its highest one). */
export const navItemsFor = (role: AppRole) => NAV_ITEMS.filter((i) => !i.roles || i.roles.includes(role));

/** The in-app page an item guards, if the role may not open it (the database refuses its data as well). */
export const forbiddenItem = (role: AppRole, pathname: string) =>
  NAV_ITEMS.find((i) => !i.href && i.roles && !i.roles.includes(role) && (pathname === i.to || pathname.startsWith(`${i.to}/`)));

export const MOBILE_PRIMARY = ["/dashboard", "/calendar", "/tasks", "/meetings", "/requests", "/regions"];
