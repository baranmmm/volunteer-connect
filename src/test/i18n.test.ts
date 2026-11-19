import { describe, expect, it } from "vitest";
import en from "@/locales/en.json";
import tr from "@/locales/tr.json";
import { errorKey, detectLanguage, LANG_STORAGE_KEY } from "@/lib/i18n";
import { historyChange } from "@/lib/history";

const keys = (o: object, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => typeof v === "object" ? keys(v, `${p}${k}.`) : [`${p}${k}`]);

describe("language support", () => {
  it("English and Turkish have exactly the same keys", () => {
    expect(keys(tr).sort()).toEqual(keys(en).sort());
  });
  it("translates role and status names into Turkish", () => {
    expect(tr.common.roles.regional_director).toBe("Bölge Direktörü");
    expect(tr.common.roles.branch_manager).toBe("Şube Yöneticisi");
    expect(tr.common.roles.volunteer).toBe("Gönüllü");
    expect(tr.common.status).toEqual({ pending: "Onay bekliyor", active: "Aktif", inactive: "Pasif" });
  });
  it("maps known database errors and falls back to a generic error", () => {
    expect(errorKey({ message: "You cannot manage this user" })).toBe("errors.cannotManage");
    expect(errorKey(new Error("Something odd from Postgres"))).toBe("errors.generic");
  });
  it("uses the saved choice before sign-in, else the browser language", () => {
    localStorage.setItem(LANG_STORAGE_KEY, "tr");
    expect(detectLanguage()).toBe("tr");
    localStorage.removeItem(LANG_STORAGE_KEY);
    Object.defineProperty(navigator, "language", { value: "tr-TR", configurable: true });
    expect(detectLanguage()).toBe("tr");
    Object.defineProperty(navigator, "language", { value: "de-DE", configurable: true });
    expect(detectLanguage()).toBe("en");
  });
  it("renders history from structured data", () => {
    expect(historyChange({ action: "role_change", old_value: "branch_manager", new_value: "volunteer" })).toEqual({ key: "history.roleChange", params: { from: "common.roles.branch_manager", to: "common.roles.volunteer" } });
    expect(historyChange({ action: "status_change", old_value: "pending", new_value: "active" }).key).toBe("history.approved");
  });
});
