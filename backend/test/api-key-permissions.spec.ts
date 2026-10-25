/**
 * Every route of the controllers that accept API keys must declare a
 * permission. PermissionGuard lets an API key through any route WITHOUT
 * @RequirePermission, so a missing decorator silently gives read-only keys
 * write access. This test fails when a route is added without one.
 */
import 'reflect-metadata';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { PERMISSION_KEY } from '../src/auth/decorators/require-permission.decorator';
import { InvoicesController } from '../src/invoices/invoices.controller';
import { ClientsController } from '../src/clients/clients.controller';

function routes(controller: any) {
  const proto = controller.prototype;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && Reflect.hasMetadata(PATH_METADATA, proto[name]))
    .map((name) => ({
      name,
      method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, proto[name])],
      path: Reflect.getMetadata(PATH_METADATA, proto[name]),
      permission: Reflect.getMetadata(PERMISSION_KEY, proto[name]) as string | undefined,
    }));
}

describe.each([
  ['invoices', InvoicesController],
  ['clients', ClientsController],
])('%s controller: API-key permission on every route', (resource, controller) => {
  const table = routes(controller);

  it('has routes', () => {
    expect(table.length).toBeGreaterThan(5);
  });

  it.each(table.map((r) => [`${r.method} ${r.path}`, r]))('%s declares a permission', (_label, r: any) => {
    expect(r.permission).toMatch(/^(read|write|delete):[a-z]+$/);
  });

  it.each(table.filter((r) => r.method !== 'GET').map((r) => [`${r.method} ${r.path}`, r]))(
    '%s (state-changing or side-effecting) does not need only read:, except PDF generation',
    (_label, r: any) => {
      if (r.path === ':id/pdf') {
        // Renders existing data (export); see docs/security/2026-10-25-pdf-keys-login.md
        expect(r.permission).toBe(`read:${resource}`);
      } else if (r.path !== 'stats') {
        expect(r.permission).toMatch(new RegExp(`^(write|delete):${resource}$`));
      }
    },
  );

  it.each(table.filter((r) => r.method === 'GET').map((r) => [`${r.method} ${r.path}`, r]))('%s needs read:', (_label, r: any) => {
    expect(r.permission).toMatch(/^read:/);
  });
});
