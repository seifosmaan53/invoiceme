import { Test, TestingModule } from '@nestjs/testing';
import { LocalAuthGuard, JwtAuthGuard as DuplicateJwtAuthGuard } from '../src/auth/guards/local-auth.guard';

describe('LocalAuthGuard', () => {
  let guard: LocalAuthGuard;
  let duplicateJwtGuard: DuplicateJwtAuthGuard;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [LocalAuthGuard, DuplicateJwtAuthGuard],
    }).compile();

    guard = module.get<LocalAuthGuard>(LocalAuthGuard);
    duplicateJwtGuard = module.get<DuplicateJwtAuthGuard>(DuplicateJwtAuthGuard);
  });

  it('should be defined and resolvable from the DI container', () => {
    // Being retrievable from the module proves it is @Injectable().
    expect(guard).toBeDefined();
    expect(guard).toBeInstanceOf(LocalAuthGuard);
  });

  it('should expose a callable canActivate (inherited from Passport AuthGuard)', () => {
    // LocalAuthGuard extends AuthGuard('local'); actual credential
    // validation is delegated to LocalStrategy, so we only assert the
    // guard wires up the Passport contract, not Passport's internals.
    expect(guard.canActivate).toBeDefined();
    expect(typeof guard.canActivate).toBe('function');
  });

  it('should also export a duplicate JwtAuthGuard that is resolvable', () => {
    // local-auth.guard.ts additionally declares a JwtAuthGuard; it is a
    // duplicate of the one in jwt-auth.guard.ts and could be removed, but
    // while it exists we verify it is a valid injectable guard.
    expect(duplicateJwtGuard).toBeDefined();
    expect(duplicateJwtGuard).toBeInstanceOf(DuplicateJwtAuthGuard);
    expect(typeof duplicateJwtGuard.canActivate).toBe('function');
  });
});
