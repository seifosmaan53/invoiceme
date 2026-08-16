import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [JwtAuthGuard],
    }).compile();

    guard = module.get<JwtAuthGuard>(JwtAuthGuard);
  });

  it('should be defined and resolvable from the DI container', () => {
    // Being retrievable from the module proves it is @Injectable().
    expect(guard).toBeDefined();
    expect(guard).toBeInstanceOf(JwtAuthGuard);
  });

  it('should expose a callable canActivate (inherited from Passport AuthGuard)', () => {
    // JwtAuthGuard extends AuthGuard('jwt'); the real JWT validation is
    // delegated to JwtStrategy, so here we only assert the guard wires up
    // the Passport contract rather than re-testing Passport internals.
    expect(guard.canActivate).toBeDefined();
    expect(typeof guard.canActivate).toBe('function');
  });
});
