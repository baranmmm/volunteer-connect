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

export type NavBadge = "requests" | "tasks" | "meetings";
export type NavItem = {
  to: string;
  testId: string;
  labelKey: string;
  icon: LucideIcon;
  /** Roles that see the item (and may open the page); every role when absent. */
  roles?: AppRole[];
  /** A count next to the item (unread notices; pending event requests for managers). */
  badge?: NavBadge;
  /** An external link (opens in a new tab). */
  href?: string;
};

const MEMBERS: AppRole[] = [
  "volunteer",
  "branch_manager",
  "regional_director",
  "national_coordinator",
];
const MANAGERS: AppRole[] = ["branch_manager", "regional_director"];

export const NAV_ITEMS: NavItem[] = [
  {
    to: "/dashboard",
    testId: "nav-dashboard",
    labelKey: "navigation.dashboard",
    icon: LayoutDashboard,
  },
  { to: "/calendar", testId: "nav-calendar", labelKey: "navigation.calendar", icon: CalendarDays },
  {
    to: "/tasks",
    testId: "nav-tasks",
    labelKey: "navigation.tasks",
    icon: ListChecks,
    badge: "tasks",
    roles: MEMBERS,
  },
  {
    to: "/meetings",
    testId: "nav-meetings",
    labelKey: "navigation.meetings",
    icon: Users2,
    badge: "meetings",
    roles: MEMBERS,
  },
  { to: "/media", testId: "nav-media", labelKey: "navigation.media", icon: Image, roles: MEMBERS },
  {
    to: "/training",
    testId: "nav-training",
    labelKey: "navigation.training",
    icon: GraduationCap,
    roles: MEMBERS,
  },
  {
    to: "/contacts",
    testId: "nav-contacts",
    labelKey: "navigation.contacts",
    icon: Contact,
    roles: MEMBERS,
  },
  {
    to: "/approvals",
    testId: "nav-approvals",
    labelKey: "navigation.approvals",
    icon: UserCheck,
    roles: MANAGERS,
  },
  {
    to: "/requests",
    testId: "nav-requests",
    labelKey: "navigation.requests",
    icon: Inbox,
    badge: "requests",
    // Followers: their volunteer application. National Coordinators: task and meeting requests sent to them.
    roles: ["follower", ...MEMBERS],
  },
  {
    to: "/users",
    testId: "nav-users",
    labelKey: "navigation.users",
    icon: Users,
    roles: [...MANAGERS, "national_coordinator"],
  },
  {
    to: "/regions",
    testId: "nav-regions",
    labelKey: "navigation.regions",
    icon: Network,
    roles: ["national_coordinator"],
  },
  {
    to: "/recycle-bin",
    testId: "nav-recycle-bin",
    labelKey: "navigation.recycleBin",
    icon: Trash2,
    roles: [...MANAGERS, "national_coordinator"],
  },
  { to: "/profile", testId: "nav-profile", labelKey: "navigation.profile", icon: UserCircle },
  {
    to: "/donate",
    testId: "nav-donate",
    labelKey: "navigation.donate",
    icon: HeartHandshake,
    href: DONATE_URL,
  },
];

/** The menu for a role (its highest one). */
export const navItemsFor = (role: AppRole) =>
  NAV_ITEMS.filter((i) => !i.roles || i.roles.includes(role));

/** The in-app page an item guards, if the role may not open it (the database refuses its data as well). */
export const forbiddenItem = (role: AppRole, pathname: string) =>
  NAV_ITEMS.find(
    (i) =>
      !i.href &&
      i.roles &&
      !i.roles.includes(role) &&
      (pathname === i.to || pathname.startsWith(`${i.to}/`)),
  );

export const MOBILE_PRIMARY = [
  "/dashboard",
  "/calendar",
  "/tasks",
  "/meetings",
  "/requests",
  "/regions",
];

/** The mobile "More" tab's count: the sum of the badges of the items it holds (hidden at zero). */
export const moreBadgeCount = (items: NavItem[], counts: Record<NavBadge, number>) =>
  items.reduce((sum, item) => sum + (item.badge ? counts[item.badge] || 0 : 0), 0);
