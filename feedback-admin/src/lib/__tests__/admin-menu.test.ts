import { describe, expect, it } from "vitest";
import {
  adminBreadcrumbNames,
  adminPathToGroup,
  buildAdminRoute,
} from "../admin/menu";

function routePaths(isSuperAdmin: boolean): string[] {
  const route = buildAdminRoute(isSuperAdmin);
  const groups = (route?.routes ?? []) as Array<{
    routes?: Array<{ path?: string }>;
  }>;
  return groups.flatMap((group) =>
    (group.routes ?? []).map((item) => item.path ?? ""),
  );
}

describe("admin sidebar navigation", () => {
  it("shows network schedules and absences to every admin tier", () => {
    expect(routePaths(false)).toContain("/admin/network/schedules");
    expect(routePaths(false)).toContain("/admin/network/absences");
  });

  it("keeps every production page exclusive to super admins", () => {
    const adminPaths = routePaths(false);
    const superAdminPaths = routePaths(true);

    expect(adminPaths).not.toContain("/admin/production/schedules");
    expect(adminPaths).not.toContain("/admin/production/workshops");
    expect(adminPaths).not.toContain("/admin/production/supplies");
    expect(superAdminPaths).toEqual(expect.arrayContaining([
      "/admin/production/schedules",
      "/admin/production/workshops",
      "/admin/production/supplies",
    ]));
  });

  it("maps each new route to a stable breadcrumb and sidebar group", () => {
    expect(adminBreadcrumbNames["/admin/network/schedules"]).toBe("Графіки роботи");
    expect(adminPathToGroup["/admin/network/schedules"]).toBe("Мережа");
    expect(adminBreadcrumbNames["/admin/network/absences"]).toBe("Графік відсутностей");
    expect(adminPathToGroup["/admin/network/absences"]).toBe("Мережа");
    expect(adminPathToGroup["/admin/production/workshops"]).toBe("Виробництво");
    expect(adminPathToGroup["/admin/production/supplies"]).toBe("Виробництво");
  });
});
